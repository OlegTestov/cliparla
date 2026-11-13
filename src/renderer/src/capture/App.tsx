import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import '../i18n'
import SelectionBox from './components/SelectionBox'

interface Selection {
  startX: number
  startY: number
  endX: number
  endY: number
}

/**
 * Capture Overlay App - fullscreen transparent overlay for selecting screen area.
 */
export default function App() {
  const { t } = useTranslation()
  const [isSelecting, setIsSelecting] = useState(false)
  const [selection, setSelection] = useState<Selection | null>(null)

  // Use ref to track current selection for mouseUp handler
  // This avoids side effects inside setState callback (React.StrictMode issue)
  const selectionRef = useRef<Selection | null>(null)

  // Keep ref in sync with state
  useEffect(() => {
    selectionRef.current = selection
  }, [selection])

  // Reset selection when window gets focus (new capture session)
  useEffect(() => {
    const handleFocus = () => {
      setIsSelecting(false)
      setSelection(null)
    }
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [])

  // Handle ESC key to cancel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        window.electronAPI.cancelCapture()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setIsSelecting(true)
    setSelection({
      startX: e.clientX,
      startY: e.clientY,
      endX: e.clientX,
      endY: e.clientY
    })
  }, [])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    setSelection((prev) => {
      if (!prev) return prev
      return { ...prev, endX: e.clientX, endY: e.clientY }
    })
  }, [])

  const handleMouseUp = useCallback(() => {
    // Read current selection from ref (not from setState callback)
    const currentSelection = selectionRef.current
    if (!currentSelection) {
      setIsSelecting(false)
      return
    }

    const x = Math.min(currentSelection.startX, currentSelection.endX)
    const y = Math.min(currentSelection.startY, currentSelection.endY)
    const width = Math.abs(currentSelection.endX - currentSelection.startX)
    const height = Math.abs(currentSelection.endY - currentSelection.startY)

    // Clear state first
    setIsSelecting(false)
    setSelection(null)

    // Then send selection as a side effect (outside of setState)
    if (width >= 10 && height >= 10) {
      window.electronAPI.sendSelection({ x, y, width, height })
    }
  }, [])

  // Memoize selection rect calculation
  const selectionRect = useMemo(() => {
    if (!selection) return null
    return {
      x: Math.min(selection.startX, selection.endX),
      y: Math.min(selection.startY, selection.endY),
      width: Math.abs(selection.endX - selection.startX),
      height: Math.abs(selection.endY - selection.startY)
    }
  }, [selection])

  const showInstructions = !isSelecting && !selection

  return (
    <div
      className="fixed inset-0 cursor-crosshair select-none"
      onMouseDown={handleMouseDown}
      onMouseMove={isSelecting ? handleMouseMove : undefined}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Overlay */}
      {!selectionRect && <div className="absolute inset-0 bg-black/50" />}

      {/* Selection */}
      {selectionRect && <SelectionBox selection={selectionRect} />}

      {/* Instructions */}
      {showInstructions && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-white text-center">
            <p className="text-xl font-medium mb-2">{t('capture.instructions')}</p>
            <p className="text-sm opacity-70">
              {t('capture.escToCancel', { interpolation: { escapeValue: false } })
                .split('<kbd>')
                .map((part, i) => {
                  if (i === 0) return part
                  const [inside, rest] = part.split('</kbd>')
                  return (
                    <span key={i}>
                      <kbd className="font-mono bg-white/20 px-1.5 py-0.5 rounded">{inside}</kbd>
                      {rest}
                    </span>
                  )
                })}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
