/**
 * The completion tone, synthesised rather than shipped.
 *
 * No asset means nothing to load, nothing to 404, and no autoplay exemption to
 * negotiate — completing a task IS the user gesture the audio policy wants.
 *
 * Audio is a garnish. Every call is wrapped: a browser that refuses an
 * AudioContext must not stop a task being completed.
 */

export const SOUND_KEY = 'gtdo.completionSound'

/** Default ON, matching the macOS app's `completionSound` preference. */
export function completionSoundEnabled(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== 'false'
  } catch {
    return true
  }
}

export function setCompletionSoundEnabled(on: boolean): void {
  try {
    localStorage.setItem(SOUND_KEY, String(on))
  } catch {
    // Best-effort; the preference still applies for this session.
  }
}

let context: AudioContext | null = null

/** Created lazily on the first completion, which is always inside a gesture. */
function audioContext(): AudioContext | null {
  if (context !== null) return context
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (Ctor === undefined) return null
  try {
    context = new Ctor()
    return context
  } catch {
    return null
  }
}

/**
 * A short struck tone: a sine at 880Hz with an exponential decay, plus a
 * quieter fifth above it so it reads as an instrument rather than a beep.
 */
export function playCompletionSound(): void {
  if (!completionSoundEnabled()) return
  try {
    const ctx = audioContext()
    if (ctx === null) return
    if (ctx.state === 'suspended') void ctx.resume()

    const now = ctx.currentTime
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.16, now + 0.008)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18)
    gain.connect(ctx.destination)

    for (const [freq, level] of [[880, 1], [1320, 0.35]] as const) {
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, now)
      const voice = ctx.createGain()
      voice.gain.setValueAtTime(level, now)
      osc.connect(voice)
      voice.connect(gain)
      osc.start(now)
      osc.stop(now + 0.2)
    }
  } catch {
    // A refused or broken AudioContext must never break completing a task.
  }
}
