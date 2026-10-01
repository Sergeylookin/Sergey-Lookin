// labels.mjs — человеческие названия полей и разбивка страницы на экраны.
//
// Ключи словаря (hero.title.word, ev.3.q) придуманы для кода, а не для человека:
// по ним не понять, какая это надпись, и префикс часто врёт — реплика экрана
// «Принципы» лежит под ключом whisper.partner. Поэтому названия берём не из ключа,
// а из МЕСТА надписи в разметке: чем она является (заголовок, подпись, пункт списка)
// и в каком экране стоит. Порядок полей — тот же, что на странице сверху вниз.
//
// Правило: [селектор, название, от чего считать {n}, от чего считать {m}].
// {n} — номер ближайшего предка-повтора среди соседей (карточка 3, строка 2).
// Побеждает первое подошедшее правило, поэтому частные стоят выше общих.

export const SCREEN_NAMES = {
  hero: 'Первый экран', intro: 'Вступление', works: 'Проекты', credo: 'Принципы',
  evaluation: 'Оценка работы', team: 'Команда', mentor: 'Менторство', audience: 'Аудитория',
  ds: 'Ремесло', results: 'Что получает бизнес', companies: 'Опыт', cta: 'Контакты',
};

// Экраны, которые нельзя скрыть или подвинуть: первый открывает страницу,
// последний её закрывает — между ними порядок свободный.
export const FIXED_SCREENS = new Set(['hero', 'cta']);

// Названия разделов в боковом указателе сайта. Значения по умолчанию зашиты в
// assets/manifest.js (SIDE_LABELS) — здесь их копия, чтобы редактор показывал то,
// что сейчас на сайте. Правка кладёт своё значение атрибутом data-nav-ru/-en на сам
// экран, и сайт берёт его оттуда. Самопроверка следит, что копия не разошлась.
export const SIDE_DEFAULTS = {
  ru: { hero: 'Начало', intro: 'Введение', works: 'Проекты', credo: 'Принципы', audience: 'Люди', evaluation: 'Оценка',
        team: 'Команда', mentor: 'Менторство', ds: 'Ремесло', results: 'Результаты', companies: 'Опыт', cta: 'Контакт' },
  en: { hero: 'Start', intro: 'Intro', works: 'Projects', credo: 'Principles', audience: 'People', evaluation: 'Evaluation',
        team: 'Team', mentor: 'Mentorship', ds: 'Craft', results: 'Results', companies: 'Experience', cta: 'Contact' },
};

// Надписи, которые живут не в словаре, а прямо в разметке: у каждой свой элемент
// на русский и на английский, сайт показывает нужный. re — где текст в файле
// (вторая скобка — сам текст), sel — тот же элемент в превью.
export const TEXT_RULES = {
  'index.html': [
    { id: 'ring', screen: 'team', label: 'Круглый знак · надпись по кругу',
      hint: 'Текст идёт по кругу вокруг знака в экране «Команда». В конце оставь « · » — иначе конец слипнется с началом. Длину знак подгоняет сам.',
      ru: { re: /(<text class="lb-ru"[^>]*><textPath[^>]*>)([^<]*)(<\/textPath>)/, sel: '.lb-ru textPath' },
      en: { re: /(<text class="lb-en"[^>]*><textPath[^>]*>)([^<]*)(<\/textPath>)/, sel: '.lb-en textPath' } },
  ],
};

const INDEX = [
  ['.hero-static', 'Первая фраза (слева вверху)'],
  ['.hero-title em', 'Вторая фраза (справа внизу)'],
  ['.hero-sub', 'Подпись между фразами'],
  ['.hero-eyebrow-bottom', 'Номер выпуска и год'],
  ['.hero-bottom-items .label', 'Колонка {n} · название', '.item'],
  ['.hero-bottom-items .value', 'Колонка {n} · текст', '.item'],

  ['.sec-aside--left', 'Реплика на полях'],
  ['.sec-aside--right [data-i18n]', 'Название раздела'],

  ['.intro-title', 'Заголовок'],
  ['.intro-p', 'Абзац {n}', '.intro-p'],
  ['.intro-stamp', 'Строка фактов внизу'],

  ['.wk-cols span', 'Шапка таблицы · колонка {n}', 'span'],

  ['.credo-title', 'Заголовок'],
  ['.credo-note', 'Утверждение {n} · привычка индустрии', '.credo-line'],
  ['.credo-say', 'Утверждение {n} · текст', '.credo-line'],

  ['.level .ln', 'Уровень {n} · метка', '.level'],
  ['.level .ltitle', 'Уровень {n} · название', '.level'],
  ['.level .ldesc', 'Уровень {n} · описание', '.level'],
  ['.level .lq', 'Уровень {n} · вопрос', '.level'],
  ['.bmp-split .label', 'Пропорция · подпись {n}', '.side'],
  ['.ev-bmp-foot', 'Вывод под пропорцией'],

  ['.tm-tag', 'Строка {n} · метка', '.tm-row'],
  ['.tm-text', 'Строка {n} · текст', '.tm-row'],

  ['.mentor-core', 'Заголовок'],
  ['.msat', 'Тема {n} · название', '.msat'],

  ['.ar-title', 'Строка {n} · заголовок', '.aud-row'],
  ['.ar-tag', 'Строка {n} · фраза справа', '.aud-row'],
  ['.ar-data', 'Строка {n} · цифры', '.aud-row'],
  ['.stream-track span', 'Строка {n} · реплика {m}', '.aud-row', 'span'],
  ['.aud-quote', 'Цитата под списком'],

  ['.craft-eye-label', 'Метка «Со стороны»'],
  ['.craft-real-label', 'Метка «Изнутри»'],
  ['.craft-eye-obs', 'Карточка {n} · со стороны', '.craft-card'],
  ['.craft-reality', 'Карточка {n} · изнутри', '.craft-card'],
  ['.ds-quote span', 'Финальная фраза · строка {n}', 'span'],

  ['.rs-card__label', 'Карточка {n} · метка', '.rs-panel'],
  ['.rs-card__title', 'Карточка {n} · заголовок', '.rs-panel'],
  ['.rs-card__desc', 'Карточка {n} · текст', '.rs-panel'],

  ['.co .role', 'Компания {n} · роль', '.co'],
  ['.co .desc', 'Компания {n} · описание', '.co'],
  ['.co .award', 'Компания {n} · награды', '.co'],
  ['.brand-marquee .lbl', 'Подпись над брендами'],

  ['.cta-author', 'Надпись справа над заголовком'],
  ['.cta-eyebrow', 'Надпись слева над заголовком'],
  ['.cta-title', 'Заголовок'],
  ['.cta-lead', 'Подзаголовок'],
  ['.cta-mega-name', 'Кнопка {n} · название', '.cta-mega-item'],

  ['.sec-title', 'Заголовок'],
  ['.sec-sub', 'Подзаголовок'],

  ['footer.foot [data-i18n="ft.tag"]', 'Подпись справа в подвале'],
];

const ABOUT = [
  ['.about__hi', 'Приветствие · первое слово'],
  ['.about__name', 'Приветствие · продолжение'],
  ['.about__text p', 'Абзац {n}', 'p'],
  ['.about__contacts-label', 'Заголовок над контактами'],
  ['.about__contact .v', 'Подпись ссылки на резюме'],
];

const PORTFOLIO = [
  ['.page-title', 'Заголовок страницы'],
  ['.page-lead', 'Подзаголовок'],
  ['.case__cta', 'Кнопка на карточке кейса'],
];

const NOTFOUND = [
  ['.eyebrow', 'Надпись над цифрой'],
  ['.nf__text', 'Текст'],
  ['.nf__link', 'Кнопка {n}', '.nf__link'],
  ['footer [data-i18n]', 'Подпись в подвале'],
];

export const PAGE_RULES = {
  'index.html': INDEX, 'about.html': ABOUT, 'portfolio.html': PORTFOLIO, '404.html': NOTFOUND,
};

// Надписи, которые не видны на странице, но читаются программами.
export const ARIA_LABELS = {
  'ab.hi': 'Приветствие целиком — для экранных читалок и поиска',
};

// Поля, которые хранят не текст, а данные в атрибуте. Сейчас это подсказки тем
// менторства: их видно при наведении, а лежат они в data-desc-ru / data-desc-en.
export const ATTR_RULES = {
  'index.html': [
    { sel: '.msat', ru: 'data-desc-ru', en: 'data-desc-en', label: 'Тема {n} · подсказка при наведении', nOf: '.msat' },
  ],
};

export const META_LABELS = {
  'meta.title': ['Заголовок для поиска и превью', 'Название вкладки браузера, строка в выдаче Google и заголовок превью, когда ссылку присылают в мессенджер.'],
  'meta.description': ['Описание для поиска и превью', 'Подпись под ссылкой в поиске и в превью мессенджера. Одно поле — оба места, на русском и английском.'],
};

// Запасное название, когда надпись не подошла ни под одно правило: по типу тега.
// Так новая надпись, добавленная в вёрстку позже, всё равно не покажется кодом.
export function fallbackLabel(tag) {
  if (/^h[1-6]$/.test(tag)) return 'Заголовок';
  if (tag === 'p') return 'Абзац';
  if (tag === 'a' || tag === 'button') return 'Кнопка';
  if (tag === 'li') return 'Пункт списка';
  return 'Надпись';
}

// Номер элемента среди соседей с тем же селектором (с единицы).
function indexAmong($, $el, sel) {
  const $anchor = $el.is(sel) ? $el : $el.closest(sel);
  if (!$anchor.length) return 0;
  const sibs = $anchor.parent().children(sel);
  for (let i = 0; i < sibs.length; i++) if (sibs[i] === $anchor[0]) return i + 1;
  return 0;
}

// Название каждого ключа страницы: { key: label }.
export function labelsFor($, file) {
  const out = {};
  for (const [sel, tpl, nOf, mOf] of PAGE_RULES[file] || []) {
    $(sel).each((_i, el) => {
      const $el = $(el);
      const key = $el.attr('data-i18n');
      if (!key || key in out) return;
      let label = tpl;
      if (nOf) label = label.replace('{n}', String(indexAmong($, $el, nOf) || ''));
      if (mOf) label = label.replace('{m}', String(indexAmong($, $el, mOf) || ''));
      out[key] = label.replace(/\s+·\s*$/, '').trim();
    });
  }
  return out;
}
