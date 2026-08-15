#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <psapi.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// Abstract key codes (must match src/shared/hotkeys.ts ABSTRACT_KEY)
static const int AK_LEFT_META  = 1;
static const int AK_RIGHT_META = 2;
static const int AK_LEFT_ALT   = 3;
static const int AK_RIGHT_ALT  = 4;
static const int AK_LEFT_SHIFT = 5;
static const int AK_RIGHT_SHIFT= 6;
static const int AK_LEFT_CTRL  = 7;
static const int AK_RIGHT_CTRL = 8;
static const int AK_FN         = 9;
static const int AK_KEY_A      = 100;
static const int AK_DIGIT_0    = 200;
static const int AK_SPACE      = 300;
static const int AK_ENTER      = 301;
static const int AK_TAB        = 302;
static const int AK_BACKSPACE  = 303;
static const int AK_ESCAPE     = 304;
static const int AK_F1         = 400;

// Abstract modifier flags (must match src/shared/hotkeys.ts ABSTRACT_MODIFIER)
static const int AM_META  = 0x01;
static const int AM_ALT   = 0x02;
static const int AM_SHIFT = 0x04;
static const int AM_CTRL  = 0x08;

static int targetKeyCode = AK_RIGHT_ALT;
static int targetModifiers = 0;
static bool hotkeyIsDown = false;

static void emitJson(const char* json) {
    printf("%s\n", json);
    fflush(stdout);
}

static void emitEvent(const char* type) {
    char buf[128];
    snprintf(buf, sizeof(buf), "{\"type\":\"%s\",\"message\":null}", type);
    emitJson(buf);
}

static void emitError(const char* message) {
    char buf[512];
    snprintf(buf, sizeof(buf), "{\"type\":\"error\",\"message\":\"%s\"}", message);
    emitJson(buf);
}

// Translate abstract key code to Windows VK code
static WORD abstractToVk(int abstractKey) {
    if (abstractKey == AK_LEFT_META)   return VK_LWIN;
    if (abstractKey == AK_RIGHT_META)  return VK_RWIN;
    if (abstractKey == AK_LEFT_ALT)    return VK_LMENU;
    if (abstractKey == AK_RIGHT_ALT)   return VK_RMENU;
    if (abstractKey == AK_LEFT_SHIFT)  return VK_LSHIFT;
    if (abstractKey == AK_RIGHT_SHIFT) return VK_RSHIFT;
    if (abstractKey == AK_LEFT_CTRL)   return VK_LCONTROL;
    if (abstractKey == AK_RIGHT_CTRL)  return VK_RCONTROL;
    if (abstractKey == AK_FN)          return 0;
    if (abstractKey >= AK_KEY_A && abstractKey <= AK_KEY_A + 25)
        return (WORD)('A' + (abstractKey - AK_KEY_A));
    if (abstractKey >= AK_DIGIT_0 && abstractKey <= AK_DIGIT_0 + 9)
        return (WORD)('0' + (abstractKey - AK_DIGIT_0));
    if (abstractKey == AK_SPACE)     return VK_SPACE;
    if (abstractKey == AK_ENTER)     return VK_RETURN;
    if (abstractKey == AK_TAB)       return VK_TAB;
    if (abstractKey == AK_BACKSPACE) return VK_BACK;
    if (abstractKey == AK_ESCAPE)    return VK_ESCAPE;
    if (abstractKey >= AK_F1 && abstractKey <= AK_F1 + 14)
        return (WORD)(VK_F1 + (abstractKey - AK_F1));
    return 0;
}

static bool isModifierKey(int abstractKey) {
    return abstractKey >= AK_LEFT_META && abstractKey <= AK_FN;
}

static bool abstractModifiersHeld(int modifiers) {
    if ((modifiers & AM_META) && !(GetAsyncKeyState(VK_LWIN) & 0x8000) && !(GetAsyncKeyState(VK_RWIN) & 0x8000))
        return false;
    if ((modifiers & AM_ALT) && !(GetAsyncKeyState(VK_LMENU) & 0x8000) && !(GetAsyncKeyState(VK_RMENU) & 0x8000))
        return false;
    if ((modifiers & AM_SHIFT) && !(GetAsyncKeyState(VK_LSHIFT) & 0x8000) && !(GetAsyncKeyState(VK_RSHIFT) & 0x8000))
        return false;
    if ((modifiers & AM_CTRL) && !(GetAsyncKeyState(VK_LCONTROL) & 0x8000) && !(GetAsyncKeyState(VK_RCONTROL) & 0x8000))
        return false;
    return true;
}

// ── Permissions ─────────────────────────────────

static void cmdPermissions() {
    emitJson("{\"microphone\":\"unknown\",\"accessibility\":true,\"inputMonitoring\":true,\"postEvents\":true}");
}

// ── Focus ───────────────────────────────────────

static void cmdFocus() {
    HWND hwnd = GetForegroundWindow();
    if (!hwnd) {
        emitJson("{\"canPaste\":false}");
        return;
    }

    DWORD pid = 0;
    GetWindowThreadProcessId(hwnd, &pid);

    char appName[512] = "";
    HANDLE hProc = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
    if (hProc) {
        char exePath[MAX_PATH] = "";
        DWORD size = MAX_PATH;
        if (QueryFullProcessImageNameA(hProc, 0, exePath, &size)) {
            const char* slash = strrchr(exePath, '\\');
            if (slash) {
                strncpy(appName, slash + 1, sizeof(appName) - 1);
            } else {
                strncpy(appName, exePath, sizeof(appName) - 1);
            }
        }
        CloseHandle(hProc);
    }

    char buf[1024];
    snprintf(buf, sizeof(buf),
        "{\"canPaste\":true,\"role\":null,\"appName\":\"%s\",\"bundleIdentifier\":\"%s\",\"processIdentifier\":%lu}",
        appName, appName, (unsigned long)pid);
    emitJson(buf);
}

// ── Paste ───────────────────────────────────────

struct EnumData {
    DWORD pid;
    HWND hwnd;
};

static BOOL CALLBACK findWindowByPid(HWND hwnd, LPARAM lParam) {
    EnumData* data = (EnumData*)lParam;
    DWORD windowPid = 0;
    GetWindowThreadProcessId(hwnd, &windowPid);
    if (windowPid == data->pid && IsWindowVisible(hwnd)) {
        data->hwnd = hwnd;
        return FALSE;
    }
    return TRUE;
}

static void cmdPaste(const char* bundleId, const char* pidStr) {
    if (pidStr && strlen(pidStr) > 0) {
        DWORD pid = (DWORD)atoi(pidStr);
        if (pid > 0) {
            EnumData data = { pid, NULL };
            EnumWindows(findWindowByPid, (LPARAM)&data);
            if (data.hwnd) {
                ShowWindow(data.hwnd, SW_RESTORE);
                SetForegroundWindow(data.hwnd);
                Sleep(100);
            }
        }
    }

    INPUT inputs[4] = {};
    inputs[0].type = INPUT_KEYBOARD;
    inputs[0].ki.wVk = VK_CONTROL;
    inputs[1].type = INPUT_KEYBOARD;
    inputs[1].ki.wVk = 'V';
    inputs[2].type = INPUT_KEYBOARD;
    inputs[2].ki.wVk = 'V';
    inputs[2].ki.dwFlags = KEYEVENTF_KEYUP;
    inputs[3].type = INPUT_KEYBOARD;
    inputs[3].ki.wVk = VK_CONTROL;
    inputs[3].ki.dwFlags = KEYEVENTF_KEYUP;

    UINT sent = SendInput(4, inputs, sizeof(INPUT));
    char buf[64];
    snprintf(buf, sizeof(buf), "{\"ok\":%s}", sent == 4 ? "true" : "false");
    emitJson(buf);
}

// ── Listen ──────────────────────────────────────

static WORD targetVk = 0;

static LRESULT CALLBACK LowLevelKeyboardProc(int nCode, WPARAM wParam, LPARAM lParam) {
    if (nCode != HC_ACTION) return CallNextHookEx(NULL, nCode, wParam, lParam);

    KBDLLHOOKSTRUCT* kb = (KBDLLHOOKSTRUCT*)lParam;
    bool isKeyDown = (wParam == WM_KEYDOWN || wParam == WM_SYSKEYDOWN);
    bool isKeyUp   = (wParam == WM_KEYUP   || wParam == WM_SYSKEYUP);

    if (kb->vkCode != targetVk) return CallNextHookEx(NULL, nCode, wParam, lParam);

    bool down = false;
    if (isKeyDown) {
        down = (targetModifiers == 0) || abstractModifiersHeld(targetModifiers);
    }

    if (down != hotkeyIsDown) {
        hotkeyIsDown = down;
        emitEvent(down ? "fnDown" : "fnUp");
    }

    return CallNextHookEx(NULL, nCode, wParam, lParam);
}

static int cmdListen(int keyCode, int modifiers) {
    targetKeyCode = keyCode;
    targetModifiers = modifiers;

    if (keyCode == AK_FN) {
        emitError("Fn key is not available on Windows. Please choose a different dictation key.");
        return 1;
    }

    targetVk = abstractToVk(keyCode);
    if (targetVk == 0) {
        emitError("Unsupported key code for Windows.");
        return 1;
    }

    HHOOK hook = SetWindowsHookExW(WH_KEYBOARD_LL, LowLevelKeyboardProc, NULL, 0);
    if (!hook) {
        emitError("Could not create the global hotkey listener.");
        return 1;
    }

    MSG msg;
    while (GetMessage(&msg, NULL, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }

    UnhookWindowsHookEx(hook);
    return 0;
}

// ── Main ────────────────────────────────────────

int main(int argc, char* argv[]) {
    if (argc < 2) {
        emitError("No helper command was provided.");
        return 1;
    }

    if (strcmp(argv[1], "permissions") == 0) {
        cmdPermissions();
        return 0;
    }

    if (strcmp(argv[1], "focus") == 0) {
        cmdFocus();
        return 0;
    }

    if (strcmp(argv[1], "paste") == 0) {
        const char* bundleId = argc >= 3 ? argv[2] : NULL;
        const char* pidStr   = argc >= 4 ? argv[3] : NULL;
        cmdPaste(bundleId, pidStr);
        return 0;
    }

    if (strcmp(argv[1], "listen") == 0) {
        int keyCode = AK_RIGHT_ALT;
        int modifiers = 0;
        if (argc >= 3) keyCode = atoi(argv[2]);
        if (argc >= 4) modifiers = atoi(argv[3]);
        return cmdListen(keyCode, modifiers);
    }

    emitError("Unknown helper command.");
    return 1;
}
