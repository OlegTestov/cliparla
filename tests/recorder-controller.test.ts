/**
 * The recorder logic of the indicator window, run with fake getUserMedia,
 * MediaRecorder, timers and IPC. Each test pins one message (or its absence).
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { nextMode } from '../src/renderer/src/listening/mode'
import {
  AUDIO_BITS_PER_SECOND,
  COUNTDOWN_SECONDS,
  recorderOptions,
  createRecorderController,
  MAX_RECORDING_DURATION
} from '../src/renderer/src/listening/recorder-controller'

class FakeTrack {
  stopped = 0
  stop(): void {
    this.stopped++
  }
}

class FakeRecorder {
  state = 'inactive'
  mimeType = 'audio/webm;codecs=opus'
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  onerror: (() => void) | null = null
  stopCalls = 0
  start(): void {
    this.state = 'recording'
  }
  stop(): void {
    this.stopCalls++
    this.state = 'inactive'
  }
  data(text = 'audio'): void {
    this.ondataavailable?.({ data: new Blob([text]) })
  }
  end(): void {
    this.onstop?.()
  }
}

const TEXT: Record<string, string> = {
  'listening.micAccessDenied': 'denied',
  'listening.noMicFound': 'no mic',
  'listening.micInUse': 'in use',
  'listening.recordingFailed': 'recording failed'
}

function setup(
  options: {
    base64?: (blob: Blob) => Promise<string>
    meter?: (stream: MediaStream) => { result: () => unknown; stop: () => void } | null
  } = {}
) {
  const track = new FakeTrack()
  const stream = { getTracks: () => [track] }
  const mics: Array<{ resolve: (s: unknown) => void; reject: (e: unknown) => void }> = []
  const recorders: FakeRecorder[] = []
  const audio: Array<{
    audioBase64: string
    mimeType: string
    session: number
    level?: unknown
  }> = []
  const failures: Array<{ session: number; reason: string }> = []
  const modes: string[] = []
  const errors: Array<string | null> = []
  const timers: Array<{ fn: () => void; ms: number; cleared: boolean }> = []
  const countdown: Array<number | null> = []
  const started: number[] = []
  const cards: Array<unknown> = []
  const clock = { now: 1000 }
  const controller = createRecorderController(
    {
      getUserMedia: () =>
        new Promise((resolve, reject) => mics.push({ resolve, reject })) as Promise<MediaStream>,
      createRecorder: () => {
        const recorder = new FakeRecorder()
        recorders.push(recorder)
        return recorder as unknown as MediaRecorder
      },
      blobToBase64: options.base64 ?? (async (blob) => `B64:${blob.size}`),
      sendAudio: (payload) => void audio.push(payload),
      recordingFailed: (failure) => void failures.push(failure),
      recordingStarted: (session) => void started.push(session),
      ...(options.meter ? { startLevelMeter: options.meter as never } : {}),
      t: (key) => TEXT[key],
      setTimeout: (fn, ms) => timers.push({ fn, ms, cleared: false }) - 1,
      clearTimeout: (handle) => void (timers[handle as number].cleared = true),
      now: () => clock.now
    },
    {
      onMode: (mode) => void modes.push(mode),
      onError: (message) => void errors.push(message),
      onCountdown: (left) => void countdown.push(left),
      onDictationError: (card) => void cards.push(card)
    }
  )
  const openMic = async (): Promise<void> => {
    mics.shift()!.resolve(stream)
    await flush()
  }
  return {
    controller,
    track,
    mics,
    recorders,
    audio,
    failures,
    modes,
    errors,
    timers,
    countdown,
    started,
    cards,
    clock,
    openMic
  }
}

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

describe('recorder controller: a normal dictation', () => {
  it('shows starting at once and listening once the microphone is open', async () => {
    const t = setup()
    const started = t.controller.onStart(7)
    assert.equal(t.controller.getMode(), 'starting')
    await t.openMic()
    await started
    assert.equal(t.controller.getMode(), 'listening')
    assert.equal(t.controller.getStartedAt(), 1000)
    assert.equal(t.recorders[0].state, 'recording')
  })

  it('stop sends the audio once, with the session and the recorder mime type', async () => {
    const t = setup()
    void t.controller.onStart(7)
    await t.openMic()
    t.recorders[0].data()
    t.clock.now += 12_000
    t.controller.onProcessing()
    t.recorders[0].end()
    await flush()
    assert.equal(t.track.stopped, 1)
    assert.deepEqual(t.audio, [
      { audioBase64: 'B64:5', mimeType: 'audio/webm;codecs=opus', session: 7, durationMs: 12_000 }
    ])
    assert.deepEqual(t.failures, [])
  })

  it('the recording limit stops like a manual stop and the audio is still sent', async () => {
    const t = setup()
    void t.controller.onStart(3)
    await t.openMic()
    assert.equal(t.timers[0].ms, MAX_RECORDING_DURATION * 1000)
    t.recorders[0].data()
    t.timers[0].fn()
    assert.equal(t.controller.getMode(), 'processing')
    assert.equal(t.recorders[0].stopCalls, 1)
    t.recorders[0].end()
    await flush()
    assert.equal(t.audio.length, 1)
  })

  it('the limit is 180 s and the countdown covers the last 15 s', () => {
    assert.equal(MAX_RECORDING_DURATION, 180)
    assert.equal(COUNTDOWN_SECONDS, 15)
  })

  it('shows no countdown before 165 s', async () => {
    const t = setup()
    void t.controller.onStart(3)
    await t.openMic()
    assert.deepEqual(t.countdown, [])
    assert.equal(t.timers[1].ms, 165_000)
  })

  it('shows the seconds left from 165 s, once per second', async () => {
    const t = setup()
    void t.controller.onStart(3)
    await t.openMic()
    t.clock.now = 1000 + 165_000
    t.timers[1].fn()
    assert.deepEqual(t.countdown, [15])
    assert.equal(t.timers[2].ms, 1000)
    t.clock.now += 1000
    t.timers[2].fn()
    t.clock.now += 13_000
    t.timers[3].fn()
    assert.deepEqual(t.countdown, [15, 14, 1])
  })

  it('auto-stops at 180 s: countdown cleared, audio still sent', async () => {
    const t = setup()
    void t.controller.onStart(3)
    await t.openMic()
    t.recorders[0].data()
    t.clock.now = 1000 + 165_000
    t.timers[1].fn()
    t.clock.now = 1000 + 180_000
    assert.equal(t.timers[0].ms, 180_000)
    t.timers[0].fn()
    assert.equal(t.countdown.at(-1), null)
    assert.equal(t.timers[2].cleared, true)
    t.recorders[0].end()
    await flush()
    assert.equal(t.audio.length, 1)
  })

  it('a manual stop during the countdown hides it', async () => {
    const t = setup()
    void t.controller.onStart(3)
    await t.openMic()
    t.clock.now = 1000 + 170_000
    t.timers[1].fn()
    t.controller.onProcessing()
    assert.equal(t.countdown.at(-1), null)
    assert.equal(t.timers[2].cleared, true)
  })

  it('a cancel during the countdown hides it', async () => {
    const t = setup()
    void t.controller.onStart(3)
    await t.openMic()
    t.clock.now = 1000 + 170_000
    t.timers[1].fn()
    t.controller.onStop()
    assert.equal(t.countdown.at(-1), null)
  })

  it('a manual stop disarms the limit timer', async () => {
    const t = setup()
    void t.controller.onStart(3)
    await t.openMic()
    t.controller.onProcessing()
    assert.equal(t.timers[0].cleared, true)
  })
})

describe('recorder controller: Stop while the microphone is opening', () => {
  it('starts no recorder and tells main nothing was recorded, exactly once', async () => {
    const t = setup()
    const started = t.controller.onStart(4)
    t.controller.onProcessing()
    await t.openMic()
    await started
    assert.equal(t.recorders.length, 0)
    assert.equal(t.track.stopped, 1)
    assert.deepEqual(t.failures, [{ session: 4, reason: 'empty' }])
    assert.deepEqual(t.audio, [])
  })
})

describe('recorder controller: a recording that yields nothing', () => {
  it('an empty buffer reports "empty"', async () => {
    const t = setup()
    void t.controller.onStart(5)
    await t.openMic()
    t.controller.onProcessing()
    t.recorders[0].end()
    await flush()
    assert.deepEqual(t.failures, [{ session: 5, reason: 'empty' }])
    assert.deepEqual(t.audio, [])
  })

  it('a base64 conversion error reports "empty" and sends no audio', async () => {
    const t = setup({
      base64: async () => {
        throw new Error('reader failed')
      }
    })
    void t.controller.onStart(5)
    await t.openMic()
    t.recorders[0].data()
    t.controller.onProcessing()
    t.recorders[0].end()
    await flush()
    assert.deepEqual(t.failures, [{ session: 5, reason: 'empty' }])
    assert.deepEqual(t.audio, [])
  })
})

describe('recorder controller: failures', () => {
  const cases: Array<[string, string, string]> = [
    ['NotAllowedError', 'denied', 'permission'],
    ['PermissionDeniedError', 'denied', 'old permission name'],
    ['NotFoundError', 'no mic', 'no device'],
    ['NotReadableError', 'in use', 'busy device'],
    ['SomethingElse', 'boom', 'any other error shows its message']
  ]
  for (const [name, text, label] of cases) {
    it(`getUserMedia ${name}: ${label}`, async () => {
      const t = setup()
      const started = t.controller.onStart(9)
      const error = new Error('boom')
      error.name = name
      t.mics[0].reject(error)
      await started
      assert.equal(t.controller.getMode(), 'idle')
      assert.equal(t.errors.at(-1), text)
      assert.deepEqual(t.failures, [{ session: 9, reason: 'mic' }])
    })
  }

  it('a recorder error shows the message, goes idle and reports "recorder" once', async () => {
    const t = setup()
    void t.controller.onStart(2)
    await t.openMic()
    t.recorders[0].onerror?.()
    assert.equal(t.controller.getMode(), 'idle')
    assert.equal(t.errors.at(-1), 'recording failed')
    assert.deepEqual(t.failures, [{ session: 2, reason: 'recorder' }])
    assert.equal(t.track.stopped, 1)
  })
})

describe('recorder controller: a cancelled recorder sends nothing', () => {
  it('the final chunk and onstop after a cancel produce no message', async () => {
    const t = setup()
    void t.controller.onStart(6)
    await t.openMic()
    t.recorders[0].data()
    t.controller.onStop() // cancel
    t.recorders[0].data('late final chunk')
    t.recorders[0].end()
    await flush()
    assert.deepEqual(t.audio, [])
    assert.deepEqual(t.failures, [])
    assert.equal(t.track.stopped, 1)
    assert.equal(t.controller.getMode(), 'idle')
  })

  it('a cancel while the audio is being converted sends nothing', async () => {
    let finishConversion: (value: string) => void = () => {}
    const t = setup({ base64: () => new Promise((resolve) => (finishConversion = resolve)) })
    void t.controller.onStart(6)
    await t.openMic()
    t.recorders[0].data()
    t.controller.onProcessing()
    t.recorders[0].end()
    t.controller.onStop()
    finishConversion('B64')
    await flush()
    assert.deepEqual(t.audio, [])
    assert.deepEqual(t.failures, [])
  })

  it('a recorder error after a cancel sends nothing', async () => {
    const t = setup()
    void t.controller.onStart(6)
    await t.openMic()
    t.controller.onStop()
    t.recorders[0].onerror?.()
    assert.deepEqual(t.failures, [])
  })

  it('A stopped by a new start does not send into B', async () => {
    const t = setup()
    void t.controller.onStart(1)
    await t.openMic()
    t.recorders[0].data('a')
    void t.controller.onStart(2)
    t.recorders[0].end() // A's onstop after B began
    await t.openMic()
    t.recorders[1].data('bb')
    t.controller.onProcessing()
    t.recorders[1].end()
    await flush()
    assert.deepEqual(
      t.audio.map((a) => a.session),
      [2]
    )
    assert.deepEqual(t.failures, [])
  })

  it('a microphone that opens after a cancel is stopped and reported to nobody', async () => {
    const t = setup()
    const started = t.controller.onStart(8)
    t.controller.onStop()
    await t.openMic()
    await started
    assert.equal(t.recorders.length, 0)
    assert.equal(t.track.stopped, 1)
    assert.deepEqual(t.failures, [])
    assert.deepEqual(t.audio, [])
  })
})

describe('recorder controller: a late "copied"', () => {
  it('is ignored while a dictation is under way: no mode change, no error reset', async () => {
    const t = setup()
    const started = t.controller.onStart(1)
    await t.openMic()
    await started
    const seen = (): string => JSON.stringify([t.modes, t.errors])
    const before = seen()
    t.controller.onCopied()
    assert.equal(t.controller.getMode(), 'listening')
    t.controller.onProcessing()
    const processing = seen()
    t.controller.onCopied()
    assert.equal(t.controller.getMode(), 'processing')
    assert.equal(seen(), processing)
    assert.ok(before.length > 0 && !t.modes.includes('copied'))
  })

  it('is shown from idle and clears the error', () => {
    const t = setup()
    t.controller.onCopied()
    assert.equal(t.controller.getMode(), 'copied')
    assert.deepEqual(t.errors, [null])
  })
})

describe('recorder controller: the microphone is released on every failure path', () => {
  it('creating the recorder throws: the stream tracks are stopped and the error is reported', async () => {
    const track = new FakeTrack()
    const failures: Array<{ session: number; reason: string }> = []
    const errors: Array<string | null> = []
    const controller = createRecorderController(
      {
        getUserMedia: async () => ({ getTracks: () => [track] }) as unknown as MediaStream,
        createRecorder: () => {
          throw new Error('NotSupportedError')
        },
        blobToBase64: async () => '',
        sendAudio: () => undefined,
        recordingFailed: (failure) => void failures.push(failure),
        recordingStarted: () => undefined,
        t: (key) => TEXT[key]
      },
      {
        onMode: () => undefined,
        onError: (message) => void errors.push(message),
        onCountdown: () => undefined
      }
    )
    await controller.onStart(4)
    assert.equal(track.stopped, 1)
    assert.equal(controller.getMode(), 'idle')
    assert.equal(errors.at(-1), 'NotSupportedError')
    assert.deepEqual(failures, [{ session: 4, reason: 'mic' }])
  })
})

describe('recorder controller: an old error does not outlive a new start', () => {
  it('mic fails, then the next start clears the error before anything else', async () => {
    const t = setup()
    const first = t.controller.onStart(1)
    t.mics.shift()!.reject(new Error('boom'))
    await first
    assert.equal(t.errors.at(-1), 'boom')
    const second = t.controller.onStart(2)
    assert.equal(t.errors.at(-1), null)
    await t.openMic()
    await second
    assert.equal(t.errors.at(-1), null)
    assert.equal(t.controller.getMode(), 'listening')
  })
})

describe('indicator mode: error', () => {
  it('replaces every state except a dictation that has just started', () => {
    assert.equal(nextMode('starting', 'error'), 'starting')
    for (const mode of ['listening', 'processing', 'copied', 'error', 'idle'] as const)
      assert.equal(nextMode(mode, 'error'), 'error')
  })

  it('a stop or failure leaves it', () => {
    assert.equal(nextMode('error', 'stop'), 'idle')
    assert.equal(nextMode('error', 'failed'), 'idle')
  })

  it('a new dictation replaces it, and a late copied does not', () => {
    assert.equal(nextMode('error', 'start'), 'starting')
    assert.equal(nextMode('error', 'copied'), 'error')
  })
})

describe('recorder controller: a dictation error from main', () => {
  const card = { message: 'offline', retry: true }

  it('is ignored while the microphone is still opening', async () => {
    const t = setup()
    void t.controller.onStart(1)
    t.controller.onDictationError(card)
    assert.equal(t.controller.getMode(), 'starting')
    assert.deepEqual(t.cards, [])
  })

  it('stops a live recording, releases the microphone and shows the card', async () => {
    const t = setup()
    void t.controller.onStart(1)
    await t.openMic()
    assert.equal(t.controller.getMode(), 'listening')
    t.controller.onDictationError(card)
    assert.equal(t.controller.getMode(), 'error')
    assert.equal(t.recorders[0].stopCalls, 1)
    assert.equal(t.track.stopped, 1)
    assert.deepEqual(t.cards, [card])
    t.recorders[0].end()
    await flush()
    assert.deepEqual(t.audio, [], 'a stopped recording sends nothing')
  })

  it('after processing it shows the card, and a stop clears it', async () => {
    const t = setup()
    void t.controller.onStart(1)
    await t.openMic()
    t.controller.onProcessing()
    t.controller.onDictationError(card)
    assert.equal(t.controller.getMode(), 'error')
    t.controller.onStop()
    assert.equal(t.controller.getMode(), 'idle')
    assert.deepEqual(t.cards, [card, null])
  })
})

describe('recorder controller: telling main the recording started', () => {
  it('reports the session once the recorder runs, not while the microphone is opening', async () => {
    const t = setup()
    const p = t.controller.onStart(9)
    assert.deepEqual(t.started, [])
    await t.openMic()
    await p
    assert.deepEqual(t.started, [9])
  })

  it('reports nothing when the microphone is denied', async () => {
    const t = setup()
    const p = t.controller.onStart(9)
    t.mics.shift()!.reject(Object.assign(new Error('x'), { name: 'NotAllowedError' }))
    await p
    assert.deepEqual(t.started, [])
  })
})

describe('recorder controller: the level meter', () => {
  const level = { peak: 0.2, activeMs: 800 }

  it('sends the measured level with the audio and stops the meter', async () => {
    let stopped = 0
    const t = setup({
      meter: () => ({ result: () => level, stop: () => void stopped++ })
    })
    void t.controller.onStart(1)
    await t.openMic()
    t.recorders[0].data()
    t.controller.onProcessing()
    t.recorders[0].end()
    await flush()
    assert.deepEqual(t.audio[0].level, level)
    assert.equal(stopped, 1)
  })

  it('a meter that cannot start leaves the audio as before', async () => {
    const t = setup({ meter: () => null })
    void t.controller.onStart(1)
    await t.openMic()
    t.recorders[0].data()
    t.controller.onProcessing()
    t.recorders[0].end()
    await flush()
    assert.equal('level' in t.audio[0], false)
  })

  it('a cancel stops the meter and sends nothing', async () => {
    let stopped = 0
    const t = setup({ meter: () => ({ result: () => level, stop: () => void stopped++ }) })
    void t.controller.onStart(1)
    await t.openMic()
    t.controller.onStop()
    assert.equal(stopped, 1)
    assert.deepEqual(t.audio, [])
  })

  it('the page measures with the shared meter', () => {
    const page = readFileSync(`${__dirname}/../src/renderer/src/listening/App.tsx`, 'utf8')
    assert.match(page, /startLevelMeter,/)
  })
})

describe('recorder controller: the copied hint', () => {
  it('passes the link to the page with the copied state and clears it on stop', () => {
    const hints: unknown[] = []
    const controller = createRecorderController(
      {
        getUserMedia: async () => ({}) as MediaStream,
        createRecorder: () => ({}) as never,
        blobToBase64: async () => '',
        sendAudio: () => undefined,
        recordingFailed: () => undefined,
        recordingStarted: () => undefined,
        t: (key) => key
      },
      {
        onMode: () => undefined,
        onError: () => undefined,
        onCountdown: () => undefined,
        onCopiedHint: (hint) => void hints.push(hint)
      }
    )
    controller.onCopied('open-settings')
    controller.onStop()
    assert.deepEqual(hints, ['open-settings', null])
  })

  it('the page shows the link only in the copied state', () => {
    const page = readFileSync(`${__dirname}/../src/renderer/src/listening/App.tsx`, 'utf8')
    assert.match(page, /mode === 'copied' && hint/)
    assert.match(page, /openAccessibilitySettings\(\)/)
  })
})

describe('recording duration clock', () => {
  it('uses a monotonic clock: a wall-clock jump cannot change the reported duration', () => {
    const src = readFileSync(
      `${__dirname}/../src/renderer/src/listening/recorder-controller.ts`,
      'utf8'
    )
    assert.match(src, /deps\.now \?\? \(\(\) => performance\.now\(\)\)/)
    assert.doesNotMatch(src, /Date\.now/)
  })

  it('without a test clock the duration is still a positive number', async () => {
    const sent: Array<{ durationMs: number }> = []
    const track = { stop: () => undefined }
    const recorder = new FakeRecorder()
    const controller = createRecorderController(
      {
        getUserMedia: async () => ({ getTracks: () => [track] }) as unknown as MediaStream,
        createRecorder: () => recorder as unknown as MediaRecorder,
        blobToBase64: async () => 'B64',
        sendAudio: (p) => void sent.push(p),
        recordingFailed: () => undefined,
        recordingStarted: () => undefined,
        t: (key) => key
      },
      { onMode: () => undefined, onError: () => undefined, onCountdown: () => undefined }
    )
    await controller.onStart(1)
    recorder.data()
    controller.onProcessing()
    recorder.end()
    await flush()
    assert.equal(sent.length, 1)
    assert.ok(sent[0].durationMs >= 1 && sent[0].durationMs < 5000)
    controller.dispose()
  })
})

describe('recorder options', () => {
  it('ask for 48 kbps explicitly, with or without a mime type', () => {
    assert.equal(AUDIO_BITS_PER_SECOND, 48_000)
    assert.deepEqual(recorderOptions('audio/webm;codecs=opus'), {
      mimeType: 'audio/webm;codecs=opus',
      audioBitsPerSecond: 48_000
    })
    assert.deepEqual(recorderOptions(''), { audioBitsPerSecond: 48_000 })
  })

  it('the indicator page builds its recorder with them', () => {
    const page = readFileSync(`${__dirname}/../src/renderer/src/listening/App.tsx`, 'utf8')
    assert.match(page, /new MediaRecorder\(stream, recorderOptions\(mimeType\)\)/)
  })
})

describe('indicator page', () => {
  it('has no progress bar or animation loop', () => {
    const page = readFileSync(`${__dirname}/../src/renderer/src/listening/App.tsx`, 'utf8')
    assert.doesNotMatch(page, /progress|requestAnimationFrame/i)
    assert.match(page, /listening\.endsIn/)
  })
})
