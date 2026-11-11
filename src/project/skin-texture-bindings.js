// Renderer-wide texture lists cannot be offered to every geometry branch:
// baby, adult, equipment and overlays frequently share one renderer.
const BABY = /(?:^|[_.\/-])baby(?:$|[_.\/-])/i;
const AUXILIARY = /(?:^|[_.\/-])(?:armor|collar|decor|markings?|overlay|outer|undercoat|saddle|glint|enchanted|eyes|eye|flower|carpet|chest|wings?|charged|beam|pattern|bioluminescent|pulsating|spots|tendrils|heart|wind|ropes|harness)(?:$|[_.\/-])/i;

const filename = value => String(value || '').split('/').at(-1).replace(/\.png$/i, '');
const directory = value => String(value || '').replace(/\\/g, '/').replace(/\/[^/]*$/, '');
const isBaby = value => BABY.test(String(value || ''));
const sameAge = (textureKey, textureId, partKey, model) =>
  (isBaby(textureKey) || isBaby(filename(textureId))) === (isBaby(partKey) || isBaby(model));
const JAVA_PALETTE_ENTITIES = new Set([
  'axolotl', 'cat', 'cow', 'horse', 'llama', 'mooshroom', 'panda', 'rabbit', 'wolf'
]);

function modelDefaults(details) {
  const owners = new Map();
  for (const entity of Object.values(details.entities || {})) {
    for (const part of Object.values(entity.layers || entity.geometry || {})) {
      if (!part?.model || !part.defaultTexture) continue;
      const models = owners.get(part.defaultTexture) || new Set();
      models.add(part.model);
      owners.set(part.defaultTexture, models);
    }
  }
  return owners;
}

function relevantParts(edition, parts, model) {
  const matching = Object.entries(parts).filter(([, part]) => part?.model === model);
  if (edition === 'java' && matching.some(([key]) => key.endsWith('#main')))
    return matching.filter(([key]) => key.endsWith('#main'));
  if (edition === 'bedrock' && matching.some(([key]) => key === 'default'))
    return matching.filter(([key]) => !AUXILIARY.test(key));
  return matching;
}

function javaVariant(textureId, partKey, part, model, owners) {
  if (!part.defaultTexture) return false;
  if (directory(textureId) !== directory(part.defaultTexture)) return false;
  if (!sameAge('', textureId, partKey, model)) return false;
  const name = filename(textureId);
  const equipmentTexture = directory(part.defaultTexture).includes('/equipment/');
  const equipmentModel = /(?:^|[._])(?:armor|saddle|decor|harness|collar|leggings)(?:$|[._])/i.test(model);
  if (equipmentTexture && !equipmentModel) return false;
  if (equipmentTexture && /(?:^|_)(?:overlay|glint)(?:$|_)/i.test(name)) return false;
  if (!equipmentTexture && (AUXILIARY.test(name) ||
    !name.startsWith(filename(part.defaultTexture).split('_')[0]))) return false;
  // An explicit default for another geometry is not an appearance variant.
  if ([...(owners.get(textureId) || [])].some(owner => owner !== model)) return false;
  return true;
}

function bedrockVariant(textureKey, textureId, partKey, part, model, parts, owners) {
  if (!part.defaultTexture || directory(textureId) !== directory(part.defaultTexture)) return false;
  if (!sameAge(textureKey, textureId, partKey, model)) return false;
  if ([...(owners.get(textureId) || [])].some(owner => owner !== model)) return false;

  const role = partKey.toLowerCase();
  if (AUXILIARY.test(role))
    return new RegExp(`(?:^|_)${role.replace(/[^a-z0-9_]/g, '')}(?:$|_)`, 'i').test(textureKey);
  if (AUXILIARY.test(textureKey) || AUXILIARY.test(filename(textureId))) return false;

  // Some climate bodies share geometry; others have a distinct geometry.
  const branch = /(?:^|_)(warm|cold)(?:$|_)/i.exec(textureKey)?.[1]?.toLowerCase();
  if (branch && role !== 'baby' && parts[branch]?.model && parts[branch].model !== model) return false;
  if ((role === 'warm' || role === 'cold') && branch !== role) return false;
  return true;
}

export function skinTextureBindings(edition, model, details) {
  const owners = modelDefaults(details);
  const bindings = [];
  const availableTextures = Object.keys(details.textures || {});
  for (const [entityId, entity] of Object.entries(details.entities || {})) {
    const parts = entity.layers || entity.geometry || {};
    for (const [partKey, part] of relevantParts(edition, parts, model)) {
      if (part.defaultTexture)
        bindings.push({ id: part.defaultTexture, entityId, partKey, source: 'default' });
      if (edition === 'java') {
        const entityName = entityId.replace(/^minecraft:/, '');
        const includePalette = JAVA_PALETTE_ENTITIES.has(entityName) ||
          /(?:^|[._])(?:armor|saddle|decor|harness|collar|leggings)(?:$|[._])/i.test(model);
        const candidates = includePalette ? availableTextures : entity.textureHints || [];
        for (const id of candidates) {
          if (!javaVariant(id, partKey, part, model, owners)) continue;
          bindings.push({ id, entityId, partKey, source: 'variant' });
        }
      } else {
        for (const [textureKey, id] of Object.entries(entity.textures || {})) {
          if (typeof id !== 'string' || !bedrockVariant(textureKey, id, partKey, part, model, parts, owners)) continue;
          bindings.push({ id, entityId, partKey, textureKey, source: 'variant' });
        }
      }
    }
  }
  return bindings.filter((binding, index) =>
    bindings.findIndex(other => other.id === binding.id) === index);
}
