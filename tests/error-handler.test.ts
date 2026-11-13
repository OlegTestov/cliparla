/**
 * Property-Based Tests for Error Handler Module
 *
 * Feature: modular-architecture-refactoring
 *
 * Tests validate correctness properties of the centralized error handling system.
 *
 * Run with: npx tsx tests/error-handler.test.ts
 */

import fc from 'fast-check'
import {
  errorHandler,
  createNetworkError,
  createApiError,
  createSystemError,
  withRetry,
  type AppError,
  type ErrorCategory
} from '../src/main/core/errors'
import { suppressLogging } from '../src/main/core/logger'

// Suppress logging during property-based tests to avoid noisy output
suppressLogging(true)

// ============================================================================
// Test Utilities
// ============================================================================

let testsPassed = 0
let testsFailed = 0

function describe(name: string, fn: () => void) {
  console.log(`\n📦 ${name}`)
  fn()
}

function it(name: string, fn: () => void | Promise<void>) {
  const result = fn()
  if (result instanceof Promise) {
    result
      .then(() => {
        testsPassed++
        console.log(`  ✅ ${name}`)
      })
      .catch((error) => {
        testsFailed++
        console.log(`  ❌ ${name}`)
        console.error(`     Error: ${error instanceof Error ? error.message : String(error)}`)
      })
  } else {
    try {
      testsPassed++
      console.log(`  ✅ ${name}`)
    } catch (error) {
      testsFailed++
      console.log(`  ❌ ${name}`)
      console.error(`     Error: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

// ============================================================================
// Property 7: Error Categorization Consistency
// Feature: modular-architecture-refactoring, Property 7: Error Categorization Consistency
// Validates: Requirements 4.1
// ============================================================================

describe('Property 7: Error Categorization Consistency', () => {
  const VALID_CATEGORIES: ErrorCategory[] = ['network', 'api', 'system']

  it('should always return valid category from errorHandler.handle()', () => {
    const result = fc.check(
      fc.property(fc.string({ minLength: 1, maxLength: 200 }), (errorMessage) => {
        const error = new Error(errorMessage)
        const appError = errorHandler.handle(error)
        return VALID_CATEGORIES.includes(appError.category)
      }),
      { numRuns: 100 }
    )

    if (result.failed) {
      throw new Error(`Property failed: ${JSON.stringify(result.counterexample)}`)
    }
  })

  it('should categorize network errors correctly', () => {
    const networkKeywords = ['network', 'fetch failed', 'ECONNREFUSED', 'offline', 'internet']

    for (const keyword of networkKeywords) {
      const error = new Error(`Error: ${keyword} issue`)
      const appError = errorHandler.handle(error)

      if (appError.category !== 'network') {
        throw new Error(`Expected 'network' category for "${keyword}", got '${appError.category}'`)
      }
    }
  })

  it('should never retry rejected credentials (401/403)', () => {
    for (const keyword of ['unauthorized', '401', '403']) {
      const appError = errorHandler.handle(new Error(`Error: ${keyword}`))
      if (appError.retryable) {
        throw new Error(`"${keyword}" must not be retryable`)
      }
      if (!VALID_CATEGORIES.includes(appError.category)) {
        throw new Error(`Unexpected category '${appError.category}' for "${keyword}"`)
      }
    }
  })

  it('should categorize API errors correctly', () => {
    const apiKeywords = ['rate limit', '429', 'api key invalid']

    for (const keyword of apiKeywords) {
      const error = new Error(`Error: ${keyword}`)
      const appError = errorHandler.handle(error)

      if (appError.category !== 'api') {
        throw new Error(`Expected 'api' category for "${keyword}", got '${appError.category}'`)
      }
    }
  })

  it('should default to system category for unknown errors', () => {
    const error = new Error('Some random error without keywords')
    const appError = errorHandler.handle(error)

    if (appError.category !== 'system') {
      throw new Error(`Expected 'system' category, got '${appError.category}'`)
    }
  })
})

// ============================================================================
// Property 8: Error User-Friendly Messages
// Feature: modular-architecture-refactoring, Property 8: Error User-Friendly Messages
// Validates: Requirements 4.2
// ============================================================================

describe('Property 8: Error User-Friendly Messages', () => {
  it('should always have non-empty user message', () => {
    const result = fc.check(
      fc.property(fc.string({ minLength: 1, maxLength: 200 }), (errorMessage) => {
        const error = new Error(errorMessage)
        const appError = errorHandler.handle(error)
        return appError.message.length > 0
      }),
      { numRuns: 100 }
    )

    if (result.failed) {
      throw new Error(`Property failed: ${JSON.stringify(result.counterexample)}`)
    }
  })

  it('should not contain stack traces in user message', () => {
    const result = fc.check(
      fc.property(fc.string({ minLength: 1, maxLength: 200 }), (errorMessage) => {
        const error = new Error(errorMessage)
        error.stack = 'Error: test\n    at Object.<anonymous> (/path/to/file.js:1:1)'
        const appError = errorHandler.handle(error)

        // User message should not contain stack trace indicators
        return (
          !appError.message.includes('at ') &&
          !appError.message.includes('.js:') &&
          !appError.message.includes('.ts:')
        )
      }),
      { numRuns: 100 }
    )

    if (result.failed) {
      throw new Error(`Property failed: ${JSON.stringify(result.counterexample)}`)
    }
  })

  it('should not contain error codes in user message', () => {
    const result = fc.check(
      fc.property(fc.string({ minLength: 1, maxLength: 200 }), (errorMessage) => {
        const error = new Error(errorMessage)
        const appError = errorHandler.handle(error)

        // User message should not contain technical error codes
        return (
          !appError.message.includes('NETWORK_') &&
          !appError.message.includes('API_') &&
          !appError.message.includes('SYSTEM_')
        )
      }),
      { numRuns: 100 }
    )

    if (result.failed) {
      throw new Error(`Property failed: ${JSON.stringify(result.counterexample)}`)
    }
  })

  it('should have friendly messages for all error factory functions', () => {
    const factories = [
      () => createNetworkError(new Error('test')),
      () => createApiError(new Error('test')),
      () => createSystemError(new Error('test'))
    ]

    for (const factory of factories) {
      const appError = factory()

      if (appError.message.length === 0) {
        throw new Error('User message should not be empty')
      }

      // Should be readable English
      if (!/^[A-Z]/.test(appError.message)) {
        throw new Error(`User message should start with capital letter: "${appError.message}"`)
      }
    }
  })
})

// ============================================================================
// Property 9: Error Original Preservation
// Feature: modular-architecture-refactoring, Property 9: Error Original Preservation
// Validates: Requirements 4.5
// ============================================================================

describe('Property 9: Error Original Preservation', () => {
  it('should preserve original Error instance', () => {
    const result = fc.check(
      fc.property(fc.string({ minLength: 1, maxLength: 200 }), (errorMessage) => {
        const originalError = new Error(errorMessage)
        const appError = errorHandler.handle(originalError)

        return appError.originalError === originalError
      }),
      { numRuns: 100 }
    )

    if (result.failed) {
      throw new Error(`Property failed: ${JSON.stringify(result.counterexample)}`)
    }
  })

  it('should preserve original error in all factory functions', () => {
    const originalError = new Error('Original error message')

    const factories: Array<(e: Error) => AppError> = [
      createNetworkError,
      createApiError,
      createSystemError
    ]

    for (const factory of factories) {
      const appError = factory(originalError)

      if (appError.originalError !== originalError) {
        throw new Error(`Factory ${factory.name} did not preserve original error`)
      }
    }
  })

  it('should preserve technical message from original error', () => {
    const result = fc.check(
      fc.property(fc.string({ minLength: 1, maxLength: 200 }), (errorMessage) => {
        const originalError = new Error(errorMessage)
        const appError = errorHandler.handle(originalError)

        // Technical message should contain original error message
        return appError.technicalMessage.includes(errorMessage)
      }),
      { numRuns: 100 }
    )

    if (result.failed) {
      throw new Error(`Property failed: ${JSON.stringify(result.counterexample)}`)
    }
  })
})

// ============================================================================
// Property 10: Retry Logic for Transient Errors
// Feature: modular-architecture-refactoring, Property 10: Retry Logic for Transient Errors
// Validates: Requirements 4.4
// ============================================================================

describe('Property 10: Retry Logic for Transient Errors', () => {
  it('should mark network errors as retryable', () => {
    const networkError = new Error('Network connection failed')
    const appError = createNetworkError(networkError)

    if (!appError.retryable) {
      throw new Error('Network errors should be retryable')
    }
  })

  it('should mark rate limit errors as retryable', () => {
    const rateLimitError = new Error('Rate limit exceeded (429)')
    const appError = createApiError(rateLimitError)

    if (!appError.retryable) {
      throw new Error('Rate limit errors should be retryable')
    }
  })

  it('should retry up to maxAttempts times', async () => {
    let attempts = 0
    const maxAttempts = 3

    try {
      await withRetry(
        async () => {
          attempts++
          throw new Error('Network error')
        },
        { maxAttempts, delayMs: 10 }
      )
    } catch {
      // Expected to fail
    }

    if (attempts !== maxAttempts) {
      throw new Error(`Expected ${maxAttempts} attempts, got ${attempts}`)
    }
  })

  it('should succeed on retry if function eventually succeeds', async () => {
    let attempts = 0

    const result = await withRetry(
      async () => {
        attempts++
        if (attempts < 2) {
          throw new Error('Network error')
        }
        return 'success'
      },
      { maxAttempts: 3, delayMs: 10 }
    )

    if (result !== 'success') {
      throw new Error(`Expected 'success', got '${result}'`)
    }

    if (attempts !== 2) {
      throw new Error(`Expected 2 attempts, got ${attempts}`)
    }
  })

  it('should not retry non-retryable errors', async () => {
    let attempts = 0

    try {
      await withRetry(
        async () => {
          attempts++
          throw new Error('Unauthorized (401)')
        },
        { maxAttempts: 3, delayMs: 10 }
      )
    } catch {
      // Expected to fail
    }

    // Auth errors are not retryable, so should only attempt once
    if (attempts !== 1) {
      throw new Error(`Expected 1 attempt for non-retryable error, got ${attempts}`)
    }
  })
})

// ============================================================================
// Additional Unit Tests
// ============================================================================

describe('Error Handler API Completeness', () => {
  it('should have handle and shouldRetry methods', () => {
    if (typeof errorHandler.handle !== 'function') {
      throw new Error('errorHandler.handle should be a function')
    }
    if (typeof errorHandler.shouldRetry !== 'function') {
      throw new Error('errorHandler.shouldRetry should be a function')
    }
  })

  it('should handle non-Error inputs', () => {
    const stringError = errorHandler.handle('string error')
    if (stringError.category !== 'system') {
      throw new Error('String error should be categorized as system')
    }

    const numberError = errorHandler.handle(42)
    if (numberError.category !== 'system') {
      throw new Error('Number error should be categorized as system')
    }
  })
})

// ============================================================================
// Test Summary
// ============================================================================

console.log('\n🧪 Running Property-Based Tests for Error Handler Module\n')
console.log('='.repeat(60))

// Wait for async tests to complete
setTimeout(() => {
  console.log('\n' + '='.repeat(60))
  console.log('📊 Test Summary')
  console.log('='.repeat(60))
  console.log(`✅ Tests passed: ${testsPassed}`)
  console.log(`❌ Tests failed: ${testsFailed}`)
  console.log(`📝 Total tests: ${testsPassed + testsFailed}`)
  console.log('='.repeat(60))

  if (testsFailed > 0) {
    console.log('\n❌ Some tests failed. Please review the errors above.\n')
    process.exit(1)
  } else {
    console.log('\n✅ All tests passed!\n')
  }
}, 1000)
