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

let cylinderPreviewMesh;
const cubePreviewMeshes = new Map();
function getCubePreviewMesh(mode) {
  if (cubePreviewMeshes.has(mode)) return cubePreviewMeshes.get(mode);
  const vertices = [], indices = [];
  const divisions = mode === 'hsv_cube' ? [24, 8, 8] : [8, 8, 8];
  for (let axis = 0; axis < 3; axis++) for (const fixed of [0, 1]) {
    const [first, second] = [0, 1, 2].filter(value => value !== axis);
    const width = divisions[first], height = divisions[second];
    const start = vertices.length / 6;
    for (let y = 0; y <= height; y++) for (let x = 0; x <= width; x++) {
      const point = [0, 0, 0];
      point[axis] = fixed;
      point[first] = x / width;
      point[second] = y / height;
      const rgb = mode === 'rgb_cube' ? point.map(value => value * 255)
        : hsvToRgbColor(point[0], point[1], point[2]);
      vertices.push(...point, ...rgb.map(channel => channel / 255));
    }
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const a = start + y * (width + 1) + x;
      const b = a + 1, d = a + width + 1, c = d + 1;
      indices.push(a, b, c, a, c, d);
    }
  }
  const mesh = { vertices: new Float32Array(vertices), indices: new Uint16Array(indices) };
  cubePreviewMeshes.set(mode, mesh);
  return mesh;
}
function getCylinderPreviewMesh() {
  if (cylinderPreviewMesh) return cylinderPreviewMesh;
  const vertices = [], indices = [], sectors = 48, steps = 8;
  const vertex = (radius, angle, y) => {
    const rgb = hsvToRgbColor(angle / (Math.PI * 2), radius, y);
    vertices.push(Math.cos(angle) * radius, y, Math.sin(angle) * radius, ...rgb.map(channel => channel / 255));
    return vertices.length / 6 - 1;
  };
  const quad = (a, b, c, d) => { indices.push(a, b, c, a, c, d); };
  const side = Array.from({ length: steps + 1 }, (_, level) => Array.from({ length: sectors + 1 }, (_, sector) =>
    vertex(1, sector / sectors * Math.PI * 2, level / steps)));
  for (let level = 0; level < steps; level++) for (let sector = 0; sector < sectors; sector++)
    quad(side[level][sector], side[level][sector + 1], side[level + 1][sector + 1], side[level + 1][sector]);
  const top = Array.from({ length: steps + 1 }, (_, ring) => Array.from({ length: sectors + 1 }, (_, sector) =>
    vertex(ring / steps, sector / sectors * Math.PI * 2, 1)));
  for (let ring = 0; ring < steps; ring++) for (let sector = 0; sector < sectors; sector++)
    quad(top[ring][sector], top[ring + 1][sector], top[ring + 1][sector + 1], top[ring][sector + 1]);
  const bottomCenter = vertex(0, 0, 0);
  const bottom = Array.from({ length: sectors + 1 }, (_, sector) => vertex(1, sector / sectors * Math.PI * 2, 0));
  for (let sector = 0; sector < sectors; sector++) indices.push(bottomCenter, bottom[sector + 1], bottom[sector]);
  cylinderPreviewMesh = { vertices: new Float32Array(vertices), indices: new Uint16Array(indices) };
  return cylinderPreviewMesh;
}

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
    this.hover = null;
    this.hitTargets = [];
    this.resizeObserver = new ResizeObserver(() => this.draw());
    this.resizeObserver.observe(canvas);
    canvas.addEventListener('pointerdown', event => this.pointerDown(event));
    canvas.addEventListener('pointermove', event => this.pointerMove(event));
    canvas.addEventListener('pointerup', event => this.pointerUp(event));
    canvas.addEventListener('pointercancel', event => this.pointerUp(event));
    canvas.addEventListener('pointerleave', () => {
      if (this.drag || !this.hover) return;
      this.hover = null;
      this.canvas.style.cursor = 'crosshair';
      this.draw();
    });
    canvas.addEventListener('wheel', event => {
      event.preventDefault();
      this.zoom = clamp(this.zoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12), .45, 3);
      this.draw();
    }, { passive: false });
    this.draw();
  }

  dispose() {
    this.resizeObserver.disconnect();
    const renderer = this.spacePreviewRenderer;
    if (renderer?.gl) {
      for (const mesh of renderer.meshes.values()) {
        renderer.gl.deleteBuffer(mesh.vertexBuffer);
        renderer.gl.deleteBuffer(mesh.indexBuffer);
      }
      renderer.gl.deleteProgram(renderer.program);
      renderer.gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  }
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
  pointerOnCylinderPlane(event, height) {
    const rect = this.canvas.getBoundingClientRect();
    const scale = Math.min(this.canvas.clientWidth, this.canvas.clientHeight) * .33 * this.zoom;
    const sx = (event.clientX - rect.left - this.canvas.clientWidth / 2) / Math.max(1, scale);
    const sy = -(event.clientY - rect.top - this.canvas.clientHeight / 2) / Math.max(1, scale);
    const { right, up, forward } = this.basis();
    const offset = right.map((value, axis) => value * sx + up[axis] * sy);
    const origin = [0, .5, 0];
    const base = origin.map((value, axis) => value + offset[axis]);
    const direction = forward.map((value, axis) => value - (this.perspective ? offset[axis] / 2.8 : 0));
    if (Math.abs(direction[1]) < 1e-5) return null;
    const depth = (height - base[1]) / direction[1];
    return base.map((value, axis) => value + direction[axis] * depth);
  }
  huePointerAngle(event, height, screenFallback = false) {
    if (!screenFallback) {
      const point = this.pointerOnCylinderPlane(event, height);
      if (point && Math.hypot(point[0], point[2]) > 1e-6) return Math.atan2(point[2], point[0]);
    }
    const rect = this.canvas.getBoundingClientRect();
    const center = this.project([0, height, 0]);
    return Math.atan2(event.clientY - rect.top - center.y, event.clientX - rect.left - center.x);
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
    if (preview) { this.drawMergedSpacePreview(mode); return; }
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
      for (let index = 0; index < 64; index++) {
        this.line([rings[0][index], rings[0][index + 1]], colorAtPosition(rings[0][index].map((value, axis) => axis === 1 ? 1 : value), mode), 3);
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
  drawMergedSpacePreview(mode = this.curve.mode) {
    if (!this.spacePreviewRenderer) {
      try { this.spacePreviewRenderer = this.createSpacePreviewRenderer() || { unavailable: true }; }
      catch (error) {
        console.warn('色彩空間預覽網格無法建立', error);
        this.spacePreviewRenderer = { unavailable: true };
      }
    }
    const renderer = this.spacePreviewRenderer;
    if (renderer.unavailable) return;
    const key = `${mode}:${this.yaw}:${this.pitch}:${this.perspective}`;
    if (renderer.key !== key) {
      const { gl, program } = renderer;
      const mesh = renderer.meshes.get(mode);
      const { right, up, forward } = this.basis();
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vertexBuffer);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.indexBuffer);
      gl.vertexAttribPointer(renderer.position, 3, gl.FLOAT, false, renderer.stride, 0);
      gl.vertexAttribPointer(renderer.color, 3, gl.FLOAT, false, renderer.stride, 3 * Float32Array.BYTES_PER_ELEMENT);
      gl.uniform3fv(renderer.right, right);
      gl.uniform3fv(renderer.up, up);
      gl.uniform3fv(renderer.forward, forward);
      gl.uniform3fv(renderer.origin, mode === 'hsv_cylinder' ? [0, .5, 0] : [.5, .5, .5]);
      gl.uniform1f(renderer.perspective, this.perspective ? 1 : 0);
      gl.uniform1f(renderer.alpha, mode === 'hsv_cylinder' ? .9 : .85);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.drawElements(gl.TRIANGLES, mesh.indexCount, gl.UNSIGNED_SHORT, 0);
      renderer.key = key;
    }
    this.context.drawImage(renderer.canvas, this.canvas.clientWidth - 134, 23, 112, 112);
  }
  createSpacePreviewRenderer() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 112;
    const gl = canvas.getContext('webgl', { alpha: true, antialias: true, depth: true,
      preserveDrawingBuffer: true, premultipliedAlpha: false });
    if (!gl) return null;
    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
      return shader;
    };
    const vertexShader = compile(gl.VERTEX_SHADER, `
      attribute vec3 aPosition;
      attribute vec3 aColor;
      uniform vec3 uRight;
      uniform vec3 uUp;
      uniform vec3 uForward;
      uniform vec3 uOrigin;
      uniform float uPerspective;
      varying vec3 vColor;
      void main() {
        vec3 relative = aPosition - uOrigin;
        float depth = dot(relative, uForward);
        float w = mix(1.0, 1.0 - depth / 2.8, uPerspective);
        gl_Position = vec4(dot(relative, uRight) * (49.0 / 56.0),
          dot(relative, uUp) * (49.0 / 56.0), -depth / 2.8, w);
        vColor = aColor;
      }
    `);
    const fragmentShader = compile(gl.FRAGMENT_SHADER, `
      precision mediump float;
      varying vec3 vColor;
      uniform float uAlpha;
      void main() { gl_FragColor = vec4(vColor, uAlpha); }
    `);
    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    const meshes = new Map();
    for (const [mode, mesh] of [['rgb_cube', getCubePreviewMesh('rgb_cube')],
      ['hsv_cube', getCubePreviewMesh('hsv_cube')], ['hsv_cylinder', getCylinderPreviewMesh()]]) {
      const vertexBuffer = gl.createBuffer(), indexBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
      meshes.set(mode, { vertexBuffer, indexBuffer, indexCount: mesh.indices.length });
    }
    gl.useProgram(program);
    const stride = 6 * Float32Array.BYTES_PER_ELEMENT;
    const position = gl.getAttribLocation(program, 'aPosition');
    const color = gl.getAttribLocation(program, 'aColor');
    gl.enableVertexAttribArray(position);
    gl.enableVertexAttribArray(color);
    gl.viewport(0, 0, 112, 112);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.enable(gl.DEPTH_TEST);
    return { canvas, gl, program, meshes, position, color, stride,
      right: gl.getUniformLocation(program, 'uRight'), up: gl.getUniformLocation(program, 'uUp'),
      forward: gl.getUniformLocation(program, 'uForward'), origin: gl.getUniformLocation(program, 'uOrigin'),
      perspective: gl.getUniformLocation(program, 'uPerspective'), alpha: gl.getUniformLocation(program, 'uAlpha'),
      key: null };
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
      const active = this.drag?.type === `handle-${kind}`, hovered = this.hover?.type === `handle-${kind}`;
      this.line([position, point], active ? 'rgba(255,255,255,.95)' : hovered ? 'rgba(255,255,255,.8)' : 'rgba(255,255,255,.55)', active ? 2.5 : hovered ? 2 : 1);
      const size = active ? 8 : hovered ? 7 : 5;
      ctx.save();
      ctx.shadowColor = active ? '#fff' : hovered ? 'rgba(255,255,255,.8)' : 'transparent';
      ctx.shadowBlur = active ? 12 : hovered ? 7 : 0;
      ctx.beginPath(); ctx.moveTo(p.x, p.y - size); ctx.lineTo(p.x + size, p.y); ctx.lineTo(p.x, p.y + size); ctx.lineTo(p.x - size, p.y);
      ctx.closePath(); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#111'; ctx.lineWidth = 1; ctx.stroke();
      ctx.restore();
      if (!node.autoTangent) this.hitTargets.push({ type: `handle-${kind}`, index: this.selected, x: p.x, y: p.y, radius: 11 });
    }
    this.drawGizmo(position);
  }
  drawDragGuide(position, vectors, colors) {
    const drag = this.drag;
    if (!drag?.moved) return;
    const ctx = this.context;
    if (drag.type === 'hue' && this.curve.mode === 'hsv_cylinder') {
      const radius = Math.hypot(position[0], position[2]);
      if (radius <= .025) return;
      const circle = Array.from({ length: 129 }, (_, index) => {
        const angle = index / 128 * Math.PI * 2;
        return [Math.cos(angle) * radius, position[1], Math.sin(angle) * radius];
      });
      ctx.save(); ctx.globalAlpha = .55;
      this.line(circle, colors.z, 1.5);
      ctx.restore();
      return;
    }
    if (drag.type !== 'axis') return;
    const vector = vectors[drag.axis];
    if (!vector) return;
    const length = Math.hypot(...vector) || 1;
    const start = this.project(position);
    const sample = this.project(position.map((value, axis) => value + vector[axis] / length * .1));
    const screenLength = Math.hypot(sample.x - start.x, sample.y - start.y);
    if (screenLength < 1e-3) return;
    const direction = [(sample.x - start.x) / screenLength, (sample.y - start.y) / screenLength];
    const reach = Math.hypot(this.canvas.clientWidth, this.canvas.clientHeight);
    ctx.save(); ctx.globalAlpha = .55; ctx.strokeStyle = colors[drag.axis]; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(start.x - direction[0] * reach, start.y - direction[1] * reach);
    ctx.lineTo(start.x + direction[0] * reach, start.y + direction[1] * reach); ctx.stroke();
    ctx.restore();
  }
  hueHandleSpan(position, targetPixels = 65) {
    const radius = Math.hypot(position[0], position[2]);
    if (radius <= .025) return 0;
    const theta = Math.atan2(position[2], position[0]);
    const arcPixels = span => {
      let length = 0, previous = null;
      for (let index = 0; index <= 16; index++) {
        const angle = theta + (index / 16 - .5) * span;
        const projected = this.project([Math.cos(angle) * radius, position[1], Math.sin(angle) * radius]);
        if (previous) length += Math.hypot(projected.x - previous.x, projected.y - previous.y);
        previous = projected;
      }
      return length;
    };
    if (arcPixels(Math.PI) <= targetPixels) return Math.PI;
    let low = 0, high = Math.PI;
    for (let iteration = 0; iteration < 10; iteration++) {
      const middle = (low + high) / 2;
      if (arcPixels(middle) < targetPixels) low = middle;
      else high = middle;
    }
    return (low + high) / 2;
  }
  drawGizmo(position) {
    const ctx = this.context, mode = this.curve.mode;
    const vectors = mode === 'hsv_cylinder'
      ? { x: [-position[0], 0, -position[2]], y: [0, 1, 0] }
      : { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
    const colors = { x: '#ef6868', y: '#83d878', z: '#6aaafa' };
    this.drawDragGuide(position, vectors, colors);
    for (const [axis, vector] of Object.entries(vectors)) {
      if (this.axisMode !== 'all' && this.axisMode !== axis) continue;
      const length = Math.hypot(...vector) || 1;
      const start = this.project(position);
      const sample = this.project(position.map((value, index) => value + vector[index] / length * .1));
      const projectedLength = Math.hypot(sample.x - start.x, sample.y - start.y);
      if (projectedLength < 1e-3) continue;
      const direction = [(sample.x - start.x) / projectedLength, (sample.y - start.y) / projectedLength];
      const p = { x: start.x + direction[0] * 54, y: start.y + direction[1] * 54 };
      const active = this.drag?.type === 'axis' && this.drag.axis === axis;
      const hovered = this.hover?.type === 'axis' && this.hover.axis === axis;
      ctx.save(); ctx.shadowColor = colors[axis]; ctx.shadowBlur = active ? 14 : hovered ? 8 : 0;
      ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(p.x, p.y); ctx.strokeStyle = colors[axis]; ctx.lineWidth = active ? 5 : hovered ? 4 : 3; ctx.stroke();
      const angle = Math.atan2(p.y - start.y, p.x - start.x);
      const arrow = active ? 14 : hovered ? 12 : 10;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - Math.cos(angle - .55) * arrow, p.y - Math.sin(angle - .55) * arrow);
      ctx.lineTo(p.x - Math.cos(angle + .55) * arrow, p.y - Math.sin(angle + .55) * arrow); ctx.closePath(); ctx.fillStyle = colors[axis]; ctx.fill();
      ctx.restore();
      this.hitTargets.push({ type: 'axis', axis, index: this.selected, x: p.x, y: p.y, radius: 16, vector });
    }
    if (mode === 'hsv_cylinder' && (this.axisMode === 'all' || this.axisMode === 'z')) {
      const radius = Math.hypot(position[0], position[2]);
      if (radius > .025) {
        const theta = Math.atan2(position[2], position[0]);
        const span = this.hueHandleSpan(position);
        const points = Array.from({ length: 31 }, (_, index) => {
          const angle = theta + (index / 30 - .5) * span;
          return [Math.cos(angle) * radius, position[1], Math.sin(angle) * radius];
        });
        const active = this.drag?.type === 'hue', hovered = this.hover?.type === 'hue';
        ctx.save(); ctx.shadowColor = colors.z; ctx.shadowBlur = active ? 14 : hovered ? 8 : 0;
        this.line(points, colors.z, active ? 5 : hovered ? 4 : 3);
        for (const [endIndex, end] of [[0, points[0]], [1, points.at(-1)]]) {
          const p = this.project(end), neighbor = this.project(endIndex ? points.at(-2) : points[1]);
          const angle = Math.atan2(p.y - neighbor.y, p.x - neighbor.x);
          ctx.beginPath(); ctx.moveTo(p.x, p.y);
          const arrow = active ? 14 : hovered ? 12 : 10;
          ctx.lineTo(p.x - Math.cos(angle - .55) * arrow, p.y - Math.sin(angle - .55) * arrow);
          ctx.lineTo(p.x - Math.cos(angle + .55) * arrow, p.y - Math.sin(angle + .55) * arrow);
          ctx.closePath(); ctx.fillStyle = colors.z; ctx.fill();
          this.hitTargets.push({ type: 'hue', index: this.selected, x: p.x, y: p.y, radius: 15 });
        }
        ctx.restore();
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
    if (this.drag.type === 'hue' && node) {
      const fallback = !this.pointerOnCylinderPlane(event, node.position[1]);
      this.drag.hueScreenFallback = fallback;
      this.drag.hueLastAngle = this.huePointerAngle(event, node.position[1], fallback);
      this.drag.hueDelta = 0;
    }
    this.hover = target || null;
    this.canvas.style.cursor = target ? 'grabbing' : 'crosshair';
    this.draw();
  }
  pointerMove(event) {
    const drag = this.drag;
    if (!drag) {
      const target = this.targetAt(event);
      if (this.hover?.type !== target?.type || this.hover?.axis !== target?.axis || this.hover?.index !== target?.index) {
        this.hover = target || null;
        this.canvas.style.cursor = target ? 'grab' : 'crosshair';
        this.draw();
      }
      return;
    }
    if (!this.canvas.hasPointerCapture(event.pointerId)) return;
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
      const currentAngle = this.huePointerAngle(event, drag.position[1], drag.hueScreenFallback);
      const step = Math.atan2(Math.sin(currentAngle - drag.hueLastAngle), Math.cos(currentAngle - drag.hueLastAngle));
      drag.hueDelta += step;
      drag.hueLastAngle = currentAngle;
      node.position = [Math.cos(theta + drag.hueDelta) * radius, drag.position[1], Math.sin(theta + drag.hueDelta) * radius];
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
    this.hover = this.targetAt(event) || null;
    this.canvas.style.cursor = this.hover ? 'grab' : 'crosshair';
    this.draw();
  }
}
