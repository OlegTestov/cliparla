import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import '../i18n'
import { createPermissionsWatcher } from './watcher'
import { opensSettings as buttonOpensSettings } from './button-action'

interface PermissionsStatus {
  screenRecording: 'granted' | 'denied' | 'not-determined'
  microphone: 'granted' | 'denied' | 'not-determined'
  accessibility: boolean
  accessibilityPrompted: boolean
}

/**
 * Permission row component
 */
function PermissionRow({
  icon,
  name,
  description,
  status,
  onRequest,
  onOpenSettings,
  isAccessibility = false,
  isScreenRecording = false,
  asked = false
}: {
  icon: string
  name: string
  description: string
  status: 'granted' | 'denied' | 'not-determined' | boolean
  onRequest: () => void
  onOpenSettings: () => void
  isAccessibility?: boolean
  isScreenRecording?: boolean
  /** The system prompt was already shown once for this row */
  asked?: boolean
}) {
  const { t } = useTranslation()
  // For accessibility, status is boolean
  const isGranted = isAccessibility ? status === true : status === 'granted'
  const isDenied = isAccessibility ? false : status === 'denied'
  const opensSettings = buttonOpensSettings(
    isScreenRecording ? 'screen' : isAccessibility ? 'accessibility' : 'microphone',
    { denied: isDenied, asked }
  )

  return (
    <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg mb-2">
      <div className="flex items-center gap-3">
        <span className="text-xl" aria-hidden="true">
          {icon}
        </span>
        <span className="sr-only">{name}</span>
        <div>
          <h3 className="text-white text-sm font-medium">{name}</h3>
          <p className="text-gray-400 text-xs">{description}</p>
        </div>
      </div>

      <div className="flex-shrink-0 ms-4 flex flex-col items-end gap-1">
        {isGranted ? (
          <div className="flex items-center gap-2 text-green-400" role="status">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
            <span className="text-sm font-medium">{t('permissions.granted')}</span>
          </div>
        ) : (
          <span className="text-xs text-gray-500">{t('permissions.notYet')}</span>
        )}
        {!isGranted && (
          <button
            onClick={opensSettings ? onOpenSettings : onRequest}
            aria-label={
              opensSettings ? t('permissions.openSettings') : t('permissions.grantAccess')
            }
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              isDenied
                ? 'bg-orange-500/20 hover:bg-orange-500/30 text-orange-400'
                : 'bg-blue-500/20 hover:bg-blue-500/30 text-blue-400'
            }`}
          >
            {opensSettings ? t('permissions.openSettings') : t('permissions.grantAccess')}
          </button>
        )}
      </div>
    </div>
  )
}

export default function App() {
  const { t } = useTranslation()
  const [permissions, setPermissions] = useState<PermissionsStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [accessibilityAsked, setAccessibilityAsked] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLDivElement>(null)

  // Every row and the Continue bar must be visible without scrolling: the window follows its content
  // (up to the work area), and the bar never covers a row.
  useEffect(() => {
    const content = contentRef.current
    const bar = barRef.current
    if (!content || !bar) return
    const TITLE_BAR = window.electronAPI.platform === 'darwin' ? 32 : 0
    const BOTTOM_PADDING = 16
    const fit = (): void =>
      window.electronAPI.fitWindowHeight(
        TITLE_BAR +
          Math.ceil(content.getBoundingClientRect().height) +
          BOTTOM_PADDING +
          Math.ceil(bar.getBoundingClientRect().height)
      )
    const observer = new ResizeObserver(fit)
    observer.observe(content)
    observer.observe(bar)
    return () => observer.disconnect()
  }, [loading])

  // Load the status on mount, and keep it fresh while the window is visible
  useEffect(() => {
    const watcher = createPermissionsWatcher({
      fetchStatus: () => window.electronAPI.getPermissionsStatus(),
      onStatus: (status) => {
        setPermissions(status)
        setLoading(false)
      },
      onError: () => setLoading(false)
    })
    watcher.init(document.visibilityState === 'visible')

    const unsubscribeShown = window.electronAPI.onPermissionsWindowShown(watcher.start)
    const unsubscribeHidden = window.electronAPI.onPermissionsWindowHidden(watcher.stop)

    return () => {
      watcher.dispose()
      unsubscribeShown()
      unsubscribeHidden()
    }
  }, [])

  // Check if all permissions are granted
  // Only Screen Recording is needed for the first translation
  const allGranted = permissions?.screenRecording === 'granted'

  // Handlers for requesting permissions
  // Note: Screen Recording now always opens System Settings
  // For Microphone, polling will automatically update the status after permission is granted
  const handleRequestScreenRecording = async (): Promise<void> => {
    await window.electronAPI.requestScreenRecordingPermission()
  }

  const handleRequestMicrophone = async (): Promise<void> => {
    await window.electronAPI.requestMicrophonePermission()
  }

  const handleRequestAccessibility = async (): Promise<void> => {
    await window.electronAPI.requestAccessibilityPermission()
    setAccessibilityAsked(true)
  }

  // Handlers for opening settings
  const handleOpenScreenRecordingSettings = (): void => {
    window.electronAPI.openScreenRecordingSettings()
  }

  const handleOpenMicrophoneSettings = (): void => {
    window.electronAPI.openMicrophoneSettings()
  }

  const handleOpenAccessibilitySettings = (): void => {
    window.electronAPI.openAccessibilitySettings()
  }

  // Continue button
  const handleContinue = (): void => {
    window.electronAPI.permissionsContinue()
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#1a1a2e] to-[#16213e] flex items-center justify-center">
        <div className="text-gray-400">{t('common.loading')}</div>
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col bg-gradient-to-br from-[#1a1a2e] to-[#16213e]">
      {/* Draggable title bar area (macOS hiddenInset only) */}
      {window.electronAPI.platform === 'darwin' && (
        <div className="h-8 shrink-0" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />
      )}

      <div className="flex-1 overflow-y-auto px-6 pb-4">
        <div ref={contentRef}>
          {/* Header */}
          <div className="text-center mb-3">
            <h1 className="text-lg font-bold text-white">{t('permissions.title')}</h1>
            <p className="text-gray-400 text-xs mt-1">{t('permissions.description')}</p>
          </div>

          {/* Required permission */}
          <div className="space-y-2">
            {permissions && (
              <PermissionRow
                icon="📺"
                name={t('permissions.screenRecording')}
                description={t('permissions.screenRecordingDescription')}
                status={permissions.screenRecording}
                onRequest={handleRequestScreenRecording}
                onOpenSettings={handleOpenScreenRecordingSettings}
                isScreenRecording
              />
            )}
            <p className="text-xs text-gray-400 px-1">{t('permissions.macAlertNote')}</p>
            <p className="text-xs text-gray-400 px-1">{t('permissions.relaunchNote')}</p>
          </div>

          {/* Status message */}
          <div className="mt-2 text-center">
            {allGranted ? (
              <p className="text-green-400 text-xs">✓ {t('permissions.screenReady')}</p>
            ) : (
              <p className="text-gray-500 text-xs">{t('permissions.screenNeeded')}</p>
            )}
          </div>

          {/* Optional here: dictation asks again if they are skipped */}
          <section className="mt-3 space-y-2">
            <h2 className="text-sm font-semibold text-white/80">{t('permissions.laterTitle')}</h2>
            <p className="text-xs text-gray-400">{t('permissions.laterDescription')}</p>
            {permissions && (
              <>
                <PermissionRow
                  icon="🎤"
                  name={t('permissions.microphone')}
                  description={t('permissions.microphoneDescription')}
                  status={permissions.microphone}
                  onRequest={handleRequestMicrophone}
                  onOpenSettings={handleOpenMicrophoneSettings}
                />

                <PermissionRow
                  icon="⌨️"
                  name={t('permissions.accessibility')}
                  description={t('permissions.accessibilityDescription')}
                  status={permissions.accessibility}
                  onRequest={handleRequestAccessibility}
                  onOpenSettings={handleOpenAccessibilitySettings}
                  asked={accessibilityAsked || permissions.accessibilityPrompted}
                  isAccessibility
                />
              </>
            )}
          </section>
        </div>
      </div>

      {/* Continue button: outside the scroll area so it never covers the rows */}
      <div ref={barRef} className="shrink-0 border-t border-white/10 px-6 py-3">
        <button
          onClick={handleContinue}
          className={`w-full py-2.5 rounded-lg font-medium transition-all ${
            allGranted
              ? 'bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white shadow-lg'
              : 'bg-white/10 hover:bg-white/20 text-gray-300'
          }`}
        >
          {allGranted ? t('common.continue') : t('common.continueAnyway')}
        </button>
      </div>
    </div>
  )
}
