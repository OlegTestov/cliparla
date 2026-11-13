/**
 * Which setup screen follows a saved key. Only a first run with Screen Recording
 * already on, and nothing optional left to offer, goes straight to "Try it now"; everyone else goes through "Continue",
 * where main picks the next window.
 */
export function stepAfterKeySaved(
  screenReady: boolean,
  tryItPending: boolean,
  optionalMissing = false
): 'try' | 'saved' {
  // A first run with Microphone or Accessibility missing goes through "Continue" to be offered them
  return screenReady && tryItPending && !optionalMissing ? 'try' : 'saved'
}
