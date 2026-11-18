// A number scrub is one edit even when its field is rebuilt during input.
// Keep this independent of the UI so history need not import a screen controller.
let current = null;

export function beginNumericEdit(project) {
  const session = { project, operations: new Set() };
  current = session;
  return session;
}

export function endNumericEdit(session) {
  if (current === session) current = null;
}

export function isNumericEditActive(project) {
  return Boolean(current && current.project === project);
}

export function claimNumericSnapshot(project, operation) {
  if (!isNumericEditActive(project)) return true;
  if (current.operations.has(operation)) return false;
  current.operations.add(operation);
  return true;
}
