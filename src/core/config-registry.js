export const ConfigType = Object.freeze({
  BOOLEAN: 'boolean',
  NUMBER: 'number',
  STRING: 'string',
  ENUM: 'enum',
  OBJECT: 'object'
});

export const ConfigScope = Object.freeze({
  APPLICATION: 'application',
  PROJECT: 'project',
  SESSION: 'session'
});

const VALID_TYPES = new Set(Object.values(ConfigType));
const VALID_SCOPES = new Set(Object.values(ConfigScope));

export class ConfigRegistry {
  constructor({ storage = null, storageKey = 'cubebricks.config' } = {}) {
    this.storage = storage;
    this.storageKey = storageKey;
    this.definitions = new Map();
    this.values = new Map();
    this.listeners = new Map();
    this.globalListeners = new Set();
    this.persistedValues = this.readPersistedValues();
  }

  register(definition) {
    const normalized = this.normalizeDefinition(definition);
    if (this.definitions.has(normalized.id)) {
      throw new Error(`Config "${normalized.id}" is already registered.`);
    }

    this.definitions.set(normalized.id, normalized);
    const persisted = this.persistedValues[normalized.id];
    const initialValue = persisted !== undefined && this.isValidValue(normalized, persisted)
      ? persisted
      : cloneValue(normalized.defaultValue);
    this.values.set(normalized.id, initialValue);
    return normalized;
  }

  registerMany(definitions) {
    return definitions.map(definition => this.register(definition));
  }

  has(id) {
    return this.definitions.has(id);
  }

  get(id) {
    this.assertRegistered(id);
    return cloneValue(this.values.get(id));
  }

  set(id, value, { source = 'runtime' } = {}) {
    this.assertRegistered(id);
    const definition = this.definitions.get(id);
    if (!this.isValidValue(definition, value)) {
      throw new TypeError(`Invalid value for config "${id}": ${JSON.stringify(value)}`);
    }

    const previousValue = this.values.get(id);
    if (isEqual(previousValue, value)) return this.get(id);

    const nextValue = cloneValue(value);
    this.values.set(id, nextValue);
    this.persist();
    this.emit({ id, value: cloneValue(nextValue), previousValue: cloneValue(previousValue), definition, source });
    return cloneValue(nextValue);
  }

  reset(id, options = {}) {
    this.assertRegistered(id);
    return this.set(id, cloneValue(this.definitions.get(id).defaultValue), { source: options.source || 'reset' });
  }

  resetAll() {
    for (const id of this.definitions.keys()) this.reset(id, { source: 'reset-all' });
  }

  getDefinition(id) {
    this.assertRegistered(id);
    return this.definitions.get(id);
  }

  list({ scope } = {}) {
    const entries = [...this.definitions.values()];
    return scope ? entries.filter(definition => definition.scope === scope) : entries;
  }

  subscribe(idOrListener, maybeListener) {
    if (typeof idOrListener === 'function') {
      this.globalListeners.add(idOrListener);
      return () => this.globalListeners.delete(idOrListener);
    }

    this.assertRegistered(idOrListener);
    if (typeof maybeListener !== 'function') throw new TypeError('Config listener must be a function.');
    if (!this.listeners.has(idOrListener)) this.listeners.set(idOrListener, new Set());
    this.listeners.get(idOrListener).add(maybeListener);
    return () => this.listeners.get(idOrListener)?.delete(maybeListener);
  }

  exportValues({ scope } = {}) {
    return Object.fromEntries(this.list({ scope }).map(definition => [definition.id, this.get(definition.id)]));
  }

  importValues(values, { source = 'import' } = {}) {
    const result = { applied: [], rejected: [], unknown: [] };
    for (const [id, value] of Object.entries(values || {})) {
      if (!this.has(id)) { result.unknown.push(id); continue; }
      try { this.set(id, value, { source }); result.applied.push(id); }
      catch { result.rejected.push(id); }
    }
    return result;
  }

  normalizeDefinition(definition) {
    if (!definition || typeof definition !== 'object') throw new TypeError('Config definition must be an object.');
    if (!definition.id || !/^[a-z][a-z0-9]*(\.[a-z][a-z0-9-]*)+$/.test(definition.id)) {
      throw new TypeError('Config id must be a namespaced key such as "application.language".');
    }
    const normalized = Object.freeze({
      type: ConfigType.STRING,
      scope: ConfigScope.APPLICATION,
      description: '',
      options: [],
      validate: null,
      ...definition,
      options: Object.freeze((definition.options || []).map(option => Object.freeze({ ...option })))
    });
    if (!VALID_TYPES.has(normalized.type)) throw new TypeError(`Unknown config type: ${normalized.type}`);
    if (!VALID_SCOPES.has(normalized.scope)) throw new TypeError(`Unknown config scope: ${normalized.scope}`);
    if (!this.isValidValue(normalized, normalized.defaultValue)) {
      throw new TypeError(`Invalid default value for config "${normalized.id}".`);
    }
    return normalized;
  }

  isValidValue(definition, value) {
    const typeValid = {
      [ConfigType.BOOLEAN]: typeof value === 'boolean',
      [ConfigType.NUMBER]: typeof value === 'number' && Number.isFinite(value),
      [ConfigType.STRING]: typeof value === 'string',
      [ConfigType.ENUM]: definition.options.some(option => option.value === value),
      [ConfigType.OBJECT]: value !== null && typeof value === 'object' && !Array.isArray(value)
    }[definition.type];
    return Boolean(typeValid && (!definition.validate || definition.validate(value)));
  }

  assertRegistered(id) {
    if (!this.definitions.has(id)) throw new Error(`Unknown config "${id}".`);
  }

  emit(change) {
    this.listeners.get(change.id)?.forEach(listener => listener(change));
    this.globalListeners.forEach(listener => listener(change));
  }

  readPersistedValues() {
    if (!this.storage) return {};
    try {
      const parsed = JSON.parse(this.storage.getItem(this.storageKey) || '{}');
      return parsed && typeof parsed === 'object' ? parsed.values || {} : {};
    } catch {
      return {};
    }
  }

  persist() {
    if (!this.storage) return;
    const values = this.exportValues({ scope: ConfigScope.APPLICATION });
    try { this.storage.setItem(this.storageKey, JSON.stringify({ version: 1, values })); }
    catch (error) { console.warn('CubeBricks config persistence failed:', error); }
  }
}

function cloneValue(value) {
  if (value === undefined || value === null || typeof value !== 'object') return value;
  return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function isEqual(left, right) {
  return Object.is(left, right) || JSON.stringify(left) === JSON.stringify(right);
}
