import { BezierElement } from '../model.js';

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, Number(value) || 0));
const uid = () => globalThis.crypto?.randomUUID?.() || `curve-${Math.random().toString(36).slice(2)}`;
const hexToRgb = hex => [1, 3, 5].map(index => parseInt(String(hex).slice(index, index + 2), 16) || 0);
const rgbToHex = rgb => `#${rgb.map(value => Math.round(clamp(value, 0, 255)).toString(16).padStart(2, '0')).join('')}`;

export function rgbToHsvColor(rgb) {
  const [red, green, blue] = rgb.map(value => clamp(value / 255));
  const high = Math.max(red, green, blue), low = Math.min(red, green, blue), delta = high - low;
  let hue = 0;
  if (delta > 1e-8) {
    if (high === red) hue = ((green - blue) / delta) % 6;
    else if (high === green) hue = (blue - red) / delta + 2;
    else hue = (red - green) / delta + 4;
    hue = (hue / 6 + 1) % 1;
  }
  return [hue, high < 1e-8 ? 0 : delta / high, high];
}

export function hsvToRgbColor(hue, saturation, value) {
  const h = ((hue % 1) + 1) % 1 * 6, s = clamp(saturation), v = clamp(value);
  const chroma = v * s, secondary = chroma * (1 - Math.abs(h % 2 - 1)), offset = v - chroma;
  return [[chroma, secondary, 0], [secondary, chroma, 0], [0, chroma, secondary],
    [0, secondary, chroma], [secondary, 0, chroma], [chroma, 0, secondary]][Math.min(5, Math.floor(h))]
    .map(component => Math.round((component + offset) * 255));
}

export function positionForColor(color, mode) {
  const rgb = hexToRgb(color);
  if (mode === 'rgb_cube') return rgb.map(value => value / 255);
  const [h, s, v] = rgbToHsvColor(rgb);
  if (mode === 'hsv_cylinder') return [Math.cos(h * Math.PI * 2) * s, v, Math.sin(h * Math.PI * 2) * s];
  return [h, s, v];
}

export function colorAtPosition(position, mode) {
  if (mode === 'rgb_cube') return rgbToHex(position.map(value => clamp(value) * 255));
  if (mode === 'hsv_cylinder') {
    const radius = Math.hypot(position[0], position[2]);
    const hue = ((Math.atan2(position[2], position[0]) / (Math.PI * 2)) + 1) % 1;
    return rgbToHex(hsvToRgbColor(hue, clamp(radius), clamp(position[1])));
  }
  return rgbToHex(hsvToRgbColor(position[0], clamp(position[1]), clamp(position[2])));
}

export function constrainColorPosition(position, mode) {
  if (mode === 'hsv_cylinder') {
    const radius = Math.hypot(position[0], position[2]);
    const scale = radius > 1 ? 1 / radius : 1;
    return [position[0] * scale, clamp(position[1]), position[2] * scale];
  }
  return position.map(value => clamp(value));
}

export function createColorSpaceCurve(colors = [], mode = 'hsv_cube') {
  const stops = colors.length >= 2 ? colors : colors.length ? [colors[0], colors[0]] : ['#000000', '#ffffff'];
  return {
    mode,
    nodes: stops.map(color => ({
      id: uid(), position: positionForColor(color, mode), handlesEnabled: true,
      autoTangent: true, symmetricHandles: true,
      handleIn: [-.12, 0, 0], handleOut: [.12, 0, 0]
    })),
    revision: 0
  };
}

export function changeColorSpaceMode(curve, nextMode) {
  if (!['rgb_cube', 'hsv_cube', 'hsv_cylinder'].includes(nextMode) || nextMode === curve.mode) return;
  curve.nodes.forEach(node => {
    const oldPosition = node.position;
    const oldColor = colorAtPosition(oldPosition, curve.mode);
    const newPosition = positionForColor(oldColor, nextMode);
    const transformHandle = handle => {
      const handleColor = colorAtPosition(oldPosition.map((value, axis) => value + handle[axis]), curve.mode);
      const mapped = positionForColor(handleColor, nextMode);
      return mapped.map((value, axis) => value - newPosition[axis]);
    };
    node.handleIn = transformHandle(node.handleIn);
    node.handleOut = transformHandle(node.handleOut);
    if (node.symmetricHandles) node.handleIn = node.handleOut.map(value => -value);
    node.position = newPosition;
  });
  curve.mode = nextMode;
  curve.revision++;
}

function curveGeometry(curve) {
  const positions = curve.nodes.map(node => [...node.position]);
  if (curve.mode === 'hsv_cube') {
    for (let index = 1; index < positions.length; index++) {
      let hue = positions[index][0];
      while (hue - positions[index - 1][0] > .5) hue--;
      while (hue - positions[index - 1][0] < -.5) hue++;
      positions[index][0] = hue;
    }
  }
  const element = new BezierElement({ nodes: curve.nodes.map((node, index) => ({ ...node, position: positions[index] })) }, 3);
  const resolved = element.nodes.map((_, index) => element.resolvedNodeState(index));
  return { positions, resolved };
}

function cubic(start, controlA, controlB, end, t) {
  const inverse = 1 - t;
  return [0, 1, 2].map(axis => inverse ** 3 * start[axis] + 3 * inverse ** 2 * t * controlA[axis]
    + 3 * inverse * t ** 2 * controlB[axis] + t ** 3 * end[axis]);
}

export function equalGradientPositions(count) {
  return Array.from({ length: count }, (_, index) => count < 2 ? 0 : index / (count - 1));
}

export function gradientRatioToUniform(ratio, positions) {
  if (positions.length < 2) return 0;
  const value = clamp(ratio);
  for (let index = 0; index < positions.length - 1; index++) {
    const end = positions[index + 1];
    if (value <= end || index === positions.length - 2) {
      const width = end - positions[index];
      return (index + (width > 1e-8 ? clamp((value - positions[index]) / width) : 0)) / (positions.length - 1);
    }
  }
  return 1;
}

export function colorSpaceArcLengthPositions(curve, samplesPerSegment = 48) {
  const count = curve?.nodes?.length || 0;
  if (count < 2) return equalGradientPositions(count);
  const geometry = curveGeometry(curve);
  const lengths = [];
  for (let segment = 0; segment < count - 1; segment++) {
    let previous = sampleColorSpacePosition(curve, segment / (count - 1), geometry);
    let length = 0;
    for (let sample = 1; sample <= samplesPerSegment; sample++) {
      const next = sampleColorSpacePosition(curve, (segment + sample / samplesPerSegment) / (count - 1), geometry);
      length += Math.hypot(...next.map((value, axis) => value - previous[axis]));
      previous = next;
    }
    lengths.push(length);
  }
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (total < 1e-8) return equalGradientPositions(count);
  let cumulative = 0;
  return [0, ...lengths.map(length => (cumulative += length / total))];
}

export function sampleColorSpacePosition(curve, ratio, geometry = curveGeometry(curve)) {
  const count = curve.nodes.length;
  if (!count) return [0, 0, 0];
  if (count === 1) return [...geometry.positions[0]];
  const scaled = clamp(ratio) * (count - 1);
  const segment = Math.min(count - 2, Math.floor(scaled));
  const t = scaled - segment;
  const start = geometry.positions[segment], end = geometry.positions[segment + 1];
  const a = curve.nodes[segment], b = curve.nodes[segment + 1];
  const out = a.handlesEnabled ? geometry.resolved[segment].handleOut : [0, 0, 0];
  const into = b.handlesEnabled ? geometry.resolved[segment + 1].handleIn : [0, 0, 0];
  return cubic(start, start.map((value, axis) => value + out[axis]),
    end.map((value, axis) => value + into[axis]), end, t);
}

const sampleCache = new WeakMap();
export function sampleColorSpaceGradient(curve, ratio) {
  if (!curve?.nodes?.length) return '#000000';
  let cache = sampleCache.get(curve);
  if (!cache || cache.revision !== curve.revision || cache.count !== curve.nodes.length || cache.mode !== curve.mode) {
    const geometry = curveGeometry(curve);
    const colors = Array.from({ length: 2049 }, (_, index) => colorAtPosition(
      sampleColorSpacePosition(curve, index / 2048, geometry), curve.mode));
    cache = { colors, revision: curve.revision, count: curve.nodes.length, mode: curve.mode };
    sampleCache.set(curve, cache);
  }
  return cache.colors[Math.round(clamp(ratio) * 2048)];
}

export function colorSpaceGradientCss(curve, steps = 48, positions = null) {
  return `linear-gradient(90deg, ${Array.from({ length: steps + 1 }, (_, index) =>
    `${sampleColorSpaceGradient(curve, positions ? gradientRatioToUniform(index / steps, positions) : index / steps)} ${(index / steps * 100).toFixed(2)}%`).join(', ')})`;
}

function dot(left, right) { return left.reduce((sum, value, index) => sum + value * right[index], 0); }
function subtract(left, right) { return left.map((value, index) => value - right[index]); }

export class ColorSpaceCurveViewport {
  constructor(canvas, curve, onChange, onSelect) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d');
    this.curve = curve;
    this.onChange = onChange;
    this.onSelect = onSelect;
    this.selected = 0;
    this.yaw = -.72;
    this.pitch = .5;
    this.zoom = 1;
    this.perspective = false;
    this.axisMode = 'all';
    this.drag = null;
    this.hitTargets = [];
    this.resizeObserver = new ResizeObserver(() => this.draw());
    this.resizeObserver.observe(canvas);
    canvas.addEventListener('pointerdown', event => this.pointerDown(event));
    canvas.addEventListener('pointermove', event => this.pointerMove(event));
    canvas.addEventListener('pointerup', event => this.pointerUp(event));
    canvas.addEventListener('pointercancel', event => this.pointerUp(event));
    canvas.addEventListener('wheel', event => {
      event.preventDefault();
      this.zoom = clamp(this.zoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12), .45, 3);
      this.draw();
    }, { passive: false });
    this.draw();
  }

  dispose() { this.resizeObserver.disconnect(); }
  basis() {
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw), cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    return { right: [cy, 0, -sy], up: [sy * sp, cp, cy * sp], forward: [-sy * cp, sp, -cy * cp] };
  }
  project(point, preview = false) {
    const width = preview ? 112 : this.canvas.clientWidth, height = preview ? 112 : this.canvas.clientHeight;
    const origin = this.curve.mode === 'hsv_cylinder' ? [0, .5, 0] : [.5, .5, .5];
    const relative = subtract(point, origin), { right, up, forward } = this.basis();
    const scale = preview ? 49 : Math.min(width, height) * .33 * this.zoom;
    const depth = dot(relative, forward);
    const factor = this.perspective ? 2.8 / Math.max(.5, 2.8 - depth) : 1;
    return { x: (preview ? this.canvas.clientWidth - 78 : width / 2) + dot(relative, right) * scale * factor,
      y: (preview ? 79 : height / 2) - dot(relative, up) * scale * factor, depth };
  }
  line(points, color, width = 1, closed = false) {
    const ctx = this.context;
    ctx.beginPath();
    points.forEach((point, index) => {
      const p = this.project(point);
      if (index) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y);
    });
    if (closed) ctx.closePath();
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
  }
  axisLine(a, b, startColor, endColor, width = 2) {
    const first = this.project(a), last = this.project(b);
    const gradient = this.context.createLinearGradient(first.x, first.y, last.x, last.y);
    gradient.addColorStop(0, startColor); gradient.addColorStop(1, endColor);
    this.line([a, b], gradient, width);
  }
  drawSpace(preview = false) {
    const ctx = this.context, mode = this.curve.mode;
    if (preview && mode !== 'hsv_cylinder') {
      const faces = [];
      for (let axis = 0; axis < 3; axis++) for (const fixed of [0, 1]) {
        const others = [0, 1, 2].filter(value => value !== axis);
        const center = [.5, .5, .5]; center[axis] = fixed;
        faces.push({ axis, fixed, others, depth: this.project(center, true).depth });
      }
      faces.sort((a, b) => a.depth - b.depth);
      for (const face of faces) for (let u = 0; u < 8; u++) for (let v = 0; v < 8; v++) {
        const points = [[u, v], [u + 1, v], [u + 1, v + 1], [u, v + 1]].map(([first, second]) => {
          const point = [0, 0, 0]; point[face.axis] = face.fixed;
          point[face.others[0]] = first / 8; point[face.others[1]] = second / 8;
          return this.project(point, true);
        });
        const center = [0, 0, 0]; center[face.axis] = face.fixed;
        center[face.others[0]] = (u + .5) / 8; center[face.others[1]] = (v + .5) / 8;
        ctx.beginPath(); points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
        ctx.closePath(); ctx.fillStyle = colorAtPosition(center, mode); ctx.globalAlpha = .85; ctx.fill();
      }
      ctx.globalAlpha = 1;
      return;
    }
    if (mode === 'hsv_cylinder') {
      const rings = [0, 1].map(y => Array.from({ length: 65 }, (_, index) => {
        const angle = index / 64 * Math.PI * 2;
        return [Math.cos(angle), y, Math.sin(angle)];
      }));
      if (!preview) {
        for (let ring = 0; ring < 10; ring++) for (let sector = 0; sector < 48; sector++) {
          const a = sector / 48 * Math.PI * 2, b = (sector + 1) / 48 * Math.PI * 2;
          const inner = ring / 10, outer = (ring + 1) / 10;
          const points = [[inner, a], [outer, a], [outer, b], [inner, b]]
            .map(([radius, angle]) => this.project([Math.cos(angle) * radius, 0, Math.sin(angle) * radius]));
          ctx.beginPath(); points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
          ctx.closePath();
          ctx.fillStyle = colorAtPosition([Math.cos(a) * (inner + outer) / 2, 1, Math.sin(a) * (inner + outer) / 2], mode);
          ctx.globalAlpha = .38; ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      if (preview) {
        const tiles = [];
        for (let index = 0; index < 48; index++) for (let ring = 0; ring < 8; ring++) for (const y of [0, 1]) {
          const a = index / 48 * Math.PI * 2, b = (index + 1) / 48 * Math.PI * 2;
          const inner = ring / 8, outer = (ring + 1) / 8;
          const points = [[inner, a], [outer, a], [outer, b], [inner, b]]
            .map(([radius, angle]) => this.project([Math.cos(angle) * radius, y, Math.sin(angle) * radius], true));
          const center = [Math.cos((a + b) / 2) * (inner + outer) / 2, y, Math.sin((a + b) / 2) * (inner + outer) / 2];
          tiles.push({ points, depth: this.project(center, true).depth, color: colorAtPosition(center, mode) });
        }
        for (let index = 0; index < 48; index++) for (let level = 0; level < 8; level++) {
          const a = index / 48 * Math.PI * 2, b = (index + 1) / 48 * Math.PI * 2;
          const corners = [[a, level / 8], [b, level / 8], [b, (level + 1) / 8], [a, (level + 1) / 8]]
            .map(([angle, y]) => this.project([Math.cos(angle), y, Math.sin(angle)], true));
          const center = [Math.cos((a + b) / 2), (level + .5) / 8, Math.sin((a + b) / 2)];
          tiles.push({ points: corners, depth: this.project(center, true).depth, color: colorAtPosition(center, mode) });
        }
        tiles.sort((a, b) => a.depth - b.depth);
        ctx.globalAlpha = .9;
        for (const tile of tiles) {
          ctx.beginPath(); tile.points.forEach((point, corner) => corner ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
          ctx.closePath(); ctx.fillStyle = tile.color; ctx.fill();
        }
        ctx.globalAlpha = 1;
        return;
      } else {
        for (let index = 0; index < 64; index++) {
          const hue = index / 64;
          this.line([rings[0][index], rings[0][index + 1]], colorAtPosition(rings[0][index].map((value, axis) => axis === 1 ? 1 : value), mode), 3);
        }
      }
      rings.forEach((ring, index) => this.line(ring, preview ? 'rgba(255,255,255,.45)' : 'rgba(200,220,205,.4)', 1));
      for (let angle = 0; angle < 8; angle++) {
        const radians = angle * Math.PI / 4;
        this.line([[Math.cos(radians), 0, Math.sin(radians)], [Math.cos(radians), 1, Math.sin(radians)]], 'rgba(200,220,205,.18)');
      }
      this.axisLine([0, 0, 0], [0, 1, 0], '#111', '#fff', 4);
      if (!preview) for (let ring = 1; ring <= 12; ring++) for (let segment = 0; segment < 48; segment++) {
        const a = segment / 48 * Math.PI * 2, b = (segment + 1) / 48 * Math.PI * 2;
        const radius = ring / 12;
        this.line([[Math.cos(a) * radius, 0, Math.sin(a) * radius], [Math.cos(b) * radius, 0, Math.sin(b) * radius]],
          colorAtPosition([Math.cos(a) * radius, 1, Math.sin(a) * radius], mode), .55);
      }
      return;
    }
    const ghost = mode === 'hsv_cube' && !preview ? [-1, 1] : [];
    for (const shift of [0, ...ghost]) {
      const alpha = shift ? .18 : .52;
      for (const y of [0, 1]) for (const z of [0, 1]) this.line([[shift, y, z], [shift + 1, y, z]], `rgba(205,225,215,${alpha})`);
      for (const x of [0, 1]) for (const z of [0, 1]) this.line([[shift + x, 0, z], [shift + x, 1, z]], `rgba(205,225,215,${alpha})`);
      for (const x of [0, 1]) for (const y of [0, 1]) this.line([[shift + x, y, 0], [shift + x, y, 1]], `rgba(205,225,215,${alpha})`);
    }
    if (mode === 'rgb_cube') {
      this.axisLine([0, 0, 0], [1, 0, 0], '#111', '#f33', 4);
      this.axisLine([0, 0, 0], [0, 1, 0], '#111', '#4e4', 4);
      this.axisLine([0, 0, 0], [0, 0, 1], '#111', '#48f', 4);
    } else {
      for (let index = 0; index < 48; index++) this.axisLine([index / 48, 1, 1], [(index + 1) / 48, 1, 1],
        colorAtPosition([index / 48, 1, 1], mode), colorAtPosition([(index + 1) / 48, 1, 1], mode), 4);
      this.axisLine([0, 0, 1], [0, 1, 1], '#fff', '#f00', 4);
      this.axisLine([0, 0, 0], [0, 0, 1], '#000', '#fff', 4);
    }
  }
  drawCurve() {
    const ctx = this.context, curve = this.curve, geometry = curveGeometry(curve);
    this.hitTargets = [];
    for (let index = 0; index < Math.max(0, curve.nodes.length - 1); index++) {
      for (let step = 0; step < 128; step++) {
        const a = sampleColorSpacePosition(curve, (index + step / 128) / (curve.nodes.length - 1), geometry);
        const b = sampleColorSpacePosition(curve, (index + (step + 1) / 128) / (curve.nodes.length - 1), geometry);
        this.line([a, b], colorAtPosition(a, curve.mode), 8);
      }
    }
    geometry.positions.forEach((position, index) => {
      const projected = this.project(position), selected = index === this.selected;
      ctx.beginPath(); ctx.arc(projected.x, projected.y, selected ? 10 : 8, 0, Math.PI * 2);
      ctx.fillStyle = colorAtPosition(position, curve.mode); ctx.fill();
      ctx.lineWidth = selected ? 3 : 2; ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#b9f55a'; ctx.stroke();
      this.hitTargets.push({ type: 'node', index, x: projected.x, y: projected.y, radius: 14 });
    });
    const node = curve.nodes[this.selected];
    if (!node) return;
    const position = geometry.positions[this.selected], handle = geometry.resolved[this.selected];
    if (node.handlesEnabled) for (const [kind, delta] of [['in', handle.handleIn], ['out', handle.handleOut]]) {
      const point = position.map((value, axis) => value + delta[axis]), p = this.project(point);
      this.line([position, point], 'rgba(255,255,255,.55)', 1);
      ctx.beginPath(); ctx.moveTo(p.x, p.y - 5); ctx.lineTo(p.x + 5, p.y); ctx.lineTo(p.x, p.y + 5); ctx.lineTo(p.x - 5, p.y);
      ctx.closePath(); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#111'; ctx.lineWidth = 1; ctx.stroke();
      if (!node.autoTangent) this.hitTargets.push({ type: `handle-${kind}`, index: this.selected, x: p.x, y: p.y, radius: 11 });
    }
    this.drawGizmo(position);
  }
  drawGizmo(position) {
    const ctx = this.context, mode = this.curve.mode;
    const vectors = mode === 'hsv_cylinder'
      ? { x: [-position[0], 0, -position[2]], y: [0, 1, 0] }
      : { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
    const colors = { x: '#ef6868', y: '#83d878', z: '#6aaafa' };
    for (const [axis, vector] of Object.entries(vectors)) {
      if (this.axisMode !== 'all' && this.axisMode !== axis) continue;
      const length = Math.hypot(...vector) || 1;
      const end = position.map((value, index) => value + vector[index] / length * .2);
      const p = this.project(end), start = this.project(position);
      ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(p.x, p.y); ctx.strokeStyle = colors[axis]; ctx.lineWidth = 3; ctx.stroke();
      const angle = Math.atan2(p.y - start.y, p.x - start.x);
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - Math.cos(angle - .55) * 10, p.y - Math.sin(angle - .55) * 10);
      ctx.lineTo(p.x - Math.cos(angle + .55) * 10, p.y - Math.sin(angle + .55) * 10); ctx.closePath(); ctx.fillStyle = colors[axis]; ctx.fill();
      this.hitTargets.push({ type: 'axis', axis, index: this.selected, x: p.x, y: p.y, radius: 16, vector });
    }
    if (mode === 'hsv_cylinder' && (this.axisMode === 'all' || this.axisMode === 'z')) {
      const radius = Math.hypot(position[0], position[2]);
      if (radius > .025) {
        const theta = Math.atan2(position[2], position[0]);
        const span = Math.min(Math.PI / 3, .22 / radius);
        const points = Array.from({ length: 31 }, (_, index) => {
          const angle = theta + (index / 30 - .5) * span;
          return [Math.cos(angle) * radius, position[1], Math.sin(angle) * radius];
        });
        this.line(points, colors.z, 3);
        for (const [endIndex, end] of [[0, points[0]], [1, points.at(-1)]]) {
          const p = this.project(end), neighbor = this.project(endIndex ? points.at(-2) : points[1]);
          const angle = Math.atan2(p.y - neighbor.y, p.x - neighbor.x);
          ctx.beginPath(); ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - Math.cos(angle - .55) * 10, p.y - Math.sin(angle - .55) * 10);
          ctx.lineTo(p.x - Math.cos(angle + .55) * 10, p.y - Math.sin(angle + .55) * 10);
          ctx.closePath(); ctx.fillStyle = colors.z; ctx.fill();
          this.hitTargets.push({ type: 'hue', index: this.selected, x: p.x, y: p.y, radius: 15 });
        }
      }
    }
  }
  draw() {
    const canvas = this.canvas, dpr = devicePixelRatio || 1;
    const width = Math.max(1, Math.round(canvas.clientWidth * dpr)), height = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    const ctx = this.context;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--viewport').trim() || '#20251e';
    ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    this.drawSpace();
    this.drawCurve();
    ctx.save(); ctx.beginPath(); ctx.roundRect(canvas.clientWidth - 144, 13, 132, 132, 8);
    ctx.fillStyle = 'rgba(0,0,0,.48)'; ctx.fill(); ctx.clip();
    this.drawSpace(true);
    ctx.restore();
  }
  targetAt(event) {
    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left, y = event.clientY - rect.top;
    return [...this.hitTargets].reverse().find(target => Math.hypot(target.x - x, target.y - y) <= target.radius);
  }
  pointerDown(event) {
    if (event.button !== 0 && event.button !== 1) return;
    event.preventDefault(); this.canvas.setPointerCapture(event.pointerId);
    const target = event.button === 0 ? this.targetAt(event) : null;
    if (target?.index !== undefined && target.index !== this.selected) {
      this.selected = target.index; this.onSelect(this.selected); this.draw();
    }
    const node = this.curve.nodes[this.selected];
    this.drag = { type: target?.type || 'orbit', axis: target?.axis, handle: target?.type?.slice(7),
      x: event.clientX, y: event.clientY, nodeIndex: this.selected,
      position: node ? [...node.position] : null,
      handleValue: node && target?.type?.startsWith('handle-') ? [...node[target.type === 'handle-in' ? 'handleIn' : 'handleOut']] : null,
      yaw: this.yaw, pitch: this.pitch, moved: false };
  }
  pointerMove(event) {
    const drag = this.drag;
    if (!drag || !this.canvas.hasPointerCapture(event.pointerId)) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (Math.hypot(dx, dy) > 2) drag.moved = true;
    if (drag.type === 'orbit') {
      this.yaw = drag.yaw + dx * .008;
      this.pitch = clamp(drag.pitch + dy * .008, -1.4, 1.4);
      this.draw(); return;
    }
    const node = this.curve.nodes[drag.nodeIndex];
    if (!node) return;
    const pixels = Math.min(this.canvas.clientWidth, this.canvas.clientHeight) * .33 * this.zoom;
    const basis = this.basis();
    if (drag.type.startsWith('handle-')) {
      const delta = [0, 1, 2].map(axis => (dx * basis.right[axis] - dy * basis.up[axis]) / pixels);
      const key = drag.handle === 'in' ? 'handleIn' : 'handleOut', opposite = drag.handle === 'in' ? 'handleOut' : 'handleIn';
      node[key] = drag.handleValue.map((value, axis) => value + delta[axis]);
      if (node.symmetricHandles) node[opposite] = node[key].map(value => -value);
    } else if (drag.type === 'hue') {
      const radius = Math.hypot(drag.position[0], drag.position[2]);
      const theta = Math.atan2(drag.position[2], drag.position[0]);
      const tangent = [-Math.sin(theta), 0, Math.cos(theta)];
      const screen = dot(tangent, basis.right) * dx - dot(tangent, basis.up) * dy;
      const angle = clamp(screen / Math.max(8, pixels * radius), -Math.PI / 2, Math.PI / 2);
      node.position = [Math.cos(theta + angle) * radius, drag.position[1], Math.sin(theta + angle) * radius];
    } else {
      let delta;
      if (drag.type === 'axis') {
        let vector = this.curve.mode === 'hsv_cylinder' && drag.axis === 'x'
          ? [-drag.position[0], 0, -drag.position[2]] : drag.axis === 'x' ? [1, 0, 0] : drag.axis === 'y' ? [0, 1, 0] : [0, 0, 1];
        const length = Math.hypot(...vector) || 1;
        vector = vector.map(value => value / length);
        const projected = [dot(vector, basis.right), -dot(vector, basis.up)];
        const amount = (dx * projected[0] + dy * projected[1]) / (pixels * Math.max(.08, projected[0] ** 2 + projected[1] ** 2));
        delta = vector.map(value => value * amount);
      } else delta = [0, 1, 2].map(axis => (dx * basis.right[axis] - dy * basis.up[axis]) / pixels);
      node.position = constrainColorPosition(drag.position.map((value, axis) => value + delta[axis]), this.curve.mode);
    }
    this.curve.revision++;
    this.onChange(false);
    this.draw();
  }
  pointerUp(event) {
    if (!this.drag) return;
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
    if (this.drag.moved && this.drag.type !== 'orbit') this.onChange(true);
    this.drag = null;
  }
}
