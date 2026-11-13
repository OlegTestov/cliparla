import { LevelMeter } from '../../../shared/speech-level'

const TICK_MS = 40
/** Below this share of the recording read, the measurement says nothing */
const MIN_COVERAGE = 0.6
/** Audio that starts flowing later than this may have missed the first word */
const MAX_START_GAP_MS = 200

type Result = ReturnType<LevelMeter['result']>

/**
 * Measures the microphone signal while it records (an analyser read about every tick).
 * `result()` is null when the measurement cannot be trusted (the context was not running, or too
 * little audio was actually processed, or it started late): the clip is then sent without a verdict.
 */
export function startLevelMeter(
  stream: MediaStream,
  now: () => number = () => performance.now()
): { result: () => Result | null; stop: () => void } | null {
  let context: AudioContext | null = null
  try {
    context = new AudioContext()
    const ctx = context
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 2048
    ctx.createMediaStreamSource(stream).connect(analyser)
    const frame = new Float32Array(analyser.fftSize)
    const meter = new LevelMeter()
    const startedAt = now()
    let last = startedAt
    let lastAudio = ctx.currentTime * 1000
    let firstAudioAt: number | null = null
    let covered = 0
    let ran = true
    let closed = false
    const tick = (): void => {
      const audioNow = ctx.currentTime * 1000
      const audioDt = audioNow - lastAudio
      lastAudio = audioNow
      if (ctx.state !== 'running') {
        ran = false
        last = now()
        return
      }
      analyser.getFloatTimeDomainData(frame)
      const t = now()
      const dt = t - last
      last = t
      if (audioDt > 0 && firstAudioAt === null) firstAudioAt = t
      meter.push(frame, dt)
      // currentTime stands still while no audio is processed: a stall reads as zeros, not silence
      covered += Math.max(0, Math.min(dt, audioDt, (frame.length / ctx.sampleRate) * 1000))
    }
    const timer = setInterval(tick, TICK_MS)
    return {
      result: () => {
        const duration = now() - startedAt
        if (!ran || duration <= 0 || covered < duration * MIN_COVERAGE) return null
        if (firstAudioAt === null || firstAudioAt - startedAt > MAX_START_GAP_MS) return null
        return meter.result()
      },
      stop: () => {
        clearInterval(timer)
        if (closed) return
        closed = true
        void ctx.close().catch(() => undefined)
      }
    }
  } catch {
    if (context) void context.close().catch(() => undefined)
    return null // not measurable: the clip is sent as before
  }
}
