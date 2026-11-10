import { registerEntityOperations } from './operation-registry.js';
import { shapeRegistry } from '../../shapes/registry.js';
import { FormatConstraintDefinition, registerFormatDefinition } from './format-hooks.js';
import { shapePackUtils } from '../../utils/index.js';

export class ModifierRegistry {
  constructor({ globalFormatHooks = false } = {}) {
    this.definitions = new Map();
    this.globalFormatHooks = globalFormatHooks;
  }

  register(definition) {
    if (!definition?.id) throw new Error('Modifier definition requires an id');
    if (definition.constrainFormat !== undefined && typeof definition.constrainFormat !== 'function'
      || definition.supportsFormat !== undefined && typeof definition.supportsFormat !== 'function') throw new Error('Invalid modifier format hook');
    const normalized = Object.assign(new FormatConstraintDefinition(), {
      label: definition.id,
      targets: [],
      allowMultiple: true,
      createDefault: () => ({}),
      ...definition,
      hasFormatHook: typeof definition.constrainFormat === 'function',
      constrainFormat(subject, context) {
        return (definition.constrainFormat || FormatConstraintDefinition.prototype.constrainFormat).call(this, subject, { ...context, utils: shapePackUtils });
      },
      supportsFormat: definition.supportsFormat || FormatConstraintDefinition.prototype.supportsFormat,
      targets: [...(definition.targets || [])]
    });
    this.definitions.set(normalized.id, normalized);
    if (this.globalFormatHooks) registerFormatDefinition('modifier', normalized);
    registerEntityOperations('modifier', normalized.id, normalized.label);
    return normalized;
  }

  get(id) {
    return this.definitions.get(id) || null;
  }

  supports(id, targetType, rules = null) {
    const definition = this.get(id);
    return Boolean(definition && (!rules || definition.supportsFormat(rules)) && (definition.targets.includes('*') || definition.targets.includes(targetType)
      || shapeRegistry.get(targetType)?.external && definition.targets.includes('polygon_prism')));
  }

  listFor(targetType, rules = null) {
    return [...this.definitions.values()].filter(definition => this.supports(definition.id, targetType, rules));
  }

  create(id, targetType, data = {}) {
    const definition = this.get(id);
    if (!definition || !this.supports(id, targetType)) return null;
    return {
      uid: data.uid || `modifier_${crypto.randomUUID().slice(0, 8)}`,
      type: id,
      enabled: data.enabled !== false,
      ...structuredClone(definition.createDefault()),
      ...structuredClone(data),
      type: id
    };
  }
}

