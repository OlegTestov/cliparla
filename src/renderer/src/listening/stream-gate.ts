/**
 * Guards microphone acquisition against cancellation.
 *
 * getUserMedia can resolve long after the user pressed Cancel (for example
 * while the OS permission prompt is open). A stream that arrives for an
 * obsolete request is stopped at once and never reaches the recorder.
 */

export interface StoppableStream {
  getTracks(): Array<{ stop(): void }>
}

export class StreamGate {
  private generation = 0

  /** Invalidate every pending request. */
  invalidate(): void {
    this.generation++
  }

  /** Resolves with the stream, or null when the request became obsolete. */
  async acquire<T extends StoppableStream>(getStream: () => Promise<T>): Promise<T | null> {
    const mine = ++this.generation
    let stream: T
    try {
      stream = await getStream()
    } catch (error) {
      if (mine !== this.generation) return null
      throw error
    }
    if (mine !== this.generation) {
      stream.getTracks().forEach((track) => track.stop())
      return null
    }
    return stream
  }
}
