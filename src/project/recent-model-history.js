import { textureSnapshot } from './texture-snapshot.js';
import { historyImageFingerprint, knownDifferentHistoryImages } from './history-fingerprint.js';
import { warmTextureSources } from '../utils/image/raster-cache.js';

function sameValue(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && sameValue(a[key], b[key]));
}

// Share immutable nodes, layer records and PNG strings between nearby states.
// Editable model constructors only ever receive a clone of this tree.
function share(value, previous) {
  if (sameValue(value, previous)) return previous;
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    const byUid = new Map((Array.isArray(previous) ? previous : []).filter(item => item?.uid || item?.uuid)
      .map(item => [item.uid || item.uuid, item]));
    return value.map((item, index) => share(item, byUid.get(item?.uid || item?.uuid) ?? previous?.[index]));
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, share(item, previous?.[key])]));
}

function comparable(data) {
  const { historyLimit, ...rest } = data;
  if (rest.meta) {
    rest.meta = { ...rest.meta };
    delete rest.meta.modifiedAt;
  }
  return rest;
}

function knownPixelChange(before, after) {
  const old = new Map((before.textures || []).map(texture => [texture.uuid, texture]));
  return (after.textures || []).some(texture => {
    const prior = old.get(texture.uuid);
    if (!prior || texture === prior) return false;
    if (knownDifferentHistoryImages(prior.source, texture.source)) return true;
    const layers = new Map((prior.layers || []).map(layer => [layer.uid, layer.source]));
    return texture.layers?.some(layer => knownDifferentHistoryImages(layers.get(layer.uid), layer.source));
  });
}

export function historySnapshot(text, assets, groups, shareModel = false) {
  const data = typeof text === 'string' ? JSON.parse(text) : shareModel ? { ...text } : structuredClone(text);
  if (assets !== undefined && assets !== null) {
    data.textures = assets.map((asset, index) => textureSnapshot(asset, index, data.textureSize));
    data.textureGroups = structuredClone(groups || []);
  }
  return data;
}

// This is a bounded visual cache, not another durable history. Pixel equality
// uses the same lossless RGBA semantics as the journal (not PNG encoding bytes).
export class RecentModelHistory {
  constructor(text, assets, { byteLimit = 64 * 1024 * 1024, countLimit = 9, fingerprint = historyImageFingerprint, groups } = {}) {
    this.byteLimit = byteLimit;
    this.countLimit = countLimit;
    this.fingerprint = fingerprint;
    this.canonicalTextures = new WeakMap();
    this.generation = 0;
    this.reset(text, assets, groups);
  }
  reset(text, assets, groups) {
    this.generation++;
    this.pendingNavigation = null;
    this.references = new Map();
    this.bytes = 0;
    this.modelText = this.modelData = null;
    this.entries = text && this.countLimit ? [this.entry(this.capture(text, assets, groups))] : [];
    for (const entry of this.entries) this.account(entry.data, 1);
    this.cursor = this.entries.length - 1;
    this.trim();
  }
  capture(text, assets, groups) {
    if (typeof text !== 'string' || assets == null) return historySnapshot(text, assets, groups);
    if (this.modelText !== text) {
      this.modelText = text;
      this.modelData = JSON.parse(text);
    }
    return historySnapshot(this.modelData, assets, groups, true);
  }
  textureKey(texture) {
    if (this.canonicalTextures.has(texture)) return this.canonicalTextures.get(texture);
    const source = this.fingerprint(texture.source);
    const layers = texture.layers?.map(layer => {
      if (!Object.hasOwn(layer, 'source')) return layer;
      const key = this.fingerprint(layer.source);
      return key instanceof Promise ? key.then(source => ({ ...layer, source })) : { ...layer, source: key };
    });
    const pending = source instanceof Promise || layers?.some(layer => layer instanceof Promise);
    const key = pending ? Promise.all([source, Promise.all(layers || [])]).then(([source, layers]) =>
      ({ ...texture, source, ...(texture.layers ? { layers } : {}) }))
      : { ...texture, source, ...(texture.layers ? { layers } : {}) };
    this.canonicalTextures.set(texture, key);
    if (key instanceof Promise) void key.then(value => this.canonicalTextures.set(texture, value), () => {});
    return key;
  }
  entry(data, previous) {
    data = share(data, previous?.data);
    if (data.textures !== previous?.data.textures) warmTextureSources(data.textures);
    const entry = { data, key: null, ready: null, valid: true };
    // Blob URLs are converted by the file serializer. Until that conversion is
    // known, use durable checkout rather than compare a URL against PNG bytes.
    if (data.textures?.some(texture => [texture, ...(texture.layers || [])].some(image => image.source?.startsWith('blob:')))) {
      entry.valid = false;
      return entry;
    }
    const textures = data.textures?.map(texture => this.textureKey(texture));
    const finish = textures => {
      entry.key = comparable({ ...data, ...(data.textures ? { textures } : {}) });
      entry.ready = null;
    };
    if (textures?.some(texture => texture instanceof Promise)) {
      entry.ready = Promise.all(textures).then(finish, () => { entry.ready = null; });
    } else finish(textures);
    return entry;
  }
  // Add or release only newly referenced subtrees. Walking the whole model
  // on each brush stroke defeated sharing even when its geometry was fixed.
  account(value, delta) {
    if (value == null) return;
    if (typeof value !== 'object' && typeof value !== 'string') {
      this.bytes += delta * 8;
      return;
    }
    const references = this.references.get(value) || 0;
    if (references + delta > 0) this.references.set(value, references + delta);
    else this.references.delete(value);
    if (delta > 0 && references > 0 || delta < 0 && references > 1) return;
    if (typeof value === 'string') {
      this.bytes += delta * value.length * (value.startsWith('data:image/') ? 1 : 2);
      return;
    }
    this.bytes += delta * 24;
    for (const [key, item] of Object.entries(value)) {
      this.bytes += delta * (key.length * 2 + 8);
      this.account(item, delta);
    }
  }
  trim() {
    while (this.entries.length && (this.entries.length > this.countLimit || this.bytes > this.byteLimit)) {
      if (this.cursor > 0) {
        this.account(this.entries.shift().data, -1);
        this.cursor--;
      }
      else this.account(this.entries.pop().data, -1);
    }
    if (!this.entries.length) this.cursor = -1;
  }
  push(text, assets, operationId, groups, { ordinal = null, canKeepForkParent = () => false } = {}) {
    if (!this.countLimit) {
      this.reset(null, null);
      return;
    }
    const previous = this.entries[this.cursor], next = this.entry(this.capture(text, assets, groups), previous);
    if (previous && sameValue(comparable(previous.data), comparable(next.data))) return previous;
    next.ordinal = ordinal;
    next.provenNew = previous && (knownPixelChange(previous.data, next.data)
      || previous.key && next.key && !sameValue(previous.key, next.key));
    // Retention can remove a fork's former parent. Keep a conservative window
    // until its first new edge is durably confirmed rather than guessing.
    if (this.cursor < this.entries.length - 1) {
      let start = this.cursor + 1;
      while (start > 0 && canKeepForkParent(this.entries[start - 1])) start--;
      this.entries.splice(this.cursor + 1).forEach(entry => this.account(entry.data, -1));
      this.entries.splice(0, start).forEach(entry => this.account(entry.data, -1));
      this.cursor = this.entries.length - 1;
    }
    this.entries.push(next);
    this.account(next.data, 1);
    this.cursor++;
    this.trim();
    return next;
  }
  navigate(direction, { textureOnlyData = false } = {}) {
    const generation = this.generation;
    const navigate = () => {
      if (generation !== this.generation) return null;
      const step = direction === 'undo' ? -1 : 1, previous = this.entries[this.cursor];
      if (!previous) return null;
      let next = this.cursor + step;
      const find = () => {
        if (generation !== this.generation) return null;
        const target = this.entries[next];
        if (!target || !previous.valid || !target.valid) return null;
        const pixelChange = knownPixelChange(previous.data, target.data);
        if (!pixelChange && (previous.ready || target.ready)) return Promise.all([previous.ready, target.ready]).then(() => {
          previous.ready = target.ready = null;
          return find();
        });
        if (!pixelChange && (!previous.key || !target.key)) return null;
        // Re-encoding an unchanged PNG is not an undoable journal transaction.
        if (!pixelChange && sameValue(previous.key, target.key)) {
          next += step;
          return find();
        }
        const model = data => {
          const { textures, textureGroups, ...rest } = data;
          return comparable(rest);
        };
        const modelChanged = !sameValue(model(previous.data), model(target.data));
        let changedUids = [];
        if (modelChanged) {
          const before = new Map([...(previous.data.groups || []), ...(previous.data.elements || [])].map(node => [node.uid, node]));
          const after = new Map([...(target.data.groups || []), ...(target.data.elements || [])].map(node => [node.uid, node]));
          changedUids = [...new Set([...before.keys(), ...after.keys()])].filter(uid => !sameValue(before.get(uid), after.get(uid)));
        }
        const layout = data => data.textures?.map(texture => ['uuid', 'id', 'name', 'mode', 'uv_width', 'uv_height'].map(key => texture[key]));
        const oldTextures = new Map((previous.data.textures || []).map(texture => [texture.uuid, texture]));
        const changedTextureUids = (target.data.textures || []).filter(texture => !sameValue(texture, oldTextures.get(texture.uuid)))
          .map(texture => texture.uuid);
        this.cursor = next;
        const { textures, textureGroups } = target.data;
        return {
          data: structuredClone(!modelChanged && textureOnlyData ? { textures, textureGroups } : target.data), changedUids, changedTextureUids,
          textureChanged: pixelChange || !sameValue(previous.key.textures, target.key.textures) || !sameValue(previous.key.textureGroups, target.key.textureGroups),
          modelChanged, geometryChanged: modelChanged || !sameValue(layout(previous.data), layout(target.data)),
          matches: data => {
            if (sameValue(comparable(target.data), comparable(data))) return true;
            const actual = this.entry(data);
            return actual.ready || target.ready
              ? Promise.all([actual.ready, target.ready]).then(() => Boolean(actual.key && target.key && sameValue(target.key, actual.key)))
              : Boolean(actual.key && target.key && sameValue(target.key, actual.key));
          }
        };
      };
      return find();
    };
    const result = this.pendingNavigation ? this.pendingNavigation.then(navigate) : navigate();
    if (result instanceof Promise) {
      const pending = result.finally(() => { if (this.pendingNavigation === pending) this.pendingNavigation = null; });
      this.pendingNavigation = pending;
      return pending;
    }
    return result;
  }
  seedCheckout(before, after, direction) {
    this.reset(null, null);
    this.entries = direction === 'undo' ? [this.entry(after), this.entry(before)] : [this.entry(before), this.entry(after)];
    for (const entry of this.entries) this.account(entry.data, 1);
    this.cursor = direction === 'undo' ? 0 : 1;
    this.trim();
  }
}
