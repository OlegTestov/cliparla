import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { applyUiLanguage } from './apply-language'
import en from './locales/en.json'
import ru from './locales/ru.json'
import es from './locales/es.json'
import fr from './locales/fr.json'
import de from './locales/de.json'
import pt from './locales/pt.json'
import it from './locales/it.json'
import zh from './locales/zh.json'
import ja from './locales/ja.json'
import ko from './locales/ko.json'
import ar from './locales/ar.json'
import hi from './locales/hi.json'
import tr from './locales/tr.json'
import pl from './locales/pl.json'
import uk from './locales/uk.json'
import nl from './locales/nl.json'

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ru: { translation: ru },
    es: { translation: es },
    fr: { translation: fr },
    de: { translation: de },
    pt: { translation: pt },
    it: { translation: it },
    zh: { translation: zh },
    ja: { translation: ja },
    ko: { translation: ko },
    ar: { translation: ar },
    hi: { translation: hi },
    tr: { translation: tr },
    pl: { translation: pl },
    uk: { translation: uk },
    nl: { translation: nl }
  },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false
  }
})

// Arabic and other right-to-left languages lay the whole window out right to left
i18n.on('languageChanged', (language) => {
  if (typeof document === 'undefined') return
  document.documentElement.lang = language
  document.documentElement.dir = i18n.dir(language)
})

if (typeof window !== 'undefined' && window.electronAPI) {
  void applyUiLanguage(i18n, () => window.electronAPI.getSettings())
  window.electronAPI.onUiLanguageChanged((language) => void i18n.changeLanguage(language))
}

export default i18n
