/**
 * What a permission button does. macOS shows the Accessibility prompt only
 * once, so after one request a still-missing Accessibility opens the pane instead.
 */

export type PermissionKind = 'screen' | 'microphone' | 'accessibility'

export function opensSettings(
  kind: PermissionKind,
  state: { denied: boolean; asked: boolean }
): boolean {
  if (kind === 'screen') return true
  if (kind === 'accessibility') return state.asked
  return state.denied
}
