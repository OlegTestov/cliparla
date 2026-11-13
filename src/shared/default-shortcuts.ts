/**
 * Built-in hotkeys of a fresh install. On macOS Ctrl+Option+S (S for screen) and Ctrl+Option+V
 * (V for voice): Cmd+Shift+S/D are Save As, Send in Mail and Desktop in Finder, and Ctrl+Option+D is
 * the first-third window shortcut of Rectangle and Magnet. Installs that already stored a shortcut
 * keep it; only a missing value gets these.
 */

export function defaultCaptureShortcut(platform: string): string {
  return platform === 'darwin' ? 'Control+Alt+S' : 'CommandOrControl+Shift+S'
}

export function defaultDictationShortcut(platform: string): string {
  return platform === 'darwin' ? 'Control+Alt+V' : 'CommandOrControl+Shift+D'
}
