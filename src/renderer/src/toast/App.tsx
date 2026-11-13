import { useEffect, useState } from 'react'
import '../i18n'

/** A short message near the cursor. Main sends the text, already in the user's language. */
export default function App(): React.ReactElement {
  const [text, setText] = useState('')

  useEffect(() => window.electronAPI.onToast(setText), [])

  return (
    <div className="h-full w-full p-1">
      <div
        role="status"
        aria-live="polite"
        className="h-full w-full rounded-xl flex items-center justify-center px-3 text-sm font-medium text-white/90 whitespace-nowrap overflow-hidden"
        style={{
          background: 'rgba(30, 30, 40, 0.92)',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1)'
        }}
      >
        <span dir="auto" className="truncate">
          {text}
        </span>
      </div>
    </div>
  )
}
