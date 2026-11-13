/** Only macOS gates pasting behind the Accessibility permission. */
export const needsMacPermissions = (platform: string): boolean => platform === 'darwin'

/** The key combination that pastes on this platform, isolated so right-to-left text keeps its order. */
export function pasteKey(platform: string): string {
  const key = needsMacPermissions(platform) ? '⌘V' : 'Ctrl+V'
  return `⁦${key}⁩`
}
