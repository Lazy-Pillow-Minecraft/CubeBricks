function freezeDefinition(definition) {
  return Object.freeze({
    ...definition,
    aliases: Object.freeze([...(definition.aliases || [])]),
    defaults: Object.freeze(structuredClone(definition.defaults || {})),
    snap: Object.freeze(structuredClone(definition.snap || {})),
    capabilities: Object.freeze(structuredClone(definition.capabilities || {}))
  });
}

export class ModelFormatRegistry {
  constructor() {
    this.formats = new Map();
    this.aliases = new Map();
    this.listeners = new Set();
  }

  register(definition) {
    if (!definition?.id || typeof definition.id !== 'string') throw new TypeError('Model format id must be a non-empty string.');
    if (!definition.name || typeof definition.name !== 'string') throw new TypeError(`Model format ${definition.id} requires a name.`);
    if (this.formats.has(definition.id)) throw new Error(`Model format already registered: ${definition.id}`);
    const format = freezeDefinition({ status: 'ready', category: 'general', ...definition });
    this.formats.set(format.id, format);
    for (const alias of new Set([format.id, format.blockbenchFormat, ...format.aliases].filter(Boolean))) {
      const key = String(alias).toLowerCase();
      if (!this.aliases.has(key)) this.aliases.set(key, format.id);
    }
    this.listeners.forEach(listener => listener({ type: 'register', format }));
    return format;
  }

  registerMany(definitions) {
    return definitions.map(definition => this.register(definition));
  }

  get(id) {
    return this.formats.get(id) || null;
  }

  list({ category = null } = {}) {
    const formats = [...this.formats.values()];
    return category ? formats.filter(format => format.category === category) : formats;
  }

  resolve(value, fallbackId = null) {
    const id = this.aliases.get(String(value || '').toLowerCase());
    return this.get(id) || this.get(fallbackId) || null;
  }

  createDefaults(id, context = {}) {
    const format = this.get(id);
    if (!format) throw new Error(`Unknown model format: ${id}`);
    const initial = typeof format.createProject === 'function' ? format.createProject(context) : {};
    return structuredClone({
      ...format.defaults,
      ...(initial || {}),
      formatId: format.id,
      modelType: format.blockbenchFormat || format.id,
      snap: {
        ...format.snap,
        ...(initial?.snap || {})
      }
    });
  }

  subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('Model format listener must be a function.');
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
