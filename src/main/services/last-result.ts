/**
 * The results handed to the user: dictated text and shown screen translations, newest first.
 * Memory only: nothing is written to disk and it is gone when the app quits.
 */

import { NO_TEXT_MARKER } from '../../shared/gemini-constants'

/** How many results the tray's "Recent" menu keeps */
export const RECENT_LIMIT = 20

let recent: string[] = []
const listeners = new Set<() => void>()

export function setLastResult(text: string): void {
  // "No text found" is an answer about the picture, not a result worth keeping
  if (!text.trim() || text.includes(NO_TEXT_MARKER) || text === recent[0]) return
  recent = [text, ...recent].slice(0, RECENT_LIMIT)
  listeners.forEach((listener) => listener())
}

export function getLastResult(): string | null {
  return recent[0] ?? null
}

export function hasLastResult(): boolean {
  return recent.length > 0
}

/** The kept results, newest first (at most RECENT_LIMIT). */
export function getRecentResults(): readonly string[] {
  return recent
}

/** Called whenever a new result replaces the old one (the tray menu follows it). */
export function onLastResultChange(listener: () => void): void {
  listeners.add(listener)
}

/** Test hook: a new app run starts with nothing. */
export function resetLastResultForTests(): void {
  recent = []
  listeners.clear()
}
