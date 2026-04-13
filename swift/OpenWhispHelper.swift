import AppKit
import ApplicationServices
import Foundation

struct PermissionState: Codable {
    let microphone: String
    let accessibility: Bool
    let inputMonitoring: Bool
    let postEvents: Bool
}

struct FocusState: Codable {
    let canPaste: Bool
    let role: String?
    let appName: String?
    let bundleIdentifier: String?
    let processIdentifier: Int32?
}

struct OkState: Codable {
    let ok: Bool
}

struct EventMessage: Codable {
    let type: String
    let message: String?
}

private var hotkeyIsDown = false
private var targetKeyCode: Int64 = 61
private var targetModifiers: UInt64 = 0

// Modifier flag constants matching CGEventFlags raw values
private let kModifierCommand: UInt64  = 0x100000
private let kModifierOption: UInt64   = 0x80000
private let kModifierShift: UInt64    = 0x20000
private let kModifierControl: UInt64  = 0x40000
private let kModifierFn: UInt64       = 0x800000

// Key codes that are themselves modifier keys
private let modifierKeyCodes: Set<Int64> = [54, 55, 56, 58, 59, 60, 61, 62, 63]

private func flagForKeyCode(_ code: Int64) -> UInt64 {
    switch code {
    case 54, 55: return kModifierCommand
    case 58, 61: return kModifierOption
    case 56, 60: return kModifierShift
    case 59, 62: return kModifierControl
    case 63: return kModifierFn
    default: return 0
    }
}

func emitJSON<T: Encodable>(_ value: T) {
    let encoder = JSONEncoder()
    encoder.outputFormatting = []

    guard let data = try? encoder.encode(value) else {
        return
    }

    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write("\n".data(using: .utf8)!)
}

func inputMonitoringGranted() -> Bool {
    if #available(macOS 10.15, *) {
        return CGPreflightListenEventAccess()
    }

    return true
}

func postEventsGranted() -> Bool {
    if #available(macOS 10.15, *) {
        return CGPreflightPostEventAccess()
    }

    return true
}

func buildPermissionState() -> PermissionState {
    PermissionState(
        microphone: "unknown",
        accessibility: AXIsProcessTrusted(),
        inputMonitoring: inputMonitoringGranted(),
        postEvents: postEventsGranted()
    )
}

func requestPermissions() -> PermissionState {
    let options = [
        kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true
    ] as CFDictionary

    _ = AXIsProcessTrustedWithOptions(options)

    if #available(macOS 10.15, *) {
        _ = CGRequestListenEventAccess()
        _ = CGRequestPostEventAccess()
    }

    return buildPermissionState()
}

func currentFocus() -> FocusState {
    let frontmostApplication = NSWorkspace.shared.frontmostApplication
    let appName = frontmostApplication?.localizedName
    let bundleIdentifier = frontmostApplication?.bundleIdentifier
    let processIdentifier = frontmostApplication.map { Int32($0.processIdentifier) }
    let systemWide = AXUIElementCreateSystemWide()
    var focusedRef: CFTypeRef?

    let focusedStatus = AXUIElementCopyAttributeValue(
        systemWide,
        kAXFocusedUIElementAttribute as CFString,
        &focusedRef
    )

    guard focusedStatus == .success, let focusedRef else {
        return FocusState(
            canPaste: false,
            role: nil,
            appName: appName,
            bundleIdentifier: bundleIdentifier,
            processIdentifier: processIdentifier
        )
    }

    let focused = unsafeBitCast(focusedRef, to: AXUIElement.self)

    var roleRef: CFTypeRef?
    let roleStatus = AXUIElementCopyAttributeValue(
        focused,
        kAXRoleAttribute as CFString,
        &roleRef
    )

    let role = roleStatus == .success ? (roleRef as? String) : nil
    let knownTextRoles: Set<String> = [
        kAXTextFieldRole as String,
        kAXTextAreaRole as String,
        "AXSearchField",
        kAXComboBoxRole as String,
        "AXWebArea"
    ]

    var valueSettable = DarwinBoolean(false)
    let valueStatus = AXUIElementIsAttributeSettable(
        focused,
        kAXValueAttribute as CFString,
        &valueSettable
    )

    var selectedTextRangeRef: CFTypeRef?
    let selectedTextRangeStatus = AXUIElementCopyAttributeValue(
        focused,
        kAXSelectedTextRangeAttribute as CFString,
        &selectedTextRangeRef
    )

    let canPaste =
        knownTextRoles.contains(role ?? "") ||
        (valueStatus == .success && valueSettable.boolValue) ||
        selectedTextRangeStatus == .success

    return FocusState(
        canPaste: canPaste,
        role: role,
        appName: appName,
        bundleIdentifier: bundleIdentifier,
        processIdentifier: processIdentifier
    )
}

func activateTargetApplication(bundleIdentifier: String?, processIdentifier: pid_t?) {
    var application: NSRunningApplication?

    if let processIdentifier, processIdentifier > 0 {
        application = NSRunningApplication(processIdentifier: processIdentifier)
    }

    if application == nil, let bundleIdentifier, !bundleIdentifier.isEmpty {
        application = NSRunningApplication.runningApplications(withBundleIdentifier: bundleIdentifier).first
    }

    application?.unhide()
    _ = application?.activate(options: [.activateIgnoringOtherApps])
    usleep(260_000)
}

func pasteClipboardContents(bundleIdentifier: String?, processIdentifier: pid_t?) -> Bool {
    guard postEventsGranted() else {
        return false
    }

    activateTargetApplication(bundleIdentifier: bundleIdentifier, processIdentifier: processIdentifier)

    let commandKeyCode: CGKeyCode = 55
    let keyCodeV: CGKeyCode = 9
    guard let source = CGEventSource(stateID: .combinedSessionState),
          let commandDown = CGEvent(keyboardEventSource: source, virtualKey: commandKeyCode, keyDown: true),
          let keyDown = CGEvent(keyboardEventSource: source, virtualKey: keyCodeV, keyDown: true),
          let keyUp = CGEvent(keyboardEventSource: source, virtualKey: keyCodeV, keyDown: false),
          let commandUp = CGEvent(keyboardEventSource: source, virtualKey: commandKeyCode, keyDown: false)
    else {
        return false
    }

    commandDown.flags = .maskCommand
    keyDown.flags = .maskCommand
    keyUp.flags = .maskCommand
    commandUp.flags = []
    commandDown.post(tap: .cghidEventTap)
    usleep(12_000)
    keyDown.post(tap: .cghidEventTap)
    keyUp.post(tap: .cghidEventTap)
    usleep(12_000)
    commandUp.post(tap: .cghidEventTap)

    return true
}

private func hotkeyCallback(
    proxy: CGEventTapProxy,
    type: CGEventType,
    event: CGEvent,
    userInfo: UnsafeMutableRawPointer?
) -> Unmanaged<CGEvent>? {
    let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
    let rawFlags = event.flags.rawValue

    if type == .flagsChanged {
        if modifierKeyCodes.contains(targetKeyCode) && targetModifiers == 0 {
            // Single modifier key mode (e.g. right Option alone)
            guard keyCode == targetKeyCode else {
                return Unmanaged.passUnretained(event)
            }
            let keyFlag = flagForKeyCode(targetKeyCode)
            let isDown = (rawFlags & keyFlag) != 0
            if isDown != hotkeyIsDown {
                hotkeyIsDown = isDown
                emitJSON(EventMessage(type: isDown ? "fnDown" : "fnUp", message: nil))
            }
        } else if modifierKeyCodes.contains(targetKeyCode) && targetModifiers != 0 {
            // Modifier combo mode (e.g. Cmd+Option = press Option while Cmd is held)
            guard keyCode == targetKeyCode else {
                return Unmanaged.passUnretained(event)
            }
            let keyFlag = flagForKeyCode(targetKeyCode)
            let keyIsDown = (rawFlags & keyFlag) != 0
            let modifiersHeld = (rawFlags & targetModifiers) == targetModifiers
            let isDown = keyIsDown && modifiersHeld
            if isDown != hotkeyIsDown {
                hotkeyIsDown = isDown
                emitJSON(EventMessage(type: isDown ? "fnDown" : "fnUp", message: nil))
            }
        }
    } else if type == .keyDown || type == .keyUp {
        // Regular key with modifier combo (e.g. Cmd+Opt+Space)
        guard !modifierKeyCodes.contains(targetKeyCode) else {
            return Unmanaged.passUnretained(event)
        }
        guard keyCode == targetKeyCode else {
            return Unmanaged.passUnretained(event)
        }
        if targetModifiers != 0 {
            let modifiersHeld = (rawFlags & targetModifiers) == targetModifiers
            guard modifiersHeld else {
                return Unmanaged.passUnretained(event)
            }
        }
        let isDown = (type == .keyDown)
        if isDown != hotkeyIsDown {
            hotkeyIsDown = isDown
            emitJSON(EventMessage(type: isDown ? "fnDown" : "fnUp", message: nil))
        }
    }

    return Unmanaged.passUnretained(event)
}

func listenForHotkey() -> Int32 {
    guard inputMonitoringGranted() else {
        emitJSON(EventMessage(type: "error", message: "Input Monitoring is not enabled for OpenWhisp."))
        return 1
    }

    var eventMask: CGEventMask
    if modifierKeyCodes.contains(targetKeyCode) {
        eventMask = CGEventMask(1 << CGEventType.flagsChanged.rawValue)
    } else {
        eventMask = CGEventMask(
            (1 << CGEventType.flagsChanged.rawValue) |
            (1 << CGEventType.keyDown.rawValue) |
            (1 << CGEventType.keyUp.rawValue)
        )
    }

    guard let tap = CGEvent.tapCreate(
        tap: .cgSessionEventTap,
        place: .headInsertEventTap,
        options: .listenOnly,
        eventsOfInterest: eventMask,
        callback: hotkeyCallback,
        userInfo: nil
    ) else {
        emitJSON(EventMessage(type: "error", message: "OpenWhisp could not create the global hotkey listener."))
        return 1
    }

    let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
    CFRunLoopAddSource(CFRunLoopGetCurrent(), source, .commonModes)
    CGEvent.tapEnable(tap: tap, enable: true)
    CFRunLoopRun()

    return 0
}

let arguments = CommandLine.arguments

guard arguments.count >= 2 else {
    emitJSON(EventMessage(type: "error", message: "No helper command was provided."))
    exit(1)
}

switch arguments[1] {
case "permissions":
    if arguments.count >= 3 && arguments[2] == "request" {
        emitJSON(requestPermissions())
    } else {
        emitJSON(buildPermissionState())
    }
case "focus":
    emitJSON(currentFocus())
case "paste":
    let bundleIdentifier = arguments.count >= 3 ? arguments[2] : nil
    let processIdentifier = arguments.count >= 4 ? Int32(arguments[3]) : nil
    emitJSON(OkState(ok: pasteClipboardContents(bundleIdentifier: bundleIdentifier, processIdentifier: processIdentifier)))
case "listen":
    if arguments.count >= 3, let code = Int64(arguments[2]) {
        targetKeyCode = code
    }
    if arguments.count >= 4, let mods = UInt64(arguments[3]) {
        targetModifiers = mods
    }
    exit(listenForHotkey())
default:
    emitJSON(EventMessage(type: "error", message: "Unknown helper command."))
    exit(1)
}
