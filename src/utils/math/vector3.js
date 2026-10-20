export function dot3(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
export function cross3(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
export function normalize3(vector) { const length = Math.hypot(...vector) || 1; return vector.map(value => value / length); }
