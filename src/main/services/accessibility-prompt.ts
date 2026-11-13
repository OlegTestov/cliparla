/**
 * Whether the macOS Accessibility prompt was already shown in this run. macOS shows it
 * once, so the permissions window and the dictation-time miss share this one flag.
 */

let prompted = false

export const wasAccessibilityPrompted = (): boolean => prompted
export const markAccessibilityPrompted = (): void => {
  prompted = true
}

/** Test hook: a new app run asks again. */
export function resetAccessibilityPromptedForTests(): void {
  prompted = false
}
