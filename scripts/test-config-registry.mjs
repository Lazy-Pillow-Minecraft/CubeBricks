import assert from 'node:assert/strict';
import { ConfigRegistry, ConfigScope, ConfigType } from '../src/core/config-registry.js';

const memory = new Map();
const storage = {
  getItem: key => memory.get(key) ?? null,
  setItem: (key, value) => memory.set(key, value)
};

const registry = new ConfigRegistry({ storage, storageKey: 'test.config' });
registry.register({
  id: 'application.language',
  type: ConfigType.ENUM,
  scope: ConfigScope.APPLICATION,
  defaultValue: 'zh-Hant',
  options: [{ value: 'zh-Hant' }, { value: 'zh-Hans' }, { value: 'en' }]
});

let observed;
registry.subscribe('application.language', change => { observed = change; });
assert.equal(registry.get('application.language'), 'zh-Hant');
assert.equal(registry.set('application.language', 'en'), 'en');
assert.equal(observed.previousValue, 'zh-Hant');
assert.throws(() => registry.set('application.language', 'fr'), TypeError);

const restored = new ConfigRegistry({ storage, storageKey: 'test.config' });
restored.register(registry.getDefinition('application.language'));
assert.equal(restored.get('application.language'), 'en');
assert.deepEqual(restored.exportValues(), { 'application.language': 'en' });

console.log('Config registry tests passed.');
