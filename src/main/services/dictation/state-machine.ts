/**
 * Dictation State Machine
 *
 * Formal state machine for dictation workflow with explicit states and transitions.
 * This module has NO Electron dependencies and can be tested in isolation.
 *
 * States:
 * - idle: Waiting for user to start dictation
 * - listening: Recording audio
 * - processing: Transcribing and translating audio
 *
 * Valid Transitions:
 * - idle → listening (START)
 * - listening → processing (STOP, AUDIO_READY)
 * - listening → idle (CANCEL)
 * - processing → idle (COMPLETE, CANCEL, ERROR)
 */

import type { AudioData, TranslationResult } from '../../../shared/types'

// ============================================================================
// Types
// ============================================================================

export type DictationState = 'idle' | 'listening' | 'processing'

export type DictationEvent =
  | { type: 'START' }
  | { type: 'STOP' }
  | { type: 'AUDIO_READY'; data: AudioData }
  | { type: 'COMPLETE'; result: TranslationResult }
  | { type: 'CANCEL' }
  | { type: 'ERROR'; error: Error }

export type DictationEventType = DictationEvent['type']

export type StateChangeListener = (state: DictationState, previousState: DictationState) => void

// ============================================================================
// Transition Table
// ============================================================================

interface TransitionRule {
  from: DictationState
  event: DictationEventType
  to: DictationState
}

/**
 * Valid state transitions.
 * Any transition not in this table is invalid and will be rejected.
 */
const TRANSITIONS: TransitionRule[] = [
  // From idle
  { from: 'idle', event: 'START', to: 'listening' },

  // From listening
  { from: 'listening', event: 'STOP', to: 'processing' },
  { from: 'listening', event: 'AUDIO_READY', to: 'processing' }, // Auto-stop case
  { from: 'listening', event: 'CANCEL', to: 'idle' },

  // From processing
  { from: 'processing', event: 'COMPLETE', to: 'idle' },
  { from: 'processing', event: 'CANCEL', to: 'idle' },
  { from: 'processing', event: 'ERROR', to: 'idle' }
]

// ============================================================================
// State Machine Implementation
// ============================================================================

export interface DictationStateMachine {
  /** Get current state */
  getState(): DictationState

  /** Send an event to the state machine. Returns true if transition was valid. */
  send(event: DictationEvent): boolean

  /** Check if a transition is valid from current state */
  canTransition(eventType: DictationEventType): boolean

  /** Subscribe to state changes. Returns unsubscribe function. */
  subscribe(listener: StateChangeListener): () => void

  /** Reset state machine to idle */
  reset(): void

  /** Get last event that was processed (for debugging) */
  getLastEvent(): DictationEvent | null
}

/**
 * Create a new dictation state machine instance.
 *
 * @param onInvalidTransition - Optional callback for invalid transitions (for logging)
 */
export function createDictationStateMachine(
  onInvalidTransition?: (from: DictationState, event: DictationEventType) => void
): DictationStateMachine {
  let currentState: DictationState = 'idle'
  let lastEvent: DictationEvent | null = null
  const listeners: Set<StateChangeListener> = new Set()

  /**
   * Find valid transition for current state and event
   */
  function findTransition(
    from: DictationState,
    eventType: DictationEventType
  ): TransitionRule | undefined {
    return TRANSITIONS.find((t) => t.from === from && t.event === eventType)
  }

  /**
   * Notify all listeners of state change
   */
  function notifyListeners(newState: DictationState, previousState: DictationState): void {
    for (const listener of listeners) {
      try {
        listener(newState, previousState)
      } catch {
        // Ignore listener errors to prevent breaking the state machine
      }
    }
  }

  return {
    getState(): DictationState {
      return currentState
    },

    send(event: DictationEvent): boolean {
      const transition = findTransition(currentState, event.type)

      if (!transition) {
        // Invalid transition
        onInvalidTransition?.(currentState, event.type)
        return false
      }

      // Valid transition - update state
      const previousState = currentState
      currentState = transition.to
      lastEvent = event

      // Notify listeners
      notifyListeners(currentState, previousState)

      return true
    },

    canTransition(eventType: DictationEventType): boolean {
      return findTransition(currentState, eventType) !== undefined
    },

    subscribe(listener: StateChangeListener): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    reset(): void {
      const previousState = currentState
      currentState = 'idle'
      lastEvent = null

      if (previousState !== 'idle') {
        notifyListeners('idle', previousState)
      }
    },

    getLastEvent(): DictationEvent | null {
      return lastEvent
    }
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get all valid event types for a given state
 */
export function getValidEventsForState(state: DictationState): DictationEventType[] {
  return TRANSITIONS.filter((t) => t.from === state).map((t) => t.event)
}

/**
 * Check if a state is a terminal state (can only transition to idle)
 */
export function isTerminalState(state: DictationState): boolean {
  return state === 'idle'
}

/**
 * Get all possible states
 */
export function getAllStates(): DictationState[] {
  return ['idle', 'listening', 'processing']
}

/**
 * Get all possible event types
 */
export function getAllEventTypes(): DictationEventType[] {
  return ['START', 'STOP', 'AUDIO_READY', 'COMPLETE', 'CANCEL', 'ERROR']
}
