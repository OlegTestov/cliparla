/**
 * What the indicator shows. `starting` is the time between the hotkey and the
 * microphone opening; it looks like listening, so Cancel is there at once.
 */

export type ListeningMode = 'starting' | 'listening' | 'processing' | 'copied' | 'error' | 'idle'
export type ModeEvent =
  'start' | 'recording' | 'processing' | 'copied' | 'error' | 'stop' | 'failed'

export function nextMode(mode: ListeningMode, event: ModeEvent): ListeningMode {
  switch (event) {
    case 'start':
      return 'starting'
    case 'recording':
      return mode === 'starting' ? 'listening' : mode
    case 'processing':
      return 'processing'
    case 'copied':
      // A late "copied" must never interrupt a dictation that is under way
      return mode === 'idle' || mode === 'copied' ? 'copied' : mode
    case 'error':
      // The error of a dictation that ended; never over one that has just started
      return mode === 'starting' ? mode : 'error'
    case 'stop':
    case 'failed':
      return 'idle'
  }
}
