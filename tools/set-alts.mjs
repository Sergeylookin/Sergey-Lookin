// set-alts.mjs — give each case-study image a distinct, descriptive alt (was 4× the
// bare project name on every page — bad for screen readers and image SEO).
// Idempotent: sets alt to the mapped value for images whose filename is known.
//   node tools/set-alts.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const ALT = {
  // Руна — славянский ИИ-ассистент, красная палитра
  'runa-1': '«Руна» — фолк-постеры со строками народных песен и модель в кокошнике с рябиной',
  'runa-2': '«Руна» — фирменный буклет бренда в руках на фоне тёмно-зелёных ламелей',
  'runa-3': '«Руна» — коллаж «Гори гори ясно» и «Сказки»: петух-оберег и матрёшка-качалка',
  'runa-4': '«Руна» — красный лукбук: айдентика на карточках и модель в русском уборе',
  'runa-5': '«Руна» — экран App Store приложения-ассистента и матрёшка, символ бренда',
  // Rocket Work — HR-финтех, дизайн-система
  'rocketwork-1': 'Rocket Work — брендбук в Figma: сотни фреймов дизайн-системы',
  'rocketwork-2': 'Rocket Work — соц-карточки бренда: статистика, иллюстрации и иконки',
  'rocketwork-3': 'Rocket Work — мобильное приложение: экраны вакансий и откликов',
  'rocketwork-4': 'Rocket Work — постер «rethinking HR processes» и экраны платформы найма',
  // Fingular — финтех-бренд + дизайн-система + менторство
  'fingular-1': 'Fingular — постеры бренда с 3D-объектами: Design Function, Team Structure, Quality',
  'fingular-2': 'Fingular — сетка тёмных экранов интерфейса финтех-продукта',
  'fingular-3': 'Fingular — крупные бизнес-метрики: рост конверсии, скорости и консистентности',
  'fingular-4': 'Fingular — mindmap процесса: инструменты, Figma, Jira и эффекты для рынка',
  // Chobies — Web3 NFT-персонажи, формат NTO
  'chobies-1': 'Chobies — лендинг NFT-коллекции: персонаж в короне и блок Passive income',
  'chobies-2': 'Chobies — приветственный экран NTO с NFT-персонажами',
  'chobies-3': 'Chobies — тёмные экраны маркетплейса и галереи NFT-персонажей',
  'chobies-4': 'Chobies — страница NFT Token Offering: партнёрская программа и лого-леттеринг',
  // Duft — лайфстайл-бренд табака
  'duft-1': 'Duft — банки табака бренда со светящейся неоновой айдентикой',
  'duft-2': 'Duft — лайфстайл-съёмка: гости бренда за столом в баре',
  'duft-3': 'Duft — коллаж: кальян, вечеринка и продуктовые банки',
  'duft-4': 'Duft — граффити-логотип со звездой и модель в мерче бренда',
  // Squad Gaming — Web3 игровое комьюнити
  'squad-1': 'Squad Gaming — гайд по фирменному стилю: логотип, персонажи, палитра, графика',
  'squad-2': 'Squad Gaming — экран приложения: ставка в аукционе с 3D-персонажем',
  'squad-3': 'Squad Gaming — яркая градиентная 3D-абстракция бренда',
  'squad-4': 'Squad Gaming — экраны приложения: онбординг и гильдии Web3-игр',
  'squad-5': 'Squad Gaming — наружная реклама «Anatomy of colors» с 3D-персонажем',
  // Маркетинг-кит — айдентика в античной эстетике
  'mk-1': 'Маркетинг-кит — билборд «Antique Design» с античными статуями в синей палитре',
  'mk-2': 'Маркетинг-кит — постер «Culture» с античным коллажем в руках',
  'mk-3': 'Маркетинг-кит — постер «Architecture» с барельефом на природе',
  'mk-4': 'Маркетинг-кит — настенная роспись с античными статуями и прохожими',
  // POS Credit — B2B-кредитование
  'poscredit-1': 'POS Credit — презентация: ключевые метрики и логотипы партнёров-ритейлеров',
  'poscredit-2': 'POS Credit — экран приложения с графиком платежа по кредиту',
  'poscredit-3': 'POS Credit — экраны приложения: мои кредиты и оплата кредита',
  'poscredit-4': 'POS Credit — экраны приложения: подтверждение кода и автоплатежи',
  // Heatbit — умный обогреватель с майнингом Bitcoin
  'heatbit-1': 'Heatbit — устройство-обогреватель и слоган «Like others, but pays you»',
  'heatbit-2': 'Heatbit — экран приложения: баланс в BTC и настройки нагрева',
  'heatbit-3': 'Heatbit — блок Safety: устройство в фокусной студийной съёмке',
  'heatbit-4': 'Heatbit — карточки продуктов Canvas и Trio в интерьере',
  'heatbit-5': 'Heatbit — взрыв-схема устройства: все компоненты в разборе',
  // Choise.com — Web3 крипто-платформа
  'choise-1': 'Choise.com — веб-дашборд доходности и 3D-сейф «30% APY in 8 days»',
  'choise-2': 'Choise.com — тёмные экраны приложения: маржинальные счета и доходность',
  'choise-3': 'Choise.com — 3D-композиция с монетами BTC, USDT и токеном CHO',
  'choise-4': 'Choise.com — экраны: сообщество, экосистема и savings-аккаунт крипто-банка',
};

const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const PAGES = Array.from({ length: 10 }, (_, i) => `projects/${String(i + 1).padStart(2, '0')}.html`);

let changed = 0;
for (const page of PAGES) {
  const path = resolve(ROOT, page);
  let html = readFileSync(path, 'utf8');
  const before = html;
  html = html.replace(/<img\b[^>]*?>/g, (tag) => {
    const src = tag.match(/\bsrc="[^"]*assets\/img\/([^"/]+)\.webp"/);
    if (!src || !ALT[src[1]]) return tag;
    const alt = esc(ALT[src[1]]);
    if (/\balt="/.test(tag)) return tag.replace(/\balt="[^"]*"/, `alt="${alt}"`);
    return tag.replace(/<img\b/, `<img alt="${alt}"`);
  });
  if (html !== before) { writeFileSync(path, html); changed++; console.log('updated', page); }
}
console.log(`\n✔ ${changed} pages updated (${Object.keys(ALT).length} images mapped)`);
