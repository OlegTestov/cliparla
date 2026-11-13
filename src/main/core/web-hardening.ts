/**
 * No window of ours may open new windows, attach webviews, or navigate to a
 * page that is not one of our own documents.
 */

import { isTrustedUrl, type TrustConfig } from './trust'

type PreventableEvent = { preventDefault(): void }

/** The slice of Electron's WebContents used here. */
export interface HardenableContents {
  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' }): void
  on(event: string, listener: (event: PreventableEvent, url: string) => void): void
}

export function hardenWebContents(contents: HardenableContents, config: TrustConfig): void {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))

  const guardNavigation = (event: PreventableEvent, url: string): void => {
    if (!isTrustedUrl(url, config)) event.preventDefault()
  }
  contents.on('will-navigate', guardNavigation)
  contents.on('will-redirect', guardNavigation)
  contents.on('will-attach-webview', (event) => event.preventDefault())
}
