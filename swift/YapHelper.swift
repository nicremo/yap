// Native macOS helper for Yap.
//
// Runs as one long-lived process (`yap-helper serve`) for the lifetime of the
// app. Commands arrive as JSON lines on stdin, replies and events leave as
// JSON lines on stdout. Keeping it alive removes a process launch from every
// focus query and every paste, and lets it watch the hotkey, the permissions
// and the clipboard continuously.
//
// Threads:
//   main      command handling, clipboard, paste, permission polling
//   hotkey    the event tap and its run loop, so nothing the main thread does
//             can ever delay keyboard input
//   stdin     blocking line reader that hands commands to the main queue

import AppKit
import ApplicationServices
import Foundation

let helperVersion = 2

// MARK: - Output

private let outputQueue = DispatchQueue(label: "yap.helper.output")

func send(_ message: [String: Any]) {
    guard JSONSerialization.isValidJSONObject(message),
          var data = try? JSONSerialization.data(withJSONObject: message, options: [])
    else {
        return
    }
    data.append(0x0A)
    outputQueue.sync {
        FileHandle.standardOutput.write(data)
    }
}

func orNull(_ value: Any?) -> Any {
    return value ?? NSNull()
}

// MARK: - Permissions

func inputMonitoringGranted() -> Bool {
    return CGPreflightListenEventAccess()
}

func postEventsGranted() -> Bool {
    return CGPreflightPostEventAccess()
}

func permissionState() -> [String: Any] {
    return [
        "accessibility": AXIsProcessTrusted(),
        "inputMonitoring": inputMonitoringGranted(),
        "postEvents": postEventsGranted(),
    ]
}

func requestAccessibility() {
    let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
    _ = AXIsProcessTrustedWithOptions(options)
}

func requestInputMonitoring() {
    _ = CGRequestListenEventAccess()
}

/// What the Globe/Fn key does: 0 nothing, 1 input source, 2 emoji, 3 dictation.
func fnUsageType() -> Int? {
    guard let value = CFPreferencesCopyAppValue("AppleFnUsageType" as CFString, "com.apple.HIToolbox" as CFString) else {
        return nil
    }
    return (value as? NSNumber)?.intValue
}

// MARK: - Focus

private let systemWideElement: AXUIElement = {
    let element = AXUIElementCreateSystemWide()
    // A hung target app must not be able to stall the helper.
    _ = AXUIElementSetMessagingTimeout(element, 0.25)
    return element
}()

/// The pid of the app that has keyboard focus, asked fresh from the
/// accessibility server. Falls back to NSWorkspace, which can lag a run loop turn.
func frontmostPid() -> pid_t? {
    if AXIsProcessTrusted() {
        var value: CFTypeRef?
        if AXUIElementCopyAttributeValue(systemWideElement, kAXFocusedApplicationAttribute as CFString, &value) == .success,
           let value {
            let element = unsafeBitCast(value, to: AXUIElement.self)
            var pid: pid_t = 0
            if AXUIElementGetPid(element, &pid) == .success, pid > 0 {
                return pid
            }
        }
    }
    return NSWorkspace.shared.frontmostApplication?.processIdentifier
}

func focusInfo(for application: NSRunningApplication?) -> [String: Any] {
    guard let application else {
        return [:]
    }
    return [
        "appName": orNull(application.localizedName),
        "bundleIdentifier": orNull(application.bundleIdentifier),
        "processIdentifier": Int(application.processIdentifier),
    ]
}

func currentFocus() -> [String: Any] {
    if let pid = frontmostPid(), let application = NSRunningApplication(processIdentifier: pid) {
        return focusInfo(for: application)
    }
    return focusInfo(for: NSWorkspace.shared.frontmostApplication)
}

// MARK: - Hotkey

private let modifierKeyCodes: Set<Int64> = [54, 55, 56, 58, 59, 60, 61, 62, 63]

private let flagCommand: UInt64 = 0x100000
private let flagOption: UInt64 = 0x80000
private let flagShift: UInt64 = 0x20000
private let flagControl: UInt64 = 0x40000
private let flagFn: UInt64 = 0x800000

// Device-dependent bits tell the left and right variant of a modifier apart.
private let deviceFlagsMask: UInt64 = 0x207F

private func genericFlag(for keyCode: Int64) -> UInt64 {
    switch keyCode {
    case 54, 55: return flagCommand
    case 58, 61: return flagOption
    case 56, 60: return flagShift
    case 59, 62: return flagControl
    case 63: return flagFn
    default: return 0
    }
}

private func deviceFlag(for keyCode: Int64) -> UInt64 {
    switch keyCode {
    case 59: return 0x01   // left control
    case 56: return 0x02   // left shift
    case 60: return 0x04   // right shift
    case 55: return 0x08   // left command
    case 54: return 0x10   // right command
    case 58: return 0x20   // left option
    case 61: return 0x40   // right option
    case 62: return 0x2000 // right control
    default: return 0
    }
}

/// Whether the given modifier key is held according to a flags value.
private func modifierKeyIsDown(_ keyCode: Int64, flags: UInt64) -> Bool {
    let device = deviceFlag(for: keyCode)
    if device != 0 && (flags & deviceFlagsMask) != 0 {
        return (flags & device) != 0
    }
    return (flags & genericFlag(for: keyCode)) != 0
}

private final class HotkeyState {
    let lock = NSLock()
    var keyCode: Int64 = 63
    var modifiers: UInt64 = 0
    var isDown = false
}

private let hotkey = HotkeyState()
private var tapPort: CFMachPort?
private var tapRunLoop: CFRunLoop?
private var tapMode: String?
private var listenerWanted = false
private var listenerError: String?

private func emitHotkey(down: Bool) {
    var message: [String: Any] = ["event": "hotkey", "state": down ? "down" : "up"]
    if down {
        // NSRunningApplication properties are safe to read from this thread.
        message["focus"] = focusInfo(for: NSWorkspace.shared.frontmostApplication)
    }
    send(message)
}

/// Computes the new pressed state for an event, or nil when the event is not about the hotkey.
private func evaluate(type: CGEventType, keyCode: Int64, flags: UInt64, target: Int64, modifiers: UInt64) -> Bool? {
    if modifierKeyCodes.contains(target) {
        guard type == .flagsChanged, keyCode == target else { return nil }
        let keyDown = modifierKeyIsDown(target, flags: flags)
        if modifiers == 0 {
            return keyDown
        }
        return keyDown && (flags & modifiers) == modifiers
    }

    guard type == .keyDown || type == .keyUp, keyCode == target else { return nil }
    if type == .keyDown && modifiers != 0 && (flags & modifiers) != modifiers {
        return nil
    }
    return type == .keyDown
}

/// After the tap was disabled events may have been missed. Read the real key state.
private func resyncHotkey() {
    hotkey.lock.lock()
    let target = hotkey.keyCode
    let modifiers = hotkey.modifiers
    let wasDown = hotkey.isDown
    let flags = CGEventSource.flagsState(.combinedSessionState).rawValue
    var nowDown: Bool
    if modifierKeyCodes.contains(target) {
        nowDown = modifierKeyIsDown(target, flags: flags)
    } else {
        nowDown = CGEventSource.keyState(.combinedSessionState, key: CGKeyCode(truncatingIfNeeded: target))
    }
    if modifiers != 0 {
        nowDown = nowDown && (flags & modifiers) == modifiers
    }
    hotkey.isDown = nowDown
    hotkey.lock.unlock()

    if nowDown != wasDown {
        emitHotkey(down: nowDown)
    }
}

private func hotkeyCallback(
    proxy: CGEventTapProxy,
    type: CGEventType,
    event: CGEvent,
    userInfo: UnsafeMutableRawPointer?
) -> Unmanaged<CGEvent>? {
    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
        // macOS switches a tap off when it was slow once. Without turning it
        // back on the hotkey silently stops working until the app restarts.
        if let tapPort {
            CGEvent.tapEnable(tap: tapPort, enable: true)
        }
        resyncHotkey()
        return Unmanaged.passUnretained(event)
    }

    if type == .keyDown && event.getIntegerValueField(.keyboardEventAutorepeat) != 0 {
        return Unmanaged.passUnretained(event)
    }

    let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
    let flags = event.flags.rawValue

    hotkey.lock.lock()
    let next = evaluate(type: type, keyCode: keyCode, flags: flags, target: hotkey.keyCode, modifiers: hotkey.modifiers)
    var changed = false
    if let next, next != hotkey.isDown {
        hotkey.isDown = next
        changed = true
    }
    hotkey.lock.unlock()

    if changed, let next {
        emitHotkey(down: next)
    }

    // Never swallow or alter the event: other apps see the key exactly as typed.
    return Unmanaged.passUnretained(event)
}

/// Creates the tap on its own thread and waits for the outcome. The result is
/// communicated through `tapPort`, so the thread closure captures nothing mutable.
private func createTap(listenOnly: Bool) -> Bool {
    let ready = DispatchSemaphore(value: 0)

    let thread = Thread {
        let mask = CGEventMask(1 << CGEventType.flagsChanged.rawValue)
            | CGEventMask(1 << CGEventType.keyDown.rawValue)
            | CGEventMask(1 << CGEventType.keyUp.rawValue)

        guard let port = CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: listenOnly ? .listenOnly : .defaultTap,
            eventsOfInterest: mask,
            callback: hotkeyCallback,
            userInfo: nil
        ) else {
            ready.signal()
            return
        }

        let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, port, 0)
        let runLoop = CFRunLoopGetCurrent()
        CFRunLoopAddSource(runLoop, source, .commonModes)
        CGEvent.tapEnable(tap: port, enable: true)
        tapPort = port
        tapRunLoop = runLoop
        ready.signal()
        CFRunLoopRun()
    }
    thread.name = "yap.hotkey"
    thread.qualityOfService = .userInteractive
    thread.start()

    ready.wait()
    return tapPort != nil
}

private func stopTap() {
    if let port = tapPort {
        CGEvent.tapEnable(tap: port, enable: false)
        CFMachPortInvalidate(port)
    }
    if let runLoop = tapRunLoop {
        CFRunLoopStop(runLoop)
    }
    tapPort = nil
    tapRunLoop = nil
    tapMode = nil
    hotkey.lock.lock()
    hotkey.isDown = false
    hotkey.lock.unlock()
}

func listenerStatus() -> [String: Any] {
    return [
        "active": tapPort != nil,
        "mode": orNull(tapMode),
        "error": orNull(tapPort == nil ? listenerError : nil),
    ]
}

/// Starts the tap with the least intrusive mode the permissions allow:
/// a passive listener with Input Monitoring, otherwise an active pass-through
/// tap, which only needs Accessibility.
func startListening() {
    guard listenerWanted, tapPort == nil else { return }

    if inputMonitoringGranted() && createTap(listenOnly: true) {
        tapMode = "listen-only"
    } else if AXIsProcessTrusted() && createTap(listenOnly: false) {
        tapMode = "active"
    } else if !AXIsProcessTrusted() && !inputMonitoringGranted() {
        listenerError = "Yap needs Accessibility access to see the dictation key."
    } else {
        listenerError = "macOS refused the keyboard listener. Remove Yap from Accessibility and Input Monitoring in System Settings, then grant access again."
    }

    if tapPort != nil {
        listenerError = nil
        resyncHotkey()
    }
    var message: [String: Any] = ["event": "listener"]
    message.merge(listenerStatus()) { current, _ in current }
    send(message)
}

// MARK: - Clipboard and paste

private let transientTypes = [
    NSPasteboard.PasteboardType("org.nspasteboard.TransientType"),
    NSPasteboard.PasteboardType("org.nspasteboard.ConcealedType"),
    NSPasteboard.PasteboardType("org.nspasteboard.AutoGeneratedType"),
]

/// How long the dictated text stays on the clipboard before the previous
/// content comes back. The target app reads it while handling Cmd+V, slow
/// apps can take a few hundred milliseconds for that.
private let restoreDelay: TimeInterval = 0.8

private struct Snapshot {
    let items: [NSPasteboardItem]
    let changeCount: Int
}

private var preparedSnapshot: Snapshot?
private var pendingRestore: (items: [NSPasteboardItem], work: DispatchWorkItem)?

private func snapshotPasteboard() -> Snapshot {
    let pasteboard = NSPasteboard.general
    var items: [NSPasteboardItem] = []
    for item in pasteboard.pasteboardItems ?? [] {
        let copy = NSPasteboardItem()
        var hasData = false
        for type in item.types {
            if let data = item.data(forType: type) {
                copy.setData(data, forType: type)
                hasData = true
            }
        }
        if hasData {
            items.append(copy)
        }
    }
    return Snapshot(items: items, changeCount: pasteboard.changeCount)
}

/// Called when the hotkey goes down, so reading a large clipboard happens
/// while the user speaks instead of delaying the paste.
func prepareClipboard() {
    if pendingRestore != nil {
        // The clipboard currently holds our previous text. The snapshot of
        // the real content travels with that pending restore.
        return
    }
    preparedSnapshot = snapshotPasteboard()
}

private func activateIfNeeded(pid: pid_t?) {
    guard let pid, pid > 0, pid != getpid() else { return }
    if frontmostPid() == pid { return }
    guard let application = NSRunningApplication(processIdentifier: pid), !application.isTerminated else { return }

    application.unhide()
    application.activate(options: [.activateIgnoringOtherApps])

    // Wait until it really has focus rather than sleeping a fixed time.
    for _ in 0..<40 {
        usleep(10_000)
        if frontmostPid() == pid {
            usleep(30_000)
            return
        }
    }
}

private func postCommandV() -> Bool {
    guard let source = CGEventSource(stateID: .combinedSessionState),
          let commandDown = CGEvent(keyboardEventSource: source, virtualKey: 55, keyDown: true),
          let keyDown = CGEvent(keyboardEventSource: source, virtualKey: 9, keyDown: true),
          let keyUp = CGEvent(keyboardEventSource: source, virtualKey: 9, keyDown: false),
          let commandUp = CGEvent(keyboardEventSource: source, virtualKey: 55, keyDown: false)
    else {
        return false
    }

    // Explicit flags, so a modifier still physically held cannot turn this
    // into Cmd+Shift+V or similar.
    commandDown.flags = .maskCommand
    keyDown.flags = .maskCommand
    keyUp.flags = .maskCommand
    commandUp.flags = []

    commandDown.post(tap: .cghidEventTap)
    usleep(8_000)
    keyDown.post(tap: .cghidEventTap)
    keyUp.post(tap: .cghidEventTap)
    usleep(8_000)
    commandUp.post(tap: .cghidEventTap)
    return true
}

func paste(text: String, restore: Bool, pid: pid_t?) -> [String: Any] {
    guard AXIsProcessTrusted() || postEventsGranted() else {
        return ["ok": false, "reason": "accessibility"]
    }

    let pasteboard = NSPasteboard.general
    var original: [NSPasteboardItem]?

    if let pending = pendingRestore {
        pending.work.cancel()
        pendingRestore = nil
        if restore {
            original = pending.items
        }
    } else if restore {
        if let prepared = preparedSnapshot, prepared.changeCount == pasteboard.changeCount {
            original = prepared.items
        } else {
            original = snapshotPasteboard().items
        }
    }
    preparedSnapshot = nil

    if restore {
        // Marked transient and kept off Universal Clipboard, so clipboard
        // managers and other devices never record the temporary text.
        pasteboard.prepareForNewContents(with: .currentHostOnly)
        let item = NSPasteboardItem()
        item.setString(text, forType: .string)
        for type in transientTypes {
            item.setData(Data(), forType: type)
        }
        pasteboard.writeObjects([item])
    } else {
        pasteboard.clearContents()
        pasteboard.setString(text, forType: .string)
    }
    let ownChangeCount = pasteboard.changeCount

    activateIfNeeded(pid: pid)
    let posted = postCommandV()

    if restore, let original {
        let work = DispatchWorkItem {
            pendingRestore = nil
            // Somebody copied something in the meantime: theirs wins.
            guard pasteboard.changeCount == ownChangeCount else { return }
            pasteboard.clearContents()
            if !original.isEmpty {
                pasteboard.writeObjects(original)
            }
        }
        pendingRestore = (original, work)
        DispatchQueue.main.asyncAfter(deadline: .now() + restoreDelay, execute: work)
    }

    return ["ok": posted]
}

// MARK: - Permission watching

private var lastPermissions: [String: Bool] = [:]
private var permissionTimer: DispatchSourceTimer?

private func pollPermissions() {
    let current = [
        "accessibility": AXIsProcessTrusted(),
        "inputMonitoring": inputMonitoringGranted(),
        "postEvents": postEventsGranted(),
    ]
    guard current != lastPermissions else { return }
    lastPermissions = current

    var message: [String: Any] = ["event": "permissions"]
    for (key, value) in current {
        message[key] = value
    }
    send(message)

    guard listenerWanted else { return }
    let accessibility = current["accessibility"] == true
    let inputMonitoring = current["inputMonitoring"] == true

    if tapPort == nil {
        if accessibility || inputMonitoring {
            startListening()
        }
    } else if tapMode == "active" && (inputMonitoring || !accessibility) {
        // Prefer the passive listener as soon as Input Monitoring allows it,
        // and drop an active tap whose permission was taken away.
        stopTap()
        startListening()
    } else if tapMode == "listen-only" && !inputMonitoring {
        stopTap()
        startListening()
    }
}

// MARK: - Commands

private func handle(_ line: String) {
    guard let data = line.data(using: .utf8),
          let command = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
          let name = command["cmd"] as? String
    else {
        send(["event": "error", "message": "Malformed command."])
        return
    }

    let id = command["id"] as? Int ?? 0
    func reply(_ result: [String: Any]) {
        send(["id": id, "ok": true, "result": result])
    }

    switch name {
    case "hello":
        reply(["version": helperVersion, "pid": Int(getpid())])
    case "permissions":
        reply(permissionState())
    case "requestAccessibility":
        requestAccessibility()
        reply(permissionState())
    case "requestInputMonitoring":
        requestInputMonitoring()
        reply(permissionState())
    case "listen":
        let keyCode = (command["keyCode"] as? NSNumber)?.int64Value ?? 63
        let modifiers = (command["modifiers"] as? NSNumber)?.uint64Value ?? 0
        hotkey.lock.lock()
        let changed = hotkey.keyCode != keyCode || hotkey.modifiers != modifiers
        hotkey.keyCode = keyCode
        hotkey.modifiers = modifiers
        if changed {
            hotkey.isDown = false
        }
        hotkey.lock.unlock()
        listenerWanted = true
        startListening()
        reply(listenerStatus())
    case "stopListening":
        listenerWanted = false
        stopTap()
        reply(listenerStatus())
    case "listenerStatus":
        reply(listenerStatus())
    case "focus":
        reply(currentFocus())
    case "prepareClipboard":
        prepareClipboard()
        reply([:])
    case "paste":
        let text = command["text"] as? String ?? ""
        let restore = command["restore"] as? Bool ?? false
        let pid = (command["processIdentifier"] as? NSNumber).map { pid_t($0.int32Value) }
        reply(paste(text: text, restore: restore, pid: pid))
    case "fnUsage":
        reply(["value": orNull(fnUsageType())])
    default:
        send(["id": id, "ok": false, "error": "Unknown command \(name)."])
    }
}

func serve() -> Never {
    signal(SIGPIPE, SIG_DFL)

    lastPermissions = [
        "accessibility": AXIsProcessTrusted(),
        "inputMonitoring": inputMonitoringGranted(),
        "postEvents": postEventsGranted(),
    ]

    let timer = DispatchSource.makeTimerSource(queue: .main)
    timer.schedule(deadline: .now() + 1, repeating: 1)
    timer.setEventHandler(handler: pollPermissions)
    timer.resume()
    permissionTimer = timer

    let reader = Thread {
        while let line = readLine(strippingNewline: true) {
            if line.isEmpty { continue }
            DispatchQueue.main.async {
                handle(line)
            }
        }
        // The app closed our stdin: it quit or crashed. Leave with it.
        DispatchQueue.main.async {
            stopTap()
            exit(0)
        }
    }
    reader.name = "yap.stdin"
    reader.start()

    send(["event": "ready", "version": helperVersion])
    CFRunLoopRun()
    exit(0)
}

// MARK: - Entry

let arguments = CommandLine.arguments

if arguments.count >= 2 && arguments[1] == "--version" {
    print(helperVersion)
    exit(0)
}

if arguments.count >= 2 && arguments[1] == "serve" {
    serve()
}

FileHandle.standardError.write("Usage: yap-helper serve\n".data(using: .utf8)!)
exit(1)
