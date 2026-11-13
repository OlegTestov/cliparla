/**
 * Centralized Logger
 *
 * Provides structured logging with levels, timestamps, and module context.
 * Filters debug messages in production for cleaner logs.
 */

// ============================================================================
// Types
// ============================================================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogEntry {
  timestamp: string
  level: LogLevel
  module: string
  message: string
  data?: Record<string, unknown>
  error?: Error
}

export interface Logger {
  debug(message: string, data?: Record<string, unknown>): void
  info(message: string, data?: Record<string, unknown>): void
  warn(message: string, data?: Record<string, unknown>): void
  error(message: string, error?: Error, data?: Record<string, unknown>): void
}

// ============================================================================
// Configuration
// ============================================================================

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
}

let isPackagedApp = false

/**
 * Tell the logger whether this is a packaged build (debug output is hidden there).
 * Set at startup from identity.ts; the logger itself never imports Electron.
 */
export function configureLogger(options: { packaged: boolean }): void {
  isPackagedApp = options.packaged
}

/** Global flag to suppress all logging (useful for tests) */
let loggingSuppressed = false

/**
 * Suppress all logging output (useful for property-based tests)
 * @param suppress - true to suppress, false to enable
 */
export function suppressLogging(suppress: boolean): void {
  loggingSuppressed = suppress
}

/**
 * Check if logging is currently suppressed
 */
export function isLoggingSuppressed(): boolean {
  return loggingSuppressed
}

/** Minimum log level based on environment */
function getMinLevel(): LogLevel {
  // In production, filter out debug messages
  // app.isPackaged is false during tests, so we check for test environment
  if (isPackagedApp) {
    return 'info'
  }
  return 'debug'
}

/** Check if a log level should be output */
export function shouldLog(level: LogLevel, minLevel: LogLevel = getMinLevel()): boolean {
  if (loggingSuppressed) {
    return false
  }
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[minLevel]
}

// ============================================================================
// Formatting
// ============================================================================

/** Format timestamp as ISO string */
function formatTimestamp(): string {
  return new Date().toISOString()
}

/** Format log entry for console output */
function formatLogEntry(entry: LogEntry): string {
  const { timestamp, level, module, message } = entry
  return `${timestamp} [${level.toUpperCase()}] [${module}] ${message}`
}

// ============================================================================
// Output
// ============================================================================

/** Output log entry to console */
function outputLog(entry: LogEntry): void {
  const formattedMessage = formatLogEntry(entry)

  // Choose console method based on level
  // Note: using console.log for debug since eslint only allows log, info, warn, error
  const consoleMethod =
    entry.level === 'error' ? console.error : entry.level === 'warn' ? console.warn : console.log

  // Output main message
  if (entry.data && Object.keys(entry.data).length > 0) {
    consoleMethod(formattedMessage, entry.data)
  } else {
    consoleMethod(formattedMessage)
  }

  // Output error stack trace if available
  if (entry.error?.stack) {
    consoleMethod(entry.error.stack)
  }
}

// ============================================================================
// Logger Factory
// ============================================================================

/**
 * Create a logger instance for a specific module
 *
 * @param module - Module name to include in log entries
 * @returns Logger instance with debug, info, warn, error methods
 *
 * @example
 * const log = createLogger('Auth')
 * log.info('Starting OAuth flow', { provider: 'google' })
 * log.error('OAuth failed', error, { code: 'NETWORK_ERROR' })
 */
export function createLogger(module: string): Logger {
  const log = (
    level: LogLevel,
    message: string,
    errorOrData?: Error | Record<string, unknown>,
    data?: Record<string, unknown>
  ): void => {
    if (!shouldLog(level)) {
      return
    }

    // Handle overloaded parameters
    let error: Error | undefined
    let logData: Record<string, unknown> | undefined

    if (errorOrData instanceof Error) {
      error = errorOrData
      logData = data
    } else {
      logData = errorOrData
    }

    const entry: LogEntry = {
      timestamp: formatTimestamp(),
      level,
      module,
      message,
      data: logData,
      error
    }

    outputLog(entry)
  }

  return {
    debug: (message, data) => log('debug', message, data),
    info: (message, data) => log('info', message, data),
    warn: (message, data) => log('warn', message, data),
    error: (message, error?, data?) => log('error', message, error, data)
  }
}
