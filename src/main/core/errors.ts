/**
 * Centralized Error Handler
 *
 * Provides consistent error categorization, user-friendly messages,
 * and retry logic for transient errors.
 */

import { createLogger } from './logger'

const log = createLogger('ErrorHandler')

// ============================================================================
// Types
// ============================================================================

export type ErrorCategory = 'network' | 'api' | 'system'

export const ERROR_CODES = {
  // Network
  NETWORK_OFFLINE: 'NETWORK_OFFLINE',
  NETWORK_TIMEOUT: 'NETWORK_TIMEOUT',

  // API
  API_RATE_LIMIT: 'API_RATE_LIMIT',
  API_INVALID_KEY: 'API_INVALID_KEY',
  API_UNAVAILABLE: 'API_UNAVAILABLE',

  // System
  SYSTEM_PERMISSION_DENIED: 'SYSTEM_PERMISSION_DENIED',
  SYSTEM_UNKNOWN: 'SYSTEM_UNKNOWN'
} as const

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES]

export interface AppError {
  category: ErrorCategory
  code: ErrorCode
  message: string // User-friendly
  technicalMessage: string // For logging
  originalError?: Error
  retryable: boolean
}

// ============================================================================
// User-Friendly Messages
// ============================================================================

const USER_MESSAGES: Record<ErrorCode, string> = {
  // Network
  [ERROR_CODES.NETWORK_OFFLINE]: 'No internet connection. Please check your network.',
  [ERROR_CODES.NETWORK_TIMEOUT]: 'Request timed out. Please try again.',

  // API
  [ERROR_CODES.API_RATE_LIMIT]: 'Too many requests. Please wait a moment.',
  [ERROR_CODES.API_INVALID_KEY]: 'Invalid API key. Please check your settings.',
  [ERROR_CODES.API_UNAVAILABLE]: 'Service temporarily unavailable. Please try again later.',

  // System
  [ERROR_CODES.SYSTEM_PERMISSION_DENIED]: 'Permission denied. Please check system settings.',
  [ERROR_CODES.SYSTEM_UNKNOWN]: 'An unexpected error occurred. Please try again.'
}

// ============================================================================
// Error Detection
// ============================================================================

function isNetworkError(error: Error): boolean {
  const message = error.message.toLowerCase()
  return (
    message.includes('network') ||
    message.includes('fetch') ||
    message.includes('econnrefused') ||
    message.includes('enotfound') ||
    message.includes('offline') ||
    message.includes('internet')
  )
}

function isTimeoutError(error: Error): boolean {
  const message = error.message.toLowerCase()
  return message.includes('timeout') || message.includes('timed out')
}

function isRateLimitError(error: Error): boolean {
  const message = error.message.toLowerCase()
  return (
    message.includes('rate limit') ||
    message.includes('429') ||
    message.includes('too many requests')
  )
}

function isApiKeyError(error: Error): boolean {
  const message = error.message.toLowerCase()
  return (
    message.includes('api key') || message.includes('invalid key') || message.includes('api_key')
  )
}

// ============================================================================
// Error Factory Functions
// ============================================================================

export function createNetworkError(error: Error): AppError {
  const isTimeout = isTimeoutError(error)
  return {
    category: 'network',
    code: isTimeout ? ERROR_CODES.NETWORK_TIMEOUT : ERROR_CODES.NETWORK_OFFLINE,
    message: isTimeout
      ? USER_MESSAGES[ERROR_CODES.NETWORK_TIMEOUT]
      : USER_MESSAGES[ERROR_CODES.NETWORK_OFFLINE],
    technicalMessage: error.message,
    originalError: error,
    retryable: true
  }
}

export function createApiError(error: Error, context?: string): AppError {
  let code: ErrorCode = ERROR_CODES.API_UNAVAILABLE

  if (isRateLimitError(error)) {
    code = ERROR_CODES.API_RATE_LIMIT
  } else if (isApiKeyError(error)) {
    code = ERROR_CODES.API_INVALID_KEY
  }

  return {
    category: 'api',
    code,
    message: USER_MESSAGES[code],
    technicalMessage: context ? `${context}: ${error.message}` : error.message,
    originalError: error,
    retryable: code === ERROR_CODES.API_RATE_LIMIT || code === ERROR_CODES.API_UNAVAILABLE
  }
}

export function createSystemError(error: Error): AppError {
  const message = error.message.toLowerCase()
  const code = message.includes('permission')
    ? ERROR_CODES.SYSTEM_PERMISSION_DENIED
    : ERROR_CODES.SYSTEM_UNKNOWN

  return {
    category: 'system',
    code,
    message: USER_MESSAGES[code],
    technicalMessage: error.message,
    originalError: error,
    retryable: false
  }
}

// ============================================================================
// Error Handler
// ============================================================================

export interface ErrorHandler {
  handle(error: unknown, context?: string): AppError
  shouldRetry(error: AppError): boolean
}

export const errorHandler: ErrorHandler = {
  /**
   * Categorize and wrap any error into AppError
   */
  handle(error: unknown, context?: string): AppError {
    // Convert to Error if needed
    const err = error instanceof Error ? error : new Error(String(error))

    // Log the error
    log.error('Error occurred', err, { context })

    // Categorize
    if (isNetworkError(err) || isTimeoutError(err)) {
      return createNetworkError(err)
    }

    if (isRateLimitError(err) || isApiKeyError(err)) {
      return createApiError(err, context)
    }

    // Default to system error
    return createSystemError(err)
  },

  /**
   * Check if error is retryable
   */
  shouldRetry(error: AppError): boolean {
    return error.retryable
  }
}

// ============================================================================
// Retry Utility
// ============================================================================

export interface RetryOptions {
  maxAttempts: number
  delayMs: number
  /** Use exponential backoff (delay doubles each retry) */
  exponentialBackoff?: boolean
  retryableCategories?: ErrorCategory[]
}

const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxAttempts: 3,
  delayMs: 500,
  exponentialBackoff: true,
  retryableCategories: ['network', 'api']
}

/**
 * Execute function with retry logic for transient errors.
 * Uses exponential backoff by default: 500ms → 1000ms → 2000ms
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options }
  let lastError: AppError | null = null

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = errorHandler.handle(error)

      const shouldRetry =
        attempt < opts.maxAttempts &&
        lastError.retryable &&
        (!opts.retryableCategories || opts.retryableCategories.includes(lastError.category))

      if (shouldRetry) {
        // Calculate delay with optional exponential backoff
        const delay = opts.exponentialBackoff
          ? opts.delayMs * Math.pow(2, attempt - 1)
          : opts.delayMs

        log.warn(`Retry attempt ${attempt}/${opts.maxAttempts}`, {
          category: lastError.category,
          code: lastError.code,
          delayMs: delay
        })
        await new Promise((resolve) => setTimeout(resolve, delay))
      } else {
        break
      }
    }
  }

  // Re-throw the last error
  throw lastError?.originalError || new Error('Unknown error')
}
