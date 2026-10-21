// Extract source-facing UI literals into one auditable translation inventory.
// Run after editing UI: node scripts/extract-ui-text.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { translateUiText } from '../src/common/config/app-config.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'src');
const locations = new Map();
const han = /[\u3400-\u9fff]/;
const ignored = new Set();
async function visit(folder) {
  for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) { if (entry.name !== 'assets') await visit(file); continue; }
    if (!/\.(?:js|html)$/.test(entry.name) || ignored.has(entry.name)) continue;
    const contents = await fs.readFile(file, 'utf8');
    const relative = path.relative(root, file).replaceAll('\\', '/');
    const conversionTableStart = entry.name === 'app-config.js' ? contents.indexOf('const SIMPLIFIED_PHRASES') : -1;
    const conversionTableEnd = conversionTableStart < 0 ? -1 : contents.indexOf('function toSimplified', conversionTableStart);
    const translatorStart = entry.name === 'app-config.js' ? contents.indexOf('export function translateUiText') : -1;
    const translatorEnd = translatorStart < 0 ? -1 : contents.indexOf('let activeLanguage', translatorStart);
    const candidates = entry.name.endsWith('.html')
      ? [...contents.matchAll(/>\s*([^<>]*[\u3400-\u9fff][^<>]*?)\s*</g)].map(match => ({ text: match[1], index: match.index }))
        .concat([...contents.matchAll(/(?:title|aria-label|placeholder|alt)="([^"]*[\u3400-\u9fff][^"]*)"/g)]
          .map(match => ({ text: match[1], index: match.index })))
      : [...contents.matchAll(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g)]
        .map(match => ({ text: match[0].slice(1, -1), index: match.index }));
    for (const candidate of candidates) {
      if (conversionTableStart >= 0 && candidate.index >= conversionTableStart && candidate.index < conversionTableEnd) continue;
      if (translatorStart >= 0 && candidate.index >= translatorStart && candidate.index < translatorEnd) continue;
      const text = candidate.text.trim().replace(/\s+/g, ' ');
      if (!han.test(text) || text.length < 2 || text.length > 240 || /<[^>]+>/.test(text)
        || /^disabled\b/.test(text) || /\.(?:png|jpg|jpeg|webp)$/i.test(text)) continue;
      const line = contents.slice(0, candidate.index).split('\n').length;
      const used = locations.get(text) || new Set();
      used.add(`${relative}:${line}`);
      locations.set(text, used);
    }
  }
}
await visit(source);
const entries = [...locations].sort(([a], [b]) => a.localeCompare(b, 'zh-Hant')).map(([zhHant, used]) => ({
  zhHant,
  zhHans: translateUiText(zhHant, 'zh-Hans'),
  en: translateUiText(zhHant, 'en'),
  dynamic: zhHant.includes('${'),
  englishMissing: translateUiText(zhHant, 'en') === zhHant,
  locations: [...used].sort()
}));
await fs.writeFile(path.join(root, 'src', 'common', 'config', 'ui-text-catalog.json'),
  `${JSON.stringify({ generatedBy: 'node scripts/extract-ui-text.mjs', entries }, null, 2)}\n`);
const staticMissing = entries.filter(entry => entry.englishMissing && !entry.dynamic).length;
const dynamicReview = entries.filter(entry => entry.dynamic && entry.englishMissing).length;
process.stdout.write(`Extracted ${entries.length} UI literals; ${staticMissing} static strings missing English, ${dynamicReview} dynamic templates queued for review.\n`);
