/**
 * Which documents count as "our own app": the packaged renderer pages and,
 * in development, the Vite dev server. Pure functions, no Electron imports.
 */

import { fileURLToPath } from 'node:url'
import path from 'node:path'

export interface TrustConfig {
  /** Directory holding the built renderer pages. */
  rendererDir: string
  /** Origin of the dev server, development only. */
  devServerUrl?: string
}

export interface SenderLike {
  senderFrame?: { url: string; parent?: unknown } | null
}

export function isTrustedUrl(url: string, config: TrustConfig): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }

  if (parsed.protocol === 'file:') {
    let file: string
    try {
      file = path.resolve(fileURLToPath(parsed))
    } catch {
      return false
    }
    const root = path.resolve(config.rendererDir)
    return file.startsWith(root + path.sep) && file.endsWith('.html')
  }

  if (config.devServerUrl) {
    try {
      return parsed.origin === new URL(config.devServerUrl).origin
    } catch {
      return false
    }
  }
  return false
}

/** True only for the top-level frame of one of our own pages. */
export function isTrustedSender(event: SenderLike, config: TrustConfig): boolean {
  const frame = event.senderFrame
  if (!frame || typeof frame.url !== 'string') return false
  if (frame.parent) return false
  return isTrustedUrl(frame.url, config)
}
