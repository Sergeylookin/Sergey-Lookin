// set-domain.mjs — makes social-preview metadata work and pins deploy-specific paths.
//
// og:image / twitter:image MUST be absolute URLs: Telegram, X/Twitter, Facebook and
// LinkedIn scrapers do not resolve relative paths, so previews silently never render.
// This can only be done once the public URL is known — hence this script.
//
// Usage (from the project root):
//   node tools/set-domain.mjs https://sergeylookin.github.io/Sergey-Lookin/
//   node tools/set-domain.mjs https://your-custom-domain.com
//
// For every page it:
//   • rewrites og:image / twitter:image to an absolute URL
//   • adds/updates og:url + <link rel="canonical"> (kept in the meta zone, so the
//     build-pages head regeneration never wipes them)
// For 404.html (served by GitHub Pages for any missing path) it also rewrites the
// ROOT-absolute /assets and nav links to include the project sub-path (e.g.
// /Sergey-Lookin/…), which is required when the site lives under a repo sub-path.
// Idempotent — safe to re-run with the same or a different URL.

import { readFileSync, writeFileSync } from 'node:fs';

const raw = process.argv[2] || '';
if (!/^https?:\/\/[a-z0-9.-]+/i.test(raw)) {
  console.error('Usage: node tools/set-domain.mjs https://host[/sub-path]/');
  process.exit(1);
}
const u = new URL(raw);
const origin = u.origin;                                   // https://sergeylookin.github.io
const basePath = u.pathname.replace(/\/+$/, '');           // /Sergey-Lookin  (''=root domain)
const domain = origin + basePath;                          // full base, no trailing slash

const PAGES = [
  'index.html', 'about.html', 'portfolio.html', '404.html',
  ...Array.from({ length: 10 }, (_, i) => `projects/${String(i + 1).padStart(2, '0')}.html`),
];

for (const rel of PAGES) {
  let html;
  try { html = readFileSync(rel, 'utf8'); } catch { console.error('skip (not found):', rel); continue; }
  const before = html;
  const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/') + 1) : '';
  const pageUrl = domain + '/' + (rel === 'index.html' ? '' : rel);

  // Resolve a page-relative asset path ("assets/…" / "../assets/…") to an absolute URL.
  const abs = (p) => {
    if (/^https?:\/\//i.test(p)) return p;
    const path = p.startsWith('../') ? p.replace(/^(\.\.\/)+/, '') : dir + p;
    return domain + '/' + path.replace(/^\/+/, '');
  };

  html = html.replace(/(property="og:image"\s+content=")([^"]+)(")/g, (_, a, p, z) => a + abs(p) + z);
  html = html.replace(/(name="twitter:image"\s+content=")([^"]+)(")/g, (_, a, p, z) => a + abs(p) + z);

  if (rel === '404.html') {
    // Pin root-absolute paths to the deploy sub-path (idempotent: strip an existing
    // basePath prefix first, then re-add). Skips '#…', '//…' and mailto/etc.
    if (basePath) {
      const seg = basePath.slice(1); // Sergey-Lookin
      html = html.replace(/\b(href|src)="\/(?!\/)([^"]*)"/g, (m, attr, rest) => {
        if (rest === seg || rest.startsWith(seg + '/')) rest = rest.slice(seg.length + 1);
        return `${attr}="${basePath}/${rest}"`;
      });
    }
  } else {
    // og:url — update or insert right after og:type / og:title
    if (/property="og:url"/.test(html)) {
      html = html.replace(/(property="og:url"\s+content=")[^"]*(")/, `$1${pageUrl}$2`);
    } else {
      html = html.replace(/(<meta property="og:(?:type|title)"[^>]*\/?>)/, `$1\n<meta property="og:url" content="${pageUrl}" />`);
    }
    // canonical — placed next to og:url (meta zone) so build-pages' head regen won't wipe it
    if (/rel="canonical"/.test(html)) {
      html = html.replace(/(rel="canonical"\s+href=")[^"]*(")/, `$1${pageUrl}$2`);
    } else if (/property="og:url"/.test(html)) {
      html = html.replace(/(<meta property="og:url"[^>]*\/?>)/, `$1\n<link rel="canonical" href="${pageUrl}">`);
    }
  }

  if (html !== before) { writeFileSync(rel, html); console.log('updated ', rel); }
  else console.log('unchanged', rel);
}

// ── sitemap.xml + robots.txt Sitemap line (indexable pages only; 404 is noindex) ──
const indexable = PAGES.filter((p) => p !== '404.html');
const urls = indexable.map((rel) => domain + '/' + (rel === 'index.html' ? '' : rel));
const sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  urls.map((u) => `  <url><loc>${u}</loc></url>`).join('\n') + '\n</urlset>\n';
writeFileSync('sitemap.xml', sitemap);

const smLine = `Sitemap: ${domain}/sitemap.xml`;
let robots = ''; try { robots = readFileSync('robots.txt', 'utf8'); } catch {}
robots = /^Sitemap:.*$/m.test(robots) ? robots.replace(/^Sitemap:.*$/m, smLine) : robots.trimEnd() + '\n\n' + smLine + '\n';
writeFileSync('robots.txt', robots);
console.log('wrote    sitemap.xml + robots.txt Sitemap line');

console.log(`\nDone → base: ${domain || origin + '/'}`);
