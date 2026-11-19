const PAIRS = Object.freeze({ x: ['left', 'right'], y: ['up', 'down'], z: ['front', 'before'] });
const WORDS = /left|right|up|down|front|before/gi;
const letter = value => /^[a-z]$/i.test(value || '');
const upper = value => /^[A-Z]$/.test(value || '');
const lower = value => /^[a-z]$/.test(value || '');

// Delimiters, numbers and camel-case boundaries identify direction words;
// ordinary names such as "group", "backup" and "Bright" are not directions.
function isDirectionPart(name, start, word) {
  const end = start + word.length, before = name[start - 1], after = name[end];
  const begins = !letter(before) || lower(before) && upper(word[0])
    || upper(before) && upper(word[0]) && lower(word[1]);
  const ends = !letter(after) || lower(word.at(-1)) && upper(after)
    || upper(word.at(-1)) && upper(after) && lower(name[end + 1]);
  return begins && ends;
}

function mapDirectionParts(name, replace) {
  return String(name ?? '').replace(WORDS, (word, index, source) =>
    isDirectionPart(source, index, word) ? replace(word) : word);
}

function matchCase(word, replacement) {
  if (word === word.toUpperCase()) return replacement.toUpperCase();
  if (word === word.toLowerCase()) return replacement;
  return [...replacement].map((value, index) => upper(word[Math.min(index, word.length - 1)])
    ? value.toUpperCase() : value).join('');
}

export function flipDirectionalName(name, axis) {
  const pair = PAIRS[axis];
  if (!pair) return String(name ?? '');
  return mapDirectionParts(name, word => {
    const index = pair.indexOf(word.toLowerCase());
    return index < 0 ? word : matchCase(word, pair[1 - index]);
  });
}

export function stripDirectionalNames(name) {
  const marked = mapDirectionParts(name, () => '\0');
  // Remove a direction and its edge separators, retaining one separator when
  // there is still identifier text on both sides. Other name formatting stays.
  return marked.replace(/[_\s.\-]*\0(?:[_\s.\-]*\0)*[_\s.\-]*/g, (match, index, source) =>
    index === 0 || index + match.length === source.length ? '' : match.match(/[_\s.\-]/)?.[0] || '');
}

export function withDirectionPrefix(name, prefix, stripExisting = true) {
  if (!prefix) return String(name ?? '');
  const base = stripExisting ? stripDirectionalNames(name) : String(name ?? '');
  return base ? `${prefix}_${base}` : prefix;
}

// Matches the symmetry evaluator's + / - traversal, with the last axis fastest.
export function axisDirectionPrefix(axes, instanceIndex) {
  const active = ['x', 'y', 'z'].filter(axis => axes?.[axis]);
  return active.map((axis, index) => {
    const negative = Boolean(instanceIndex & (1 << (active.length - index - 1)));
    return axis === 'x' ? negative ? 'left' : 'right'
      : axis === 'y' ? negative ? 'down' : 'up' : negative ? 'before' : 'front';
  }).join('_');
}
