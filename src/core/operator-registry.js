import { registerEntityOperations } from './operation-registry.js';

export class OperatorRegistry {
  constructor() {
    this.definitions = new Map();
  }

  register(definition) {
    if (!definition?.id) throw new Error('Operator definition requires an id');
    const normalized = {
      label: definition.id,
      targets: [],
      allowMultiple: true,
      createDefault: () => ({}),
      ...definition,
      targets: [...(definition.targets || [])]
    };
    this.definitions.set(normalized.id, normalized);
    registerEntityOperations('operator', normalized.id, normalized.label);
    return normalized;
  }

  get(id) { return this.definitions.get(id) || null; }

  supports(id, targetType) {
    const definition = this.get(id);
    return Boolean(definition && (definition.targets.includes('*') || definition.targets.includes(targetType)));
  }

  listFor(targetType) {
    return [...this.definitions.values()].filter(definition => this.supports(definition.id, targetType));
  }

  create(id, targetType, data = {}) {
    const definition = this.get(id);
    if (!definition || !this.supports(id, targetType)) return null;
    return {
      uid: data.uid || `operator_${crypto.randomUUID().slice(0, 8)}`,
      type: id,
      enabled: data.enabled !== false,
      ...structuredClone(definition.createDefault()),
      ...structuredClone(data),
      type: id
    };
  }
}
