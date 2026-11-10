const fs = require('node:fs/promises');

async function historyRoute(journal, source, target) {
  const backward = [], forward = [];
  let current = source, destination = target;
  const parent = async record => {
    if (record.parent === null) return null;
    if (!Number.isInteger(record.parent) || record.parent < 1 || record.parent >= record.sequence) throw Error('歷史父節點無效或形成循環');
    return journal.manifest(record.parent);
  };
  while (current?.sequence !== destination?.sequence) {
    if (current && (!destination || current.sequence > destination.sequence)) {
      backward.push(current);
      current = await parent(current);
    } else {
      forward.push(destination);
      destination = await parent(destination);
    }
  }
  forward.reverse();
  return { backward, forward, shared: Boolean(current) };
}

async function readHistoryTextureRoot(journal, root) {
  const checkpoint = await journal.readRecord(`history_roots/${root.sequence}.json`);
  if (!checkpoint || checkpoint.sequence !== root.sequence || !Array.isArray(checkpoint.textures)) throw Error(`歷史貼圖基準缺失：${root.sequence}`);
  const states = new Map();
  for (const { id, hash } of checkpoint.textures) {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw Error(`歷史貼圖基準損壞：${root.sequence}`);
    const texture = await journal.readRecord(`history_textures/${hash}.json`);
    if (!texture) throw Error(`歷史貼圖基準缺失：${id}`);
    states.set(id, texture);
  }
  return states;
}

async function texturesAtHistoryNode(journal, target, textureDigest) {
  const cached = journal.recentContents.get(target.sequence);
  if (cached) return JSON.parse(cached).textures;
  const parent = target.parent === null ? null : await journal.manifest(target.parent);
  const parentCheckpoint = parent && await journal.readRecord(`history_roots/${parent.sequence}.json`);
  let states;
  if (parentCheckpoint) {
    // Sliding a full history window normally advances a root by one step.
    // Apply that one delta rather than replaying backward from the live head.
    states = await readHistoryTextureRoot(journal, parent);
    await journal.applyTextureChange(target, 'after', states);
  } else {
    const route = await historyRoute(journal, journal.activeManifest, target);
    if (route.shared) {
      states = new Map();
      for (const id of journal.activeManifest.textureIds) states.set(id, await journal.readRecord(`textures/${id}/current`));
      for (const record of route.backward) await journal.applyTextureChange(record, 'before', states);
      for (const record of route.forward) await journal.applyTextureChange(record, 'after', states);
    } else {
      states = await readHistoryTextureRoot(journal, route.forward[0]);
      for (const record of route.forward.slice(1)) await journal.applyTextureChange(record, 'after', states);
    }
  }
  return target.textureIds.map(id => {
    const texture = states.get(id);
    if (!texture || target.textureHashVersion === 2 && textureDigest(texture) !== target.textureHashes[id]) throw Error(`貼圖還原校驗失敗：${id}`);
    return texture;
  });
}

async function writeHistoryTextureRoot(journal, root, { writeJson, textureDigest }) {
  // Only surviving roots need a baseline. Content-addressed texture states are
  // shared between roots, and swept when no root references them anymore.
  if (await journal.readRecord(`history_roots/${root.sequence}.json`)) return;
  const textures = await texturesAtHistoryNode(journal, root, textureDigest), references = [];
  for (let index = 0; index < root.textureIds.length; index++) {
    const texture = textures[index], id = root.textureIds[index], hash = textureDigest(texture);
    const file = journal.file(`history_textures/${hash}.json`);
    try { await fs.access(file); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await writeJson(file, texture);
    }
    references.push({ id, hash });
  }
  await writeJson(journal.file(`history_roots/${root.sequence}.json`), { sequence: root.sequence, textures: references });
}

async function sweepHistoryTextureRoots(journal, roots) {
  const live = new Set();
  for (const sequence of roots) {
    const checkpoint = await journal.readRecord(`history_roots/${sequence}.json`);
    for (const entry of checkpoint?.textures || []) live.add(entry.hash);
  }
  const names = async directory => fs.readdir(journal.file(directory)).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  for (const name of await names('history_roots')) if (/^\d+\.json$/.test(name) && !roots.has(Number(name.slice(0, -5)))) await fs.rm(journal.file(`history_roots/${name}`), { force: true });
  for (const name of await names('history_textures')) if (/^[a-f0-9]{64}\.json$/.test(name) && !live.has(name.slice(0, -5))) await fs.rm(journal.file(`history_textures/${name}`), { force: true });
}

module.exports = { historyRoute, readHistoryTextureRoot, writeHistoryTextureRoot, sweepHistoryTextureRoots };
