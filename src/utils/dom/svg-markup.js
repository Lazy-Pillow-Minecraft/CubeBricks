// Retain SVG controls while their projected coordinates change. Replacing the
// tree each frame also rebuilds browser hit testing and accessibility objects.
const caches = new WeakMap();
const tags = /<[^>]*>|[^<]+/g;
const attributes = /([^\s=]+)="([^"]*)"/g;
const entities = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' };
const decode = value => value.replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (match, entity) => {
  if (entity[0] !== '#') return entities[entity] ?? match;
  const point = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
  return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '\uFFFD';
});

export function syncSvgMarkup(root, markup) {
  const entries = [];
  let topology = '';
  for (const token of markup.match(tags) || []) {
    const opening = /^<([\w:-]+)\b/.exec(token);
    if (!opening) {
      if (token.trim()) topology += token;
      continue;
    }
    const values = [];
    topology += `<${opening[1]}`;
    for (const match of token.matchAll(attributes)) {
      topology += ` ${match[1]}`;
      values.push([match[1], match[2]]);
    }
    topology += token.endsWith('/>') ? '/>' : '>';
    entries.push(values);
  }
  let cache = caches.get(root);
  if (!cache || cache.topology !== topology || (cache.nodes.length
    ? !root.contains(cache.nodes[0]) : root.childElementCount !== 0)) {
    root.innerHTML = markup;
    cache = { topology, nodes: [...root.querySelectorAll('*')], entries };
    caches.set(root, cache);
    return;
  }
  for (let index = 0; index < entries.length; index++) {
    const values = entries[index], previous = cache.entries[index], node = cache.nodes[index];
    for (let attr = 0; attr < values.length; attr++) {
      if (values[attr][1] !== previous[attr][1]) node.setAttribute(values[attr][0], decode(values[attr][1]));
    }
  }
  cache.entries = entries;
}
