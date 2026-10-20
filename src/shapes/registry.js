import { operationDefinition, registerOperation } from '../core/operation-registry.js';

const definitions = new Map();

export const shapeRegistry = Object.freeze({
  register(definition, { external = false, pack = null } = {}) {
    if (!definition || !/^[a-z][a-z0-9_.-]{1,63}$/i.test(definition.id)
      || typeof definition.label !== 'string' || !definition.label.trim()
      || typeof definition.generate !== 'function') throw new Error('Shape 定義需要 id、label 和 generate');
    if (definitions.has(definition.id)) throw new Error(`Shape ID 已存在：${definition.id}`);
    if (definition.fields && (!Array.isArray(definition.fields) || definition.fields.some(field =>
      !/^[a-z][a-z0-9_]{0,63}$/i.test(field.key) || typeof field.label !== 'string'))) {
      throw new Error(`Shape ${definition.id} 的 fields 不合法`);
    }
    if (external) for (const field of definition.fields || []) {
      const operationId = `shape.${definition.id}.parameter.${field.key.toLowerCase()}`;
      if (!operationDefinition(operationId)) registerOperation(operationId, `修改${definition.label}：${field.label}`);
    }
    const entry = Object.freeze({ ...definition, defaults: structuredClone(definition.defaults || {}), external, pack });
    definitions.set(entry.id, entry);
    return entry;
  },
  get(id) { return definitions.get(id) || null; },
  has(id) { return definitions.has(id); },
  list() { return [...definitions.values()]; },
  removeExternal() {
    for (const [id, definition] of definitions) if (definition.external) definitions.delete(id);
  }
});
