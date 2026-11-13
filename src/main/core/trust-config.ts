import { app } from 'electron'
import { join } from 'node:path'
import type { TrustConfig } from './trust'

let override: TrustConfig | null = null

/** Replace the trusted locations (used by tests). */
export function setTrustConfig(config: TrustConfig | null): void {
  override = config
}

export function getTrustConfig(): TrustConfig {
  if (override) return override
  return {
    rendererDir: join(__dirname, '../renderer'),
    devServerUrl: !app.isPackaged ? process.env['ELECTRON_RENDERER_URL'] : undefined
  }
}
