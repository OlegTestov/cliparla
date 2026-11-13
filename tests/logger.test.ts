/**
 * Property-Based Tests for Logger Module
 *
 * Feature: modular-architecture-refactoring
 *
 * Tests validate correctness properties of the centralized logging system.
 *
 * Run with: npx tsx tests/logger.test.ts
 */

import fc from 'fast-check'
import { shouldLog, createLogger, suppressLogging, type LogLevel } from '../src/main/core/logger'

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

function it(name: string, fn: () => void) {
  try {
    fn()
    testsPassed++
    console.log(`  ✅ ${name}`)
  } catch (error) {
    testsFailed++
    console.log(`  ❌ ${name}`)
    console.error(`     Error: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// ============================================================================
// Property 4: Logger Level Filtering
// Feature: modular-architecture-refactoring, Property 4: Logger Level Filtering
// Validates: Requirements 3.1, 3.3
// ============================================================================

describe('Property 4: Logger Level Filtering', () => {
  const LOG_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error']
  const LEVEL_PRIORITY: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3
  }

  it('should output log if level >= minLevel (all combinations)', () => {
    // Temporarily enable logging to test shouldLog logic
    suppressLogging(false)
    try {
      for (const level of LOG_LEVELS) {
        for (const minLevel of LOG_LEVELS) {
          const expected = LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[minLevel]
          const actual = shouldLog(level, minLevel)

          if (actual !== expected) {
            throw new Error(
              `shouldLog('${level}', '${minLevel}') = ${actual}, expected ${expected}`
            )
          }
        }
      }
    } finally {
      suppressLogging(true)
    }
  })

  it('should filter debug in production (minLevel=info)', () => {
    suppressLogging(false)
    try {
      // When minLevel is 'info', debug should be filtered
      if (shouldLog('debug', 'info')) {
        throw new Error('debug should be filtered when minLevel is info')
      }

      // info, warn, error should pass
      if (!shouldLog('info', 'info')) {
        throw new Error('info should pass when minLevel is info')
      }
      if (!shouldLog('warn', 'info')) {
        throw new Error('warn should pass when minLevel is info')
      }
      if (!shouldLog('error', 'info')) {
        throw new Error('error should pass when minLevel is info')
      }
    } finally {
      suppressLogging(true)
    }
  })

  it('should always output error level regardless of minLevel', () => {
    suppressLogging(false)
    try {
      for (const minLevel of LOG_LEVELS) {
        if (!shouldLog('error', minLevel)) {
          throw new Error(`error should always pass, but failed with minLevel=${minLevel}`)
        }
      }
    } finally {
      suppressLogging(true)
    }
  })

  it('should filter all levels below minLevel (100 random combinations)', () => {
    suppressLogging(false)
    try {
      const result = fc.check(
        fc.property(
          fc.constantFrom(...LOG_LEVELS),
          fc.constantFrom(...LOG_LEVELS),
          (level, minLevel) => {
            const expected = LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[minLevel]
            return shouldLog(level, minLevel) === expected
          }
        ),
        { numRuns: 100 }
      )

      if (result.failed) {
        throw new Error(`Property failed: ${JSON.stringify(result.counterexample)}`)
      }
    } finally {
      suppressLogging(true)
    }
  })
})

// ============================================================================
// Property 5: Logger Entry Structure
// Feature: modular-architecture-refactoring, Property 5: Logger Entry Structure
// Validates: Requirements 3.2, 3.5
// ============================================================================

describe('Property 5: Logger Entry Structure', () => {
  it('should create logger with module name', () => {
    const log = createLogger('TestModule')

    if (typeof log.debug !== 'function') {
      throw new Error('Logger should have debug method')
    }
    if (typeof log.info !== 'function') {
      throw new Error('Logger should have info method')
    }
    if (typeof log.warn !== 'function') {
      throw new Error('Logger should have warn method')
    }
    if (typeof log.error !== 'function') {
      throw new Error('Logger should have error method')
    }
  })

  it('should accept structured data in log entries (100 iterations)', () => {
    const log = createLogger('TestModule')

    const result = fc.check(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }),
        fc.dictionary(fc.string({ minLength: 1, maxLength: 20 }), fc.jsonValue()),
        (message, data) => {
          // Should not throw when called with structured data
          try {
            log.info(message, data as Record<string, unknown>)
            return true
          } catch {
            return false
          }
        }
      ),
      { numRuns: 100 }
    )

    if (result.failed) {
      throw new Error(`Property failed: ${JSON.stringify(result.counterexample)}`)
    }
  })

  it('should handle empty module names', () => {
    const log = createLogger('')

    // Should not throw
    try {
      log.info('test message')
    } catch (error) {
      throw new Error(`Logger should handle empty module name: ${error}`)
    }
  })

  it('should handle special characters in module names (100 iterations)', () => {
    const result = fc.check(
      fc.property(fc.string({ minLength: 0, maxLength: 50 }), (moduleName) => {
        try {
          const log = createLogger(moduleName)
          log.info('test')
          return true
        } catch {
          return false
        }
      }),
      { numRuns: 100 }
    )

    if (result.failed) {
      throw new Error(`Property failed: ${JSON.stringify(result.counterexample)}`)
    }
  })
})

// ============================================================================
// Property 6: Logger Error Stack Trace
// Feature: modular-architecture-refactoring, Property 6: Logger Error Stack Trace
// Validates: Requirements 3.6
// ============================================================================

describe('Property 6: Logger Error Stack Trace', () => {
  it('should accept Error objects in error() method', () => {
    const log = createLogger('TestModule')
    const error = new Error('Test error')

    // Should not throw
    try {
      log.error('An error occurred', error)
    } catch (e) {
      throw new Error(`Logger.error should accept Error objects: ${e}`)
    }
  })

  it('should accept Error with additional data', () => {
    const log = createLogger('TestModule')
    const error = new Error('Test error')

    // Should not throw
    try {
      log.error('An error occurred', error, { context: 'test', code: 123 })
    } catch (e) {
      throw new Error(`Logger.error should accept Error with data: ${e}`)
    }
  })

  it('should handle errors without stack trace', () => {
    const log = createLogger('TestModule')
    const error = new Error('Test error')
    delete error.stack

    // Should not throw
    try {
      log.error('An error occurred', error)
    } catch (e) {
      throw new Error(`Logger.error should handle errors without stack: ${e}`)
    }
  })

  it('should handle various error types (100 iterations)', () => {
    const log = createLogger('TestModule')

    const result = fc.check(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }),
        fc.string({ minLength: 1, maxLength: 200 }),
        (message, errorMessage) => {
          try {
            const error = new Error(errorMessage)
            log.error(message, error)
            return true
          } catch {
            return false
          }
        }
      ),
      { numRuns: 100 }
    )

    if (result.failed) {
      throw new Error(`Property failed: ${JSON.stringify(result.counterexample)}`)
    }
  })

  it('should handle undefined error parameter', () => {
    const log = createLogger('TestModule')

    // Should not throw
    try {
      log.error('An error occurred', undefined)
    } catch (e) {
      throw new Error(`Logger.error should handle undefined error: ${e}`)
    }
  })
})

// ============================================================================
// Additional Unit Tests
// ============================================================================

describe('Logger API Completeness', () => {
  it('should have all required methods', () => {
    const log = createLogger('Test')
    const methods = ['debug', 'info', 'warn', 'error']

    for (const method of methods) {
      if (typeof (log as unknown as Record<string, unknown>)[method] !== 'function') {
        throw new Error(`Logger missing method: ${method}`)
      }
    }
  })

  it('should be callable without data parameter', () => {
    // Re-enable logging for this test to show output
    suppressLogging(false)
    const log = createLogger('Test')

    // All methods should work without data
    try {
      log.debug('debug message')
      log.info('info message')
      log.warn('warn message')
      log.error('error message')
    } catch (e) {
      throw new Error(`Logger methods should work without data: ${e}`)
    } finally {
      // Suppress again for any remaining tests
      suppressLogging(true)
    }
  })
})

// ============================================================================
// Test Summary
// ============================================================================

console.log('\n🧪 Running Property-Based Tests for Logger Module\n')
console.log('='.repeat(60))

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
