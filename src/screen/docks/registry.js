const DOCK_SIDES = new Set(['left', 'right', 'bottom', 'floating']);
const EDITOR_MODES = new Set(['edit', 'uv', 'paint', 'animate']);

export class DockPanelRegistry {
  constructor() {
    this.definitions = new Map();
    this.indices = new Set();
  }

  register(definition) {
    if (!definition || typeof definition.id !== 'string' || !/^[a-z][a-zA-Z0-9]*$/.test(definition.id))
      throw new TypeError('Dock panel requires a stable identifier.');
    if (this.definitions.has(definition.id)) throw new Error(`Dock panel already registered: ${definition.id}`);
    if (!Number.isInteger(definition.index) || this.indices.has(definition.index))
      throw new TypeError(`Dock panel ${definition.id} requires a unique integer index.`);
    if (!DOCK_SIDES.has(definition.defaultDock)) throw new TypeError(`Invalid default dock: ${definition.id}`);
    if (!Array.isArray(definition.modes) || !definition.modes.length
      || definition.modes.some(mode => !EDITOR_MODES.has(mode)))
      throw new TypeError(`Invalid editor modes for dock panel: ${definition.id}`);
    const normalized = Object.freeze({
      ...definition,
      modes: Object.freeze([...new Set(definition.modes)]),
      defaultPosition: Object.freeze({ ...definition.defaultPosition }),
      defaultSize: Object.freeze({ ...definition.defaultSize })
    });
    this.definitions.set(normalized.id, normalized);
    this.indices.add(normalized.index);
    return normalized;
  }

  registerMany(definitions) {
    return definitions.map(definition => this.register(definition));
  }

  get(id) {
    return this.definitions.get(id) || null;
  }

  list() {
    return [...this.definitions.values()].sort((a, b) => a.index - b.index);
  }
}
