/** Fake Gemini models for the service tests: no network, no SDK. */

export interface FakeChunk {
  text?: string
  blocked?: string
}

type OneShot = (parts: unknown[], signal?: AbortSignal) => Promise<{ response: { text(): string } }>

/** Wraps a one-reply function (the shape the tests were written in) as a streaming model. */
export function asModel({ generateContent: generate }: { generateContent: OneShot }) {
  const once = async (parts: unknown[], signal?: AbortSignal): Promise<FakeChunk> => ({
    text: (await generate(parts, signal)).response.text()
  })
  return {
    generateContent: once,
    generateContentStream: async (parts: unknown[], signal?: AbortSignal) =>
      (async function* () {
        yield await once(parts, signal)
      })()
  }
}

/** A model whose stream yields these chunks, then throws `then` if given. */
export function streamingModel(chunks: FakeChunk[], then?: Error, gate?: () => Promise<void>) {
  return {
    generateContent: async () => ({ text: chunks.map((c) => c.text ?? '').join('') }),
    generateContentStream: async () =>
      (async function* () {
        for (const chunk of chunks) {
          if (gate) await gate()
          yield chunk
        }
        if (then) throw then
      })()
  }
}
