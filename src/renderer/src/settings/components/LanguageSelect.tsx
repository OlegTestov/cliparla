import { useTranslation } from 'react-i18next'
import { SUPPORTED_LANGUAGES } from '../../../../shared/types'
import { languageLabel } from '../../../../shared/language-label'

interface LanguageSelectProps {
  value: string
  onChange: (language: string) => void
  label?: string
  description?: string
  /** An extra first choice, e.g. "Keep my language" */
  leading?: { value: string; label: string }
}

export default function LanguageSelect({
  value,
  onChange,
  label,
  description,
  leading
}: LanguageSelectProps) {
  const { t, i18n: i18nInstance } = useTranslation()
  const displayLabel = label || t('settings.languageSelect.defaultLabel')
  const displayDescription = description || t('settings.languageSelect.defaultDescription')
  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-white/80">{displayLabel}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="glass-select">
        {leading && <option value={leading.value}>{leading.label}</option>}
        {SUPPORTED_LANGUAGES.map((lang) => (
          <option key={lang.code} value={lang.name}>
            {languageLabel(lang.name, i18nInstance.language)}
          </option>
        ))}
      </select>
      <p className="text-xs text-white/40">{displayDescription}</p>
    </div>
  )
}
