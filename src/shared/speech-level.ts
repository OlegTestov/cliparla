/**
 * Is there anything to transcribe? The indicator measures the microphone signal while it records
 * (loudest sample, and how long it was above a noise floor). Only near-certain silence is refused,
 * because a model asked to transcribe digital silence invents a sentence; room noise and quiet
 * speech go to the model, which answers "[No speech detected]" for noise. Any doubt sends the clip.
 */

export interface SpeechLevel {
  /** Loudest sample over the clip, 0..1 */
  peak: number
  /** Time spent in frames whose RMS was at least ACTIVE_FRAME_RMS */
  activeMs: number
}

/** A clip is silence only when it never rose to this peak ... */
export const SILENCE_PEAK = 0.00316 // -50 dBFS
/** ... and was above the frame floor for less than this long */
export const SILENCE_ACTIVE_MS = 100
export const ACTIVE_FRAME_RMS = 0.002

export class LevelMeter {
  private peak = 0
  private activeMs = 0

  /** One frame of samples (-1..1) that lasted `frameMs`. */
  push(frame: ArrayLike<number>, frameMs: number): void {
    let sum = 0
    for (let i = 0; i < frame.length; i++) {
      const v = frame[i]
      const a = v < 0 ? -v : v
      if (a > this.peak) this.peak = a
      sum += v * v
    }
    if (frame.length > 0 && Math.sqrt(sum / frame.length) >= ACTIVE_FRAME_RMS) {
      this.activeMs += frameMs
    }
  }

  result(): SpeechLevel {
    return { peak: this.peak, activeMs: this.activeMs }
  }
}

/** False only for a valid measurement of near-certain silence; a missing or odd one is sent. */
export function hasSpeechSignal(level: SpeechLevel | null | undefined): boolean {
  if (!level || !Number.isFinite(level.peak) || !Number.isFinite(level.activeMs)) return true
  return !(level.peak < SILENCE_PEAK && level.activeMs < SILENCE_ACTIVE_MS)
}
