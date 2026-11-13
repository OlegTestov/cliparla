import { useEffect, useState, useCallback, useRef, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
import '../i18n'
import { ResultController, canCopyText, canRetry, isStreaming } from './result-controller'
import { heightToAsk } from './fit'

// AI Actions configuration
const AI_ACTIONS = [
  {
    id: 'summarize',
    emoji: '📝',
    labelKey: 'result.action.summarize',
    descriptionKey: 'result.action.summarizeDescription'
  },
  {
    id: 'comment',
    emoji: '💬',
    labelKey: 'result.action.comment',
    descriptionKey: 'result.action.commentDescription'
  },
  {
    id: 'improve',
    emoji: '✏️',
    labelKey: 'result.action.improve',
    descriptionKey: 'result.action.improveDescription'
  }
] as const

type AIActionId = (typeof AI_ACTIONS)[number]['id']

// Icon components
const CheckIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
  </svg>
)

const CloseIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
)

const ImageIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <rect x="3" y="5" width="18" height="14" rx="2" strokeWidth={2} />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 16l5-5 4 4 3-3 6 6" />
  </svg>
)

const ChevronDownIcon = () => (
  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
  </svg>
)

const SpinnerIcon = () => (
  <div className="w-4 h-4 border-2 border-white/30 border-t-white/90 rounded-full animate-spin" />
)

/**
 * Result Window - displays translation results with copy functionality.
 * Supports AI actions (Summarize, Comment, Improve) via dropdown menu.
 */
export default function App() {
  const [controller] = useState(() => new ResultController())
  const { isLoading, result, processingAction, view, original, originalOpen, streamText } =
    useSyncExternalStore(controller.subscribe, controller.getState)
  const [copied, setCopied] = useState(false)
  const [screenshotCopied, setScreenshotCopied] = useState(false)
  const [originalCopied, setOriginalCopied] = useState(false)
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const [focusedMenuIndex, setFocusedMenuIndex] = useState(-1)

  const { t } = useTranslation()
  const isOnline = useOnlineStatus()
  const dropdownRef = useRef<HTMLDivElement>(null)
  const staleContent = useRef(false)
  const [starts, setStarts] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)

  const handleClose = useCallback(() => {
    window.electronAPI.closeResult()
  }, [])

  const handleCopy = useCallback(async () => {
    if (result?.success && result.text) {
      await window.electronAPI.copyToClipboard(result.text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }, [result])

  const handleCopyOriginal = useCallback(async () => {
    if (await controller.copyOriginal(window.electronAPI.copyToClipboard)) {
      setOriginalCopied(true)
      setTimeout(() => setOriginalCopied(false), 2000)
    }
  }, [controller])

  const handleCopyScreenshot = useCallback(async () => {
    const result = await window.electronAPI.copyScreenshot()
    if (result.success) {
      setScreenshotCopied(true)
      setTimeout(() => setScreenshotCopied(false), 2000)
    }
  }, [])

  const handleAIAction = useCallback(
    (actionId: AIActionId) => {
      setIsDropdownOpen(false)
      const api = window.electronAPI
      const invoke = {
        summarize: api.summarizeText,
        comment: api.commentText,
        improve: api.improveText
      }[actionId]
      return controller.runAction(actionId, invoke, {
        failed: t('result.translationFailed'),
        unexpected: t('result.unexpectedError')
      })
    },
    [controller, t]
  )

  // Listen for translation events
  useEffect(() => {
    const unsubStart = window.electronAPI.onTranslationStart(() => {
      // The old text stays on screen until this render commits: no growth is asked for it
      staleContent.current = true
      controller.start()
      setStarts((n) => n + 1)
      setCopied(false)
      setOriginalCopied(false)
      setIsDropdownOpen(false)
    })

    const unsubComplete = window.electronAPI.onTranslationComplete((r) => {
      controller.complete(r)
    })

    const unsubPartial = window.electronAPI.onTranslationPartial((text) => controller.partial(text))
    const unsubActionPartial = window.electronAPI.onActionPartial(({ requestId, text }) =>
      controller.actionPartial(requestId, text)
    )

    return () => {
      unsubStart()
      unsubComplete()
      unsubPartial()
      unsubActionPartial()
    }
  }, [controller])

  // A long text makes the window taller instead of scrolling; it never shrinks back meanwhile
  useEffect(() => {
    const scroller = scrollRef.current
    const inner = innerRef.current
    if (!scroller || !inner) return
    const observer = new ResizeObserver(() => {
      const ask = heightToAsk(scroller.scrollHeight, scroller.clientHeight, window.innerHeight)
      if (ask !== null && !staleContent.current) window.electronAPI.fitWindowHeight(ask)
    })
    observer.observe(inner)
    return () => observer.disconnect()
  }, [])

  // The cleared page has rendered (two frames: commit, then layout): only now the window may shrink
  useEffect(() => {
    if (starts === 0) return
    let second = 0
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        window.electronAPI.resetWindowHeight()
        staleContent.current = false
      })
    })
    return () => {
      cancelAnimationFrame(first)
      cancelAnimationFrame(second)
    }
  }, [starts])

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false)
      }
    }

    if (isDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isDropdownOpen])

  // Keyboard handling: ESC, Arrow keys for dropdown
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isDropdownOpen) {
          setIsDropdownOpen(false)
          setFocusedMenuIndex(-1)
        } else {
          handleClose()
        }
        return
      }

      if (isDropdownOpen) {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setFocusedMenuIndex((prev) => (prev + 1) % AI_ACTIONS.length)
        } else if (e.key === 'ArrowUp') {
          e.preventDefault()
          setFocusedMenuIndex((prev) => (prev - 1 + AI_ACTIONS.length) % AI_ACTIONS.length)
        } else if (e.key === 'Enter' && focusedMenuIndex >= 0) {
          e.preventDefault()
          handleAIAction(AI_ACTIONS[focusedMenuIndex].id)
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleClose, isDropdownOpen, focusedMenuIndex, handleAIAction])

  const state = controller.getState()
  const streaming = isStreaming(state)
  const canCopy = canCopyText(state)
  // Actions work on the translation, so they stay available while another result is shown
  const canProcess =
    !isLoading && !processingAction && (view !== null || (result?.success && !!result.text))

  const retryable = canRetry(state)
  const handleRetry = (): void => {
    if (view !== null) void handleAIAction(view as AIActionId)
    else window.electronAPI.retryTranslation()
  }

  // Get current action label for button text during processing
  const currentActionLabel = processingAction
    ? (() => {
        const action = AI_ACTIONS.find((a) => a.id === processingAction)
        return action ? t(action.labelKey) : null
      })()
    : null

  return (
    <div className="h-screen bg-slate-900/95 backdrop-blur-sm rounded-lg shadow-2xl border border-white/10 overflow-hidden flex flex-col">
      {/* Header */}
      <div
        className="h-10 bg-white/5 border-b border-white/10 flex items-center justify-between gap-2 px-3 shrink-0"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <span
          className="min-w-0 truncate text-sm font-medium text-white/90"
          title={view ? t(`result.view.${view}`) : t('result.title')}
        >
          {view ? t(`result.view.${view}`) : t('result.title')}
        </span>

        <div
          className="flex shrink-0 items-center gap-1 whitespace-nowrap"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {/* Copy Screenshot Button */}
          <button
            onClick={handleCopyScreenshot}
            className={`h-7 px-2 rounded-md flex items-center gap-1.5 transition-colors ${
              screenshotCopied
                ? 'bg-green-500/20 text-green-400'
                : 'bg-white/10 hover:bg-blue-500/20 text-white/60 hover:text-blue-400'
            }`}
            title={screenshotCopied ? t('result.screenshotCopied') : t('result.copyScreenshot')}
            aria-label={
              screenshotCopied
                ? t('result.screenshotCopiedAria')
                : t('result.copyScreenshotToClipboard')
            }
          >
            {/* An icon only: long labels in many languages left no room for the title */}
            {screenshotCopied ? <CheckIcon /> : <ImageIcon />}
          </button>

          {/* AI Dropdown */}
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => {
                if (canProcess) {
                  setIsDropdownOpen(!isDropdownOpen)
                  setFocusedMenuIndex(-1)
                }
              }}
              disabled={!canProcess}
              className={`h-7 px-2 rounded-md flex items-center gap-1.5 transition-colors ${
                canProcess
                  ? isDropdownOpen
                    ? 'bg-purple-500/20 text-purple-400'
                    : 'bg-white/10 hover:bg-purple-500/20 text-white/70 hover:text-purple-400'
                  : 'bg-white/5 text-white/30 cursor-not-allowed'
              }`}
              title={t('result.aiActions')}
              aria-expanded={isDropdownOpen}
              aria-haspopup="true"
            >
              {processingAction ? (
                <>
                  <SpinnerIcon />
                  <span className="text-xs">{currentActionLabel}...</span>
                </>
              ) : (
                <>
                  <span className="text-sm">✨</span>
                  <span className="text-xs font-medium">{t('result.ai')}</span>
                  <ChevronDownIcon />
                </>
              )}
            </button>

            {/* Dropdown Menu */}
            {isDropdownOpen && (
              <div
                className="absolute end-0 top-full mt-1 min-w-[200px] bg-slate-800/95 backdrop-blur-sm border border-white/10 rounded-lg shadow-xl overflow-hidden z-50"
                role="menu"
              >
                {AI_ACTIONS.map((action, index) => (
                  <button
                    key={action.id}
                    onClick={() => handleAIAction(action.id)}
                    role="menuitem"
                    aria-label={`${t(action.labelKey)}: ${t(action.descriptionKey)}`}
                    className={`w-full px-3 py-2.5 flex items-start gap-3 hover:bg-white/10 transition-colors text-start ${
                      index !== AI_ACTIONS.length - 1 ? 'border-b border-white/5' : ''
                    } ${focusedMenuIndex === index ? 'bg-white/10' : ''}`}
                  >
                    <span className="text-base mt-0.5">{action.emoji}</span>
                    <div>
                      <div className="text-sm font-medium text-white/90">{t(action.labelKey)}</div>
                      <div className="text-xs text-white/50">{t(action.descriptionKey)}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Copy Text Button */}
          <button
            onClick={handleCopy}
            disabled={!canCopy}
            className={`h-7 px-2 rounded-md flex items-center gap-1.5 transition-colors ${
              canCopy
                ? copied
                  ? 'bg-green-500/20 text-green-400'
                  : 'bg-white/10 hover:bg-emerald-500/15 text-white/60 hover:text-emerald-400/80'
                : 'bg-white/5 text-white/30 cursor-not-allowed'
            }`}
            title={copied ? t('result.copied') : t('result.copyToClipboard')}
            aria-label={copied ? t('result.textCopied') : t('result.copyToClipboard')}
          >
            {copied ? (
              <>
                <CheckIcon />
                <span className="text-xs font-medium">{t('result.copied')}</span>
              </>
            ) : (
              <span className="text-xs font-medium">{t('result.copyText')}</span>
            )}
          </button>

          {/* Close Button */}
          <button
            onClick={handleClose}
            className="w-7 h-7 rounded-md bg-white/10 hover:bg-red-500/20 text-white/60 hover:text-red-400 flex items-center justify-center transition-colors"
            title={t('result.closeEsc')}
            aria-label={t('result.closeResult')}
          >
            <CloseIcon />
          </button>
        </div>
      </div>

      {/* Offline Banner */}
      {!isOnline && (
        <div
          className="mx-3 mt-2 px-3 py-2 bg-yellow-500/10 border border-yellow-500/20 rounded-md flex items-center gap-2"
          role="alert"
        >
          <span className="text-yellow-400 text-sm">{t('common.offlineShort')}</span>
        </div>
      )}

      {/* Content */}
      <div ref={scrollRef} className="flex-1 p-4 overflow-auto">
        <div ref={innerRef} className="flex min-h-full flex-col">
          {view && !processingAction && (
            <button
              type="button"
              onClick={() => controller.showTranslation()}
              className="mb-2 self-start text-xs text-blue-300 hover:text-blue-200 hover:underline"
            >
              {t('result.backToTranslation')}
            </button>
          )}
          {streaming && (
            <div className="bg-white/5 border border-white/10 rounded-lg p-3" aria-live="off">
              <p dir="auto" className="text-white/90 whitespace-pre-wrap leading-relaxed">
                {streamText}
              </p>
            </div>
          )}

          {isLoading && !streaming && (
            <div
              className="flex flex-1 flex-col items-center justify-center py-8"
              aria-live="polite"
            >
              <div className="w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full animate-spin mb-3" />
              <p className="text-white/60 text-sm">{t('result.translating')}</p>
            </div>
          )}

          {!isLoading && !streaming && result && !result.success && result.partial && (
            <div className="mb-2 bg-white/5 border border-white/10 rounded-lg p-3">
              <p dir="auto" className="text-white/90 whitespace-pre-wrap leading-relaxed">
                {result.partial}
              </p>
            </div>
          )}

          {!isLoading && !streaming && result && !result.success && (
            <div
              className="bg-red-500/20 border border-red-500/30 rounded-lg p-4"
              aria-live="polite"
            >
              <p className="text-red-300 font-medium">{t('result.translationFailed')}</p>
              <p className="text-red-400 text-sm mt-1">
                {result.error || t('result.unknownError')}
              </p>
              {retryable && (
                <button
                  type="button"
                  onClick={handleRetry}
                  className="mt-3 h-7 px-3 rounded-md bg-white/10 hover:bg-white/20 text-xs font-medium text-white/90"
                >
                  {t('result.retry')}
                </button>
              )}
            </div>
          )}

          {!isLoading && !streaming && result?.success && result.text && (
            <div className="bg-white/5 border border-white/10 rounded-lg p-3">
              <p dir="auto" className="text-white/90 whitespace-pre-wrap leading-relaxed">
                {result.text}
              </p>
            </div>
          )}

          {!isLoading && original !== null && (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => controller.toggleOriginal()}
                aria-expanded={originalOpen}
                className="flex items-center gap-1 text-xs text-white/60 hover:text-white/90"
              >
                <span
                  className={`inline-block transition-transform ${originalOpen ? '' : '-rotate-90 rtl:rotate-90'}`}
                >
                  <ChevronDownIcon />
                </span>
                {t('result.original')}
              </button>
              {originalOpen && (
                <div className="mt-1 bg-white/5 border border-white/10 rounded-lg p-3">
                  <p
                    dir="auto"
                    className="max-h-40 overflow-auto whitespace-pre-wrap text-sm leading-relaxed text-white/70"
                  >
                    {original}
                  </p>
                  <button
                    type="button"
                    onClick={handleCopyOriginal}
                    className={`mt-2 h-7 px-2 rounded-md text-xs font-medium transition-colors ${
                      originalCopied
                        ? 'bg-green-500/20 text-green-400'
                        : 'bg-white/10 hover:bg-emerald-500/15 text-white/60 hover:text-emerald-400/80'
                    }`}
                    aria-label={t('result.copyOriginalAria')}
                  >
                    {originalCopied ? t('result.copied') : t('result.copyOriginal')}
                  </button>
                </div>
              )}
            </div>
          )}

          {!isLoading && result?.success && !result.text && (
            <p className="text-center text-white/60 py-8">{t('result.noTextFound')}</p>
          )}
        </div>
      </div>
    </div>
  )
}
