/**
 * The permissions screen must show all three rows, their buttons and the Continue bar without
 * scrolling, in every locale. The window starts at 560 px and the page asks main to grow it
 * (fit-window-height) up to the work area; this test keeps the content within what a small
 * laptop work area offers (700 px) by estimating the layout from measured text widths.
 * Widths: AppKit, medium weight, at the size the page uses (title 18, names/buttons 14,
 * the rest 12), measured by tools/measure-indicator-text.swift; a changed string must be measured again.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const MEASURED: Record<string, Record<string, [string, number]>> = {
  'permissions.description': {
    ar: ['يلزم إذن واحد لترجمة ما يظهر على شاشتك.', 218],
    de: ['Für die Übersetzung von Bildschirmtext ist eine Berechtigung nötig.', 412],
    en: ['One permission is needed to translate what is on your screen.', 375],
    es: ['Hace falta un permiso para traducir lo que hay en tu pantalla.', 372],
    fr: ["Une autorisation est nécessaire pour traduire ce qui s'affiche à l'écran.", 432],
    hi: ['स्क्रीन पर दिख रही चीज़ों का अनुवाद करने के लिए एक अनुमति चाहिए।', 321],
    it: ["Serve un'autorizzazione per tradurre ciò che è sullo schermo.", 374],
    ja: ['画面上の内容を翻訳するには、1 つの許可が必要です。', 311],
    ko: ['화면에 있는 내용을 번역하려면 권한 하나가 필요합니다.', 272],
    nl: ['Eén toestemming is nodig om te vertalen wat op je scherm staat.', 393],
    pl: ['Do tłumaczenia tego, co na ekranie, potrzebne jest jedno uprawnienie.', 428],
    pt: ['É preciso uma permissão para traduzir o que está na tela.', 349],
    ru: ['Для перевода текста на экране нужно одно разрешение.', 363],
    tr: ['Ekranınızdaki metni çevirmek için bir izin gerekir.', 297],
    uk: ['Для перекладу тексту на екрані потрібен один дозвіл.', 344],
    zh: ['翻译屏幕上的内容需要一项权限。', 189]
  },
  'permissions.screenRecordingDescription': {
    ar: ['مطلوب لالتقاط لقطات الشاشة', 154],
    de: ['Erforderlich für Screenshots', 173],
    en: ['Required for capturing screenshots', 215],
    es: ['Necesaria para capturar pantallas', 206],
    fr: ["Requis pour capturer des captures d'écran", 260],
    hi: ['स्क्रीनशॉट कैप्चर करने के लिए आवश्यक', 182],
    it: ['Necessaria per catturare screenshot', 222],
    ja: ['スクリーンショットのキャプチャに必要', 226],
    ko: ['스크린샷 캡처에 필요합니다', 136],
    nl: ['Vereist voor het maken van schermafbeeldingen', 293],
    pl: ['Wymagane do przechwytywania zrzutów ekranu', 292],
    pt: ['Necessária para capturar telas', 187],
    ru: ['Необходимо для захвата скриншотов', 238],
    tr: ['Ekran görüntüsü almak için gereklidir', 226],
    uk: ['Необхідно для створення знімків екрана', 258],
    zh: ['截图功能所需', 76]
  },
  'permissions.microphoneDescription': {
    ar: ['مطلوب للإملاء الصوتي', 114],
    de: ['Erforderlich für das Sprachdiktat', 200],
    en: ['Required for voice dictation', 169],
    es: ['Necesario para el dictado por voz', 204],
    fr: ['Requis pour la dictée vocale', 171],
    hi: ['वॉइस डिक्टेशन के लिए आवश्यक', 151],
    it: ['Necessario per la dettatura vocale', 209],
    ja: ['音声ディクテーションに必要', 164],
    ko: ['음성 받아쓰기에 필요합니다', 136],
    nl: ['Vereist voor spraakdictaat', 160],
    pl: ['Wymagane do dyktowania głosowego', 228],
    pt: ['Necessário para o ditado por voz', 200],
    ru: ['Необходимо для голосовой диктовки', 237],
    tr: ['Sesli dikte için gereklidir', 150],
    uk: ['Необхідно для голосової диктовки', 219],
    zh: ['语音听写所需', 76]
  },
  'permissions.accessibilityDescription': {
    ar: ['للصق النص حيث يوجد المؤشر', 156],
    de: ['Zum Einfügen des Texts an der Cursorposition', 281],
    en: ['Pastes the text where your cursor is', 219],
    es: ['Para pegar el texto donde está el cursor', 243],
    fr: ["Pour coller le texte à l'emplacement du curseur", 287],
    hi: ['कर्सर जहाँ है वहाँ टेक्स्ट चिपकाने के लिए', 183],
    it: ['Per incollare il testo dove si trova il cursore', 263],
    ja: ['カーソルのある場所にテキストを貼り付けるために', 289],
    ko: ['커서가 있는 곳에 텍스트를 붙여넣기 위해', 200],
    nl: ['Om de tekst te plakken waar je cursor staat', 264],
    pl: ['Do wklejania tekstu w miejscu kursora', 232],
    pt: ['Para colar o texto onde está o cursor', 224],
    ru: ['Чтобы вставлять текст туда, где стоит курсор', 291],
    tr: ['Metni imlecin olduğu yere yapıştırmak için', 256],
    uk: ['Щоб вставляти текст там, де курсор', 231],
    zh: ['用于把文字粘贴到光标所在位置', 176]
  },
  'permissions.macAlertNote': {
    ar: ['قد يعرض macOS تنبيهًا خاصًا به. اختر فيه "فتح إعدادات النظام".', 336],
    de: [
      'macOS zeigt eventuell eine eigene Meldung. Wähle dort „Systemeinstellungen öffnen“.',
      526
    ],
    en: ['macOS may show its own alert. Choose "Open System Settings" there.', 430],
    es: ['macOS puede mostrar su propia alerta. Elige "Abrir Ajustes del Sistema" en ella.', 488],
    fr: [
      'macOS peut afficher sa propre alerte. Choisissez-y « Ouvrir les Réglages Système ».',
      516
    ],
    hi: ['macOS अपना अलर्ट दिखा सकता है। उसमें "सिस्टम सेटिंग्ज़ खोलें" चुनें।', 335],
    it: ['macOS può mostrare un avviso proprio. Scegli lì "Apri Impostazioni di Sistema".', 483],
    ja: [
      'macOS が独自のアラートを表示することがあります。そこで「システム設定を開く」を選んでください。',
      599
    ],
    ko: ['macOS가 자체 알림을 표시할 수 있습니다. 거기서 "시스템 설정 열기"를 선택하세요.', 421],
    nl: ['macOS toont mogelijk een eigen melding. Kies daarin "Open Systeeminstellingen".', 501],
    pl: ['macOS może pokazać własny alert. Wybierz w nim „Otwórz Ustawienia systemowe”.', 510],
    pt: ['O macOS pode mostrar o próprio alerta. Escolha nele "Abrir Ajustes do Sistema".', 491],
    ru: [
      'macOS может показать собственное окно. Выберите в нём «Открыть Системные настройки».',
      598
    ],
    tr: [
      'macOS kendi uyarısını gösterebilir. Orada "Sistem Ayarları\'nı Aç" seçeneğini seçin.',
      501
    ],
    uk: ['macOS може показати власне вікно. Виберіть у ньому «Відкрити Системні параметри».', 559],
    zh: ['macOS 可能会弹出自己的提示。请在其中选择“打开系统设置”。', 361]
  },
  'permissions.relaunchNote': {
    ar: ['بعد تفعيله، سيطلب منك macOS إعادة فتح Cliparla. اختر «إعادة الفتح».', 383],
    de: [
      'Sobald du sie aktivierst, fragt macOS, ob Cliparla erneut geöffnet werden soll. Wähle „Erneut öffnen“.',
      617
    ],
    en: ['After you turn it on, macOS asks to reopen Cliparla. Choose Reopen.', 416],
    es: ['Cuando lo actives, macOS te pedirá reabrir Cliparla. Elige Reabrir.', 399],
    fr: [
      "Une fois l'option activée, macOS vous propose de rouvrir Cliparla. Choisissez Rouvrir.",
      520
    ],
    hi: ['चालू करने के बाद macOS Cliparla को दोबारा खोलने के लिए कहेगा। दोबारा खोलें चुनें।', 414],
    it: ['Dopo averlo attivato, macOS chiede di riaprire Cliparla. Scegli Riapri.', 418],
    ja: ['オンにすると、macOS が Cliparla の再起動を求めます。「再度開く」を選んでください。', 515],
    ko: ['켜면 macOS가 Cliparla를 다시 열라고 요청합니다. 다시 열기를 선택하세요.', 383],
    nl: [
      'Nadat je dit aanzet, vraagt macOS om Cliparla opnieuw te openen. Kies Open opnieuw.',
      526
    ],
    pl: ['Po włączeniu macOS poprosi o ponowne otwarcie Cliparla. Wybierz Otwórz ponownie.', 522],
    pt: ['Depois de ativar, o macOS pede para reabrir o Cliparla. Escolha Reabrir.', 435],
    ru: ['После включения macOS предложит перезапустить Cliparla. Выберите «Перезапустить».', 569],
    tr: ["Açtıktan sonra macOS, Cliparla'yı yeniden açmak isteyecek. Yeniden Aç'ı seçin.", 481],
    uk: ['Після ввімкнення macOS запропонує перезапустити Cliparla. Оберіть «Перезапустити».', 561],
    zh: ['开启后，macOS 会提示重新打开 Cliparla。请选择“重新打开”。', 361]
  },
  'permissions.screenNeeded': {
    ar: ['فعّل تسجيل الشاشة لترجمة لقطات الشاشة.', 223],
    de: ['Aktiviere die Bildschirmaufnahme, um Screenshots zu übersetzen.', 403],
    en: ['Turn on Screen Recording to translate screenshots.', 313],
    es: ['Activa la Grabación de pantalla para traducir capturas de pantalla.', 403],
    fr: ["Activez l'enregistrement de l'écran pour traduire des captures d'écran.", 432],
    hi: ['स्क्रीनशॉट का अनुवाद करने के लिए स्क्रीन रिकॉर्डिंग चालू करें।', 278],
    it: ['Attiva la Registrazione schermo per tradurre gli screenshot.', 363],
    ja: ['スクリーンショットを翻訳するには、画面収録をオンにしてください。', 402],
    ko: ['스크린샷을 번역하려면 화면 녹화를 켜세요.', 211],
    nl: ['Zet Schermopname aan om schermafbeeldingen te vertalen.', 367],
    pl: ['Włącz Nagrywanie ekranu, aby tłumaczyć zrzuty ekranu.', 345],
    pt: ['Ative a Gravação de Tela para traduzir capturas de tela.', 337],
    ru: ['Включите запись экрана, чтобы переводить скриншоты.', 360],
    tr: ["Ekran görüntülerini çevirmek için Ekran Kaydı'nı açın.", 323],
    uk: ['Увімкніть «Запис екрана», щоб перекладати знімки екрана.', 383],
    zh: ['请开启屏幕录制以翻译截图。', 164]
  },
  'permissions.screenReady': {
    ar: ['تسجيل الشاشة مفعّل. أنت جاهز لترجمة لقطات الشاشة.', 285],
    de: ['Die Bildschirmaufnahme ist aktiviert. Du kannst jetzt Screenshots übersetzen.', 475],
    en: ['Screen Recording is on. You are ready to translate screenshots.', 386],
    es: ['La Grabación de pantalla está activada. Ya puedes traducir capturas de pantalla.', 489],
    fr: ["L'enregistrement de l'écran est activé. Vous pouvez traduire des captures d'écran.", 502],
    hi: ['स्क्रीन रिकॉर्डिंग चालू है। आप स्क्रीनशॉट का अनुवाद करने के लिए तैयार हैं।', 336],
    it: ['Registrazione schermo attiva. Puoi tradurre gli screenshot.', 358],
    ja: ['画面収録はオンです。スクリーンショットを翻訳できます。', 339],
    ko: ['화면 녹화가 켜져 있습니다. 스크린샷을 번역할 수 있습니다.', 290],
    nl: ['Schermopname staat aan. Je kunt nu schermafbeeldingen vertalen.', 410],
    pl: ['Nagrywanie ekranu jest włączone. Możesz tłumaczyć zrzuty ekranu.', 415],
    pt: ['A Gravação de Tela está ativada. Você já pode traduzir capturas de tela.', 437],
    ru: ['Запись экрана включена. Можно переводить скриншоты.', 365],
    tr: ['Ekran Kaydı açık. Ekran görüntülerini çevirmeye hazırsınız.', 355],
    uk: ['Запис екрана ввімкнено. Можна перекладати знімки екрана.', 388],
    zh: ['屏幕录制已开启，可以翻译截图了。', 201]
  },
  'permissions.laterDescription': {
    ar: ['يمكنك تخطيها. سيطلبها Cliparla مجددًا عند أول إملاء.', 282],
    de: ['Du kannst sie überspringen. Cliparla fragt beim ersten Diktat erneut.', 417],
    en: ['You can skip these. Cliparla asks again at your first dictation.', 372],
    es: ['Puedes omitirlos. Cliparla los pedirá de nuevo en tu primer dictado.', 409],
    fr: ['Vous pouvez les ignorer. Cliparla les redemandera à la première dictée.', 432],
    hi: ['आप इन्हें छोड़ सकते हैं। पहली डिक्टेशन पर Cliparla फिर से माँगेगा।', 319],
    it: ['Puoi saltarli. Cliparla li richiederà alla prima dettatura.', 329],
    ja: ['スキップしても構いません。最初の音声入力のときに Cliparla が改めて許可を求めます。', 506],
    ko: ['건너뛰어도 됩니다. 첫 음성 입력 때 Cliparla가 다시 요청합니다.', 319],
    nl: ['Je kunt ze overslaan. Cliparla vraagt er bij je eerste dictaat opnieuw om.', 438],
    pl: ['Możesz je pominąć. Cliparla poprosi o nie ponownie przy pierwszym dyktowaniu.', 490],
    pt: ['Você pode pular. O Cliparla pede de novo no primeiro ditado.', 369],
    ru: ['Можно пропустить. Cliparla спросит снова при первой диктовке.', 411],
    tr: ['Atlayabilirsiniz. Cliparla ilk diktede yeniden ister.', 296],
    uk: ['Можна пропустити. Cliparla запитає знову під час першої диктовки.', 430],
    zh: ['可以跳过。首次听写时 Cliparla 会再次请求。', 255]
  },
  'permissions.notYet': {
    ar: ['ليس بعد', 45],
    de: ['Noch nicht', 66],
    en: ['Not yet', 45],
    es: ['Todavía no', 66],
    fr: ['Pas encore', 67],
    hi: ['अभी नहीं', 40],
    it: ['Non ancora', 70],
    ja: ['未許可', 38],
    ko: ['아직 아님', 47],
    nl: ['Nog niet', 52],
    pl: ['Jeszcze nie', 71],
    pt: ['Ainda não', 61],
    ru: ['Ещё нет', 51],
    tr: ['Henüz değil', 72],
    uk: ['Ще ні', 35],
    zh: ['尚未开启', 51]
  },
  'permissions.laterTitle': {
    ar: ['اختياري، للإملاء الصوتي', 137],
    de: ['Optional, für das Sprachdiktat', 210],
    en: ['Optional, for voice dictation', 194],
    es: ['Opcional, para el dictado por voz', 230],
    fr: ['Facultatif, pour la dictée vocale', 218],
    hi: ['वैकल्पिक, वॉइस डिक्टेशन के लिए', 180],
    it: ['Facoltativo, per la dettatura vocale', 242],
    ja: ['任意、音声入力のために', 161],
    ko: ['선택 사항, 음성 입력용', 129],
    nl: ['Optioneel, voor spraakdictaat', 206],
    pl: ['Opcjonalnie, do dyktowania głosowego', 271],
    pt: ['Opcional, para o ditado por voz', 218],
    ru: ['По желанию, для голосовой диктовки', 274],
    tr: ['İsteğe bağlı, sesli dikte için', 189],
    uk: ["Необов'язково, для голосової диктовки", 287],
    zh: ['可选，用于语音听写', 132]
  },
  'permissions.screenRecording': {
    ar: ['تسجيل الشاشة', 89],
    de: ['Bildschirmaufnahme', 143],
    en: ['Screen Recording', 123],
    es: ['Grabación de pantalla', 152],
    fr: ["Enregistrement d'écran", 164],
    hi: ['स्क्रीन रिकॉर्डिंग', 79],
    it: ['Registrazione schermo', 160],
    ja: ['画面収録', 59],
    ko: ['화면 녹화', 54],
    nl: ['Schermopname', 109],
    pl: ['Nagrywanie ekranu', 134],
    pt: ['Gravação de tela', 117],
    ru: ['Запись экрана', 106],
    tr: ['Ekran Kaydı', 82],
    uk: ['Запис екрана', 99],
    zh: ['屏幕录制', 59]
  },
  'permissions.microphone': {
    ar: ['الميكروفون', 66],
    de: ['Mikrofon', 62],
    en: ['Microphone', 83],
    es: ['Micrófono', 70],
    fr: ['Microphone', 83],
    hi: ['माइक्रोफ़ोन', 59],
    it: ['Microfono', 70],
    ja: ['マイク', 44],
    ko: ['마이크', 38],
    nl: ['Microfoon', 70],
    pl: ['Mikrofon', 62],
    pt: ['Microfone', 70],
    ru: ['Микрофон', 77],
    tr: ['Mikrofon', 62],
    uk: ['Мікрофон', 72],
    zh: ['麦克风', 44]
  },
  'permissions.accessibility': {
    ar: ['تسهيلات الاستخدام', 113],
    de: ['Bedienungshilfen', 121],
    en: ['Accessibility', 88],
    es: ['Accesibilidad', 93],
    fr: ['Accessibilité', 88],
    hi: ['ऐक्सेसिबिलिटी', 79],
    it: ['Accessibilità', 88],
    ja: ['アクセシビリティ', 118],
    ko: ['손쉬운 사용', 67],
    nl: ['Toegankelijkheid', 117],
    pl: ['Dostępność', 83],
    pt: ['Acessibilidade', 101],
    ru: ['Универсальный доступ', 168],
    tr: ['Erişilebilirlik', 85],
    uk: ['Доступність', 88],
    zh: ['辅助功能', 59]
  },
  'permissions.grantAccess': {
    ar: ['منح الوصول', 72],
    de: ['Zugriff erteilen', 105],
    en: ['Grant Access', 93],
    es: ['Conceder acceso', 121],
    fr: ["Accorder l'accès", 117],
    hi: ['पहुँच प्रदान करें', 79],
    it: ['Concedi accesso', 118],
    ja: ['アクセスを許可', 103],
    ko: ['접근 허용', 54],
    nl: ['Toegang verlenen', 124],
    pl: ['Przyznaj dostęp', 112],
    pt: ['Conceder acesso', 120],
    ru: ['Предоставить доступ', 157],
    tr: ['Erişim Ver', 70],
    uk: ['Надати доступ', 107],
    zh: ['授予权限', 59]
  },
  'permissions.openSettings': {
    ar: ['فتح الإعدادات', 83],
    de: ['Einstellungen öffnen', 143],
    en: ['Open Settings', 99],
    es: ['Abrir ajustes', 89],
    fr: ['Ouvrir les paramètres', 151],
    hi: ['सेटिंग्स खोलें', 66],
    it: ['Apri impostazioni', 121],
    ja: ['設定を開く', 74],
    ko: ['설정 열기', 54],
    nl: ['Instellingen openen', 136],
    pl: ['Otwórz ustawienia', 128],
    pt: ['Abrir configurações', 138],
    ru: ['Открыть настройки', 143],
    tr: ['Ayarları Aç', 75],
    uk: ['Відкрити налаштування', 173],
    zh: ['打开设置', 59]
  },
  'permissions.title': {
    ar: ['فعّل تسجيل الشاشة', 150],
    de: ['Bildschirmaufnahme aktivieren', 268],
    en: ['Turn on Screen Recording', 224],
    es: ['Activa la grabación de pantalla', 265],
    fr: ["Activez l'enregistrement de l'écran", 302],
    hi: ['स्क्रीन रिकॉर्डिंग चालू करें', 164],
    it: ['Attiva la registrazione dello schermo', 316],
    ja: ['画面収録をオンにする', 188],
    ko: ['화면 기록 켜기', 106],
    nl: ['Schermopname aanzetten', 227],
    pl: ['Włącz nagrywanie ekranu', 223],
    pt: ['Ative a gravação de tela', 207],
    ru: ['Включите запись экрана', 225],
    tr: ['Ekran Kaydı iznini açın', 193],
    uk: ['Увімкніть запис екрана', 212],
    zh: ['开启屏幕录制', 113]
  }
}

const WORK_AREA_MIN = 700
// 450 window - 2 x 24 page padding
const FULL = 402
// row text: FULL - 2 x 12 padding - 28 icon - 12 gap - ~120 for the status and the button column
const ROW_TEXT = 230

const lines = (width: number, avail: number): number => Math.max(1, Math.ceil(width / avail))
const w = (code: string, key: string): number => MEASURED[key][code][1]

function estimate(code: string): number {
  const row = (descKey: string): number =>
    24 + Math.max(lines(w(code, descKey), ROW_TEXT) * 16 + 20, 52) + 8
  const header =
    lines(w(code, 'permissions.title'), FULL) * 28 +
    lines(w(code, 'permissions.description'), FULL) * 16 +
    4 +
    12
  const notes =
    lines(w(code, 'permissions.macAlertNote'), FULL) * 16 +
    lines(w(code, 'permissions.relaunchNote'), FULL) * 16 +
    8
  const status =
    8 +
    Math.max(
      lines(w(code, 'permissions.screenNeeded'), FULL),
      lines(w(code, 'permissions.screenReady'), FULL)
    ) *
      16
  const later = 12 + 20 + lines(w(code, 'permissions.laterDescription'), FULL) * 16 + 8
  const rows =
    row('permissions.screenRecordingDescription') +
    row('permissions.microphoneDescription') +
    row('permissions.accessibilityDescription')
  const titleBar = 32
  const bar = 70
  return titleBar + header + notes + status + later + rows + 16 + bar
}

const locale = (code: string): Record<string, string> =>
  JSON.parse(readFileSync(`${__dirname}/../src/renderer/src/i18n/locales/${code}.json`, 'utf8'))

describe('permissions screen layout', () => {
  it('the measured texts are the shipped texts in all 16 locales', () => {
    for (const [key, entries] of Object.entries(MEASURED)) {
      assert.equal(Object.keys(entries).length, 16, key)
      for (const [code, [text]] of Object.entries(entries))
        assert.equal(locale(code)[key], text, `${code} ${key} changed: measure it again`)
    }
  })

  it('with Screen Recording missing, every locale needs at most 700 px for all rows and the bar', () => {
    for (const code of Object.keys(MEASURED['permissions.title'])) {
      const height = estimate(code)
      assert.ok(height <= WORK_AREA_MIN, `${code} needs about ${height} px`)
    }
  })

  it('the page measures its content and its bar, and asks main to fit the window', () => {
    const page = readFileSync(`${__dirname}/../src/renderer/src/permissions/App.tsx`, 'utf8')
    assert.match(page, /fitWindowHeight\(/)
    assert.match(page, /observer\.observe\(content\)/)
    assert.match(page, /observer\.observe\(bar\)/)
    assert.doesNotMatch(page, /<details/)
  })

  it('the Continue bar sits below the scroll area, so it never covers a row', () => {
    const page = readFileSync(`${__dirname}/../src/renderer/src/permissions/App.tsx`, 'utf8')
    assert.match(page, /shrink-0 border-t/)
    assert.doesNotMatch(page, /sticky bottom-0|absolute bottom/)
  })
})
