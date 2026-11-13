# Changelog

## 0.2.0

First public release.

- Signed with a Developer ID certificate and notarized by Apple (Apple silicon, DMG and ZIP).
- Dictation: paste uses a bundled native helper that needs only Accessibility (no System Events or Automation prompt), only when another app has focus; Secure Input fields get a clear message instead of a silent failure.
- Dictation: hold the hotkey to talk and release to send, or tap to start and stop.
- New setting: remove filler words in every dictation mode (on by default).
- A Gemini per-day quota error is no longer retried and says the limit resets tomorrow.
- Closing the result window now stops the Gemini request instead of only ignoring its answer.
- The two required hotkeys can no longer end up on the same shortcut when their fallbacks are taken.
- New default hotkeys on macOS: `Ctrl+Option+S` (screen) and `Ctrl+Option+V` (voice). `Cmd+Shift+S` and `Cmd+Shift+D` are Save As, Send in Mail and Desktop in Finder in many apps. Installs that already saved their hotkeys keep them; change them in Settings.
- New tray item "Send feedback" opens the project's GitHub issue page.
- Third-party license notices (`THIRD_PARTY_NOTICES.md`) and `PRIVACY.md`.

## 0.1.0

Internal builds.
