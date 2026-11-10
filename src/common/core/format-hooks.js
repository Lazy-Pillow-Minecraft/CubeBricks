// Shared by Shape and modifier definitions. A pack can override either method;
// formats that need no special handling keep the empty default hook.
export class FormatConstraintDefinition {
  constrainFormat(_subject, _context) {}
  supportsFormat(_rules) { return true; }
}

const definitions = { shape: new Map(), modifier: new Map() };
const contexts = new WeakMap();
export function registerFormatDefinition(kind, definition) {
  definitions[kind].set(definition.id, definition);
}
export function removeFormatDefinition(kind, id) { definitions[kind].delete(id); }
export function formatDefinition(kind, id) { return definitions[kind].get(id); }
export function bindFormatContext(node, context) { if (node) contexts.set(node, context); }
export function boundFormatContext(node) {
  // UV Preview uses prototype-based visual copies of procedural objects.
  for (let source = node; source; source = Object.getPrototypeOf(source)) {
    const context = contexts.get(source);
    if (context) return context;
  }
  return null;
}
export function invokeFormatHook(kind, id, subject, context) {
  return definitions[kind].get(id)?.constrainFormat(subject, context);
}
