const SHAPES = new Set(['square', 'diamond', 'circle', 'hexagon', 'star', 'triangle']);

function normalizeHistoryMark(mark) {
  if (!mark || !SHAPES.has(mark.shape) || typeof mark.color !== 'string' || !/^#[a-f0-9]{6}$/i.test(mark.color)) return null;
  return {
    shape: mark.shape,
    color: mark.color.toLowerCase(),
    name: String(mark.name || '').trim().replace(/\s+/g, ' ').slice(0, 120)
  };
}

async function readHistoryMarks(journal) {
  const stored = await journal.readRecord('history_marks'), marks = {};
  if (stored?.version !== 1 || !stored.marks || typeof stored.marks !== 'object') return marks;
  for (const [sequence, value] of Object.entries(stored.marks)) {
    if (!/^[1-9]\d*$/.test(sequence) || !Number.isSafeInteger(Number(sequence)) || Number(sequence) > journal.state.lastCommitted || journal.historyPruned.has(Number(sequence))) continue;
    const mark = normalizeHistoryMark(value);
    if (mark) marks[sequence] = mark;
  }
  return marks;
}

async function setHistoryMark(journal, sequence, value, writeJson) {
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw Error('無效的歷史節點');
  await journal.ensureReady();
  await journal.manifest(sequence);
  const mark = value === null ? null : normalizeHistoryMark(value);
  if (value !== null && !mark) throw Error('無效的歷史節點標記');
  const marks = { ...journal.historyMarks };
  if (mark) marks[sequence] = mark; else delete marks[sequence];
  await writeJson(journal.file('history_marks'), { version: 1, marks });
  journal.historyMarks = marks;
  return mark;
}

async function pruneHistoryMarks(journal, removed, writeJson) {
  const marks = { ...journal.historyMarks };
  let changed = false;
  for (const sequence of removed) if (Object.hasOwn(marks, sequence)) {
    delete marks[sequence];
    changed = true;
  }
  if (changed) {
    await writeJson(journal.file('history_marks'), { version: 1, marks });
    journal.historyMarks = marks;
  }
}

module.exports = { readHistoryMarks, setHistoryMark, pruneHistoryMarks };
