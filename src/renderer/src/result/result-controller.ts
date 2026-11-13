/**
 * State of the result window.
 *
 * Every capture bumps a generation. An AI action remembers the generation it
 * started in and is ignored when it finishes after a newer capture began, so a
 * slow action on screenshot A can never overwrite screenshot B.
 *
 * Actions always work on the translation, which is kept, so the user can go
 * back to it after a summary, comment or improved version.
 */

import type { TranslationResult } from '../../../shared/types'
import { originalToShow } from '../../../shared/original-text'

export interface ResultState {
  isLoading: boolean
  /** What the window shows: the translation or the last action's result. */
  result: TranslationResult | null
  processingAction: string | null
  /** The action whose result is shown; null while the translation is shown. */
  view: string | null
  /** The recognised text under the translation; null when there is none to show. */
  original: string | null
  originalOpen: boolean
  /** Text that has arrived so far from the running translation or action ('' when none). */
  streamText: string
}

type Draft = Omit<ResultState, 'original'>

export interface ActionMessages {
  failed: string
  unexpected: string
}

/** Text is still arriving from the translation or an action. */
export function isStreaming(state: ResultState): boolean {
  return (state.isLoading || !!state.processingAction) && state.streamText !== ''
}

/** Copy waits until the text has fully arrived. */
export function canCopyText(state: ResultState): boolean {
  return (
    !state.isLoading && !state.processingAction && !!state.result?.success && !!state.result.text
  )
}

/**
 * Retry shows after a failed translation (when the failure came from the model call, not from the
 * app itself: those have no error code) and after a failed action.
 */
export function canRetry(state: ResultState): boolean {
  const { isLoading, processingAction, result, view } = state
  return (
    !isLoading &&
    !processingAction &&
    !!result &&
    !result.success &&
    (view !== null || !!result.errorCode)
  )
}

export class ResultController {
  private state: ResultState = {
    isLoading: true,
    result: null,
    processingAction: null,
    view: null,
    original: null,
    originalOpen: false,
    streamText: ''
  }
  private translation: TranslationResult | null = null
  private generation = 0
  // Names the running action so text of an older one (a stale stream) is not shown
  private actionRequest = 0
  private listeners = new Set<() => void>()

  getState = (): ResultState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** A new capture started. */
  start(): void {
    this.generation++
    this.translation = null
    this.set({
      isLoading: true,
      result: null,
      processingAction: null,
      view: null,
      originalOpen: false,
      streamText: ''
    })
  }

  /** Part of the translation arrived. Late text after the end is ignored. */
  partial(text: string): void {
    if (!this.state.isLoading) return
    this.set({ ...this.state, streamText: text })
  }

  /** Part of the running AI action arrived. Text of an older request is ignored. */
  actionPartial(requestId: number | undefined, text: string): void {
    if (!this.state.processingAction || requestId !== this.actionRequest) return
    this.set({ ...this.state, streamText: text })
  }

  /** The capture finished (success or failure). */
  complete(result: TranslationResult): void {
    this.translation = result
    this.set({
      ...this.state,
      isLoading: false,
      result,
      view: null,
      originalOpen: false,
      streamText: ''
    })
  }

  /** Show the translation again after an action. */
  showTranslation(): void {
    if (!this.translation || this.state.processingAction) return
    this.set({ ...this.state, result: this.translation, view: null })
  }

  /** Expand or collapse the "Original" row. */
  toggleOriginal(): void {
    if (this.state.original === null) return
    this.set({ ...this.state, originalOpen: !this.state.originalOpen })
  }

  /** Copy the recognised text only (never the translation). */
  async copyOriginal(copy: (text: string) => Promise<void>): Promise<boolean> {
    const { original } = this.state
    if (original === null) return false
    await copy(original)
    return true
  }

  /** Run an AI action on the current text. Ignored if a newer capture starts meanwhile. */
  async runAction(
    actionId: string,
    invoke: (text: string, requestId: number) => Promise<TranslationResult>,
    messages: ActionMessages
  ): Promise<void> {
    const { processingAction, isLoading } = this.state
    const source = this.translation
    if (isLoading || processingAction || !source?.success || !source.text) return

    const mine = this.generation
    const requestId = ++this.actionRequest
    this.set({ ...this.state, processingAction: actionId, streamText: '' })

    let next: TranslationResult
    try {
      const response = await invoke(source.text, requestId)
      next =
        response.success && response.text
          ? { success: true, text: response.text }
          : {
              success: false,
              error: response.error || messages.failed,
              ...(response.partial ? { partial: response.partial } : {})
            }
    } catch {
      next = { success: false, error: messages.unexpected }
    }

    if (mine !== this.generation) return
    this.set({
      ...this.state,
      result: next,
      processingAction: null,
      view: actionId,
      streamText: ''
    })
  }

  private set(next: Draft): void {
    // The original belongs to the translation, not to an action's result
    const original = next.view === null && next.result?.success ? originalToShow(next.result) : null
    this.state = { ...next, original }
    this.listeners.forEach((listener) => listener())
  }
}
