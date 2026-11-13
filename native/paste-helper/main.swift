// Posts Cmd+V through CGEvent. Needs only Accessibility.
import ApplicationServices
import AppKit
import Carbon
import Foundation

let kVKAnsiV: CGKeyCode = 9  // physical V position, same key code the app always used

// All modes require the parent's pid; probes never post events or ask for permission.
guard CommandLine.arguments.count == 3,
    ["--check-focus", "--check-secure", "--paste-for"].contains(CommandLine.arguments[1]),
    let owner = Int32(CommandLine.arguments[2]), owner > 0
else { exit(3) }

func hasExternalTarget() -> Bool {
    guard let front = NSWorkspace.shared.frontmostApplication else { return false }
    return front.processIdentifier > 0 && front.processIdentifier != owner
}

if CommandLine.arguments[1] == "--check-focus" {
    exit(hasExternalTarget() ? 0 : 4)
}

guard !IsSecureEventInputEnabled() else {
    FileHandle.standardError.write(Data("Secure Input is enabled\n".utf8))
    exit(5)
}

if CommandLine.arguments[1] == "--check-secure" {
    exit(0)
}

guard AXIsProcessTrusted() else {
    FileHandle.standardError.write(Data("Accessibility permission is not granted\n".utf8))
    exit(2)
}

// A private source does not inherit the physical modifiers still held after a hotkey.
guard let source = CGEventSource(stateID: .privateState),
    let down = CGEvent(keyboardEventSource: source, virtualKey: kVKAnsiV, keyDown: true),
    let up = CGEvent(keyboardEventSource: source, virtualKey: kVKAnsiV, keyDown: false)
else {
    FileHandle.standardError.write(Data("Could not create the keyboard events\n".utf8))
    exit(3)
}

let commandFlags: CGEventFlags = [.maskCommand, CGEventFlags(rawValue: 0x000008)]  // 0x8 = left-Command device bit
down.flags = commandFlags
up.flags = commandFlags
// Recheck at the last moment: focus may have changed since the parent's probe.
guard hasExternalTarget() else { exit(4) }
// Events posted right before exit are lost (measured on a real Mac): wait before exiting.
down.post(tap: .cgSessionEventTap)
usleep(8_000)
up.post(tap: .cgSessionEventTap)
usleep(50_000)
exit(0)
