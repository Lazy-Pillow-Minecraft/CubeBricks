const fs = require('node:fs/promises');
const { writeHistoryTextureRoot, sweepHistoryTextureRoots } = require('./journal-history-storage.cjs');
const { pruneHistoryMarks } = require('./history-marks.cjs');

async function historyRecords(journal) {
  await journal.ensureReady();
  const pendingNames = [...(journal.historyImport?.remaining || [])];
  const names = new Set((await fs.readdir(journal.file('transactions'))).filter(name => /^\d+\.json$/.test(name)));
  for (const name of pendingNames) if (/^transactions\/\d+\.json$/.test(name)) names.add(name.split('/')[1]);
  const sequences = [...names].map(name => Number(name.slice(0, -5)))
    .filter(sequence => sequence <= journal.state.lastCommitted && !journal.historyPruned.has(sequence)).sort((a, b) => a - b);
  const records = [];
  for (let index = 0; index < sequences.length; index += 16)records.push(...await Promise.all(sequences.slice(index, index + 16).map(sequence => journal.manifest(sequence))));
  return records;
}

function historyGraph(journal, records) {
  return {
    current: journal.state.activeHead, nodes: records.map(record => ({
      sequence: record.sequence, parent: record.parent, detached: record.historyParent != null, operationId: record.operationId,
      label: record.operationLabel || record.operationId, timestamp: record.timestamp || '', mark: journal.historyMarks[record.sequence] || null
    }))
  };
}

function retainedHistoryForest(records, active, capacity) {
  const latest = [...records].sort((a, b) => b.sequence - a.sequence).slice(0, capacity);
  if (!latest.some(record => record.sequence === active)) {
    const current = records.find(record => record.sequence === active);
    if (!current) throw Error('目前歷史節點已不存在');
    latest[latest.length - 1] = current;
  }
  return new Map(latest.map(record => [record.sequence, record]));
}

async function removeHistoryNodes(journal, records, removed, helpers) {
  const { writeJson, readJson } = helpers;
  const remaining = records.filter(record => !removed.has(record.sequence));
  if (!remaining.length) throw Error('至少需要保留一個歷史狀態');
  const keep = new Map(remaining.map(record => [record.sequence, record]));
  const roots = remaining.filter(record => !keep.has(record.parent));
  const liveSnapshots = new Set(remaining.flatMap(record => Object.values(record.pointers || {}).map(pointer => `${pointer.folder}/${pointer.local}.json`)));
  // Only removed manifests can release a reference. Do not stat every live
  // Cube or recursively scan the entire project after each capped commit.
  // Checkout still validates the exact snapshots it restores.
  const obsoleteSnapshots = new Set(records.filter(record => removed.has(record.sequence))
    .flatMap(record => [...Object.values(record.pointers || {}), ...(record.writtenSnapshots || [])])
    .map(pointer => `${pointer.folder}/${pointer.local}.json`).filter(file => !liveSnapshots.has(file)));
  // Materialize every new root before severing its old parent. This is a
  // read-only reconstruction; it never changes the visible/current model.
  for (const root of roots) await writeHistoryTextureRoot(journal, root, helpers);
  const saved = await readJson(journal.file('saved_state'));
  if (saved && removed.has(saved.sequence)) {
    let ancestor = journal.activeManifest, isAncestor = false;
    const visited = new Set();
    while (ancestor) {
      if (visited.has(ancestor.sequence)) throw Error('歷史父節點形成循環');
      visited.add(ancestor.sequence);
      if (ancestor.sequence === saved.sequence) {
        isAncestor = true;
        break;
      }
      if (ancestor.parent !== null && (!Number.isInteger(ancestor.parent) || ancestor.parent < 1 || ancestor.parent >= ancestor.sequence)) throw Error('歷史父節點無效');
      ancestor = ancestor.parent === null ? null : await journal.manifest(ancestor.parent);
    }
    await writeJson(journal.file('saved_state'), { ...saved, prunedAncestor: isAncestor });
  }
  const changed = removed.has(journal.state.activeHead);
  let content = null;
  if (changed) {
    const deleted = records.find(record => record.sequence === journal.state.activeHead);
    const previous = remaining.filter(record => record.sequence < deleted.sequence).at(-1);
    const target = keep.get(deleted.parent) || previous || remaining[0];
    content = await journal.checkout(target.sequence, { redoHeads: [] });
  }
  const rewrittenRoots = roots.filter(root => root.parent !== null || (root.textureChanges || []).length)
    .map(root => ({ ...root, parent: null, historyParent: root.parent ?? root.historyParent, textureChanges: [] }));
  journal.state = {
    ...journal.state, redoHeads: (journal.state.redoHeads || []).filter(id => !removed.has(id)),
    previousCommitted: removed.has(journal.state.previousCommitted) ? null : journal.state.previousCommitted
  };
  await writeJson(journal.file('current_state.previous'), journal.state);
  await writeJson(journal.file('current_state'), journal.state);
  // The durable index is authoritative even if a crash interrupts cleanup.
  const pruned = new Set([...journal.historyPruned, ...removed]);
  await writeJson(journal.file('history_pruned'), [...pruned].sort((a, b) => a - b));
  journal.historyPruned = pruned;
  for (const root of rewrittenRoots) if (journal.activeManifest.sequence === root.sequence) journal.activeManifest = root;
  for (const id of removed) journal.recentContents.delete(id);
  let cleanupWarning = null;
  try {
    await pruneHistoryMarks(journal, removed, writeJson);
    for (const root of rewrittenRoots) await writeJson(journal.file(`transactions/${root.sequence}.json`), root);
    for (const id of removed) await fs.rm(journal.file(`transactions/${id}.json`), { force: true });
    const rootIds = new Set(roots.map(root => root.sequence));
    for (const sequence of new Set([...removed, ...rootIds])) await fs.rm(journal.file(`texture_changes/${sequence}`), { recursive: true, force: true });
    const snapshots = [...obsoleteSnapshots];
    for (let index = 0; index < snapshots.length; index += 32)await Promise.all(snapshots.slice(index, index + 32).map(file => fs.rm(journal.file(file), { force: true })));
    await sweepHistoryTextureRoots(journal, rootIds);
  } catch (error) { cleanupWarning = error.message; }
  return {
    sequence: journal.state.activeHead, removed: [...removed], content, cleanupWarning,
    changedUids: changed ? journal.lastCheckoutChangedUids : [], textureChanged: changed && journal.lastCheckoutTextureChanged,
    retained: remaining.length, baseline: roots[0].sequence, baselines: roots.map(root => root.sequence)
  };
}

async function pruneHistoryBranch(journal, sequence, helpers, single = false) {
  if (!Number.isInteger(sequence) || sequence < 1) throw Error('無效的歷史節點');
  await journal.finishHistoryImport();
  const records = await historyRecords(journal);
  if (!records.some(record => record.sequence === sequence)) throw Error('歷史節點已不存在');
  const removed = new Set([sequence]);
  if (!single) {
    const children = new Map();
    for (const record of records) {
      const list = children.get(record.parent) || [];
      list.push(record.sequence);
      children.set(record.parent, list);
    }
    const pending = [sequence];
    while (pending.length) for (const child of children.get(pending.pop()) || []) if (!removed.has(child)) {
      removed.add(child);
      pending.push(child);
    }
  }
  return removeHistoryNodes(journal, records, removed, helpers);
}

async function compactHistory(journal, limit, helpers) {
  if (journal.historyImport?.remaining.size) return { changed: false, deferred: true };
  if (!Number.isInteger(limit) || limit < 0 || limit > 10000) throw Error('歷史上限必須是 0–10000 筆操作');
  await journal.ensureReady();
  const names = await fs.readdir(journal.file('transactions'));
  if (names.filter(name => /^\d+\.json$/.test(name)).length <= limit + 1) return { changed: false };
  const records = await historyRecords(journal);
  const keep = retainedHistoryForest(records, journal.state.activeHead, limit + 1);
  const removed = new Set(records.filter(record => !keep.has(record.sequence)).map(record => record.sequence));
  if (!removed.size) return { changed: false, retained: records.length };
  const result = await removeHistoryNodes(journal, records, removed, helpers);
  if (result.cleanupWarning) throw Error(result.cleanupWarning);
  return { changed: true, retained: result.retained, baseline: result.baseline, baselines: result.baselines };
}

module.exports = { historyRecords, historyGraph, pruneHistoryBranch, compactHistory, retainedHistoryForest };
