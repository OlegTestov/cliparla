/**
 * The error card in the indicator is 360 x 124: text 292 px wide, up to 4 lines (about 1000 px of
 * one-line width with wrapping slack); Retry + Close sit side by side in 328 px (24 px padding each,
 * 8 px gap). Widths are measured with AppKit (12 px, medium) by tools/measure-indicator-text.swift
 * ({{size}} = 5.00). A changed string must be measured again.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const MESSAGE_MAX = 1000
const BUTTONS_MAX = 328

const MEASURED: Record<string, Record<string, [string, number]>> = {
  'error.QUOTA_EXHAUSTED': {
    ar: [
      'استُنفدت حصة Gemini الخاصة بك حاليًا. انتظر دقيقة وحاول مرة أخرى، أو تحقق من حدودك في Google AI Studio.',
      596
    ],
    de: [
      'Dein Gemini-Kontingent ist vorerst aufgebraucht. Warte eine Minute und versuche es erneut oder prüfe deine Limits in Google AI Studio.',
      828
    ],
    en: [
      'Your Gemini quota is used up for now. Wait a minute and try again, or check your limits in Google AI Studio.',
      650
    ],
    es: [
      'Se agotó tu cuota de Gemini por ahora. Espera un minuto e inténtalo de nuevo, o revisa tus límites en Google AI Studio.',
      723
    ],
    fr: [
      'Votre quota Gemini est épuisé pour le moment. Attendez une minute et réessayez, ou vérifiez vos limites dans Google AI Studio.',
      777
    ],
    hi: [
      'आपका Gemini कोटा फ़िलहाल खत्म हो गया है। एक मिनट रुककर फिर कोशिश करें, या Google AI Studio में अपनी सीमाएँ देखें।',
      612
    ],
    it: [
      'La tua quota Gemini è esaurita per ora. Attendi un minuto e riprova, oppure controlla i tuoi limiti in Google AI Studio.',
      703
    ],
    ja: [
      'Gemini の利用枠を一時的に使い切りました。1分ほど待ってからもう一度お試しいただくか、Google AI Studio で上限を確認してください。',
      798
    ],
    ko: [
      'Gemini 사용량 한도를 일시적으로 모두 사용했습니다. 1분 뒤에 다시 시도하거나 Google AI Studio에서 한도를 확인하세요.',
      618
    ],
    nl: [
      'Je Gemini-quotum is voorlopig op. Wacht een minuut en probeer het opnieuw, of controleer je limieten in Google AI Studio.',
      745
    ],
    pl: [
      'Limit Gemini został na razie wyczerpany. Odczekaj minutę i spróbuj ponownie lub sprawdź swoje limity w Google AI Studio.',
      745
    ],
    pt: [
      'Sua cota do Gemini acabou por enquanto. Aguarde um minuto e tente novamente, ou confira seus limites no Google AI Studio.',
      764
    ],
    ru: [
      'Квота Gemini пока исчерпана. Подождите минуту и попробуйте снова или проверьте лимиты в Google AI Studio.',
      711
    ],
    tr: [
      "Gemini kotanız şimdilik doldu. Bir dakika bekleyip tekrar deneyin ya da limitlerinizi Google AI Studio'dan kontrol edin.",
      710
    ],
    uk: [
      'Ваша квота Gemini тимчасово вичерпана. Зачекайте хвилину й спробуйте ще раз або перевірте свої ліміти в Google AI Studio.',
      800
    ],
    zh: ['你的 Gemini 配额暂时用完了。请等一分钟再试，或在 Google AI Studio 中查看你的额度。', 510]
  },
  'error.NETWORK': {
    ar: ['تعذّر الوصول إلى Google. تحقق من اتصالك بالإنترنت وحاول مرة أخرى.', 364],
    de: [
      'Google ist nicht erreichbar. Prüfe deine Internetverbindung und versuche es erneut.',
      509
    ],
    en: ['Cannot reach Google. Check your internet connection and try again.', 414],
    es: [
      'No se puede conectar con Google. Comprueba tu conexión a internet e inténtalo de nuevo.',
      550
    ],
    fr: ['Impossible de joindre Google. Vérifiez votre connexion internet et réessayez.', 467],
    hi: ['Google से कनेक्ट नहीं हो पा रहा। अपना इंटरनेट कनेक्शन देखें और फिर कोशिश करें।', 395],
    it: ['Impossibile raggiungere Google. Controlla la connessione a internet e riprova.', 473],
    ja: ['Google に接続できません。インターネット接続を確認して、もう一度お試しください。', 499],
    ko: ['Google에 연결할 수 없습니다. 인터넷 연결을 확인하고 다시 시도하세요.', 358],
    nl: [
      'Geen verbinding met Google. Controleer je internetverbinding en probeer het opnieuw.',
      526
    ],
    pl: ['Brak połączenia z Google. Sprawdź połączenie z internetem i spróbuj ponownie.', 486],
    pt: [
      'Não foi possível conectar ao Google. Verifique sua conexão com a internet e tente novamente.',
      572
    ],
    ru: [
      'Не удаётся связаться с Google. Проверьте подключение к интернету и попробуйте снова.',
      571
    ],
    tr: ["Google'a ulaşılamıyor. İnternet bağlantınızı kontrol edip tekrar deneyin.", 431],
    uk: [
      "Не вдається зв'язатися з Google. Перевірте підключення до інтернету й спробуйте ще раз.",
      577
    ],
    zh: ['无法连接到 Google。请检查网络连接后重试。', 260]
  },
  'error.TIMEOUT': {
    ar: ['لم ترد Google في الوقت المناسب. تحقق من اتصالك وحاول مرة أخرى.', 363],
    de: [
      'Google hat nicht rechtzeitig geantwortet. Prüfe deine Verbindung und versuche es erneut.',
      548
    ],
    en: ['Google did not answer in time. Check your connection and try again.', 416],
    es: ['Google no respondió a tiempo. Comprueba tu conexión e inténtalo de nuevo.', 465],
    fr: ["Google n'a pas répondu à temps. Vérifiez votre connexion et réessayez.", 435],
    hi: ['Google ने समय पर जवाब नहीं दिया। अपना कनेक्शन देखें और फिर कोशिश करें।', 377],
    it: ['Google non ha risposto in tempo. Controlla la connessione e riprova.', 415],
    ja: ['Google からの応答がありませんでした。接続を確認して、もう一度お試しください。', 486],
    ko: ['Google에서 제때 응답하지 않았습니다. 연결을 확인하고 다시 시도하세요.', 365],
    nl: ['Google antwoordde niet op tijd. Controleer je verbinding en probeer het opnieuw.', 493],
    pl: ['Google nie odpowiedziało na czas. Sprawdź połączenie i spróbuj ponownie.', 458],
    pt: ['O Google não respondeu a tempo. Verifique sua conexão e tente novamente.', 464],
    ru: ['Google не ответил вовремя. Проверьте подключение и попробуйте снова.', 470],
    tr: ['Google zamanında yanıt vermedi. Bağlantınızı kontrol edip tekrar deneyin.', 448],
    uk: ['Google не відповів вчасно. Перевірте підключення й спробуйте ще раз.', 453],
    zh: ['Google 未能及时响应。请检查网络连接后重试。', 273]
  },
  'error.BLOCKED': {
    ar: ['حظرت Google هذا المحتوى بسبب مرشحات الأمان. جرّب تحديدًا مختلفًا.', 377],
    de: [
      'Google hat diesen Inhalt mit seinen Sicherheitsfiltern blockiert. Versuche eine andere Auswahl.',
      577
    ],
    en: ['Google blocked this content with its safety filters. Try a different selection.', 457],
    es: [
      'Google bloqueó este contenido con sus filtros de seguridad. Prueba con otra selección.',
      532
    ],
    fr: [
      'Google a bloqué ce contenu avec ses filtres de sécurité. Essayez une autre sélection.',
      517
    ],
    hi: ['Google ने अपने सुरक्षा फ़िल्टर से इस सामग्री को रोक दिया। कोई दूसरा चयन आज़माएँ।', 404],
    it: [
      'Google ha bloccato questo contenuto con i suoi filtri di sicurezza. Prova con una selezione diversa.',
      601
    ],
    ja: [
      'Google の安全フィルターによりこのコンテンツはブロックされました。別の範囲でお試しください。',
      574
    ],
    ko: ['Google 안전 필터가 이 콘텐츠를 차단했습니다. 다른 영역을 선택해 보세요.', 372],
    nl: [
      'Google heeft deze inhoud geblokkeerd met zijn veiligheidsfilters. Probeer een andere selectie.',
      573
    ],
    pl: ['Google zablokowało tę treść filtrami bezpieczeństwa. Spróbuj wybrać coś innego.', 497],
    pt: [
      'O Google bloqueou este conteúdo com seus filtros de segurança. Tente outra seleção.',
      524
    ],
    ru: [
      'Google заблокировал этот контент своими фильтрами безопасности. Попробуйте выбрать другое.',
      627
    ],
    tr: ['Google bu içeriği güvenlik filtreleriyle engelledi. Farklı bir seçim deneyin.', 442],
    uk: ['Google заблокував цей вміст своїми фільтрами безпеки. Спробуйте інший фрагмент.', 540],
    zh: ['Google 的安全过滤器拦截了此内容。请换一个选区试试。', 323]
  },
  'error.INVALID_REQUEST': {
    ar: ['لم يُقبل الطلب. حاول مرة أخرى بمدخلات مختلفة.', 255],
    de: [
      'Die Anfrage wurde nicht akzeptiert. Versuche es bitte mit einer anderen Eingabe erneut.',
      535
    ],
    en: ['The request was not accepted. Please try again with different input.', 413],
    es: ['La solicitud no fue aceptada. Inténtalo de nuevo con otra entrada.', 400],
    fr: ["La requête n'a pas été acceptée. Réessayez avec une autre saisie.", 402],
    hi: ['अनुरोध स्वीकार नहीं किया गया। कृपया अलग इनपुट के साथ फिर कोशिश करें।', 358],
    it: ['La richiesta non è stata accettata. Riprova con un contenuto diverso.', 418],
    ja: ['リクエストが受け付けられませんでした。別の内容でもう一度お試しください。', 452],
    ko: ['요청이 받아들여지지 않았습니다. 다른 내용으로 다시 시도하세요.', 318],
    nl: ['Het verzoek is niet geaccepteerd. Probeer het opnieuw met andere invoer.', 451],
    pl: ['Żądanie nie zostało przyjęte. Spróbuj ponownie z innymi danymi.', 394],
    pt: ['A solicitação não foi aceita. Tente novamente com outra entrada.', 394],
    ru: ['Запрос не принят. Попробуйте снова с другими данными.', 369],
    tr: ['İstek kabul edilmedi. Lütfen farklı bir girdiyle tekrar deneyin.', 367],
    uk: ['Запит не прийнято. Спробуйте ще раз з іншими даними.', 358],
    zh: ['请求未被接受。请换一些内容后重试。', 214]
  },
  'error.UNKNOWN': {
    ar: ['حدث خطأ أثناء التواصل مع Google. حاول مرة أخرى.', 274],
    de: [
      'Bei der Kommunikation mit Google ist etwas schiefgelaufen. Bitte versuche es erneut.',
      521
    ],
    en: ['Something went wrong while talking to Google. Please try again.', 391],
    es: ['Algo salió mal al comunicarse con Google. Inténtalo de nuevo.', 376],
    fr: ['Un problème est survenu lors de la communication avec Google. Réessayez.', 462],
    hi: ['Google से बात करते समय कुछ गड़बड़ हो गई। कृपया फिर कोशिश करें।', 336],
    it: ['Qualcosa è andato storto nella comunicazione con Google. Riprova.', 410],
    ja: ['Google との通信中に問題が発生しました。もう一度お試しください。', 398],
    ko: ['Google과 통신하는 중 문제가 발생했습니다. 다시 시도하세요.', 308],
    nl: ['Er ging iets mis bij het contact met Google. Probeer het opnieuw.', 395],
    pl: ['Coś poszło nie tak podczas łączenia z Google. Spróbuj ponownie.', 399],
    pt: ['Algo deu errado ao se comunicar com o Google. Tente novamente.', 403],
    ru: ['Что-то пошло не так при обращении к Google. Попробуйте снова.', 418],
    tr: ['Google ile konuşurken bir şeyler ters gitti. Lütfen tekrar deneyin.', 393],
    uk: ['Під час звернення до Google щось пішло не так. Спробуйте ще раз.', 429],
    zh: ['与 Google 通信时出了点问题。请重试。', 226]
  },
  'dictation.noAudio.message': {
    ar: ['لم يتم تسجيل أي صوت. حاول مرة أخرى.', 209],
    de: ['Es wurde kein Audio aufgenommen. Bitte versuche es erneut.', 373],
    en: ['No audio was recorded. Please try again.', 249],
    es: ['No se grabó ningún audio. Inténtalo de nuevo.', 279],
    fr: ["Aucun son n'a été enregistré. Veuillez réessayer.", 295],
    hi: ['कोई ऑडियो रिकॉर्ड नहीं हुआ। कृपया फिर कोशिश करें।', 255],
    it: ['Nessun audio registrato. Riprova.', 203],
    ja: ['音声が録音されませんでした。もう一度お試しください。', 327],
    ko: ['녹음된 오디오가 없습니다. 다시 시도하세요.', 215],
    nl: ['Er is geen audio opgenomen. Probeer het opnieuw.', 309],
    pl: ['Nie nagrano dźwięku. Spróbuj ponownie.', 248],
    pt: ['Nenhum áudio foi gravado. Tente novamente.', 275],
    ru: ['Аудио не записано. Попробуйте ещё раз.', 262],
    tr: ['Hiç ses kaydedilmedi. Lütfen tekrar deneyin.', 271],
    uk: ['Аудіо не записано. Спробуйте ще раз.', 243],
    zh: ['未录到音频。请重试。', 126]
  },
  'dictation.tooLarge.message': {
    ar: [
      'التسجيل كبير جدًا ({{size}} ميجابايت). الحد الأقصى 5 ميجابايت. يرجى تسجيل رسالة أقصر.',
      450
    ],
    de: [
      'Die Aufnahme ist zu groß ({{size}} MB). Das Maximum beträgt 5 MB. Bitte nimm eine kürzere Nachricht auf.',
      633
    ],
    en: [
      'The recording is too large ({{size}} MB). The maximum is 5 MB. Please record a shorter message.',
      572
    ],
    es: [
      'La grabación es demasiado grande ({{size}} MB). El máximo es de 5 MB. Graba un mensaje más corto.',
      600
    ],
    fr: [
      "L'enregistrement est trop volumineux ({{size}} Mo). Le maximum est de 5 Mo. Veuillez enregistrer un message plus court.",
      719
    ],
    hi: [
      'रिकॉर्डिंग बहुत बड़ी है ({{size}} MB)। अधिकतम 5 MB की अनुमति है। कृपया छोटा संदेश रिकॉर्ड करें।',
      459
    ],
    it: [
      'La registrazione è troppo grande ({{size}} MB). Il massimo è 5 MB. Registra un messaggio più breve.',
      590
    ],
    ja: [
      '録音が大きすぎます（{{size}} MB）。上限は 5 MB です。もっと短いメッセージで録音してください。',
      566
    ],
    ko: ['녹음 파일이 너무 큽니다({{size}} MB). 최대 크기는 5 MB입니다. 더 짧게 녹음하세요.', 414],
    nl: [
      'De opname is te groot ({{size}} MB). Het maximum is 5 MB. Neem een korter bericht op.',
      515
    ],
    pl: [
      'Nagranie jest za duże ({{size}} MB). Maksymalny rozmiar to 5 MB. Nagraj krótszą wiadomość.',
      549
    ],
    pt: [
      'A gravação é muito grande ({{size}} MB). O máximo é 5 MB. Grave uma mensagem mais curta.',
      552
    ],
    ru: [
      'Запись слишком большая ({{size}} МБ). Максимум — 5 МБ. Запишите сообщение покороче.',
      562
    ],
    tr: [
      'Kayıt çok büyük ({{size}} MB). En fazla 5 MB olabilir. Lütfen daha kısa bir mesaj kaydedin.',
      524
    ],
    uk: ['Запис завеликий ({{size}} МБ). Максимум — 5 МБ. Запишіть коротше повідомлення.', 513],
    zh: ['录音过大（{{size}} MB），最大为 5 MB。请录制较短的内容。', 336]
  },
  'dictation.payload.message': {
    ar: ['تعذّر استخدام التسجيل. حاول مرة أخرى.', 207],
    de: ['Die Aufnahme konnte nicht verwendet werden. Bitte versuche es noch einmal.', 473],
    en: ['The recording could not be used. Please try again.', 306],
    es: ['No se pudo usar la grabación. Inténtalo de nuevo.', 301],
    fr: ["L'enregistrement n'a pas pu être utilisé. Réessayez.", 314],
    hi: ['रिकॉर्डिंग इस्तेमाल नहीं हो सकी। कृपया फिर कोशिश करें।', 263],
    it: ['Impossibile usare la registrazione. Riprova.', 262],
    ja: ['録音を使用できませんでした。もう一度お試しください。', 327],
    ko: ['녹음을 사용할 수 없습니다. 다시 시도해 주세요.', 233],
    nl: ['De opname kon niet worden gebruikt. Probeer het opnieuw.', 360],
    pl: ['Nie udało się użyć nagrania. Spróbuj ponownie.', 288],
    pt: ['Não foi possível usar a gravação. Tente novamente.', 312],
    ru: ['Не удалось использовать запись. Попробуйте ещё раз.', 351],
    tr: ['Kayıt kullanılamadı. Lütfen tekrar deneyin.', 256],
    uk: ['Не вдалося використати запис. Спробуйте ще раз.', 323],
    zh: ['无法使用该录音。请重试。', 151]
  },
  'dictation.rendererGone.message': {
    ar: ['توقفت نافذة الإملاء بشكل غير متوقع. حاول مرة أخرى.', 272],
    de: ['Das Diktatfenster wurde unerwartet beendet. Bitte versuche es noch einmal.', 465],
    en: ['The dictation window stopped unexpectedly. Please try again.', 377],
    es: ['La ventana de dictado se cerró de forma inesperada. Inténtalo de nuevo.', 440],
    fr: ["La fenêtre de dictée s'est arrêtée de façon inattendue. Réessayez.", 404],
    hi: ['डिक्टेशन विंडो अचानक बंद हो गई। कृपया फिर कोशिश करें।', 275],
    it: ['La finestra di dettatura si è interrotta in modo imprevisto. Riprova.', 402],
    ja: ['音声入力のウィンドウが予期せず停止しました。もう一度お試しください。', 427],
    ko: ['음성 입력 창이 예기치 않게 중단되었습니다. 다시 시도해 주세요.', 315],
    nl: ['Het dicteervenster is onverwacht gestopt. Probeer het opnieuw.', 389],
    pl: ['Okno dyktowania nieoczekiwanie przestało działać. Spróbuj ponownie.', 430],
    pt: ['A janela de ditado parou inesperadamente. Tente novamente.', 372],
    ru: ['Окно диктовки неожиданно закрылось. Попробуйте ещё раз.', 390],
    tr: ['Dikte penceresi beklenmedik şekilde durdu. Lütfen tekrar deneyin.', 404],
    uk: ['Вікно диктовки несподівано зупинилося. Спробуйте ще раз.', 383],
    zh: ['听写窗口意外停止。请重试。', 164]
  },
  'common.tryAgain': {
    ar: ['حاول مرة أخرى', 78],
    de: ['Erneut versuchen', 107],
    en: ['Try Again', 58],
    es: ['Reintentar', 64],
    fr: ['Réessayer', 63],
    hi: ['पुनः प्रयास करें', 67],
    it: ['Riprova', 46],
    ja: ['再試行', 38],
    ko: ['다시 시도', 47],
    nl: ['Opnieuw proberen', 112],
    pl: ['Spróbuj ponownie', 109],
    pt: ['Tentar novamente', 109],
    ru: ['Попробовать снова', 124],
    tr: ['Tekrar Dene', 74],
    uk: ['Спробувати ще раз', 123],
    zh: ['重试', 26]
  },
  'common.close': {
    ar: ['إغلاق', 27],
    de: ['Schließen', 60],
    en: ['Close', 35],
    es: ['Cerrar', 39],
    fr: ['Fermer', 44],
    hi: ['बंद करें', 33],
    it: ['Chiudi', 39],
    ja: ['閉じる', 38],
    ko: ['닫기', 22],
    nl: ['Sluiten', 43],
    pl: ['Zamknij', 48],
    pt: ['Fechar', 42],
    ru: ['Закрыть', 53],
    tr: ['Kapat', 36],
    uk: ['Закрити', 53],
    zh: ['关闭', 26]
  }
}

const locale = (code: string): Record<string, string> =>
  JSON.parse(readFileSync(`${__dirname}/../src/renderer/src/i18n/locales/${code}.json`, 'utf8'))

describe('error card text width', () => {
  for (const [key, entries] of Object.entries(MEASURED)) {
    it(`${key}: all 16 locales are the measured text`, () => {
      assert.equal(Object.keys(entries).length, 16)
      for (const [code, [text]] of Object.entries(entries))
        assert.equal(locale(code)[key], text, `${code} ${key} changed: measure it again`)
    })
  }

  it('every error message fits four lines in every locale', () => {
    for (const [key, entries] of Object.entries(MEASURED)) {
      if (key.startsWith('common.')) continue
      for (const [code, [, width]] of Object.entries(entries))
        assert.ok(width <= MESSAGE_MAX, `${code} ${key} is ${width} px`)
    }
  })

  it('Retry and Close fit side by side in every locale', () => {
    for (const code of Object.keys(MEASURED['common.close'])) {
      const total =
        MEASURED['common.tryAgain'][code][1] + MEASURED['common.close'][code][1] + 56 + 8
      assert.ok(total <= BUTTONS_MAX, `${code} buttons are ${total} px`)
    }
  })
})
