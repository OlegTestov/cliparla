import { useTranslation } from 'react-i18next'
import SidebarItem from './SidebarItem'
import appIcon from '../../../../../resources/icon.png'

export interface SectionConfig {
  id: string
  label: string
  icon: React.ReactNode
  badge?: string
  hidden?: boolean
  accentColor?: string
}

interface SidebarProps {
  sections: SectionConfig[]
  activeSection: string
  onSectionChange: (sectionId: string) => void
  appVersion: string
  saveStatus: 'idle' | 'saving' | 'saved' | 'error'
}

export default function Sidebar({
  sections,
  activeSection,
  onSectionChange,
  appVersion,
  saveStatus
}: SidebarProps) {
  const { t } = useTranslation()
  return (
    <nav className="h-full flex flex-col" role="navigation" aria-label="Settings navigation">
      {/* App Logo & Name */}
      <div className="flex items-center gap-3 px-4 py-3 mb-2">
        <img src={appIcon} alt="Cliparla" className="w-8 h-8" />
        <div className="flex-1">
          <span className="text-white font-semibold text-sm">Cliparla</span>
        </div>
      </div>

      {/* Navigation Items */}
      <div className="flex-1 space-y-1" role="list">
        {sections
          .filter((s) => !s.hidden)
          .map((section) => (
            <div key={section.id} role="listitem">
              <SidebarItem
                icon={section.icon}
                label={section.label}
                badge={section.badge}
                isActive={activeSection === section.id}
                onClick={() => onSectionChange(section.id)}
                accentColor={section.accentColor}
                ariaCurrent={activeSection === section.id ? 'page' : undefined}
                ariaLabel={section.label}
              />
            </div>
          ))}
      </div>

      {/* Footer - Version & Save Status */}
      <div className="px-4 py-3 border-t border-white/[0.06]">
        <div className="flex items-center justify-between">
          <span className="text-xs text-white/40">v{appVersion}</span>
          {/* Save Status */}
          <div className="text-xs" aria-live="polite">
            {saveStatus === 'saving' && (
              <span className="text-white/40 flex items-center gap-1.5">
                <svg className="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24">
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                {t('settings.sidebar.saving')}
              </span>
            )}
            {saveStatus === 'saved' && (
              <span className="text-emerald-400/80 flex items-center gap-1">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                {t('settings.sidebar.saved')}
              </span>
            )}
            {saveStatus === 'error' && (
              <span className="text-red-400/80 flex items-center gap-1">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
                {t('settings.sidebar.error')}
              </span>
            )}
          </div>
        </div>
      </div>
    </nav>
  )
}
