// Reports when the dictation hotkey is held and released: prints "down" and "up" lines.
// An ACTIVE tap (.defaultTap) needs Accessibility, which Cliparla already asks for; a listen-only
// tap would need Input Monitoring, so it is never used. Events always pass through untouched.
// Usage: cliparla-keys <keycode> <modifiers: 1 cmd, 2 ctrl, 4 alt, 8 shift>
// Exit: 2 no Accessibility, 3 tap could not be created, 4 bad arguments; 0 when Cliparla goes away.
import ApplicationServices
import Foundation

func fail(_ message: String, _ code: Int32) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(code)
}

// Globals: the tap callback is a C function and cannot capture locals
var wantedKey: Int64 = 0
var wantedModifiers = 0
guard CommandLine.arguments.count == 3,
    let keyCode = Int64(CommandLine.arguments[1]),
    let modifiers = Int(CommandLine.arguments[2])
else { fail("usage: cliparla-keys <keycode> <modifiers>", 4) }
wantedKey = keyCode
wantedModifiers = modifiers

// Checked first so that a missing grant never makes the system show a prompt of its own
guard AXIsProcessTrusted() else { fail("Accessibility permission is not granted", 2) }

// A full pipe must never slow the keyboard down: writes do not block and are dropped when it is full
_ = fcntl(1, F_SETFL, O_NONBLOCK)
func say(_ line: String) {
    let bytes = Array((line + "\n").utf8)
    _ = bytes.withUnsafeBufferPointer { write(1, $0.baseAddress, $0.count) }
}

func modifierBits(_ flags: CGEventFlags) -> Int {
    var bits = 0
    if flags.contains(.maskCommand) { bits |= 1 }
    if flags.contains(.maskControl) { bits |= 2 }
    if flags.contains(.maskAlternate) { bits |= 4 }
    if flags.contains(.maskShift) { bits |= 8 }
    return bits
}

var held = false
var tap: CFMachPort?

let callback: CGEventTapCallBack = { _, type, event, _ in
    switch type {
    case .tapDisabledByTimeout, .tapDisabledByUserInput:
        if let tap = tap { CGEvent.tapEnable(tap: tap, enable: true) }
    case .keyDown:
        if event.getIntegerValueField(.keyboardEventKeycode) == wantedKey,
            event.getIntegerValueField(.keyboardEventAutorepeat) == 0,
            modifierBits(event.flags) == wantedModifiers
        {
            held = true
            say("down")
        }
    case .keyUp:
        // The modifiers may already be released: only the key itself counts
        if held, event.getIntegerValueField(.keyboardEventKeycode) == wantedKey {
            held = false
            say("up")
        }
    default:
        break
    }
    return Unmanaged.passUnretained(event)
}

let mask = (1 << CGEventType.keyDown.rawValue) | (1 << CGEventType.keyUp.rawValue)
guard
    let created = CGEvent.tapCreate(
        tap: .cgSessionEventTap, place: .headInsertEventTap, options: .defaultTap,
        eventsOfInterest: CGEventMask(mask), callback: callback, userInfo: nil)
else { fail("Could not create the event tap", 3) }
tap = created
CFRunLoopAddSource(
    CFRunLoopGetMain(), CFMachPortCreateRunLoopSource(nil, created, 0), .commonModes)
CGEvent.tapEnable(tap: created, enable: true)

// Cliparla owns our stdin: when it goes away (quit or crash) the pipe closes and we leave
Thread.detachNewThread {
    while FileHandle.standardInput.availableData.count > 0 {}
    exit(0)
}
say("ready")
CFRunLoopRun()
