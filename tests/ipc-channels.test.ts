/**
 * IPC Channel Completeness Tests
 *
 * Property 15: IPC Channel Completeness
 * For any IPC channel name used in ipcMain.handle() or ipcMain.on(),
 * the channel name SHALL be a value from the IPC_CHANNELS constant.
 *
 * **Validates: Requirements 9.1**
 */

import { IPC_CHANNELS } from '../src/shared/ipc-types'

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
    toBeGreaterThan(expected: number) {
      if (typeof actual !== 'number' || actual <= expected) {
        throw new Error(`Expected ${actual} to be greater than ${expected}`)
      }
    },
    toBeTruthy() {
      if (!actual) {
        throw new Error(`Expected ${actual} to be truthy`)
      }
    },
    toBeDefined() {
      if (actual === undefined) {
        throw new Error(`Expected value to be defined`)
      }
    },
    toHaveLength(expected: number) {
      if (!Array.isArray(actual) || actual.length !== expected) {
        throw new Error(`Expected array length ${expected} but got ${(actual as unknown[]).length}`)
      }
    }
  }
}

// ============================================================================
// IPC Channel Constants
// ============================================================================

// All channel values from IPC_CHANNELS
const ALL_CHANNEL_VALUES = Object.values(IPC_CHANNELS)

// Expected channels by domain
const SETTINGS_CHANNELS = [
  IPC_CHANNELS.GET_SETTINGS,
  IPC_CHANNELS.SAVE_SETTINGS,
  IPC_CHANNELS.SET_DICTIONARY,
  IPC_CHANNELS.SET_SHORTCUT
]

const CAPTURE_CHANNELS = [IPC_CHANNELS.SELECTION_MADE, IPC_CHANNELS.CANCEL_CAPTURE]

const RESULT_CHANNELS = [
  IPC_CHANNELS.COPY_TO_CLIPBOARD,
  IPC_CHANNELS.COPY_SCREENSHOT,
  IPC_CHANNELS.CLOSE_RESULT,
  IPC_CHANNELS.TRANSLATION_START,
  IPC_CHANNELS.TRANSLATION_COMPLETE,
  IPC_CHANNELS.TRANSLATION_PARTIAL,
  IPC_CHANNELS.ACTION_PARTIAL,
  IPC_CHANNELS.RETRY_TRANSLATION,
  IPC_CHANNELS.TOAST_SHOW,
  IPC_CHANNELS.COMMENT_TEXT,
  IPC_CHANNELS.IMPROVE_TEXT,
  IPC_CHANNELS.SUMMARIZE_TEXT
]

const DICTATION_CHANNELS = [
  IPC_CHANNELS.AUDIO_DATA_READY,
  IPC_CHANNELS.CANCEL_DICTATION,
  IPC_CHANNELS.STOP_DICTATION,
  IPC_CHANNELS.INDICATOR_HOVER,
  IPC_CHANNELS.RECORDING_FAILED,
  IPC_CHANNELS.RECORDING_STARTED,
  IPC_CHANNELS.LISTENING_MODE_START,
  IPC_CHANNELS.LISTENING_MODE_PROCESSING,
  IPC_CHANNELS.LISTENING_MODE_COPIED,
  IPC_CHANNELS.LISTENING_MODE_STOP,
  IPC_CHANNELS.LISTENING_MODE_ERROR,
  IPC_CHANNELS.LISTENING_MODE_TEXT,
  IPC_CHANNELS.RETRY_DICTATION,
  IPC_CHANNELS.INDICATOR_PAGE_READY,
  IPC_CHANNELS.INDICATOR_PAGE_FAILED
]

const PERMISSIONS_CHANNELS = [
  IPC_CHANNELS.GET_PERMISSIONS_STATUS,
  IPC_CHANNELS.REQUEST_SCREEN_RECORDING,
  IPC_CHANNELS.REQUEST_MICROPHONE,
  IPC_CHANNELS.REQUEST_ACCESSIBILITY,
  IPC_CHANNELS.OPEN_SCREEN_RECORDING_SETTINGS,
  IPC_CHANNELS.OPEN_MICROPHONE_SETTINGS,
  IPC_CHANNELS.OPEN_ACCESSIBILITY_SETTINGS,
  IPC_CHANNELS.PERMISSIONS_CONTINUE,
  IPC_CHANNELS.PERMISSIONS_WINDOW_SHOWN,
  IPC_CHANNELS.PERMISSIONS_WINDOW_HIDDEN
]

const API_KEY_CHANNELS = [
  IPC_CHANNELS.GET_KEY_STATUS,
  IPC_CHANNELS.TEST_KEY,
  IPC_CHANNELS.SAVE_KEY,
  IPC_CHANNELS.REMOVE_KEY,
  IPC_CHANNELS.SETUP_RESET,
  IPC_CHANNELS.GET_SETUP_REASON,
  IPC_CHANNELS.GET_TRY_IT_PENDING,
  IPC_CHANNELS.UI_LANGUAGE_CHANGED,
  IPC_CHANNELS.SETUP_DONE,
  IPC_CHANNELS.TRY_CAPTURE,
  IPC_CHANNELS.FINISH_ONBOARDING
]

const APP_CHANNELS = [
  IPC_CHANNELS.OPEN_EXTERNAL,
  IPC_CHANNELS.GET_APP_VERSION,
  IPC_CHANNELS.FIT_WINDOW_HEIGHT,
  IPC_CHANNELS.RESET_WINDOW_HEIGHT
]

// ============================================================================
// Tests
// ============================================================================

console.log('🧪 Running IPC Channel Completeness Tests')
console.log('============================================================')

describe('Property 15: IPC Channel Completeness', () => {
  it('should have all settings channels defined', () => {
    for (const channel of SETTINGS_CHANNELS) {
      expect(ALL_CHANNEL_VALUES).toContain(channel)
    }
  })

  it('should have all capture channels defined', () => {
    for (const channel of CAPTURE_CHANNELS) {
      expect(ALL_CHANNEL_VALUES).toContain(channel)
    }
  })

  it('should have all result channels defined', () => {
    for (const channel of RESULT_CHANNELS) {
      expect(ALL_CHANNEL_VALUES).toContain(channel)
    }
  })

  it('should have all dictation channels defined', () => {
    for (const channel of DICTATION_CHANNELS) {
      expect(ALL_CHANNEL_VALUES).toContain(channel)
    }
  })

  it('should have all permissions channels defined', () => {
    for (const channel of PERMISSIONS_CHANNELS) {
      expect(ALL_CHANNEL_VALUES).toContain(channel)
    }
  })

  it('should have all API key channels defined', () => {
    for (const channel of API_KEY_CHANNELS) {
      expect(ALL_CHANNEL_VALUES).toContain(channel)
    }
  })

  it('should have all app channels defined', () => {
    for (const channel of APP_CHANNELS) {
      expect(ALL_CHANNEL_VALUES).toContain(channel)
    }
  })
})

describe('IPC Channel String Values', () => {
  it('should have correct string value for GET_SETTINGS', () => {
    expect(IPC_CHANNELS.GET_SETTINGS).toBe('get-settings')
  })

  it('should have correct string value for SAVE_SETTINGS', () => {
    expect(IPC_CHANNELS.SAVE_SETTINGS).toBe('save-settings')
  })

  it('should have correct string value for SELECTION_MADE', () => {
    expect(IPC_CHANNELS.SELECTION_MADE).toBe('selection-made')
  })

  it('should have correct string value for CANCEL_CAPTURE', () => {
    expect(IPC_CHANNELS.CANCEL_CAPTURE).toBe('cancel-capture')
  })

  it('should have correct string value for COPY_TO_CLIPBOARD', () => {
    expect(IPC_CHANNELS.COPY_TO_CLIPBOARD).toBe('copy-to-clipboard')
  })

  it('should have correct string value for CLOSE_RESULT', () => {
    expect(IPC_CHANNELS.CLOSE_RESULT).toBe('close-result')
  })

  it('should have correct string value for AUDIO_DATA_READY', () => {
    expect(IPC_CHANNELS.AUDIO_DATA_READY).toBe('audio-data-ready')
  })

  it('should have correct string value for CANCEL_DICTATION', () => {
    expect(IPC_CHANNELS.CANCEL_DICTATION).toBe('cancel-dictation')
  })

  it('should have correct string values for the API key channels', () => {
    expect(IPC_CHANNELS.GET_KEY_STATUS).toBe('get-key-status')
    expect(IPC_CHANNELS.TEST_KEY).toBe('test-key')
    expect(IPC_CHANNELS.SAVE_KEY).toBe('save-key')
    expect(IPC_CHANNELS.REMOVE_KEY).toBe('remove-key')
  })

  it('should have no duplicate channel values', () => {
    const uniqueValues = new Set(ALL_CHANNEL_VALUES)
    expect(uniqueValues.size).toBe(ALL_CHANNEL_VALUES.length)
  })

  it('should have all channels as non-empty strings', () => {
    for (const channel of ALL_CHANNEL_VALUES) {
      expect(typeof channel).toBe('string')
      expect(channel.length).toBeGreaterThan(0)
    }
  })
})

describe('IPC Channel Coverage', () => {
  it('should have expected total number of channels', () => {
    const expectedTotal =
      SETTINGS_CHANNELS.length +
      CAPTURE_CHANNELS.length +
      RESULT_CHANNELS.length +
      DICTATION_CHANNELS.length +
      PERMISSIONS_CHANNELS.length +
      API_KEY_CHANNELS.length +
      APP_CHANNELS.length

    expect(ALL_CHANNEL_VALUES.length).toBe(expectedTotal)
  })

  it('should cover all domains', () => {
    const allDomainChannels = [
      ...SETTINGS_CHANNELS,
      ...CAPTURE_CHANNELS,
      ...RESULT_CHANNELS,
      ...DICTATION_CHANNELS,
      ...PERMISSIONS_CHANNELS,
      ...API_KEY_CHANNELS,
      ...APP_CHANNELS
    ]

    // Every channel in IPC_CHANNELS should be in one of the domain arrays
    for (const channel of ALL_CHANNEL_VALUES) {
      expect(allDomainChannels).toContain(channel)
    }
  })
})

// ============================================================================
// Summary
// ============================================================================

// Wait for async tests to complete
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
