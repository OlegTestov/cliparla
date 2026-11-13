/**
 * Every window starts in English and switches to the user's language as soon
 * as the saved (or system) language is known.
 */

export async function applyUiLanguage(
  i18n: { changeLanguage(language: string): unknown },
  getSettings: () => Promise<{ uiLanguage?: string }>
): Promise<void> {
  try {
    const { uiLanguage } = await getSettings()
    if (uiLanguage) await i18n.changeLanguage(uiLanguage)
  } catch {
    // Settings bridge unavailable: stay on English
  }
}
