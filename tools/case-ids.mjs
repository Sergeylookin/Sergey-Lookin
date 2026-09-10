// case-ids.mjs — единственный источник списка кейсов для остальных скриптов.
// Раньше число 10 было зашито в четырёх местах, и одиннадцатый кейс просто
// не попадал ни в сборку EN, ни в srcset, ни в карту сайта.

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const caseIds = () =>
  readdirSync(resolve(ROOT, 'projects'))
    .filter((f) => /^\d\d\.html$/.test(f))
    .map((f) => f.slice(0, 2))
    .sort();

export const casePages = () => caseIds().map((n) => `projects/${n}.html`);

// Кейсы, скрытые с сайта (черновик или архив) — по реестру content/cases.json.
// Реестра может не быть (старое состояние проекта) — тогда скрытых нет.
export const hiddenIds = () => {
  try {
    const reg = JSON.parse(readFileSync(resolve(ROOT, "content", "cases.json"), "utf8"));
    return reg.cases.filter((c) => c.status !== "published").map((c) => c.id);
  } catch { return []; }
};
