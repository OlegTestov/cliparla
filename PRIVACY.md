# Privacy

Your key is stored encrypted on this computer; screen images and voice go directly to Google with your key.

Cliparla has no server of its own and no account. This page lists what leaves your Mac, where it goes, and what stays.

## What is sent, and to whom

Only when you use a feature, and only to Google's Gemini API (model `gemini-3.1-flash-lite`), signed with your own API key:

| You do | What Google receives |
|---|---|
| Translate or copy text from a screen area | The picture of the area you selected |
| Dictate | The audio of that dictation |
| Summarize, comment, polish | The text you ask about |
| Any of the above | Your target language and, if you set one, your custom dictionary words (in the instructions) |
| Press **Test key** | A one-word test request |

How Google handles this content depends on your key. Google's terms for the Gemini API differ between free and paid keys, including whether content may be used to improve their products. Read them if you handle sensitive material.

## What is not sent

- No analytics, no usage statistics, no crash reports.
- No update check: Cliparla never contacts a server of its own. You update by installing a newer release.
- Nothing is sent to the author of Cliparla. The tray item "Send feedback" only opens the project's GitHub issue page in your browser; Cliparla itself sends nothing.

## What is stored on your Mac

- Settings (hotkeys, languages, custom dictionary) and your API key, in Cliparla's own data folder. The key is encrypted with Electron `safeStorage`, which uses the macOS Keychain.
- The last 20 results (for the tray "Recent" menu) are kept in memory only and disappear when you quit.
- A failed dictation keeps its audio in memory so you can press Retry; it is dropped after a successful delivery, when you close the card or start a new dictation, on quit, and after 10 minutes.
- The last screenshot stays in memory until the next one replaces it or you quit (for "Copy screenshot").
- Screenshots and audio are not written to disk by the packaged app.

To remove everything, quit Cliparla, delete the app, its data folder in `~/Library/Application Support/Cliparla` and the Keychain item "Cliparla Safe Storage" (Keychain Access), `~/Library/Preferences/dev.cliparla.app.plist` and `~/Library/Saved Application State/dev.cliparla.app.savedState`, and delete your key at Google AI Studio if you no longer want it valid.

## Permissions

Screen Recording (to capture the area you select), Microphone (to record dictation), Accessibility (to paste the dictated text and detect the end of a held hotkey). None of them send data anywhere by themselves.
