/**
 * Dictation State Machine Tests
 *
 * Property-based tests for the dictation state machine.
 *
 * Properties tested:
 * - Property 1: State Machine Transition Validity
 * - Property 2: State Machine Cancellation
 * - Property 3: State Machine Event Emission
 *
 * **Validates: Requirements 6.2, 6.3, 6.4, 6.5**
 */

import * as fc from 'fast-check'
import {
  createDictationStateMachine,
  getAllStates,
  getAllEventTypes,
  getValidEventsForState,
  type DictationState,
  type DictationEvent,
  type DictationEventType,
  type DictationStateMachine
} from '../src/main/services/dictation/state-machine'

// ============================================================================
// Test Infrastructure
// ============================================================================

let passedTests = 0
let failedTests = 0
const testResults: { name: string; passed: boolean; error?: string }[] = []

function it(name: string, fn: () => void | Promise<void>): void {
  try {
    const result = fn()
    if (result instanceof Promise) {
      result
        .then(() => {
          passedTests++
          testResults.push({ name, passed: true })
          console.log(`  ✅ ${name}`)
        })
        .catch((error) => {
          failedTests++
          testResults.push({ name, passed: false, error: String(error) })
          console.log(`  ❌ ${name}`)
          console.log(`     Error: ${error}`)
        })
    } else {
      passedTests++
      testResults.push({ name, passed: true })
      console.log(`  ✅ ${name}`)
    }
  } catch (error) {
    failedTests++
    testResults.push({ name, passed: false, error: String(error) })
    console.log(`  ❌ ${name}`)
    console.log(`     Error: ${error}`)
  }
}

function describe(name: string, fn: () => void): void {
  console.log(`\n📦 ${name}`)
  fn()
}

function expect<T>(actual: T) {
  return {
    toBe(expected: T) {
      if (actual !== expected) {
        throw new Error(`Expected ${expected} but got ${actual}`)
      }
    },
    toEqual(expected: T) {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`Expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`)
      }
    },
    toContain(item: unknown) {
      if (!Array.isArray(actual) || !actual.includes(item)) {
        throw new Error(`Expected array to contain ${item}`)
      }
    },
    toBeTruthy() {
      if (!actual) {
        throw new Error(`Expected ${actual} to be truthy`)
      }
    },
    toBeFalsy() {
      if (actual) {
        throw new Error(`Expected ${actual} to be falsy`)
      }
    },
    toBeNull() {
      if (actual !== null) {
        throw new Error(`Expected null but got ${actual}`)
      }
    },
    toHaveBeenCalled() {
      // For mock functions
      if (typeof actual !== 'function' || !(actual as unknown as { calls: unknown[] }).calls) {
        throw new Error('Expected a mock function')
      }
    }
  }
}

// ============================================================================
// Generators
// ============================================================================

const stateArb = fc.constantFrom<DictationState>('idle', 'listening', 'processing')

const eventTypeArb = fc.constantFrom<DictationEventType>(
  'START',
  'STOP',
  'AUDIO_READY',
  'COMPLETE',
  'CANCEL',
  'ERROR'
)

function createEvent(type: DictationEventType): DictationEvent {
  switch (type) {
    case 'START':
      return { type: 'START' }
    case 'STOP':
      return { type: 'STOP' }
    case 'AUDIO_READY':
      return { type: 'AUDIO_READY', data: { audioBase64: 'test', mimeType: 'audio/webm' } }
    case 'COMPLETE':
      return { type: 'COMPLETE', result: { success: true, text: 'test' } }
    case 'CANCEL':
      return { type: 'CANCEL' }
    case 'ERROR':
      return { type: 'ERROR', error: new Error('test error') }
  }
}

// Generate a sequence of events
const eventSequenceArb = fc.array(eventTypeArb, { minLength: 1, maxLength: 20 })

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Valid transitions table for verification
 */
const VALID_TRANSITIONS: Record<DictationState, DictationEventType[]> = {
  idle: ['START'],
  listening: ['STOP', 'AUDIO_READY', 'CANCEL'],
  processing: ['COMPLETE', 'CANCEL', 'ERROR']
}

function isValidTransition(from: DictationState, eventType: DictationEventType): boolean {
  return VALID_TRANSITIONS[from].includes(eventType)
}

function getNextState(from: DictationState, eventType: DictationEventType): DictationState | null {
  if (!isValidTransition(from, eventType)) return null

  switch (from) {
    case 'idle':
      if (eventType === 'START') return 'listening'
      break
    case 'listening':
      if (eventType === 'STOP' || eventType === 'AUDIO_READY') return 'processing'
      if (eventType === 'CANCEL') return 'idle'
      break
    case 'processing':
      if (eventType === 'COMPLETE' || eventType === 'CANCEL' || eventType === 'ERROR') return 'idle'
      break
  }
  return null
}

// ============================================================================
// Tests
// ============================================================================

console.log('🧪 Running Property-Based Tests for Dictation State Machine')
console.log('============================================================')

describe('Property 1: State Machine Transition Validity', () => {
  it('should reject invalid transitions and keep state unchanged (100 iterations)', () => {
    fc.assert(
      fc.property(stateArb, eventTypeArb, (initialState, eventType) => {
        // Create state machine and set to initial state
        const sm = createDictationStateMachine()

        // Navigate to initial state
        if (initialState === 'listening') {
          sm.send({ type: 'START' })
        } else if (initialState === 'processing') {
          sm.send({ type: 'START' })
          sm.send({ type: 'STOP' })
        }

        const stateBefore = sm.getState()
        const event = createEvent(eventType)
        const result = sm.send(event)
        const stateAfter = sm.getState()

        if (isValidTransition(stateBefore, eventType)) {
          // Valid transition - should succeed
          if (!result) {
            throw new Error(
              `Expected valid transition ${stateBefore} + ${eventType} to succeed, but it failed`
            )
          }
          const expectedState = getNextState(stateBefore, eventType)
          if (stateAfter !== expectedState) {
            throw new Error(
              `Expected state ${expectedState} after ${stateBefore} + ${eventType}, got ${stateAfter}`
            )
          }
        } else {
          // Invalid transition - should fail and state unchanged
          if (result) {
            throw new Error(
              `Expected invalid transition ${stateBefore} + ${eventType} to fail, but it succeeded`
            )
          }
          if (stateAfter !== stateBefore) {
            throw new Error(
              `State changed from ${stateBefore} to ${stateAfter} on invalid transition ${eventType}`
            )
          }
        }
      }),
      { numRuns: 100 }
    )
  })

  it('should call onInvalidTransition callback for invalid transitions', () => {
    let callbackCalled = false
    let callbackFrom: DictationState | null = null
    let callbackEvent: DictationEventType | null = null

    const sm = createDictationStateMachine((from, event) => {
      callbackCalled = true
      callbackFrom = from
      callbackEvent = event
    })

    // Try invalid transition: idle + STOP
    sm.send({ type: 'STOP' })

    expect(callbackCalled).toBeTruthy()
    expect(callbackFrom).toBe('idle')
    expect(callbackEvent).toBe('STOP')
  })

  it('should not call onInvalidTransition for valid transitions', () => {
    let callbackCalled = false

    const sm = createDictationStateMachine(() => {
      callbackCalled = true
    })

    // Valid transition: idle + START
    sm.send({ type: 'START' })

    expect(callbackCalled).toBeFalsy()
  })
})

describe('Property 2: State Machine Cancellation', () => {
  it('should transition to idle from listening on CANCEL', () => {
    const sm = createDictationStateMachine()

    // Go to listening
    sm.send({ type: 'START' })
    expect(sm.getState()).toBe('listening')

    // Cancel
    const result = sm.send({ type: 'CANCEL' })
    expect(result).toBeTruthy()
    expect(sm.getState()).toBe('idle')
  })

  it('should transition to idle from processing on CANCEL', () => {
    const sm = createDictationStateMachine()

    // Go to processing
    sm.send({ type: 'START' })
    sm.send({ type: 'STOP' })
    expect(sm.getState()).toBe('processing')

    // Cancel
    const result = sm.send({ type: 'CANCEL' })
    expect(result).toBeTruthy()
    expect(sm.getState()).toBe('idle')
  })

  it('should reject CANCEL from idle state', () => {
    const sm = createDictationStateMachine()

    expect(sm.getState()).toBe('idle')

    const result = sm.send({ type: 'CANCEL' })
    expect(result).toBeFalsy()
    expect(sm.getState()).toBe('idle')
  })

  it('should allow cancellation from any non-idle state (100 iterations)', () => {
    fc.assert(
      fc.property(fc.constantFrom<DictationState>('listening', 'processing'), (nonIdleState) => {
        const sm = createDictationStateMachine()

        // Navigate to non-idle state
        if (nonIdleState === 'listening') {
          sm.send({ type: 'START' })
        } else if (nonIdleState === 'processing') {
          sm.send({ type: 'START' })
          sm.send({ type: 'STOP' })
        }

        expect(sm.getState()).toBe(nonIdleState)

        // Cancel should always work from non-idle states
        const result = sm.send({ type: 'CANCEL' })
        if (!result) {
          throw new Error(`CANCEL should succeed from ${nonIdleState}`)
        }
        if (sm.getState() !== 'idle') {
          throw new Error(`State should be idle after CANCEL, got ${sm.getState()}`)
        }
      }),
      { numRuns: 100 }
    )
  })
})

describe('Property 3: State Machine Event Emission', () => {
  it('should emit exactly one state change event per valid transition', () => {
    const sm = createDictationStateMachine()
    const stateChanges: { newState: DictationState; previousState: DictationState }[] = []

    sm.subscribe((newState, previousState) => {
      stateChanges.push({ newState, previousState })
    })

    // Valid transition
    sm.send({ type: 'START' })

    expect(stateChanges.length).toBe(1)
    expect(stateChanges[0].previousState).toBe('idle')
    expect(stateChanges[0].newState).toBe('listening')
  })

  it('should not emit events for invalid transitions', () => {
    const sm = createDictationStateMachine()
    const stateChanges: { newState: DictationState; previousState: DictationState }[] = []

    sm.subscribe((newState, previousState) => {
      stateChanges.push({ newState, previousState })
    })

    // Invalid transition
    sm.send({ type: 'STOP' }) // Can't STOP from idle

    expect(stateChanges.length).toBe(0)
  })

  it('should notify all subscribers on state change', () => {
    const sm = createDictationStateMachine()
    let listener1Called = false
    let listener2Called = false

    sm.subscribe(() => {
      listener1Called = true
    })
    sm.subscribe(() => {
      listener2Called = true
    })

    sm.send({ type: 'START' })

    expect(listener1Called).toBeTruthy()
    expect(listener2Called).toBeTruthy()
  })

  it('should allow unsubscribing from state changes', () => {
    const sm = createDictationStateMachine()
    let callCount = 0

    const unsubscribe = sm.subscribe(() => {
      callCount++
    })

    sm.send({ type: 'START' })
    expect(callCount).toBe(1)

    unsubscribe()

    sm.send({ type: 'STOP' })
    expect(callCount).toBe(1) // Should not increase
  })

  it('should emit correct state changes for event sequences (100 iterations)', () => {
    fc.assert(
      fc.property(eventSequenceArb, (eventTypes) => {
        const sm = createDictationStateMachine()
        const stateChanges: { newState: DictationState; previousState: DictationState }[] = []

        sm.subscribe((newState, previousState) => {
          stateChanges.push({ newState, previousState })
        })

        let expectedChangeCount = 0
        let currentState: DictationState = 'idle'

        for (const eventType of eventTypes) {
          const event = createEvent(eventType)
          const nextState = getNextState(currentState, eventType)

          if (nextState !== null) {
            expectedChangeCount++
            currentState = nextState
          }

          sm.send(event)
        }

        if (stateChanges.length !== expectedChangeCount) {
          throw new Error(
            `Expected ${expectedChangeCount} state changes, got ${stateChanges.length}`
          )
        }
      }),
      { numRuns: 100 }
    )
  })
})

describe('State Machine Utility Functions', () => {
  it('should return all states', () => {
    const states = getAllStates()
    expect(states).toContain('idle')
    expect(states).toContain('listening')
    expect(states).toContain('processing')
    expect(states.length).toBe(3)
  })

  it('should return all event types', () => {
    const events = getAllEventTypes()
    expect(events).toContain('START')
    expect(events).toContain('STOP')
    expect(events).toContain('AUDIO_READY')
    expect(events).toContain('COMPLETE')
    expect(events).toContain('CANCEL')
    expect(events).toContain('ERROR')
    expect(events.length).toBe(6)
  })

  it('should return valid events for each state', () => {
    expect(getValidEventsForState('idle')).toContain('START')
    expect(getValidEventsForState('listening')).toContain('STOP')
    expect(getValidEventsForState('listening')).toContain('CANCEL')
    expect(getValidEventsForState('processing')).toContain('COMPLETE')
    expect(getValidEventsForState('processing')).toContain('CANCEL')
  })
})

describe('State Machine Reset', () => {
  it('should reset to idle state', () => {
    const sm = createDictationStateMachine()

    sm.send({ type: 'START' })
    sm.send({ type: 'STOP' })
    expect(sm.getState()).toBe('processing')

    sm.reset()
    expect(sm.getState()).toBe('idle')
  })

  it('should emit state change on reset if not already idle', () => {
    const sm = createDictationStateMachine()
    let emitted = false

    sm.send({ type: 'START' })

    sm.subscribe((newState, previousState) => {
      emitted = true
      expect(previousState).toBe('listening')
      expect(newState).toBe('idle')
    })

    sm.reset()
    expect(emitted).toBeTruthy()
  })

  it('should not emit state change on reset if already idle', () => {
    const sm = createDictationStateMachine()
    let emitted = false

    sm.subscribe(() => {
      emitted = true
    })

    sm.reset()
    expect(emitted).toBeFalsy()
  })

  it('should clear last event on reset', () => {
    const sm = createDictationStateMachine()

    sm.send({ type: 'START' })
    expect(sm.getLastEvent()).toEqual({ type: 'START' })

    sm.reset()
    expect(sm.getLastEvent()).toBeNull()
  })
})

describe('State Machine canTransition', () => {
  it('should correctly report valid transitions', () => {
    const sm = createDictationStateMachine()

    // From idle
    expect(sm.canTransition('START')).toBeTruthy()
    expect(sm.canTransition('STOP')).toBeFalsy()
    expect(sm.canTransition('CANCEL')).toBeFalsy()

    // Go to listening
    sm.send({ type: 'START' })
    expect(sm.canTransition('START')).toBeFalsy()
    expect(sm.canTransition('STOP')).toBeTruthy()
    expect(sm.canTransition('CANCEL')).toBeTruthy()

    // Go to processing
    sm.send({ type: 'STOP' })
    expect(sm.canTransition('START')).toBeFalsy()
    expect(sm.canTransition('COMPLETE')).toBeTruthy()
    expect(sm.canTransition('CANCEL')).toBeTruthy()
    expect(sm.canTransition('ERROR')).toBeTruthy()
  })
})

// ============================================================================
// Summary
// ============================================================================

setTimeout(() => {
  console.log('\n============================================================')
  console.log('📊 Test Summary')
  console.log('============================================================')
  console.log(`✅ Tests passed: ${passedTests}`)
  console.log(`❌ Tests failed: ${failedTests}`)
  console.log(`📝 Total tests: ${passedTests + failedTests}`)
  console.log('============================================================')

  if (failedTests > 0) {
    console.log('\n❌ Some tests failed!')
    process.exit(1)
  } else {
    console.log('\n✅ All tests passed!')
    process.exit(0)
  }
}, 100)
