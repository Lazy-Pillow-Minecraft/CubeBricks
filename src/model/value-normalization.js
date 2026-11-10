export function booleanProperty(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'false' || normalized === '0' || normalized === '') return false;
    if (normalized === 'true' || normalized === '1') return true;
  }
  return Boolean(value);
}

export function cloneData(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}
