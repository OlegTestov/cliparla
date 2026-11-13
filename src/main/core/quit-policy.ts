/**
 * Quitting really quits. Closing a window only hides it; Cmd-Q, the app menu,
 * the tray, a logout or a signal must end the process.
 */

export function handleBeforeQuit(
  _event: { preventDefault(): void },
  windows: { setAllQuitting(quitting: boolean): void }
): void {
  windows.setAllQuitting(true)
}

export function installSignalQuit(
  proc: { once(signal: string, listener: () => void): unknown },
  quit: () => void
): void {
  for (const signal of ['SIGTERM', 'SIGINT']) proc.once(signal, quit)
}
