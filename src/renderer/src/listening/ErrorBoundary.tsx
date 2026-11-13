import { Component, type ReactNode } from 'react'

/**
 * A render error must not leave a blank panel on screen: the page tells main it cannot be used
 * and main hides the window and reloads the page.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  componentDidCatch(): void {
    // the preload may be what failed; main then learns from the settle timeout
    window.electronAPI?.indicatorPageFailed?.()
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children
  }
}
