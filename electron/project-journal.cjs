const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { packZip, unpackZip } = require('./zip-store.cjs');
const { createTextureDelta, applyTextureDelta } = require('./texture-delta.cjs');

const FORMAT = 'cubebricks-journal';
const VERSION = 1;
const pretty = value => JSON.stringify(value, null, 2);
const comparable = value => JSON.stringify(value);
const digest = value => crypto.createHash('sha256').update(comparable(value)).digest('hex');
function comparableInformation(information) {
  const copy = structuredClone(information);
  if (copy.meta) delete copy.meta.modifiedAt;
  return comparable(copy);
}

async function atomicWrite(filename, bytes) {
  await fs.mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${crypto.randomUUID()}.tmp`;
  const file = await fs.open(temporary, 'wx');
  try {
    await file.writeFile(bytes);
    await file.sync();
  } finally { await file.close(); }
  try { await fs.rename(temporary, filename); }
  catch (error) { await fs.rm(temporary, { force: true }); throw error; }
}
async function writeJson(filename, value) { await atomicWrite(filename, pretty(value)); }
async function readJson(filename, fallback = null) {
  try { return JSON.parse(await fs.readFile(filename, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return fallback; throw error; }
}
function safeId(value) {
  const id = String(value || '');
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new Error(`不安全的要素識別器：${id}`);
  return id;
}
function nodeFolder(node) {
  if (node.type === 'group') return `elements/groups/${safeId(node.uid)}`;
  const category = ({ cube: 'cubes', locator: 'locators' })[node.type] || 'shapes';
  return `elements/geometric/${category}/${safeId(node.uid)}`;
}
function separate(content) {
  const document = typeof content === 'string' ? JSON.parse(content) : structuredClone(content);
  const elements = document.elements || [], groups = document.groups || [], textures = document.textures || [];
  delete document.elements; delete document.groups; delete document.textures;
  return { information: document, elements, groups, textures };
}
function textureId(texture, index) { return safeId(texture.uuid || texture._uid || `texture_${index + 1}`); }
function placementsFor(data) {
  const groups = new Map(data.groups.map(group => [group.uid, group]));
  const placements = {};
  const visit = (uid, parent, index, ancestry = []) => {
    if (placements[uid]) return;
    placements[uid] = { parent, index, path: [...ancestry, uid] };
    const group = groups.get(uid);
    group?.children?.forEach((child, childIndex) => visit(child, uid, childIndex, [...ancestry, uid]));
  };
  (data.information.outliner || []).forEach((uid, index) => visit(uid, null, index));
  return placements;
}
function textureFields(asset) {
  if (!asset) return null;
  return {
    ...asset, source: undefined,
    layers: asset.layers?.map(layer => ({ ...layer, source: undefined })) || null
  };
}
function textureChangeRecord(id, before, after) {
  const beforeLayers = new Map((before?.layers || []).map(layer => [layer.uid, layer]));
  const afterLayers = new Map((after?.layers || []).map(layer => [layer.uid, layer]));
  const layerChanges = {};
  for (const uid of new Set([...beforeLayers.keys(), ...afterLayers.keys()])) {
    const original = beforeLayers.get(uid)?.source || null;
    const result = afterLayers.get(uid)?.source || null;
    if (original !== result) layerChanges[uid] = createTextureDelta(original, result);
  }
  return {
    id, beforeFields: textureFields(before), afterFields: textureFields(after),
    image: createTextureDelta(before?.source || null, after?.source || null), layerChanges
  };
}

class ProjectJournal {
  constructor(directory) {
    this.directory = directory;
    this.state = null;
    this.activeManifest = null;
    this.operationIndexHash = null;
  }
  file(relative) { return path.join(this.directory, ...relative.split('/')); }
  async initialize(content, operationId = 'core.project.create', operationIndex = []) {
    if (await readJson(this.file('current_state'))) return this.load();
    const data = separate(content);
    const placements = placementsFor(data);
    await fs.mkdir(this.directory, { recursive: true });
    const pointers = {};
    const nodeHashes = {};
    for (const node of [...data.groups, ...data.elements]) {
      const folder = nodeFolder(node);
      pointers[node.uid] = { folder, local: 1 };
      nodeHashes[node.uid] = digest(node);
      await writeJson(this.file(`${folder}/1.json`), {
        identifier: node.uid, globalSequence: 1, previousSequence: null,
        operationId, directoryChanged: false, directory: placements[node.uid] || null,
        storageDirectory: folder, deleted: false, state: node
      });
      await writeJson(this.file(`${folder}/local_number`), 1);
    }
    const textureIds = [];
    const textureHashes = {};
    for (const [index, texture] of data.textures.entries()) {
      const id = textureId(texture, index);
      textureIds.push(id);
      textureHashes[id] = digest(texture);
      await writeJson(this.file(`textures/${id}/current`), texture);
    }
    const manifest = {
      format: FORMAT, version: VERSION, sequence: 1, parent: null, operationId,
      operationLabel: '建立項目', timestamp: new Date().toISOString(),
      information: data.information, elementOrder: data.elements.map(node => node.uid),
      groupOrder: data.groups.map(node => node.uid), textureIds, pointers, placements,
      nodeHashes, textureHashes,
      changed: Object.keys(pointers), textureChanges: []
    };
    await writeJson(this.file('transactions/1.json'), manifest);
    this.state = { format: FORMAT, version: VERSION, status: 'complete', sequence: 1,
      lastCommitted: 1, activeHead: 1, previousCommitted: null };
    await writeJson(this.file('index_number'), 1);
    await writeJson(this.file('current_state'), this.state);
    await writeJson(this.file('project_information.json'), data.information);
    await writeJson(this.file('operation_index.json'), operationIndex);
    this.operationIndexHash = digest(operationIndex);
    this.activeManifest = manifest;
    await this.writeNodePointers(manifest);
    return this;
  }
  async load() {
    const state = await readJson(this.file('current_state'));
    const previous = await readJson(this.file('current_state.previous'));
    this.state = state?.format === FORMAT ? state : previous?.format === FORMAT ? previous : null;
    if (!this.state) throw new Error('項目狀態文件損壞，且找不到上一個完成狀態');
    if (this.state.status !== 'complete') {
      this.state.sequence = this.state.lastCommitted;
      this.state.status = 'complete';
      await writeJson(this.file('current_state'), this.state);
    }
    this.activeManifest = await this.manifest(this.state.activeHead);
    this.operationIndexHash = digest(await readJson(this.file('operation_index.json'), []));
    await this.recoverPendingTextures();
    if (this.state.pointerSyncFrom) {
      const previousManifest = await this.manifest(this.state.pointerSyncFrom);
      await this.syncNodePointers(this.activeManifest, previousManifest);
      delete this.state.pointerSyncFrom;
      await writeJson(this.file('current_state'), this.state);
    }
    return this;
  }
  async manifest(sequence) {
    const data = await readJson(this.file(`transactions/${Number(sequence)}.json`));
    if (!data || data.format !== FORMAT) throw new Error(`操作 ${sequence} 的記錄缺失`);
    return data;
  }
  async writeNodePointers(manifest, affectedUids = Object.keys(manifest.pointers), previousManifest = null) {
    for (const uid of affectedUids) {
      const pointer = manifest.pointers[uid];
      if (!pointer) {
        const previous = previousManifest?.pointers?.[uid];
        if (!previous) continue;
        await writeJson(this.file(`${previous.folder}/locator`), {
          identifier: uid, globalSequence: manifest.globalSequence || manifest.sequence, local: null,
          directory: null, storageDirectory: previous.folder, deleted: true
        });
        await writeJson(this.file(`${previous.folder}/branch`), { activeHead: manifest.sequence, local: null, deleted: true });
        continue;
      }
      const previous = previousManifest?.pointers?.[uid];
      if (previous && previous.folder !== pointer.folder) {
        await writeJson(this.file(`${previous.folder}/locator`), {
          identifier: uid, globalSequence: manifest.globalSequence || manifest.sequence, local: null,
          directory: null, storageDirectory: previous.folder, deleted: true
        });
        await writeJson(this.file(`${previous.folder}/branch`), { activeHead: manifest.sequence, local: null, deleted: true });
      }
      const data = { identifier: uid, globalSequence: manifest.globalSequence || manifest.sequence, local: pointer.local,
        directory: manifest.placements?.[uid] || null, storageDirectory: pointer.folder };
      await writeJson(this.file(`${pointer.folder}/locator`), data);
      await writeJson(this.file(`${pointer.folder}/branch`), { activeHead: manifest.sequence, local: pointer.local });
    }
  }
  async syncNodePointers(manifest, previousManifest) {
    const affected = new Set();
    for (const uid of new Set([...Object.keys(previousManifest.pointers), ...Object.keys(manifest.pointers)])) {
      if (comparable(previousManifest.pointers[uid]) !== comparable(manifest.pointers[uid])
        || comparable(previousManifest.placements?.[uid]) !== comparable(manifest.placements?.[uid])) affected.add(uid);
    }
    await this.writeNodePointers(manifest, affected, previousManifest);
  }
  async recoverPendingTextures() {
    let textureFolders = [];
    try { textureFolders = await fs.readdir(this.file('textures'), { withFileTypes: true }); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    for (const entry of textureFolders) {
      if (!entry.isDirectory()) continue;
      const id = entry.name;
      const next = this.file(`textures/${id}/next`);
      const pending = await readJson(next);
      if (!pending) continue;
      const latest = pending.sequence === this.activeManifest.sequence
        && (pending.purpose === 'checkout' || this.activeManifest.textureChanges?.includes(id));
      if (latest && pending.texture) await writeJson(this.file(`textures/${id}/current`), pending.texture);
      else if (latest) await fs.rm(this.file(`textures/${id}/current`), { force: true });
      await fs.rm(next, { force: true });
    }
  }
  async content() {
    const manifest = this.activeManifest;
    const elements = [], groups = [];
    for (const uid of manifest.groupOrder) {
      const pointer = manifest.pointers[uid];
      if (!pointer) continue;
      const record = await readJson(this.file(`${pointer.folder}/${pointer.local}.json`));
      if (!record || record.deleted || record.identifier !== uid) throw new Error(`組快照損壞：${uid}`);
      groups.push(record.state);
    }
    for (const uid of manifest.elementOrder) {
      const pointer = manifest.pointers[uid];
      if (!pointer) continue;
      const record = await readJson(this.file(`${pointer.folder}/${pointer.local}.json`));
      if (!record || record.deleted || record.identifier !== uid) throw new Error(`元素快照損壞：${uid}`);
      elements.push(record.state);
    }
    const textures = [];
    for (const id of manifest.textureIds) {
      const texture = await readJson(this.file(`textures/${id}/current`));
      if (!texture) throw new Error(`貼圖狀態損壞：${id}`);
      textures.push(texture);
    }
    return pretty({ ...manifest.information, elements, groups, textures });
  }
  async commit(content, operationId, operationLabel = operationId, operationIndex = []) {
    if (!/^[a-z][a-z0-9_.-]*$/.test(operationId)) throw new Error('操作 ID 不合法');
    const data = separate(content);
    const placements = placementsFor(data);
    const old = this.activeManifest;
    const nextNodes = [...data.groups, ...data.elements];
    const nextUids = new Set(nextNodes.map(node => node.uid));
    const nodeHashes = Object.fromEntries(nextNodes.map(node => [node.uid, digest(node)]));
    const changed = nextNodes.filter(node => nodeHashes[node.uid] !== old.nodeHashes?.[node.uid]
      || comparable(placements[node.uid]) !== comparable(old.placements?.[node.uid]));
    const removed = Object.keys(old.pointers).filter(uid => !nextUids.has(uid));
    const textureIds = data.textures.map(textureId);
    const textureHashes = Object.fromEntries(data.textures.map((texture, index) => [textureIds[index], digest(texture)]));
    const textureChanges = [];
    for (const [index, texture] of data.textures.entries()) {
      const id = textureIds[index];
      if (textureHashes[id] !== old.textureHashes?.[id]) {
        const previous = old.textureIds.includes(id) ? await readJson(this.file(`textures/${id}/current`)) : null;
        textureChanges.push({ id, before: previous, after: texture });
      }
    }
    for (const id of old.textureIds) {
      if (textureIds.includes(id)) continue;
      textureChanges.push({ id, before: await readJson(this.file(`textures/${id}/current`)), after: null });
    }
    const metadataChanged = comparableInformation(data.information) !== comparableInformation(old.information)
      || comparable(data.elements.map(node => node.uid)) !== comparable(old.elementOrder)
      || comparable(data.groups.map(node => node.uid)) !== comparable(old.groupOrder)
      || comparable(textureIds) !== comparable(old.textureIds);
    if (!changed.length && !removed.length && !textureChanges.length && !metadataChanged) return { changed: false, sequence: old.sequence };
    const sequence = Math.max(Number(await readJson(this.file('index_number'), 1)) || 1, this.state.lastCommitted) + 1;
    const transactional = changed.length + removed.length + textureChanges.length > 1;
    const globalSequence = `${sequence}${transactional ? '_T' : ''}`;
    await writeJson(this.file('index_number'), sequence);
    const pending = { ...this.state, status: 'in_progress', sequence, operationId,
      previousCommitted: this.state.lastCommitted, lastCommitted: this.state.lastCommitted };
    await writeJson(this.file('current_state.previous'), this.state);
    await writeJson(this.file('current_state'), pending);
    const pointers = { ...old.pointers };
    const affected = [];
    for (const node of changed) {
      const folder = nodeFolder(node);
      const previous = pointers[node.uid];
      const local = await this.nextLocalIndex(folder);
      const directoryChanged = Boolean(previous && (previous.folder !== folder
        || comparable(placements[node.uid]) !== comparable(old.placements?.[node.uid])));
      await writeJson(this.file(`${folder}/${local}.json`), {
        identifier: node.uid, globalSequence, previousSequence: old.sequence,
        operationId, directoryChanged, directory: placements[node.uid] || null,
        storageDirectory: folder, deleted: false, state: node
      });
      pointers[node.uid] = { folder, local };
      affected.push(node.uid);
    }
    for (const uid of removed) {
      const previous = pointers[uid], local = await this.nextLocalIndex(previous.folder);
      await writeJson(this.file(`${previous.folder}/${local}.json`), {
        identifier: uid, globalSequence, previousSequence: old.sequence,
        operationId, directoryChanged: true, directory: null,
        storageDirectory: previous.folder, deleted: true, state: null
      });
      delete pointers[uid];
      affected.push(uid);
    }
    for (const change of textureChanges) {
      const { id, before, after } = change;
      await writeJson(this.file(`textures/${id}/next`), { sequence, purpose: 'commit', texture: after });
      const delta = textureChangeRecord(id, before, after);
      await writeJson(this.file(`texture_changes/${sequence}/${id}.json`), delta);
    }
    const manifest = {
      format: FORMAT, version: VERSION, sequence, globalSequence, parent: old.sequence,
      operationId, operationLabel, timestamp: new Date().toISOString(),
      information: data.information, elementOrder: data.elements.map(node => node.uid),
      groupOrder: data.groups.map(node => node.uid), textureIds, pointers, placements,
      nodeHashes, textureHashes,
      changed: affected, textureChanges: textureChanges.map(change => change.id)
    };
    await writeJson(this.file(`transactions/${sequence}.json`), manifest);
    this.state = { format: FORMAT, version: VERSION, status: 'complete', sequence,
      lastCommitted: sequence, activeHead: sequence, previousCommitted: old.sequence,
      pointerSyncFrom: old.sequence };
    await writeJson(this.file('current_state'), this.state);
    this.activeManifest = manifest;
    for (const { id } of textureChanges) {
      const next = await readJson(this.file(`textures/${id}/next`));
      if (next.texture) await writeJson(this.file(`textures/${id}/current`), next.texture);
      else await fs.rm(this.file(`textures/${id}/current`), { force: true });
      await fs.rm(this.file(`textures/${id}/next`), { force: true });
    }
    await writeJson(this.file('project_information.json'), data.information);
    if (operationIndex.length) {
      const indexHash = digest(operationIndex);
      if (indexHash !== this.operationIndexHash) {
        await writeJson(this.file('operation_index.json'), operationIndex);
        this.operationIndexHash = indexHash;
      }
    }
    await this.writeNodePointers(manifest, affected, old);
    delete this.state.pointerSyncFrom;
    await writeJson(this.file('current_state'), this.state);
    return { changed: true, sequence, globalSequence };
  }
  async nextLocalIndex(folder) {
    const file = this.file(`${folder}/local_number`);
    const cached = Number(await readJson(file, 0)) || 0;
    let maximum = cached;
    if (!cached) {
      try {
        for (const name of await fs.readdir(this.file(folder))) {
          const match = /^(\d+)\.json$/.exec(name);
          if (match) maximum = Math.max(maximum, Number(match[1]));
        }
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    await writeJson(file, maximum + 1);
    return maximum + 1;
  }
  async checkout(targetSequence) {
    const target = await this.manifest(targetSequence);
    if (target.sequence === this.activeManifest.sequence) return this.content();
    const previousManifest = this.activeManifest;
    // Texture patches carry both old and new pixels, so navigating a branch
    // never needs to recompute from the original image.
    const currentAncestors = new Set();
    for (let cursor = this.activeManifest; cursor; cursor = cursor.parent ? await this.manifest(cursor.parent) : null) currentAncestors.add(cursor.sequence);
    const forward = [];
    let common = target;
    while (!currentAncestors.has(common.sequence)) {
      forward.unshift(common);
      common = common.parent ? await this.manifest(common.parent) : null;
      if (!common) throw new Error('操作分支沒有共同祖先');
    }
    const textureStates = new Map();
    for (let cursor = this.activeManifest; cursor.sequence !== common.sequence; cursor = await this.manifest(cursor.parent)) await this.applyTextureChange(cursor, 'before', textureStates);
    for (const manifest of forward) await this.applyTextureChange(manifest, 'after', textureStates);
    await writeJson(this.file('current_state.previous'), this.state);
    await writeJson(this.file('current_state'), { ...this.state, status: 'checking_out', targetHead: target.sequence });
    for (const [id, texture] of textureStates) await writeJson(this.file(`textures/${id}/next`), {
      sequence: target.sequence, purpose: 'checkout', texture
    });
    this.state = { ...this.state, activeHead: target.sequence, status: 'complete',
      pointerSyncFrom: this.activeManifest.sequence };
    await writeJson(this.file('current_state'), this.state);
    for (const [id, texture] of textureStates) {
      if (texture) await writeJson(this.file(`textures/${id}/current`), texture);
      else await fs.rm(this.file(`textures/${id}/current`), { force: true });
      await fs.rm(this.file(`textures/${id}/next`), { force: true });
    }
    this.activeManifest = target;
    await writeJson(this.file('project_information.json'), target.information);
    await this.syncNodePointers(target, previousManifest);
    delete this.state.pointerSyncFrom;
    await writeJson(this.file('current_state'), this.state);
    return this.content();
  }
  async navigate(direction) {
    if (direction === 'undo') {
      if (!this.activeManifest.parent) return null;
      return { sequence: this.activeManifest.parent, content: await this.checkout(this.activeManifest.parent) };
    }
    if (direction === 'redo') {
      const maximum = Number(await readJson(this.file('index_number'), this.state.lastCommitted)) || this.state.lastCommitted;
      for (let sequence = maximum; sequence > this.activeManifest.sequence; sequence--) {
        const child = await readJson(this.file(`transactions/${sequence}.json`));
        if (child?.parent === this.activeManifest.sequence && sequence <= this.state.lastCommitted) {
          return { sequence, content: await this.checkout(sequence) };
        }
      }
      return null;
    }
    throw new Error('未知的操作樹方向');
  }
  async applyTextureChange(manifest, direction, textureStates) {
    for (const id of manifest.textureChanges || []) {
      const delta = await readJson(this.file(`texture_changes/${manifest.sequence}/${id}.json`));
      if (!delta) throw new Error(`貼圖差異缺失：${manifest.sequence}/${id}`);
      const current = textureStates.has(id) ? textureStates.get(id) : await readJson(this.file(`textures/${id}/current`));
      const fields = direction === 'before' ? delta.beforeFields : delta.afterFields;
      if (!fields) { textureStates.set(id, null); continue; }
      const source = applyTextureDelta(current?.source, delta.image, direction);
      const currentLayers = new Map((current?.layers || []).map(layer => [layer.uid, layer]));
      const layers = fields.layers?.map(layer => {
        const patch = delta.layerChanges?.[layer.uid];
        return { ...layer, source: patch
          ? applyTextureDelta(currentLayers.get(layer.uid)?.source || null, patch, direction)
          : currentLayers.get(layer.uid)?.source || null };
      }) || null;
      textureStates.set(id, { ...fields, source, layers });
    }
  }
  async archive(filePath) {
    const files = [];
    const visit = async directory => {
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) await visit(absolute);
        else if (entry.isFile() && !entry.name.endsWith('.tmp')) files.push([path.relative(this.directory, absolute).replace(/\\/g, '/'), await fs.readFile(absolute)]);
      }
    };
    await visit(this.directory);
    await atomicWrite(filePath, packZip(files));
    await writeJson(this.file('saved_state'), { sequence: this.activeManifest.sequence, filePath, savedAt: new Date().toISOString() });
  }
  static async fromArchive(bytes, directory) {
    const entries = unpackZip(bytes);
    if (!entries.has('current_state')) throw new Error('不是展開式 CubeBricks 項目');
    for (const [name, value] of entries) {
      if (name.startsWith('/') || name.split('/').includes('..')) throw new Error('不安全的項目路徑');
      await atomicWrite(path.join(directory, ...name.split('/')), value);
    }
    return new ProjectJournal(directory).load();
  }
}

module.exports = { ProjectJournal, atomicWrite, readJson, separate };
