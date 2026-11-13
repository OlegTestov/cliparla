/**
 * The Gemini requests behind the result window. Closing the window aborts them, so the HTTP
 * request stops and the quota is not spent on an answer nobody will read.
 */

const running = new Set<AbortController>()

/** Runs `work` with a signal that `cancelResultRequests` aborts. */
export async function trackResultRequest<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController()
  running.add(controller)
  try {
    return await work(controller.signal)
  } finally {
    running.delete(controller)
  }
}

export function cancelResultRequests(): void {
  for (const controller of running) controller.abort()
  running.clear()
}
