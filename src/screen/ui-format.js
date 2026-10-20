export function escapeHtml(value) { const div = document.createElement('div'); div.textContent = value; return div.innerHTML; }
export function escapeAttribute(value) { return escapeHtml(value).replaceAll('"', '&quot;'); }
export function round(value) { return Math.round(value * 10000) / 10000; }
export function hexToRgb(hex) { const n = parseInt(hex.replace('#', ''), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
