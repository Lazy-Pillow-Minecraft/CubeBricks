export const JavaBlockVersion = Object.freeze({
  LEGACY: '1.9-1.21.5', SINGLE_AXIS: '1.21.6-1.21.10', UNRESTRICTED: '1.21.11+'
});
export function normalizeJavaBlockVersion(value) {
  if (Object.values(JavaBlockVersion).includes(value)) return value;
  const parts = String(value || '').split('.').map(Number);
  if (parts[0] > 1 || parts[0] === 1 && (parts[1] > 21 || parts[1] === 21 && parts[2] >= 11)) return JavaBlockVersion.UNRESTRICTED;
  if (parts[0] === 1 && parts[1] === 21 && parts[2] >= 6) return JavaBlockVersion.SINGLE_AXIS;
  return JavaBlockVersion.LEGACY;
}
// Blockbench stores this project property at the document root; meta's
// format_version describes the bbmodel container, not the Minecraft version.
export function blockbenchJavaVersion(value) {
  return { [JavaBlockVersion.LEGACY]: '1.9.0', [JavaBlockVersion.SINGLE_AXIS]: '1.21.6',
    [JavaBlockVersion.UNRESTRICTED]: '1.21.11' }[normalizeJavaBlockVersion(value)];
}
