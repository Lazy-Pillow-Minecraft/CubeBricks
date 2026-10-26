import { buildModifierRenderInstances } from '../model.js';
import { tiledFaceReference, tiledFaceRegions } from '../common/core/texture-features.js';
import { constrainCube, formatRules } from '../common/core/format-constraints.js';
import { buildPaintExplodeOffsets, applyPaintExplodeOffsets } from './paint-explode.js';
import { SELECTION_STRIPE_SIZE, SELECTION_STRIPE_PIXELS, selectionStripePhase } from '../utils/selection-stripes.js';

const DEG = Math.PI / 180;
const MIPPED_SUPERSAMPLE = 1.5;
const LOCATOR_ICON_PIXELS = 17;
const LOCATOR_NEAR_DISTANCE = 72;
const LOCATOR_MAX_PIXELS = 96;
const CUBE_LIFETIME_ANIMATION_MS = 60;
export function cubeLifetimeScale(kind, elapsed, duration = CUBE_LIFETIME_ANIMATION_MS) {
  const progress = clamp(elapsed / duration, 0, 1);
  const t = kind === 'birth' ? progress : 1 - progress;
  return t < .7 ? 1.05 * t / .7 : 1.05 - .05 * (t - .7) / .3;
}
const IDENTITY_MATRIX = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

// Minecraft-like pass order: opaque geometry writes depth first, then overlays.
// Cutout/translucent passes are reserved here so textures can join the same pipeline.
export const RenderPass = Object.freeze({
  SOLID: 'solid',
  CUTOUT: 'cutout',
  TRANSLUCENT: 'translucent'
});

export const MinecraftRenderType = Object.freeze({
  SOLID: 'solid',
  SOLID_SMOOTH: 'solid_smooth',
  CUTOUT: 'cutout',
  CUTOUT_SMOOTH: 'cutout_smooth',
  TRANSLUCENT: 'translucent',
  TRANSLUCENT_SMOOTH: 'translucent_smooth'
});

const MINECRAFT_RENDER_TYPES = Object.freeze({
  // `smooth` means a supersampled screen resolve. It must never change how
  // the model texture itself is sampled; Minecraft pixel art stays NEAREST.
  [MinecraftRenderType.SOLID]: { pass: RenderPass.SOLID, smooth: false, alphaMode: 0, blend: false, cull: true, depthWrite: true },
  [MinecraftRenderType.SOLID_SMOOTH]: { pass: RenderPass.SOLID, smooth: true, alphaMode: 0, blend: false, cull: true, depthWrite: true },
  [MinecraftRenderType.CUTOUT]: { pass: RenderPass.CUTOUT, smooth: false, alphaMode: 1, blend: false, cull: true, depthWrite: true },
  [MinecraftRenderType.CUTOUT_SMOOTH]: { pass: RenderPass.CUTOUT, smooth: true, alphaMode: 1, blend: false, cull: true, depthWrite: true },
  [MinecraftRenderType.TRANSLUCENT]: { pass: RenderPass.TRANSLUCENT, smooth: false, alphaMode: 2, blend: true, cull: false, depthWrite: true },
  [MinecraftRenderType.TRANSLUCENT_SMOOTH]: { pass: RenderPass.TRANSLUCENT, smooth: true, alphaMode: 2, blend: true, cull: false, depthWrite: true }
});

export function getMinecraftRenderType(id) {
  return MINECRAFT_RENDER_TYPES[id] || MINECRAFT_RENDER_TYPES[MinecraftRenderType.CUTOUT];
}

// Each face is expressed in Blockbench's four UV vertex slots:
// top-left, top-right, bottom-left, bottom-right. The triangle order mirrors
// Blockbench's BoxGeometry index order: 0,2,1 and 2,3,1.
const FACE_LAYOUTS = Object.freeze({
  south: [7, 6, 4, 5],
  north: [2, 3, 1, 0],
  east: [6, 2, 5, 1],
  west: [3, 7, 0, 4],
  up: [3, 2, 7, 6],
  down: [4, 5, 0, 1]
});
const FACE_TRIANGLE_SLOTS = [0, 2, 1, 2, 3, 1];
const FACE_PREVIEW_COLORS = Object.freeze({
  north: [0.91, 0.38, 0.35],
  south: [0.94, 0.67, 0.28],
  east: [0.27, 0.65, 0.92],
  west: [0.62, 0.43, 0.86],
  up: [0.48, 0.82, 0.42],
  down: [0.28, 0.50, 0.48]
});

export class WebGLSceneRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl', {
      alpha: true,
      // Native MSAA keeps editor lines (grid, selection and bounds) smooth in
      // every render type. Mipped modes add a separate full-scene SSAA pass.
      antialias: true,
      depth: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false
    });
    if (!this.gl) throw new Error('WebGL is unavailable.');

    this.logDepthEnabled = Boolean(this.gl.getExtension('EXT_frag_depth'));
    this.selectionDerivativesEnabled = Boolean(this.gl.getExtension('OES_standard_derivatives'));
    const selectionShaderPrelude = this.selectionDerivativesEnabled
      ? '#extension GL_OES_standard_derivatives : enable\n#define SCREEN_SELECTION_DERIVATIVES\n' : '';
    this.program = createProgram(this.gl, VERTEX_SHADER, selectionShaderPrelude
      + (this.logDepthEnabled ? LOG_DEPTH_FRAGMENT_SHADER : FRAGMENT_SHADER));
    this.postProgram = createProgram(this.gl, POST_VERTEX_SHADER, SSAA_RESOLVE_FRAGMENT_SHADER);
    this.copyProgram = createProgram(this.gl, POST_VERTEX_SHADER, COPY_FRAGMENT_SHADER);
    this.layerProgram = createProgram(this.gl, POST_VERTEX_SHADER, LOCKED_COMPOSITE_FRAGMENT_SHADER);
    this.positionLocation = this.gl.getAttribLocation(this.program, 'aPosition');
    this.colorLocation = this.gl.getAttribLocation(this.program, 'aColor');
    this.normalLocation = this.gl.getAttribLocation(this.program, 'aNormal');
    this.uvLocation = this.gl.getAttribLocation(this.program, 'aUv');
    this.matrixLocation = this.gl.getUniformLocation(this.program, 'uViewProjection');
    this.modelTransformLocation = this.gl.getUniformLocation(this.program, 'uModelTransform');
    this.light0Location = this.gl.getUniformLocation(this.program, 'uLight0Direction');
    this.light1Location = this.gl.getUniformLocation(this.program, 'uLight1Direction');
    this.previewShadeLocation = this.gl.getUniformLocation(this.program, 'uPreviewShade');
    this.renderModeLocation = this.gl.getUniformLocation(this.program, 'uRenderMode');
    this.alphaModeLocation = this.gl.getUniformLocation(this.program, 'uAlphaMode');
    this.opacityLocation = this.gl.getUniformLocation(this.program, 'uOpacity');
    this.colorOverrideLocation = this.gl.getUniformLocation(this.program, 'uColorOverride');
    this.textureLocation = this.gl.getUniformLocation(this.program, 'uTexture');
    this.paintPixelGridLocation = this.gl.getUniformLocation(this.program, 'uPaintPixelGrid');
    this.paintGridSizeLocation = this.gl.getUniformLocation(this.program, 'uPaintGridSize');
    this.selectionMaskLocation = this.gl.getUniformLocation(this.program, 'uSelectionMask');
    this.selectionActiveLocation = this.gl.getUniformLocation(this.program, 'uSelectionActive');
    this.selectionTexelLocation = this.gl.getUniformLocation(this.program, 'uSelectionTexel');
    this.selectionPixelRadiusLocation = this.gl.getUniformLocation(this.program, 'uSelectionPixelRadius');
    this.selectionPhaseLocation = this.gl.getUniformLocation(this.program, 'uSelectionPhase');
    this.selectionStripeLocation = this.gl.getUniformLocation(this.program, 'uSelectionStripe');
    this.selectionStripeViewportLocation = this.gl.getUniformLocation(this.program, 'uSelectionStripeViewport');
    this.useLogDepthLocation = this.gl.getUniformLocation(this.program, 'uUseLogDepth');
    this.logDepthFactorLocation = this.gl.getUniformLocation(this.program, 'uLogDepthFactor');
    this.postPositionLocation = this.gl.getAttribLocation(this.postProgram, 'aPosition');
    this.postTextureLocation = this.gl.getUniformLocation(this.postProgram, 'uScreenTexture');
    this.postResolutionLocation = this.gl.getUniformLocation(this.postProgram, 'uResolution');
    this.copyPositionLocation = this.gl.getAttribLocation(this.copyProgram, 'aPosition');
    this.copyTextureLocation = this.gl.getUniformLocation(this.copyProgram, 'uScreenTexture');
    this.layerPositionLocation = this.gl.getAttribLocation(this.layerProgram, 'aPosition');
    this.layerTextureLocation = this.gl.getUniformLocation(this.layerProgram, 'uScreenTexture');
    this.layerResolutionLocation = this.gl.getUniformLocation(this.layerProgram, 'uOutputResolution');
    this.layerPointerLocation = this.gl.getUniformLocation(this.layerProgram, 'uPointer');
    this.layerHoverRadiusLocation = this.gl.getUniformLocation(this.layerProgram, 'uHoverRadius');
    this.layerBaseOpacityLocation = this.gl.getUniformLocation(this.layerProgram, 'uBaseOpacity');
    this.layerHoverOpacityLocation = this.gl.getUniformLocation(this.layerProgram, 'uHoverOpacity');
    this.layerHoverStrengthLocation = this.gl.getUniformLocation(this.layerProgram, 'uHoverStrength');
    this.layerHoverEnabledLocation = this.gl.getUniformLocation(this.layerProgram, 'uHoverEnabled');
    this.dynamicBuffer = this.gl.createBuffer();
    this.staticTriangleBuffer = this.gl.createBuffer();
    this.staticWireBuffer = this.gl.createBuffer();
    this.visibleStaticTriangleBuffer = this.gl.createBuffer();
    this.visibleStaticWireBuffer = this.gl.createBuffer();
    this.selectedTriangleBuffer = this.gl.createBuffer();
    this.selectedWireBuffer = this.gl.createBuffer();
    this.faceSelectionBuffer = this.gl.createBuffer();
    this.ghostWireBuffer = this.gl.createBuffer();
    this.lockedBatchBuffers = [this.gl.createBuffer(), this.gl.createBuffer(), this.gl.createBuffer(), this.gl.createBuffer()];
    this.lockedOutlineBuffer = this.gl.createBuffer();
    this.postQuadBuffer = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.postQuadBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 1, -1, -1, 1,
      -1, 1, 1, -1, 1, 1
    ]), this.gl.STATIC_DRAW);
    this.postFramebuffer = this.gl.createFramebuffer();
    this.postColorTexture = this.gl.createTexture();
    this.postDepthBuffer = this.gl.createRenderbuffer();
    this.postTargetSize = { width: 0, height: 0 };
    this.baseColorTexture = this.gl.createTexture();
    this.baseTargetSize = { width: 0, height: 0 };
    this.lockedFramebuffer = this.gl.createFramebuffer();
    this.lockedColorTexture = this.gl.createTexture();
    this.lockedDepthBuffer = this.gl.createRenderbuffer();
    this.lockedTargetSize = { width: 0, height: 0 };
    this.ghostWireCount = 0;
    this.texture = this.gl.createTexture();
    this.selectionMaskTexture = this.gl.createTexture();
    this.selectionStripeTexture = this.gl.createTexture();
    this.selectionMaskReady = false;
    this.selectionMaskSize = [1, 1];
    this.textureLayout = null;
    this.textureLayoutKey = '';
    this.texturePixelSize = [1, 1];
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
    this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, 1, 1, 0, this.gl.RGBA, this.gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.selectionMaskTexture);
    this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, 1, 1, 0, this.gl.RGBA, this.gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    for (const parameter of [this.gl.TEXTURE_MIN_FILTER, this.gl.TEXTURE_MAG_FILTER])
      this.gl.texParameteri(this.gl.TEXTURE_2D, parameter, this.gl.NEAREST);
    for (const parameter of [this.gl.TEXTURE_WRAP_S, this.gl.TEXTURE_WRAP_T])
      this.gl.texParameteri(this.gl.TEXTURE_2D, parameter, this.gl.CLAMP_TO_EDGE);
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.selectionStripeTexture);
    this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA,
      SELECTION_STRIPE_SIZE, SELECTION_STRIPE_SIZE, 0, this.gl.RGBA,
      this.gl.UNSIGNED_BYTE, SELECTION_STRIPE_PIXELS);
    for (const parameter of [this.gl.TEXTURE_MIN_FILTER, this.gl.TEXTURE_MAG_FILTER])
      this.gl.texParameteri(this.gl.TEXTURE_2D, parameter, this.gl.NEAREST);
    for (const parameter of [this.gl.TEXTURE_WRAP_S, this.gl.TEXTURE_WRAP_T])
      this.gl.texParameteri(this.gl.TEXTURE_2D, parameter, this.gl.REPEAT);
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
    this.playerReferenceBuffer = this.gl.createBuffer();
    this.playerReferenceTexture = this.gl.createTexture();
    this.playerReferenceVertexCount = 0;
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.playerReferenceTexture);
    this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, 1, 1, 0, this.gl.RGBA, this.gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    this.faceLabelTexture = this.gl.createTexture();
    this.faceLabelTextureKey = null;
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.faceLabelTexture);
    this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, 1, 1, 0, this.gl.RGBA, this.gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
    this.lastViewProjection = identity();
    this.lastViewport = { width: 1, height: 1 };
    this.lastCameraState = null;
    this.lastCameraInput = null;
    this.lastOwnerPoints = new Map();
    this.lastHelperPoints = [];
    this.geometryRevision = 0;
    this.selectionRevision = 0;
    this.staticCache = null;
    this.paintExplodeOffsets = new Map();
    this.selectedCache = null;
    this.faceSelectionCache = null;
    this.mirrorCache = null;
    this.mirrorRevision = 0;
    this.selectedGeometryDirty = false;
    this.selectionDescriptorCache = null;
    this.visibleStaticBatchCache = null;
    this.lockedBatchCache = null;
    this.lockRevision = 0;
    this.lockedStateCache = null;
    this.lastLockedUids = new Set();
    this.lastNodeByUid = new Map();
    this.lastOverlayState = null;
    this.selectionOutline = hexToRgb('#d8f59b');
    this.selectionPreviewTransform = null;
    this.cubeTransitionSource = null;
    this.cubeTransitions = [];
    this.cubeBirthUids = new Set();
    this.cubeBirthStartByUid = new Map();
    this.cubeTransitionRevision = -1;
    this.cubeBirthMs = CUBE_LIFETIME_ANIMATION_MS;
    this.cubeDeathMs = CUBE_LIFETIME_ANIMATION_MS;

    this.gl.enable(this.gl.DEPTH_TEST);
    this.gl.depthFunc(this.gl.LEQUAL);
    this.gl.enable(this.gl.CULL_FACE);
    this.gl.cullFace(this.gl.BACK);
    this.gl.frontFace(this.gl.CCW);
  }

  setTexture(source) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    this.texturePixelSize = [source.width, source.height];
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (this.textureLayout) {
      this.textureLayout = null;
      this.textureLayoutKey = '';
      this.invalidateGeometry();
    }
  }

  setSelectionMaskAtlas(source) {
    if (!source?.width || !source?.height) { this.selectionMaskReady = false; return; }
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.selectionMaskTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    this.selectionMaskSize = [source.width, source.height];
    this.selectionMaskReady = true;
    gl.activeTexture(gl.TEXTURE0);
  }

  setPlayerReference(project, source) {
    const geometry = buildElementGeometry(project, project?.elements || [], null, [1, 1, 1], false, null);
    this.uploadBuffer(this.playerReferenceBuffer, geometry.triangles, this.gl.STATIC_DRAW);
    this.playerReferenceVertexCount = geometry.triangles.length / 12;
    if (!source) return;
    const { gl } = this;
    gl.bindTexture(gl.TEXTURE_2D, this.playerReferenceTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  setTextureAtlas(source, entries = []) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    this.texturePixelSize = [source.width, source.height];
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const key = `${source.width}x${source.height}:` + entries.map(entry =>
      `${entry.uid}:${entry.mode}:${entry.x},${entry.y},${entry.width},${entry.height}:${entry.uvWidth},${entry.uvHeight}:${(entry.references || []).join(',')}`).join('|');
    if (key === this.textureLayoutKey) return;
    const byReference = new Map();
    let defaultEntry = null;
    for (const entry of entries) {
      if (entry.default && !defaultEntry) defaultEntry = entry;
      for (const reference of entry.references || []) {
        const raw = String(reference);
        byReference.set(raw, entry);
        byReference.set(raw.startsWith('#') ? raw.slice(1) : `#${raw}`, entry);
      }
    }
    this.textureLayout = { width: source.width, height: source.height, byReference, defaultEntry: defaultEntry || entries[0] || null };
    this.textureLayoutKey = key;
    this.invalidateGeometry();
  }

  updateTextureAtlasRegion(source, x, y) {
    if (!this.textureLayout || !source) return false;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    const destinationY = this.textureLayout.height - y - source.height;
    gl.texSubImage2D(gl.TEXTURE_2D, 0, x, destinationY, gl.RGBA, gl.UNSIGNED_BYTE, source);
    return true;
  }

  setSelectionOutline(color) {
    this.selectionOutline = hexToRgb(color);
    this.invalidateSelectionGeometry(false);
  }

  applyTextureSampling() {
    const { gl } = this;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  }

  ensurePostProcessTarget(width, height) {
    if (this.postTargetSize.width === width && this.postTargetSize.height === height) return;
    const { gl } = this;
    this.postTargetSize = { width, height };
    gl.bindTexture(gl.TEXTURE_2D, this.postColorTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.postDepthBuffer);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, width, height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.postFramebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.postColorTexture, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.postDepthBuffer);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error('Unable to create the screen antialias render target.');
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  ensureLockedLayerTarget(width, height) {
    if (this.lockedTargetSize.width === width && this.lockedTargetSize.height === height) return;
    const { gl } = this;
    this.lockedTargetSize = { width, height };
    gl.bindTexture(gl.TEXTURE_2D, this.lockedColorTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.lockedDepthBuffer);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, width, height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.lockedFramebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.lockedColorTexture, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.lockedDepthBuffer);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error('Unable to create the locked-object render target.');
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  captureBaseFrame(width, height) {
    const { gl } = this;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, this.baseColorTexture);
    if (this.baseTargetSize.width !== width || this.baseTargetSize.height !== height) {
      this.baseTargetSize = { width, height };
      gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 0, 0, width, height, 0);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    } else gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, width, height);
  }

  restoreBaseFrame(width, height) {
    const { gl } = this;
    if (this.baseTargetSize.width !== width || this.baseTargetSize.height !== height) return false;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.useProgram(this.copyProgram);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.postQuadBuffer);
    gl.enableVertexAttribArray(this.copyPositionLocation);
    gl.vertexAttribPointer(this.copyPositionLocation, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.baseColorTexture);
    gl.uniform1i(this.copyTextureLocation, 0);
    gl.depthMask(false);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
    return true;
  }

  compositeLockedLayer(camera, targetFramebuffer, width, height) {
    const { gl } = this;
    gl.bindFramebuffer(gl.FRAMEBUFFER, targetFramebuffer);
    gl.viewport(0, 0, width, height);
    gl.useProgram(this.layerProgram);
    gl.uniform2f(this.layerResolutionLocation, width, height);
    const baseOpacity = clamp(Number(camera.lockedDefaultAlpha ?? 100) / 100, 0, 1);
    const hoverOpacity = clamp(Number(camera.lockedHoverAlpha ?? 50) / 100, 0, 1);
    const strength = clamp(Number(camera.lockedHoverStrength ?? 0), 0, 1);
    const point = camera.lockedHoverPoint;
    const hoverEnabled = camera.lockedHoverFade !== false && Array.isArray(point) && strength > 0;
    const scaleX = width / Math.max(1, this.lastViewport.width);
    const scaleY = height / Math.max(1, this.lastViewport.height);
    gl.uniform2f(this.layerPointerLocation,
      hoverEnabled ? point[0] * scaleX : -100000,
      hoverEnabled ? (this.lastViewport.height - point[1]) * scaleY : -100000);
    gl.uniform1f(this.layerHoverRadiusLocation,
      Math.max(1, Number(camera.lockedHoverRadius ?? 120) * (scaleX + scaleY) * .5));
    gl.uniform1f(this.layerBaseOpacityLocation, baseOpacity);
    gl.uniform1f(this.layerHoverOpacityLocation, hoverOpacity);
    gl.uniform1f(this.layerHoverStrengthLocation, strength);
    gl.uniform1i(this.layerHoverEnabledLocation, hoverEnabled ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.lockedColorTexture);
    gl.uniform1i(this.layerTextureLocation, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.postQuadBuffer);
    gl.enableVertexAttribArray(this.layerPositionLocation);
    gl.vertexAttribPointer(this.layerPositionLocation, 2, gl.FLOAT, false, 0, 0);
    gl.depthMask(false);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    // The viewport is transparent outside the model. Preserve the alpha of
    // opaque geometry behind this faded layer instead of fading the canvas too.
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
  }

  drawLockedOverlay(project, camera, minecraftRenderType, dynamicUids, lockedUids,
    ownerPoints, viewProjection, targetFramebuffer, outputWidth, outputHeight, layerWidth, layerHeight) {
    if (!lockedUids.size) {
      this.lastOverlayState = null;
      return;
    }
    const { gl } = this;
    this.captureBaseFrame(outputWidth, outputHeight);
    this.renderLockedLayer(project, camera, minecraftRenderType, dynamicUids, lockedUids,
      viewProjection, layerWidth, layerHeight);
    this.compositeLockedLayer(camera, targetFramebuffer, outputWidth, outputHeight);
    this.lastOverlayState = {
      project, minecraftRenderType, dynamicUids, lockedUids, ownerPoints, viewProjection,
      targetFramebuffer, outputWidth, outputHeight
    };
  }

  redrawLockedOverlay(camera) {
    const overlay = this.lastOverlayState;
    if (!overlay || !this.restoreBaseFrame(overlay.outputWidth, overlay.outputHeight)) return false;
    this.compositeLockedLayer(camera, overlay.targetFramebuffer, overlay.outputWidth, overlay.outputHeight);
    this.drawEditorLines(overlay.project, camera, overlay.dynamicUids, overlay.lockedUids,
      overlay.ownerPoints, overlay.viewProjection);
    this.lastCameraInput = { ...this.lastCameraInput, ...camera };
    return true;
  }

  drawModifierGhostOverlay(project, camera, minecraftRenderType, dynamicUids, lockedUids,
    viewProjection, targetFramebuffer, width, height) {
    if (!camera.modifierResultGhost || !this.mirrorCache?.instances.length) return;
    const { gl } = this;
    this.ensureLockedLayerTarget(width, height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.lockedFramebuffer);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    // Resolve all generated surfaces into one opaque, depth-tested layer.
    // Existing geometry and the ground grid only populate depth, so they can
    // occlude the result while remaining visible through its final 75% fade.
    gl.colorMask(false, false, false, false);
    this.drawGrid(camera, viewProjection);
    this.drawPlayerReference(camera, viewProjection);
    this.drawSurfaceGeometry(project, camera, minecraftRenderType, dynamicUids, lockedUids,
      viewProjection, this.lastCameraState);
    if (lockedUids.size) this.drawLockedGeometry(project, camera, minecraftRenderType,
      dynamicUids, lockedUids, viewProjection, true);
    gl.colorMask(true, true, true, true);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const wireframe = camera.renderMode === 'wireframe';
    const pipeline = camera.renderMode === 'textured'
      ? minecraftRenderType : MINECRAFT_RENDER_TYPES[MinecraftRenderType.SOLID];
    const primitive = wireframe ? gl.LINES : gl.TRIANGLES;
    const options = wireframe
      ? { depthWrite: true, cull: false, renderMode: 0, blend: false }
      : { depthWrite: true, cull: project.cullFaces, renderMode: getSurfaceRenderMode(camera.renderMode),
          alphaMode: pipeline.alphaMode, blend: false };
    this.drawMirrorInstances(dynamicUids, lockedUids, primitive, viewProjection, options, { ghostOnly: true });
    if (lockedUids.size) this.drawMirrorInstances(dynamicUids, lockedUids, primitive,
      viewProjection, options, { ghostOnly: true, lockedOnly: true });
    this.compositeLockedLayer({ lockedDefaultAlpha: 75, lockedHoverFade: false },
      targetFramebuffer, width, height);
  }

  presentAntialiased(outputWidth, outputHeight, sourceWidth, sourceHeight) {
    const { gl } = this;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, outputWidth, outputHeight);
    gl.useProgram(this.postProgram);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.postQuadBuffer);
    gl.enableVertexAttribArray(this.postPositionLocation);
    gl.vertexAttribPointer(this.postPositionLocation, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.postColorTexture);
    gl.uniform1i(this.postTextureLocation, 0);
    gl.uniform2f(this.postResolutionLocation, sourceWidth, sourceHeight);
    gl.depthMask(false);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
  }

  invalidateGeometry() {
    if (this.staticCache && !this.cubeTransitionSource) this.cubeTransitionSource = this.staticCache;
    this.geometryRevision += 1;
    this.selectionRevision += 1;
    this.staticCache = null;
    this.selectedCache = null;
    this.faceSelectionCache = null;
    this.mirrorRevision += 1;
    this.mirrorCache = null;
    this.selectedGeometryDirty = false;
    this.selectionDescriptorCache = null;
    this.visibleStaticBatchCache = null;
    this.lockedBatchCache = null;
    this.lockedStateCache = null;
    this.selectionPreviewTransform = null;
  }

  invalidateSelectionGeometry(geometryChanged = true) {
    if (geometryChanged) {
      this.selectedGeometryDirty = true;
      this.mirrorCache?.rangeCache?.clear();
    }
    this.selectionRevision += 1;
    this.selectedCache = null;
    this.faceSelectionCache = null;
    this.lockedBatchCache = null;
  }

  hasActiveCubeTransitions() {
    // Also request one final frame if the last animation elapsed while this
    // frame was being drawn; that frame restores the ordinary merged mesh.
    return this.cubeTransitions.length > 0;
  }

  reconcileCubeTransitions(project) {
    if (this.cubeTransitionRevision === this.geometryRevision) return;
    this.cubeTransitionRevision = this.geometryRevision;
    const previous = this.cubeTransitionSource;
    this.cubeTransitionSource = null;
    this.cubeTransitions = this.cubeTransitions.filter(transition => {
      if (performance.now() - transition.started < transition.duration) return true;
      this.gl.deleteBuffer(transition.buffer);
      this.gl.deleteBuffer(transition.wireBuffer);
      return false;
    });
    this.cubeBirthUids = new Set();
    this.cubeBirthStartByUid = new Map();
    if (!previous || previous.project !== project) return;
    const current = this.staticCache;
    const born = [], gone = [];
    for (const [uid, cubes] of current.cubePoints) {
      if (!cubes.length) continue;
      const oldCount = previous.cubePoints.get(uid)?.length || 0;
      if (cubes.length > oldCount) born.push({ uid, from: oldCount });
    }
    for (const [uid, cubes] of previous.cubePoints) {
      if (!cubes.length) continue;
      const newCount = current.cubePoints.get(uid)?.length || 0;
      if (cubes.length > newCount) gone.push({ uid, from: newCount });
    }
    const makeBatch = (cache, entries, kind) => {
      if (!entries.length) return;
      const triangleRanges = entries.flatMap(({ uid, from }) =>
        (cache.cubeTriangleRanges.get(uid) || []).slice(from)).filter(range => range?.count);
      if (!triangleRanges.length) return;
      const wireRanges = entries.flatMap(({ uid, from }) =>
        (cache.cubeEdgeRanges.get(uid) || []).slice(from)).filter(range => range?.count);
      const gather = (source, ranges) => {
        const count = ranges.reduce((sum, range) => sum + range.count, 0);
        const result = new Float32Array(count * 12);
        let offset = 0;
        for (const range of ranges) {
          const values = source.slice(range.start * 12, (range.start + range.count) * 12);
          result.set(values, offset);
          offset += values.length;
        }
        return result;
      };
      const vertices = gather(cache.triangles, triangleRanges);
      const wires = gather(cache.edges, wireRanges);
      const points = entries.flatMap(({ uid, from }) =>
        (cache.cubePoints.get(uid) || []).slice(from).flat());
      const center = geometryBounds(points)?.center;
      if (!center) return;
      const buffer = this.gl.createBuffer(), wireBuffer = this.gl.createBuffer();
      this.uploadBuffer(buffer, vertices, this.gl.STATIC_DRAW);
      this.uploadBuffer(wireBuffer, wires, this.gl.STATIC_DRAW);
      this.cubeTransitions.push({ project, kind, started: performance.now(),
        duration: kind === 'birth' ? this.cubeBirthMs : this.cubeDeathMs, center, entries,
        buffer, wireBuffer, triangleCount: vertices.length / 12, wireCount: wires.length / 12 });
      if (kind === 'birth') for (const { uid, from } of entries) {
        this.cubeBirthStartByUid.set(uid, from);
        if (from === 0) this.cubeBirthUids.add(uid);
      }
    };
    if (this.cubeBirthMs > 0) makeBatch(current, born, 'birth');
    if (this.cubeDeathMs > 0) makeBatch(previous, gone, 'death');
    this.visibleStaticBatchCache = null;
  }

  drawCubeTransitions(project, camera, viewProjection, primitive) {
    const now = this.cubeTransitionFrameTime ?? performance.now();
    const pipeline = camera.renderMode === 'textured'
      ? getMinecraftRenderType(project.renderType)
      : MINECRAFT_RENDER_TYPES[MinecraftRenderType.SOLID];
    for (const transition of this.cubeTransitions) {
      const progress = Math.min(1, (now - transition.started) / transition.duration);
      if (progress >= 1) continue;
      const scale = cubeLifetimeScale(transition.kind, now - transition.started, transition.duration);
      const matrix = scaleAroundPoint(transition.center, Math.max(.0001, scale));
      this.drawBuffer(primitive === this.gl.LINES ? transition.wireBuffer : transition.buffer,
        primitive === this.gl.LINES ? transition.wireCount : transition.triangleCount,
        primitive, viewProjection, primitive === this.gl.LINES
          ? { modelTransform: matrix, cull: false, renderMode: 0, depthWrite: true }
          : { modelTransform: matrix, cull: project.cullFaces,
              renderMode: getSurfaceRenderMode(camera.renderMode),
              alphaMode: pipeline.alphaMode, blend: pipeline.blend,
              depthWrite: pipeline.depthWrite });
    }
  }

  invalidateMirrorGeometry() {
    this.mirrorRevision += 1;
  }

  invalidateLockState() {
    this.lockRevision += 1;
    this.lockedStateCache = null;
    this.lockedBatchCache = null;
    this.visibleStaticBatchCache = null;
  }

  getLockedState(project) {
    if (this.lockedStateCache?.project === project
      && this.lockedStateCache.revision === this.lockRevision) return this.lockedStateCache;
    this.lockedStateCache = {
      project,
      revision: this.lockRevision,
      ...collectLockedState(project)
    };
    return this.lockedStateCache;
  }

  getSelectionDescriptor(project, selection) {
    const selectionRef = selection && typeof selection !== 'string' ? selection : selection || null;
    const selectionSize = typeof selection === 'string' ? 1 : selection?.size || 0;
    if (this.selectionDescriptorCache?.project === project
      && this.selectionDescriptorCache.selectionRef === selectionRef
      && this.selectionDescriptorCache.selectionSize === selectionSize) return this.selectionDescriptorCache;
    const selectedUids = normalizeSelectedNodeUids(selection);
    const dynamicUids = getDynamicElementUids(project, selectedUids);
    this.selectionDescriptorCache = {
      project,
      selectionRef,
      selectionSize,
      selectedUids,
      selectedKey: [...selectedUids].sort().join('|'),
      dynamicUids,
      dynamicKey: [...dynamicUids].sort().join('|')
    };
    return this.selectionDescriptorCache;
  }

  hasLockedObjects() {
    return this.lastLockedUids.size > 0;
  }

  isLocked(uid) {
    return this.lastLockedUids.has(uid);
  }

  beginTransformGhost() {
    if (!this.selectedCache?.edges?.length) {
      this.ghostWireCount = 0;
      return;
    }
    const ghost = [...this.selectedCache.edges];
    for (let offset = 0; offset < ghost.length; offset += 12) {
      ghost[offset + 3] = .28;
      ghost[offset + 4] = .32;
      ghost[offset + 5] = .26;
      ghost[offset + 6] = .68;
    }
    this.uploadBuffer(this.ghostWireBuffer, ghost, this.gl.STATIC_DRAW);
    this.ghostWireCount = ghost.length / 12;
  }

  setSelectionPreviewTransform(matrix) {
    this.selectionPreviewTransform = matrix ? [...matrix] : null;
  }

  clearSelectionPreviewTransform() {
    this.selectionPreviewTransform = null;
  }

  transformSelectionPreviewPoint(point) {
    if (!this.selectionPreviewTransform) return [...point];
    return transform(this.selectionPreviewTransform, [...point, 1]).slice(0, 3);
  }

  endTransformGhost() {
    this.ghostWireCount = 0;
  }

  commitSelectionGeometry(project, selection) {
    if (!this.staticCache || this.staticCache.project !== project || !selection) return false;
    if (!this.selectedGeometryDirty) return true;
    const dynamicUids = getDynamicElementUids(project, selection);
    if (!dynamicUids.size) return false;
    const elements = project.elements.filter(element => dynamicUids.has(element.uid));
    const geometry = buildElementGeometry(project, elements, null, [1, 1, 1], false, this.textureLayout);
    for (const uid of dynamicUids) {
      const checks = [
        [this.staticCache.triangleRanges.get(uid), geometry.triangleRanges.get(uid)],
        [this.staticCache.edgeRanges.get(uid), geometry.edgeRanges.get(uid)],
        [this.staticCache.helperRanges.get(uid), geometry.helperRanges.get(uid)]
      ];
      if (checks.some(([target, source]) => !target || !source || target.count !== source.count)) {
        this.invalidateGeometry();
        return false;
      }
    }
    this.patchGeometryBuffer(this.staticTriangleBuffer, this.staticCache.triangles, this.staticCache.triangleRanges, geometry.triangles, geometry.triangleRanges, dynamicUids);
    this.patchGeometryBuffer(this.staticWireBuffer, this.staticCache.edges, this.staticCache.edgeRanges, geometry.edges, geometry.edgeRanges, dynamicUids);
    patchVertexArrays(this.staticCache.helpers, this.staticCache.helperRanges, geometry.helpers, geometry.helperRanges, dynamicUids);
    this.staticCache.faces = this.staticCache.faces.filter(face => !dynamicUids.has(face.uid)).concat(geometry.faces);
    this.staticCache.faceIndex = indexFaces(this.staticCache.faces);
    this.staticCache.faceBvh = buildFaceBvh(this.staticCache.faces);
    for (const uid of dynamicUids) {
      if (geometry.ownerPoints.has(uid)) this.staticCache.ownerPoints.set(uid, geometry.ownerPoints.get(uid));
      else this.staticCache.ownerPoints.delete(uid);
      this.staticCache.cubePoints.set(uid, geometry.cubePoints.get(uid) || []);
    }
    this.selectedGeometryDirty = false;
    return true;
  }

  patchGeometryBuffer(buffer, targetVertices, targetRanges, sourceVertices, sourceRanges, uids) {
    const { gl } = this;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    for (const uid of uids) {
      const target = targetRanges.get(uid), source = sourceRanges.get(uid);
      if (!target?.count) continue;
      const sourceStart = source.start * 12;
      const sourceEnd = sourceStart + source.count * 12;
      const values = new Float32Array(sourceVertices.slice(sourceStart, sourceEnd));
      gl.bufferSubData(gl.ARRAY_BUFFER, target.start * 48, values);
      for (let index = 0; index < values.length; index++) targetVertices[target.start * 12 + index] = values[index];
    }
  }

  drawBufferExcluding(buffer, totalCount, excludedUids, rangesByUid, primitive, matrix, options = {}) {
    const cache = buffer === this.selectedTriangleBuffer || buffer === this.selectedWireBuffer
      ? this.selectedCache : this.staticCache;
    const cubeRanges = primitive === this.gl.LINES ? cache?.cubeEdgeRanges : cache?.cubeTriangleRanges;
    const births = [...this.cubeBirthStartByUid].flatMap(([uid, from]) =>
      (cubeRanges?.get(uid) || []).slice(from));
    for (const range of complementVertexRanges(totalCount, excludedUids, rangesByUid, births)) {
      this.drawBuffer(buffer, range.count, primitive, matrix, { ...options, first: range.start });
    }
  }

  ensureVisibleStaticBatches(dynamicUids, lockedUids) {
    const dynamicKey = this.currentDynamicElementKey ?? [...dynamicUids].sort().join('|');
    const lockedKey = this.currentLockedKey ?? [...lockedUids].sort().join('|');
    const birthKey = [...this.cubeBirthStartByUid].sort(([left], [right]) => left.localeCompare(right)).join('|');
    const key = `${this.geometryRevision}::${dynamicKey}::${lockedKey}::${birthKey}`;
    if (this.visibleStaticBatchCache?.project === this.staticCache.project
      && this.visibleStaticBatchCache.key === key) return this.visibleStaticBatchCache;
    const excluded = new Set([...dynamicUids, ...lockedUids, ...this.cubeBirthUids]);
    const birthTriangles = [...this.cubeBirthStartByUid].flatMap(([uid, from]) =>
      (this.staticCache.cubeTriangleRanges.get(uid) || []).slice(from));
    const birthEdges = [...this.cubeBirthStartByUid].flatMap(([uid, from]) =>
      (this.staticCache.cubeEdgeRanges.get(uid) || []).slice(from));
    const triangles = collectVertexRanges(this.staticCache.triangles,
      complementVertexRanges(this.staticCache.triangles.length / 12, excluded, this.staticCache.triangleRanges, birthTriangles));
    const edges = collectVertexRanges(this.staticCache.edges,
      complementVertexRanges(this.staticCache.edges.length / 12, excluded, this.staticCache.edgeRanges, birthEdges));
    this.uploadBuffer(this.visibleStaticTriangleBuffer, triangles, this.gl.STATIC_DRAW);
    this.uploadBuffer(this.visibleStaticWireBuffer, edges, this.gl.STATIC_DRAW);
    this.visibleStaticBatchCache = {
      project: this.staticCache.project,
      key,
      triangleCount: triangles.length / 12,
      edgeCount: edges.length / 12
    };
    return this.visibleStaticBatchCache;
  }

  ensureLockedBatches(camera, dynamicUids, lockedUids) {
    const wireframe = camera.renderMode === 'wireframe';
    const key = [
      this.geometryRevision, this.selectionRevision, wireframe ? 'wire' : 'surface',
      [...lockedUids].sort().join('|'),
      this.cubeBirthStartByUid.size
        ? [...lockedUids].map(uid => `${uid}:${this.cubeBirthStartByUid.get(uid) ?? '-'}`).sort().join('|') : ''
    ].join('::');
    if (this.lockedBatchCache?.key === key) return this.lockedBatchCache;

    const vertices = [];
    const outlines = [];
    for (const uid of lockedUids) {
      const selected = dynamicUids.has(uid);
      const cache = selected ? this.selectedCache : this.staticCache;
      const source = wireframe ? cache.edges : cache.triangles;
      const birthFrom = this.cubeBirthStartByUid.get(uid);
      const ranges = birthFrom === undefined
        ? [(wireframe ? cache.edgeRanges : cache.triangleRanges).get(uid)]
        : (wireframe ? cache.cubeEdgeRanges : cache.cubeTriangleRanges).get(uid)?.slice(0, birthFrom) || [];
      for (const range of ranges) if (range?.count)
        vertices.push(...source.slice(range.start * 12, (range.start + range.count) * 12));
      if (!wireframe && selected) {
        const outlineRanges = birthFrom === undefined
          ? [cache.edgeRanges.get(uid)] : cache.cubeEdgeRanges.get(uid)?.slice(0, birthFrom) || [];
        for (const outlineRange of outlineRanges) if (outlineRange?.count)
          outlines.push(...cache.edges.slice(outlineRange.start * 12, (outlineRange.start + outlineRange.count) * 12));
      }
    }
    this.uploadBuffer(this.lockedBatchBuffers[0], vertices, this.gl.DYNAMIC_DRAW);
    this.uploadBuffer(this.lockedOutlineBuffer, outlines, this.gl.DYNAMIC_DRAW);
    this.lockedBatchCache = {
      key,
      counts: [vertices.length / 12],
      outlineCount: outlines.length / 12,
      primitive: wireframe ? this.gl.LINES : this.gl.TRIANGLES
    };
    return this.lockedBatchCache;
  }

  drawLockedGeometry(project, camera, minecraftRenderType, dynamicUids, lockedUids, viewProjection, depthOnly = false) {
    const { gl } = this;
    const renderMode = getSurfaceRenderMode(camera.renderMode);
    const pipeline = camera.renderMode === 'textured'
      ? minecraftRenderType
      : MINECRAFT_RENDER_TYPES[MinecraftRenderType.SOLID];
    const batches = this.ensureLockedBatches(camera, dynamicUids, lockedUids);
    for (let index = 0; index < batches.counts.length; index++) {
      const options = camera.renderMode === 'wireframe'
        ? { depthWrite: true, cull: false, renderMode: 0, opacity: 1, blend: false }
        : { depthWrite: true, cull: project.cullFaces, renderMode, alphaMode: pipeline.alphaMode,
            opacity: 1, blend: false };
      this.drawBuffer(this.lockedBatchBuffers[index], batches.counts[index], batches.primitive, viewProjection, options);
    }
    const mirrorOptions = camera.renderMode === 'wireframe'
      ? { depthWrite: true, cull: false, renderMode: 0, opacity: 1, blend: false }
      : { depthWrite: true, cull: project.cullFaces, renderMode, alphaMode: pipeline.alphaMode,
          opacity: 1, blend: false };
    this.drawMirrorInstances(dynamicUids, lockedUids, batches.primitive, viewProjection, mirrorOptions,
      { lockedOnly: true });
    if (!depthOnly && camera.renderMode !== 'wireframe' && batches.outlineCount) {
      this.drawBuffer(this.lockedOutlineBuffer, batches.outlineCount, gl.LINES, viewProjection,
        { depthWrite: false, cull: false, renderMode: 0, opacity: 1, blend: false });
      this.drawMirrorInstances(dynamicUids, lockedUids, gl.LINES, viewProjection,
        { depthWrite: false, cull: false, renderMode: 0, opacity: 1, blend: false },
        { lockedOnly: true, selectedOnly: true });
    }
  }

  renderLockedLayer(project, camera, minecraftRenderType, dynamicUids, lockedUids, viewProjection, width, height) {
    if (!lockedUids.size) return;
    const { gl } = this;
    this.ensureLockedLayerTarget(width, height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.lockedFramebuffer);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    // Build the locked texture against the same scene depth once. The
    // resulting transparent texture can then be recomposited for pointer
    // movement without redrawing any model geometry.
    gl.colorMask(false, false, false, false);
    this.drawGrid(camera, viewProjection);
    this.drawSurfaceGeometry(project, camera, minecraftRenderType, dynamicUids, lockedUids,
      viewProjection, this.lastCameraState);
    gl.colorMask(true, true, true, true);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.drawLockedGeometry(project, camera, minecraftRenderType, dynamicUids, lockedUids, viewProjection, false);
  }

  paintExplodeInstanceTranslation(instance, uid) {
    const offset = this.paintExplodeOffsets.get(uid);
    if (!offset) return instance.translation;
    return instance.translation.map((value, axis) => value + offset[axis]
      - instance.matrix[axis].reduce((sum, coefficient, component) => sum + coefficient * offset[component], 0));
  }

  paintExplodeInstanceTransform(instance, uid) {
    const translation = this.paintExplodeInstanceTranslation(instance, uid);
    if (translation === instance.translation) return instance.transform;
    const transform = [...instance.transform];
    for (let axis = 0; axis < 3; axis++) transform[12 + axis] = translation[axis];
    return transform;
  }

  paintExplodeInstancePoint(instance, uid, point) {
    const translation = this.paintExplodeInstanceTranslation(instance, uid);
    return instance.matrix.map((row, axis) => row[0] * point[0] + row[1] * point[1]
      + row[2] * point[2] + translation[axis]);
  }

  drawMirrorInstances(dynamicUids, lockedUids, primitive, viewProjection, options = {},
    { lockedOnly = false, selectedOnly = false, ghostOnly = false } = {}) {
    if (Boolean(this.lastCameraInput?.modifierResultGhost) !== ghostOnly) return;
    const lines = primitive === this.gl.LINES;
    const rangeKey = lines ? 'edgeRanges' : 'triangleRanges';
    const cubeRangeKey = lines ? 'cubeEdgeRanges' : 'cubeTriangleRanges';
    if (this.lastCameraInput?.mode === 'paint' && this.lastCameraInput.paintExplode) {
      for (const instance of this.mirrorCache?.instances || []) {
        const groups = new Map();
        for (const uid of instance.sourceUids) {
          const locked = lockedUids.has(uid);
          if (lockedOnly !== locked || (selectedOnly && !dynamicUids.has(uid))) continue;
          const selected = dynamicUids.has(uid);
          const cache = selected ? this.selectedCache : this.staticCache;
          const allowedIndices = instance.cubeIndices?.[uid];
          const birthFrom = this.cubeBirthStartByUid.get(uid);
          const cubeRanges = cache?.[cubeRangeKey]?.get(uid);
          const ranges = allowedIndices && cubeRanges
            ? allowedIndices.filter(index => birthFrom === undefined || index < birthFrom)
              .map(index => cubeRanges[index]).filter(Boolean)
            : birthFrom !== undefined && cubeRanges ? cubeRanges.slice(0, birthFrom)
              : [cache?.[rangeKey]?.get(uid)];
          const offsetKey = `${selected}:${(this.paintExplodeOffsets.get(uid) || [0, 0, 0]).join(',')}`;
          if (!groups.has(offsetKey)) groups.set(offsetKey, { uid, selected, ranges: [] });
          for (const range of ranges) if (range?.count) groups.get(offsetKey).ranges.push(range);
        }
        for (const group of groups.values()) {
          const buffer = group.selected
            ? (lines ? this.selectedWireBuffer : this.selectedTriangleBuffer)
            : (lines ? this.staticWireBuffer : this.staticTriangleBuffer);
          const modelTransform = this.paintExplodeInstanceTransform(instance, group.uid);
          for (const range of mergeAdjacentVertexRanges(group.ranges)) this.drawBuffer(buffer, range.count, primitive, viewProjection, {
            ...options, first: range.start, modelTransform, flipWinding: instance.reflected
          });
        }
      }
      return;
    }
    for (const instance of this.mirrorCache?.instances || []) {
      const batchKey = [
        instance.key, instance.groupUid, instance.modifierUid, instance.sourceUids.join(','),
        lines ? 'edges' : 'triangles', lockedOnly ? 'locked' : 'visible',
        selectedOnly ? 'selected' : 'all', this.geometryRevision,
        this.currentDynamicElementKey || '', this.currentLockedKey || '',
        this.cubeBirthStartByUid.size
          ? instance.sourceUids.map(uid => `${uid}:${this.cubeBirthStartByUid.get(uid) ?? '-'}`).join(',') : ''
      ].join('::');
      let batches = this.mirrorCache.rangeCache.get(batchKey);
      if (!batches) {
        const staticRanges = [], selectedRanges = [];
        for (const uid of instance.sourceUids) {
          const locked = lockedUids.has(uid);
          if (lockedOnly !== locked || (selectedOnly && !dynamicUids.has(uid))) continue;
          const selected = dynamicUids.has(uid);
          const cache = selected ? this.selectedCache : this.staticCache;
          const allowedIndices = instance.cubeIndices?.[uid];
          const birthFrom = this.cubeBirthStartByUid.get(uid);
          const ranges = allowedIndices && cache?.[cubeRangeKey]?.get(uid)
            ? allowedIndices.filter(index => birthFrom === undefined || index < birthFrom)
              .map(index => cache[cubeRangeKey].get(uid)[index]).filter(Boolean)
            : birthFrom !== undefined && cache?.[cubeRangeKey]?.get(uid)
              ? cache[cubeRangeKey].get(uid).slice(0, birthFrom)
              : [cache?.[rangeKey]?.get(uid)];
          for (const range of ranges) if (range?.count) (selected ? selectedRanges : staticRanges).push(range);
        }
        batches = {
          static: mergeAdjacentVertexRanges(staticRanges),
          selected: mergeAdjacentVertexRanges(selectedRanges)
        };
        this.mirrorCache.rangeCache.set(batchKey, batches);
      }
      for (const selected of [false, true]) {
        const ranges = selected ? batches.selected : batches.static;
        const buffer = selected
          ? (lines ? this.selectedWireBuffer : this.selectedTriangleBuffer)
          : (lines ? this.staticWireBuffer : this.staticTriangleBuffer);
        const modelTransform = selected && this.selectionPreviewTransform
          ? multiply(instance.transform, this.selectionPreviewTransform)
          : instance.transform;
        for (const range of ranges) this.drawBuffer(buffer, range.count, primitive, viewProjection, {
            ...options,
            first: range.start,
            modelTransform,
            flipWinding: instance.reflected
          });
      }
    }
  }

  drawSurfaceGeometry(project, camera, minecraftRenderType, dynamicUids, lockedUids, viewProjection, cameraState) {
    const { gl } = this;
    if (camera.renderMode === 'wireframe') return;
    if (camera.faceDistinct || (camera.renderMode === 'textured' && minecraftRenderType.pass === RenderPass.TRANSLUCENT)) {
      const facePreview = camera.faceDistinct === true;
      const isBornFace = face => {
        const from = this.cubeBirthStartByUid.get(face.uid);
        return from !== undefined && (face.cubeIndex ?? 0) >= from;
      };
      const staticFaces = this.staticCache.faces
        .filter(face => !dynamicUids.has(face.uid) && !lockedUids.has(face.uid) && !isBornFace(face))
        .sort((a, b) => cameraDepth(b.center, cameraState) - cameraDepth(a.center, cameraState));
      const sortedFaces = [...staticFaces, ...this.selectedCache.faces]
        .filter(face => !lockedUids.has(face.uid) && !isBornFace(face))
        .sort((a, b) => cameraDepth(b.center, cameraState) - cameraDepth(a.center, cameraState));
      const drawFacePass = options => {
        if (!this.selectionPreviewTransform) {
          this.drawVertices(sortedFaces.flatMap(face => face.vertices), gl.TRIANGLES, viewProjection, options);
          this.drawMirrorInstances(dynamicUids, lockedUids, gl.TRIANGLES, viewProjection, options);
          return;
        }
        this.drawVertices(staticFaces.flatMap(face => face.vertices), gl.TRIANGLES, viewProjection, {
          ...options
        });
        this.drawBufferExcluding(this.selectedTriangleBuffer, this.selectedCache.triangles.length / 12,
          new Set([...lockedUids, ...this.cubeBirthUids]), this.selectedCache.triangleRanges, gl.TRIANGLES, viewProjection, {
            ...options,
            modelTransform: this.selectionPreviewTransform
          });
        this.drawMirrorInstances(dynamicUids, lockedUids, gl.TRIANGLES, viewProjection, options);
      };
      if (facePreview) {
        // First draw the real texture, then tint each face in a separate
        // translucent pass. Face distinction must never replace the texture.
        drawFacePass({
          depthWrite: minecraftRenderType.depthWrite,
          cull: project.cullFaces,
          renderMode: 2,
          alphaMode: minecraftRenderType.alphaMode,
          blend: minecraftRenderType.blend || this.paintPixelGrid
        });
        drawFacePass({
          depthWrite: false,
          cull: false,
          // Mode 3 uses the face colour while retaining the texture alpha,
          // so cutout/transparent pixels never become coloured plates.
          renderMode: 3,
          alphaMode: minecraftRenderType.alphaMode,
          blend: true,
          opacity: .34
        });
      } else {
        drawFacePass({
          depthWrite: minecraftRenderType.depthWrite,
          cull: project.cullFaces,
          renderMode: 2,
          alphaMode: minecraftRenderType.alphaMode,
          blend: minecraftRenderType.blend
        });
      }
      this.drawCubeTransitions(project, camera, viewProjection, gl.TRIANGLES);
      return;
    }
    const renderMode = getSurfaceRenderMode(camera.renderMode);
    const pipeline = camera.renderMode === 'textured'
      ? minecraftRenderType
      : MINECRAFT_RENDER_TYPES[MinecraftRenderType.SOLID];
    const options = {
      depthWrite: pipeline.depthWrite,
      cull: project.cullFaces,
      renderMode,
      alphaMode: pipeline.alphaMode,
      blend: pipeline.blend || (this.paintPixelGrid && renderMode === 2)
    };
    const staticBatches = this.ensureVisibleStaticBatches(dynamicUids, lockedUids);
    this.drawBuffer(this.visibleStaticTriangleBuffer, staticBatches.triangleCount,
      gl.TRIANGLES, viewProjection, options);
    this.drawMirrorInstances(dynamicUids, lockedUids, gl.TRIANGLES, viewProjection, options);
    this.drawBufferExcluding(this.selectedTriangleBuffer, this.selectedCache.triangles.length / 12,
      new Set([...lockedUids, ...this.cubeBirthUids]), this.selectedCache.triangleRanges, gl.TRIANGLES, viewProjection,
      { ...options, modelTransform: this.selectionPreviewTransform });
    this.drawCubeTransitions(project, camera, viewProjection, gl.TRIANGLES);
  }

  drawGrid(camera, viewProjection) {
    if (!camera.grid) return;
    const { gl } = this;
    const grid = gridGeometry(camera.snap);
    this.drawVertices(grid.fine, gl.LINES, viewProjection, { depthWrite: true, cull: false, renderMode: 0 });
    this.drawVertices(grid.major, gl.LINES, viewProjection, { depthWrite: true, cull: false, renderMode: 0 });
    this.drawVertices(grid.direction, gl.LINES, viewProjection, { depthWrite: true, cull: false, renderMode: 0 });
  }

  drawSelectionOcclusionDepth(project, camera, dynamicUids, lockedUids, viewProjection, includeSurfaceDepth) {
    if (camera.renderMode === 'wireframe') return;
    const { gl } = this;
    const options = { depthWrite: true, cull: project.cullFaces, renderMode: 2, alphaMode: 0, blend: false };
    gl.colorMask(false, false, false, false);
    if (includeSurfaceDepth) {
      const staticBatches = this.ensureVisibleStaticBatches(dynamicUids, lockedUids);
      this.drawBuffer(this.visibleStaticTriangleBuffer, staticBatches.triangleCount, gl.TRIANGLES, viewProjection, options);
      this.drawBufferExcluding(this.selectedTriangleBuffer, this.selectedCache.triangles.length / 12,
        new Set([...lockedUids, ...this.cubeBirthUids]), this.selectedCache.triangleRanges, gl.TRIANGLES,
        viewProjection, { ...options, modelTransform: this.selectionPreviewTransform });
      this.drawMirrorInstances(dynamicUids, lockedUids, gl.TRIANGLES, viewProjection, options);
    }
    if (lockedUids.size) this.drawLockedGeometry(project, camera,
      { ...getMinecraftRenderType(project.renderType), alphaMode: 0 }, dynamicUids, lockedUids, viewProjection, true);
    gl.colorMask(true, true, true, true);
  }

  drawPlayerReference(camera, viewProjection) {
    if (!camera.playerReference || !this.playerReferenceVertexCount) return;
    this.drawBuffer(this.playerReferenceBuffer, this.playerReferenceVertexCount,
      this.gl.TRIANGLES, viewProjection, {
        depthWrite: true,
        // The player is a visual scale reference rather than editable model
        // geometry. Keep it double-sided so thin skin parts never disappear
        // while orbiting or using an axis view.
        cull: false,
        renderMode: 2,
        alphaMode: 1,
        blend: false,
        texture: this.playerReferenceTexture
      });
  }

  drawEditorLines(project, camera, dynamicUids, lockedUids, ownerPoints, viewProjection) {
    const { gl } = this;
    // Locked objects are color-composited from an independent fade layer, so
    // its depth does not exist in the main framebuffer. Restore that depth
    // before selection lines; otherwise outlines shine through faded cubes.
    if (lockedUids.size || camera.modifierResultGhost) {
      gl.colorMask(false, false, false, false);
      if (lockedUids.size) this.drawLockedGeometry(project, camera, getMinecraftRenderType(project.renderType),
        dynamicUids, lockedUids, viewProjection, true);
      if (camera.modifierResultGhost) {
        const wireframe = camera.renderMode === 'wireframe';
        const pipeline = camera.renderMode === 'textured'
          ? getMinecraftRenderType(project.renderType) : MINECRAFT_RENDER_TYPES[MinecraftRenderType.SOLID];
        const primitive = wireframe ? gl.LINES : gl.TRIANGLES;
        const options = wireframe
          ? { depthWrite: true, cull: false, renderMode: 0, blend: false }
          : { depthWrite: true, cull: project.cullFaces, renderMode: getSurfaceRenderMode(camera.renderMode),
              alphaMode: pipeline.alphaMode, blend: false };
        this.drawMirrorInstances(dynamicUids, lockedUids, primitive, viewProjection, options, { ghostOnly: true });
        if (lockedUids.size) this.drawMirrorInstances(dynamicUids, lockedUids, primitive,
          viewProjection, options, { ghostOnly: true, lockedOnly: true });
      }
      gl.colorMask(true, true, true, true);
    }
    if (camera.renderMode === 'wireframe') {
      const staticBatches = this.ensureVisibleStaticBatches(dynamicUids, lockedUids);
      this.drawBuffer(this.visibleStaticWireBuffer, staticBatches.edgeCount, gl.LINES, viewProjection,
        { depthWrite: true, cull: false, renderMode: 0 });
      this.drawMirrorInstances(dynamicUids, lockedUids, gl.LINES, viewProjection,
        { depthWrite: true, cull: false, renderMode: 0 });
      this.drawBufferExcluding(this.selectedWireBuffer, this.selectedCache.edges.length / 12,
        new Set([...lockedUids, ...this.cubeBirthUids]), this.selectedCache.edgeRanges, gl.LINES, viewProjection,
        { depthWrite: true, cull: false, renderMode: 0, modelTransform: this.selectionPreviewTransform });
      this.drawCubeTransitions(project, camera, viewProjection, gl.LINES);
    }
    this.drawBuffer(this.ghostWireBuffer, this.ghostWireCount, gl.LINES, viewProjection, {
      depthWrite: false, cull: false, renderMode: 0
    });
    // Face editing has its own compact GPU outline buffer below. Drawing the
    // complete selected-object wire mesh as well duplicates most edges and is
    // especially expensive when every cube is selected.
    if (camera.renderMode !== 'wireframe' && camera.tool !== 'faceSelect') {
      this.drawBufferExcluding(this.selectedWireBuffer, this.selectedCache.edges.length / 12,
        new Set([...lockedUids, ...this.cubeBirthUids]), this.selectedCache.edgeRanges, gl.LINES, viewProjection,
        { depthWrite: false, depthTest: true, cull: false, renderMode: 0, modelTransform: this.selectionPreviewTransform });
    }
    if (camera.wire) {
      const staticWire = [], selectedWire = [];
      for (const [uid, points] of ownerPoints) if (!lockedUids.has(uid) && !this.cubeBirthStartByUid.has(uid)) {
        (dynamicUids.has(uid) ? selectedWire : staticWire).push(...boundsWireGeometry(points));
      }
      this.drawVertices(staticWire, gl.LINES, viewProjection, { depthWrite: true, cull: false, renderMode: 0 });
      this.drawMirrorInstances(dynamicUids, lockedUids, gl.LINES, viewProjection,
        { depthWrite: true, cull: false, renderMode: 0 });
      this.drawVertices(selectedWire, gl.LINES, viewProjection, {
        depthWrite: true, cull: false, renderMode: 0, modelTransform: this.selectionPreviewTransform
      });
    }
    if (!camera.geometryOnly) {
      const visibleHelpers = collectVertexRanges(this.staticCache.helpers,
        complementVertexRanges(this.staticCache.helpers.length / 12, new Set([...dynamicUids, ...lockedUids]), this.staticCache.helperRanges));
      const selectedHelpers = collectVertexRanges(this.selectedCache.helpers,
        complementVertexRanges(this.selectedCache.helpers.length / 12, lockedUids, this.selectedCache.helperRanges));
      this.drawVertices(visibleHelpers, gl.LINES, viewProjection, {
        depthWrite: false, cull: false, renderMode: 0
      });
      this.drawVertices(selectedHelpers, gl.LINES, viewProjection, {
        depthWrite: false, depthTest: true, cull: false, renderMode: 0, modelTransform: this.selectionPreviewTransform
      });
    }
    if (camera.editorOverlayLines?.length) {
      const overlay = [];
      for (const line of camera.editorOverlayLines) {
        const color = line.color || [1, 1, 1, 1];
        pushVertex(overlay, line.start, color);
        pushVertex(overlay, line.end, color);
      }
      this.drawVertices(overlay, gl.LINES, viewProjection, { depthWrite: false, cull: false, renderMode: 0 });
    }
    this.drawGeneratedSelection(camera.selectedGenerated, viewProjection);
    const selectedFaceFillCount = this.ensureFaceSelectionFill(camera.selectedUvFaces);
    this.drawBuffer(this.faceSelectionBuffer, selectedFaceFillCount, gl.TRIANGLES, viewProjection, {
      depthWrite: false, depthTest: true, cull: false, renderMode: 0, blend: true,
      modelTransform: this.selectionPreviewTransform
    });
  }

  drawGeneratedSelection(selection, viewProjection) {
    if (!selection || this.lastCameraInput?.modifierResultGhost) return;
    const instance = this.mirrorCache?.instances.find(entry => entry.key === selection.instanceKey);
    if (!instance || !instance.sourceUids.includes(selection.uid)) return;
    const inverted = this.selectionOutline.map(value => 1 - value);
    const allowed = instance.cubeIndices?.[selection.uid];
    for (const cache of [this.staticCache, this.selectedCache]) {
      const ranges = allowed && cache?.cubeEdgeRanges?.get(selection.uid)
        ? allowed.map(index => cache.cubeEdgeRanges.get(selection.uid)[index]).filter(Boolean)
        : [cache?.edgeRanges?.get(selection.uid)];
      const buffer = cache === this.staticCache ? this.staticWireBuffer : this.selectedWireBuffer;
      for (const range of ranges) if (range?.count) this.drawBuffer(buffer, range.count, this.gl.LINES, viewProjection, {
        first: range.start, modelTransform: instance.transform, depthWrite: false,
        cull: false, renderMode: 0, colorOverride: [...inverted, 1]
      });
    }
  }

  ensureFaceSelectionFill(selection) {
    const selectedFaces = selection instanceof Set ? selection : new Set();
    if (this.faceSelectionCache?.selection === selectedFaces
      && this.faceSelectionCache.size === selectedFaces.size
      && this.faceSelectionCache.geometryRevision === this.geometryRevision
      && this.faceSelectionCache.selectionRevision === this.selectionRevision) {
      return this.faceSelectionCache.count;
    }
    const vertices = [];
    const color = [...this.selectionOutline, .16];
    for (const key of selectedFaces) {
      const face = this.selectedCache?.faceIndex?.get(key) || this.staticCache?.faceIndex?.get(key);
      if (!face?.quad?.length) continue;
      FACE_TRIANGLE_SLOTS.forEach(slot => pushVertex(vertices, face.quad[slot], color));
    }
    this.uploadBuffer(this.faceSelectionBuffer, vertices, this.gl.DYNAMIC_DRAW);
    this.faceSelectionCache = {
      selection: selectedFaces,
      size: selectedFaces.size,
      geometryRevision: this.geometryRevision,
      selectionRevision: this.selectionRevision,
      count: vertices.length / 12
    };
    return this.faceSelectionCache.count;
  }

  render(project, selectedUid, camera) {
    const { gl, canvas } = this;
    this.captureModelOnly = camera.captureModelOnly === true;
    this.previewShade = camera.previewShade !== false;
    this.paintPixelGrid = camera.mode === 'paint' && camera.paintPixelGrid === true;
    this.paintSelectionActive = camera.mode === 'paint' && camera.paintSelection?.active === true && this.selectionMaskReady;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.floor(camera.captureWidth || rect.width));
    const height = Math.max(1, Math.floor(camera.captureHeight || rect.height));
    const pixelWidth = camera.capturePixelWidth || (camera.layoutResizing && canvas.width
      ? canvas.width
      : Math.max(1, Math.floor(width * dpr)));
    const pixelHeight = camera.capturePixelHeight || (camera.layoutResizing && canvas.height
      ? canvas.height
      : Math.max(1, Math.floor(height * dpr)));
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    const minecraftRenderType = getMinecraftRenderType(project.renderType);
    const useMippedAntialias = minecraftRenderType.smooth && camera.renderMode === 'textured';
    const renderWidth = useMippedAntialias
      ? Math.max(1, Math.floor(pixelWidth * MIPPED_SUPERSAMPLE))
      : pixelWidth;
    const renderHeight = useMippedAntialias
      ? Math.max(1, Math.floor(pixelHeight * MIPPED_SUPERSAMPLE))
      : pixelHeight;
    this.selectionStripeViewport = [rect.left, rect.top, renderWidth / width, renderHeight];
    this.selectionPixelRadius = Math.max(1.5, renderWidth / width * 1.5);
    if (useMippedAntialias) {
      this.ensurePostProcessTarget(renderWidth, renderHeight);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.postFramebuffer);
    } else gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, renderWidth, renderHeight);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const cameraState = buildCameraState(camera, width / height, width, height);
    const viewProjection = cameraState.matrix;
    this.lastViewProjection = viewProjection;
    this.lastViewport = { width, height };
    this.lastCameraState = cameraState;
    this.lastCameraInput = { ...camera };

    const selection = camera.selectedUids?.size ? camera.selectedUids : selectedUid;
    const paintExplode = camera.mode === 'paint' && camera.paintExplode === true;
    const { selectedUids, selectedKey, dynamicUids, dynamicKey } = this.getSelectionDescriptor(project, selection);
    this.currentDynamicElementKey = dynamicKey;
    if (!this.staticCache
      || this.staticCache.project !== project
      || this.staticCache.revision !== this.geometryRevision
      || this.staticCache.faceDistinct !== (camera.faceDistinct === true)
      || this.staticCache.paintExplode !== paintExplode
      || paintExplode && this.staticCache.paintExplodeGap !== camera.paintExplodeGap) {
      this.visibleStaticBatchCache = null;
      this.lockedBatchCache = null;
      this.faceSelectionCache = null;
      this.mirrorCache?.rangeCache?.clear();
      const faceDistinct = camera.faceDistinct === true;
      const renderElements = camera.subdivisionEditOwnerUid
        ? project.elements.filter(element => element.uid !== camera.subdivisionEditOwnerUid)
        : project.elements;
      const geometry = buildElementGeometry(project, renderElements, null, [1, 1, 1], faceDistinct, this.textureLayout);
      if (paintExplode) {
        const layoutPoints = new Map([...geometry.ownerPoints].map(([uid, points]) => [uid, [...points]]));
        for (const instance of buildModifierRenderInstances(project)) for (const uid of instance.sourceUids) {
          const points = layoutPoints.get(uid);
          if (!points) continue;
          const cubes = geometry.cubePoints.get(uid) || [];
          const indices = instance.cubeIndices?.[uid] || cubes.map((_, index) => index);
          for (const index of indices) for (const point of cubes[index] || [])
            points.push(modifierInstancePoint(instance, point));
        }
        this.paintExplodeOffsets = buildPaintExplodeOffsets(project, layoutPoints, camera.paintExplodeGap ?? 2);
      } else this.paintExplodeOffsets = new Map();
      if (paintExplode) applyPaintExplodeOffsets(geometry, this.paintExplodeOffsets);
      this.staticCache = {
        project, revision: this.geometryRevision, faceDistinct, paintExplode,
        paintExplodeGap: camera.paintExplodeGap, ...geometry,
        faceIndex: indexFaces(geometry.faces), faceBvh: buildFaceBvh(geometry.faces)
      };
      this.uploadBuffer(this.staticTriangleBuffer, geometry.triangles, gl.STATIC_DRAW);
      this.uploadBuffer(this.staticWireBuffer, geometry.edges, gl.STATIC_DRAW);
    }

    const mirrorCacheDirty = !this.mirrorCache
      || this.mirrorCache.project !== project
      || this.mirrorCache.revision !== this.mirrorRevision
      || this.mirrorCache.faceDistinct !== (camera.faceDistinct === true);
    if (mirrorCacheDirty) {
      this.mirrorCache = {
        project,
        revision: this.mirrorRevision,
        faceDistinct: camera.faceDistinct === true,
        rangeCache: new Map(),
        instances: buildModifierRenderInstances(project).map(instance => ({
          ...instance,
          transform: modifierModelMatrix(instance.matrix, instance.translation, instance.center)
        }))
      };
    }

    if (!this.selectedCache
      || this.selectedCache.project !== project
      || this.selectedCache.revision !== this.selectionRevision
      || this.selectedCache.selectedKey !== selectedKey
      || this.selectedCache.faceDistinct !== (camera.faceDistinct === true)) {
      const selectedElements = project.elements.filter(element => dynamicUids.has(element.uid)
        && element.uid !== camera.subdivisionEditOwnerUid);
      const faceDistinct = camera.faceDistinct === true;
      const geometry = buildElementGeometry(project, selectedElements, selectedUids, this.selectionOutline, faceDistinct, this.textureLayout);
      this.selectedCache = {
        project, revision: this.selectionRevision, selectedKey, faceDistinct, ...geometry,
        faceIndex: indexFaces(geometry.faces), faceBvh: buildFaceBvh(geometry.faces)
      };
      this.uploadBuffer(this.selectedTriangleBuffer, geometry.triangles, gl.DYNAMIC_DRAW);
      this.uploadBuffer(this.selectedWireBuffer, geometry.edges, gl.DYNAMIC_DRAW);
    }
    this.cubeBirthMs = Math.max(0, Number(camera.cubeBirthMs ?? CUBE_LIFETIME_ANIMATION_MS));
    this.cubeDeathMs = Math.max(0, Number(camera.cubeDeathMs ?? CUBE_LIFETIME_ANIMATION_MS));
    this.reconcileCubeTransitions(project);
    this.cubeTransitionFrameTime = performance.now();
    this.cubeTransitions = this.cubeTransitions.filter(transition => {
      if (transition.project === project
        && this.cubeTransitionFrameTime - transition.started < transition.duration) return true;
      this.gl.deleteBuffer(transition.buffer);
      this.gl.deleteBuffer(transition.wireBuffer);
      return false;
    });
    const activeBirthEntries = this.cubeTransitions
      .filter(transition => transition.kind === 'birth')
      .flatMap(transition => transition.entries);
    const activeBirths = new Set(activeBirthEntries.filter(entry => entry.from === 0).map(entry => entry.uid));
    if (activeBirths.size !== this.cubeBirthUids.size) this.visibleStaticBatchCache = null;
    this.cubeBirthUids = activeBirths;
    this.cubeBirthStartByUid = new Map(activeBirthEntries.map(entry => [entry.uid, entry.from]));
    const ownerPoints = mergeOwnerPoints(this.staticCache.ownerPoints, this.selectedCache.ownerPoints);
    this.lastOwnerPoints = ownerPoints;
    const lockedState = this.getLockedState(project);
    const lockedUids = camera.captureModelOnly ? new Set() : new Set(lockedState.uids);
    if (!camera.captureModelOnly && camera.subdivisionEditOwnerUid) {
      for (const element of project.elements) {
        if (element.uid !== camera.subdivisionEditOwnerUid
          && element.subdivisionOwnerUid !== camera.subdivisionEditOwnerUid) lockedUids.add(element.uid);
      }
    }
    this.currentLockedKey = [...lockedUids].sort().join('|');
    this.lastLockedUids = lockedUids;
    this.lastNodeByUid = lockedState.nodes;
    this.lastHelperPoints = [...ownerPoints.entries()].filter(([uid]) =>
      ['locator', 'node'].includes(this.lastNodeByUid.get(uid)?.type));

    this.applyTextureSampling();

    if (camera.captureModelOnly) {
      this.drawSurfaceGeometry(project, camera, minecraftRenderType, dynamicUids, lockedUids, viewProjection, cameraState);
      if (camera.renderMode === 'wireframe') {
        const batches = this.ensureVisibleStaticBatches(dynamicUids, lockedUids);
        const options = { depthWrite: true, cull: false, renderMode: 0 };
        this.drawBuffer(this.visibleStaticWireBuffer, batches.edgeCount, gl.LINES, viewProjection, options);
        this.drawMirrorInstances(dynamicUids, lockedUids, gl.LINES, viewProjection, options);
        this.drawBufferExcluding(this.selectedWireBuffer, this.selectedCache.edges.length / 12,
          this.cubeBirthUids, this.selectedCache.edgeRanges, gl.LINES, viewProjection, options);
        this.drawCubeTransitions(project, camera, viewProjection, gl.LINES);
      }
      if (useMippedAntialias) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, pixelWidth, pixelHeight);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        this.presentAntialiased(pixelWidth, pixelHeight, renderWidth, renderHeight);
      }
      return;
    }

    if (useMippedAntialias) {
      // Only model surfaces are supersampled. Rebuild their depth in the
      // native-MSAA framebuffer, resolve the colour, then draw editor lines
      // directly so Mipped never changes grid or wire appearance.
      this.drawPlayerReference(camera, viewProjection);
      this.drawSurfaceGeometry(project, camera, minecraftRenderType, dynamicUids, lockedUids, viewProjection, cameraState);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, pixelWidth, pixelHeight);
      this.selectionStripeViewport = [rect.left, rect.top, pixelWidth / width, pixelHeight];
      gl.clearColor(0, 0, 0, 0);
      gl.clearDepth(1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.colorMask(false, false, false, false);
      this.drawPlayerReference(camera, viewProjection);
      this.drawSurfaceGeometry(project, camera, minecraftRenderType, dynamicUids, lockedUids, viewProjection, cameraState);
      gl.colorMask(true, true, true, true);
      this.presentAntialiased(pixelWidth, pixelHeight, renderWidth, renderHeight);
      this.drawGrid(camera, viewProjection);
      this.drawModifierGhostOverlay(project, camera, minecraftRenderType, dynamicUids, lockedUids,
        viewProjection, null, pixelWidth, pixelHeight);
      this.drawLockedOverlay(project, camera, minecraftRenderType, dynamicUids, lockedUids,
        ownerPoints, viewProjection, null, pixelWidth, pixelHeight, renderWidth, renderHeight);
      this.drawFaceLabel(camera, viewProjection);
      if (selectedUids.size && (minecraftRenderType.pass !== RenderPass.SOLID || lockedUids.size))
        this.drawSelectionOcclusionDepth(project, camera, dynamicUids, lockedUids, viewProjection,
          minecraftRenderType.pass !== RenderPass.SOLID);
      this.drawEditorLines(project, camera, dynamicUids, lockedUids, ownerPoints, viewProjection);
    } else {
      this.drawGrid(camera, viewProjection);
      this.drawPlayerReference(camera, viewProjection);
      this.drawSurfaceGeometry(project, camera, minecraftRenderType, dynamicUids, lockedUids, viewProjection, cameraState);
      this.drawModifierGhostOverlay(project, camera, minecraftRenderType, dynamicUids, lockedUids,
        viewProjection, null, pixelWidth, pixelHeight);
      this.drawLockedOverlay(project, camera, minecraftRenderType, dynamicUids, lockedUids,
        ownerPoints, viewProjection, null, pixelWidth, pixelHeight, pixelWidth, pixelHeight);
      this.drawFaceLabel(camera, viewProjection);
      if (selectedUids.size && (minecraftRenderType.pass !== RenderPass.SOLID || lockedUids.size))
        this.drawSelectionOcclusionDepth(project, camera, dynamicUids, lockedUids, viewProjection,
          minecraftRenderType.pass !== RenderPass.SOLID);
      this.drawEditorLines(project, camera, dynamicUids, lockedUids, ownerPoints, viewProjection);
    }

  }

  captureImageCanvas() {
    const { gl, canvas } = this;
    const width = canvas.width, height = canvas.height;
    const pixels = new Uint8Array(width * height * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    if (gl.getError() !== gl.NO_ERROR) throw new Error('無法讀取模型渲染結果');
    const image = document.createElement('canvas');
    image.width = width;
    image.height = height;
    const context = image.getContext('2d');
    const upright = new Uint8ClampedArray(pixels.length);
    const stride = width * 4;
    for (let row = 0; row < height; row++)
      upright.set(pixels.subarray((height - row - 1) * stride, (height - row) * stride), row * stride);
    context.putImageData(new ImageData(upright, width, height), 0, 0);
    return image;
  }

  fitCameraToVisibleModel(project, camera, aspect, padding = 1.12) {
    const visible = new Set(project.elements.filter(element => element.visible !== false
      && element.type !== 'locator' && element.type !== 'node').map(element => element.uid));
    const instances = buildModifierRenderInstances(project);
    const visitPoints = visit => {
      for (const uid of visible) for (const point of this.lastOwnerPoints.get(uid) || []) visit(point);
      for (const instance of instances) for (const uid of instance.sourceUids) {
        if (!visible.has(uid)) continue;
        const cache = this.selectedCache?.cubePoints?.has(uid) ? this.selectedCache : this.staticCache;
        const cubes = cache?.cubePoints?.get(uid) || [];
        for (const index of instance.cubeIndices?.[uid] || cubes.map((_, cubeIndex) => cubeIndex))
          for (const point of cubes[index] || []) visit(this.paintExplodeInstancePoint(instance, uid, point));
      }
    };
    const minimum = [Infinity, Infinity, Infinity], maximum = [-Infinity, -Infinity, -Infinity];
    let count = 0;
    visitPoints(point => {
      count++;
      for (let axis = 0; axis < 3; axis++) {
        minimum[axis] = Math.min(minimum[axis], point[axis]);
        maximum[axis] = Math.max(maximum[axis], point[axis]);
      }
    });
    if (!count) return null;
    const center = minimum.map((value, axis) => (value + maximum[axis]) / 2);
    const frame = buildCameraState({ ...camera, target: center, panX: 0, panY: 0 }, aspect, aspect, 1);
    let horizontal = 0, vertical = 0, distance = 0, nearestDepth = Infinity;
    const tangent = Math.tan(45 * DEG / 2);
    visitPoints(point => {
      const offset = subtract(point, center);
      const x = Math.abs(dot(offset, frame.right));
      const y = Math.abs(dot(offset, frame.up));
      const depth = dot(offset, frame.forward);
      horizontal = Math.max(horizontal, x);
      vertical = Math.max(vertical, y);
      nearestDepth = Math.min(nearestDepth, depth);
      distance = Math.max(distance, padding * x / (tangent * aspect) - depth,
        padding * y / tangent - depth);
    });
    const zoom = camera.projection === 'perspective'
      ? 42 / Math.max(.1, distance, -nearestDepth + .1)
      : Math.min(18 * aspect / Math.max(.01, padding * horizontal),
        18 / Math.max(.01, padding * vertical));
    return { ...camera, target: center, panX: 0, panY: 0, zoom: Math.max(1e-6, Math.min(1000, zoom)) };
  }

  getHitAreas(project, geometryOnly = false) {
    return [...this.lastOwnerPoints.entries()]
      .filter(([uid]) => !this.lastLockedUids.has(uid) && (!geometryOnly || !['locator', 'node'].includes(this.lastNodeByUid.get(uid)?.type)))
      .map(([uid, points]) => ({ uid, ...screenBounds(points, this.lastViewProjection, this.lastViewport.width, this.lastViewport.height) }));
  }

  pick(project, screenX, screenY, geometryOnly = false) {
    return this.pickDetailed(project, screenX, screenY, geometryOnly)?.uid || null;
  }

  selectInScreenRect(project, screenRect, geometryOnly = false) {
    if (!this.lastCameraState || !this.lastViewProjection) return [];
    const rect = normalizeScreenRect(screenRect);
    const selected = new Set();
    for (const [uid, points] of this.lastOwnerPoints) {
      const node = this.lastNodeByUid.get(uid);
      if (!node || !['locator', 'node'].includes(node.type) || this.lastLockedUids.has(uid) || geometryOnly) continue;
      const projected = projectScreenPoint(points[0], this.lastViewProjection, this.lastViewport.width, this.lastViewport.height);
      if (projected.behind || projected.depth < -1 || projected.depth > 1) continue;
      const radius = node.type === 'locator' ? locatorScreenSize(points[0], this.lastCameraState) * .72 : 14;
      const closestX = clamp(projected.x, rect.x1, rect.x2);
      const closestY = clamp(projected.y, rect.y1, rect.y2);
      if (Math.hypot(projected.x - closestX, projected.y - closestY) <= radius) selected.add(uid);
    }
    const dynamicUids = new Set(this.selectedCache?.ownerPoints?.keys() || []);
    const faces = [
      ...(this.staticCache?.faces || []).filter(face => !dynamicUids.has(face.uid)),
      ...(this.selectedCache?.faces || [])
    ];
    for (const face of faces) {
      if (selected.has(face.uid) || this.lastLockedUids.has(face.uid)) continue;
      const projected = face.quad
        .map(point => projectScreenPoint(point, this.lastViewProjection, this.lastViewport.width, this.lastViewport.height))
        .filter(point => !point.behind && point.depth >= -1 && point.depth <= 1);
      if (projected.length >= 2 && screenPolygonIntersectsRect(projected, rect)) selected.add(face.uid);
    }
    return [...selected];
  }

  pickDetailed(project, screenX, screenY, geometryOnly = false,
    { includeLocked = false, lockedOnly = false, candidateUids = null, includeGenerated = false } = {}) {
    if (!this.lastCameraState || !this.lastCameraInput) return null;
    const ray = screenRay(screenX, screenY, this.lastViewport, this.lastCameraState, this.lastCameraInput);
    let closest = null;
    let closestDistance = Infinity;
    let locatorHit = null;
    let locatorDistance = Infinity;
    for (const [uid, points] of geometryOnly ? [] : this.lastHelperPoints) {
      if (candidateUids && !candidateUids.has(uid)) continue;
      const node = this.lastNodeByUid.get(uid);
      const locked = this.lastLockedUids.has(uid);
      if (!node || (!includeLocked && locked) || (lockedOnly && !locked)) continue;
      const projected = projectScreenPoint(points[0], this.lastViewProjection, this.lastViewport.width, this.lastViewport.height);
      const distance = dot(subtract(points[0], ray.origin), ray.direction);
      const iconSize = node.type === 'locator' ? locatorScreenSize(points[0], this.lastCameraState) : 16;
      if (!projected.behind && projected.depth >= -1 && projected.depth <= 1
        && Math.hypot(projected.x - screenX, projected.y - screenY) <= iconSize * .72 && distance > 0 && distance < locatorDistance) {
        locatorDistance = distance;
        locatorHit = { uid, distance, point: [...points[0]], faceName: null };
      }
    }
    // Helper elements are editor overlays whose visible marks take priority
    // over model geometry drawn beneath them.
    if (locatorHit) return locatorHit;
    const dynamicUids = new Set(this.selectedCache?.ownerPoints?.keys() || []);
    const faces = [
      ...queryFaceBvh(this.staticCache?.faceBvh, ray).filter(face => !dynamicUids.has(face.uid)),
      ...queryFaceBvh(this.selectedCache?.faceBvh, ray)
    ];
    for (const face of faces) {
      if (candidateUids && !candidateUids.has(face.uid)) continue;
      const locked = this.lastLockedUids.has(face.uid);
      if ((!includeLocked && locked) || (lockedOnly && !locked) || (geometryOnly && ['locator', 'node'].includes(project.getNode(face.uid)?.type))) continue;
      const indices = FACE_TRIANGLE_SLOTS;
      for (let triangle = 0; triangle < 2; triangle++) {
        const base = triangle * 3;
        const distance = rayTriangleDistance(ray.origin, ray.direction,
          face.quad[indices[base]], face.quad[indices[base + 1]], face.quad[indices[base + 2]]);
        if (distance !== null && distance < closestDistance) {
          closestDistance = distance;
          closest = {
            uid: face.uid,
            cubeUid: face.cubeUid || face.uid,
            cubeIndex: face.cubeIndex ?? null,
            cube: face.cube || null,
            distance,
            faceName: face.faceName,
            facePoints: face.quad.map(point => [...point]),
            point: ray.origin.map((value, axis) => value + ray.direction[axis] * distance)
          };
        }
      }
    }
    if (includeGenerated && !this.lastCameraInput.modifierResultGhost && !lockedOnly) {
      for (const instance of this.mirrorCache?.instances || []) {
        for (const sourceUid of this.lastCameraInput?.mode === 'paint' && this.lastCameraInput.paintExplode
          ? instance.sourceUids : [null]) {
        const translation = sourceUid ? this.paintExplodeInstanceTranslation(instance, sourceUid) : instance.translation;
        const inversePoint = point => [0, 1, 2].map(axis =>
          instance.matrix[0][axis] * (point[0] - translation[0])
          + instance.matrix[1][axis] * (point[1] - translation[1])
          + instance.matrix[2][axis] * (point[2] - translation[2]));
        const inverseDirection = direction => [0, 1, 2].map(axis =>
          instance.matrix[0][axis] * direction[0]
          + instance.matrix[1][axis] * direction[1]
          + instance.matrix[2][axis] * direction[2]);
        const localRay = { origin: inversePoint(ray.origin), direction: inverseDirection(ray.direction) };
        const candidates = [...queryFaceBvh(this.staticCache?.faceBvh, localRay),
          ...queryFaceBvh(this.selectedCache?.faceBvh, localRay)];
        for (const face of candidates) {
          if ((sourceUid && face.uid !== sourceUid) || !instance.sourceUids.includes(face.uid) || this.lastLockedUids.has(face.uid)
            || candidateUids && !candidateUids.has(face.uid)) continue;
          const indices = instance.cubeIndices?.[face.uid];
          if (indices && !indices.includes(face.cubeIndex ?? 0)) continue;
          for (let triangle = 0; triangle < 2; triangle++) {
            const base = triangle * 3;
            const distance = rayTriangleDistance(localRay.origin, localRay.direction,
              face.quad[FACE_TRIANGLE_SLOTS[base]], face.quad[FACE_TRIANGLE_SLOTS[base + 1]],
              face.quad[FACE_TRIANGLE_SLOTS[base + 2]]);
            if (distance === null || distance >= closestDistance) continue;
            closestDistance = distance;
            closest = {
              uid: face.uid, cubeUid: face.cubeUid || face.uid, cubeIndex: face.cubeIndex ?? null,
              distance, faceName: face.faceName, generated: true, instanceKey: instance.key,
              facePoints: face.quad.map(point => this.paintExplodeInstancePoint(instance, face.uid, point)),
              point: ray.origin.map((value, axis) => value + ray.direction[axis] * distance),
              modelPoint: localRay.origin.map((value, axis) => value + localRay.direction[axis] * distance
                - (this.paintExplodeOffsets.get(face.uid)?.[axis] || 0))
            };
          }
        }
        }
      }
    }
    return closest;
  }

  pickCoincident(project, screenX, screenY, geometryOnly = true, allDepths = false) {
    if (!this.lastCameraState || !this.lastCameraInput) return [];
    const ray = screenRay(screenX, screenY, this.lastViewport, this.lastCameraState, this.lastCameraInput);
    const dynamicUids = new Set(this.selectedCache?.ownerPoints?.keys() || []);
    const faces = [
      ...queryFaceBvh(this.staticCache?.faceBvh, ray).filter(face => !dynamicUids.has(face.uid)),
      ...queryFaceBvh(this.selectedCache?.faceBvh, ray)
    ];
    const hits = new Map();
    for (const face of faces) {
      if (this.lastLockedUids.has(face.uid)
        || (geometryOnly && ['locator', 'node'].includes(project.getNode(face.uid)?.type))) continue;
      let faceDistance = Infinity;
      for (let triangle = 0; triangle < 2; triangle++) {
        const base = triangle * 3;
        const distance = rayTriangleDistance(ray.origin, ray.direction,
          face.quad[FACE_TRIANGLE_SLOTS[base]], face.quad[FACE_TRIANGLE_SLOTS[base + 1]], face.quad[FACE_TRIANGLE_SLOTS[base + 2]]);
        if (distance !== null) faceDistance = Math.min(faceDistance, distance);
      }
      if (!Number.isFinite(faceDistance)) continue;
      const key = `${face.uid}::${face.cubeUid || face.uid}::${face.faceName}`
        + (allDepths ? `::${face.quad[0].map(value => Math.round(value * 1e5)).join(',')}` : '');
      const normal = normalize(cross(subtract(face.quad[2], face.quad[0]), subtract(face.quad[1], face.quad[0])));
      const previous = hits.get(key);
      if (!previous || faceDistance < previous.distance) hits.set(key, {
        uid: face.uid,
        cubeUid: face.cubeUid || face.uid,
        cubeIndex: face.cubeIndex ?? null,
        cube: face.cube || null,
        distance: faceDistance,
        faceName: face.faceName,
        facePoints: face.quad.map(point => [...point]),
        normal,
        point: ray.origin.map((value, axis) => value + ray.direction[axis] * faceDistance)
      });
    }
    const ordered = [...hits.values()].sort((a, b) => a.distance - b.distance);
    if (!ordered.length) return [];
    if (allDepths) return ordered;
    const front = ordered[0];
    const distanceTolerance = Math.max(1e-5, Math.abs(front.distance) * 1e-6);
    return ordered.filter(hit => Math.abs(hit.distance - front.distance) <= distanceTolerance
      && Math.abs(dot(hit.normal, front.normal)) >= .99999);
  }

  getCubeFaceQuads(uid, cubeUid = uid) {
    const dynamicUids = new Set(this.selectedCache?.ownerPoints?.keys() || []);
    return [
      ...(this.staticCache?.faces || []).filter(face => !dynamicUids.has(face.uid)),
      ...(this.selectedCache?.faces || [])
    ].filter(face => face.uid === uid && (face.cubeUid || face.uid) === cubeUid)
      .map(face => ({
        uid: face.uid,
        cubeUid: face.cubeUid || face.uid,
        cubeIndex: face.cubeIndex ?? null,
        cube: face.cube || null,
        faceName: face.faceName,
        facePoints: face.quad.map(point => [...point])
      }));
  }

  getFaceQuadsForUids(uids, { modelSpace = false } = {}) {
    const wanted = uids instanceof Set ? uids : new Set(uids || []);
    const dynamicUids = new Set(this.selectedCache?.ownerPoints?.keys() || []);
    const seen = new Set();
    return [
      ...(this.staticCache?.faces || []).filter(face => !dynamicUids.has(face.uid)),
      ...(this.selectedCache?.faces || [])
    ].flatMap(face => {
      if (!wanted.has(face.uid)) return [];
      const key = `${face.uid}::${face.cubeUid || face.uid}::${face.faceName}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{
        uid: face.uid,
        cubeUid: face.cubeUid || face.uid,
        cubeIndex: face.cubeIndex ?? null,
        cube: face.cube || null,
        faceName: face.faceName,
        facePoints: (modelSpace && face.modelQuad ? face.modelQuad : face.quad).map(point => [...point])
      }];
    });
  }

  getFaceQuad(uid, faceName) {
    const key = `${uid}::${faceName}`;
    const selectedFace = this.selectedCache?.faceIndex?.get(key);
    if (selectedFace) return selectedFace.quad.map(point => [...point]);
    const staticFace = this.staticCache?.faceIndex?.get(key);
    return staticFace ? staticFace.quad.map(point => [...point]) : null;
  }

  getWorldVertices(project, uid) {
    const node = project.getNode(uid);
    if (!node) return [];
    if (node.type === 'node') {
      const point = applyGroupTransforms(node.position, project.getGroupChain(node.uid));
      return [{ uid: node.uid, point }];
    }
    const uids = node.type === 'group' ? project.getDescendantElementUids(uid) : [uid];
    const seen = new Set();
    const vertices = [];
    for (const elementUid of uids) {
      for (const point of this.lastOwnerPoints.get(elementUid) || []) {
        const key = point.map(value => Math.round(value * 1e5)).join(',');
        if (seen.has(key)) continue;
        seen.add(key);
        vertices.push({ uid: elementUid, point: [...point] });
      }
    }
    return vertices;
  }

  getGeneratedWorldVertices(uid) {
    if (this.lastCameraInput?.modifierResultGhost) return [];
    const vertices = [];
    for (const instance of this.mirrorCache?.instances || []) {
      if (!instance.sourceUids.includes(uid)) continue;
      const cache = this.selectedCache?.cubePoints?.has(uid) ? this.selectedCache : this.staticCache;
      const cubePoints = cache?.cubePoints?.get(uid) || [];
      const source = (instance.cubeIndices?.[uid] || cubePoints.map((_, index) => index))
        .flatMap(index => cubePoints[index] || []);
      const seen = new Set();
      for (const point of source) {
        const transformed = this.paintExplodeInstancePoint(instance, uid, point);
        const key = transformed.map(value => Math.round(value * 1e5)).join(',');
        if (seen.has(key)) continue;
        seen.add(key);
        vertices.push({ uid, point: transformed, generated: true, instanceKey: instance.key });
      }
    }
    return vertices;
  }

  getVertexSnapIntersectionGeometry(project, selectedUid) {
    const selectedNode = project.getNode(selectedUid);
    if (!selectedNode) return { sourceCubes: [], targetCubes: [], targetQuads: [] };
    const sourceUids = new Set(selectedNode.type === 'group'
      ? project.getDescendantElementUids(selectedUid) : [selectedUid]);
    const dynamicUids = new Set(this.selectedCache?.cubePoints?.keys() || []);
    const visible = new Map();
    const isVisible = uid => {
      if (visible.has(uid)) return visible.get(uid);
      const node = project.getNode(uid);
      const result = Boolean(node && node.visible !== false
        && project.getGroupChain(uid).every(group => group.visible !== false));
      visible.set(uid, result);
      return result;
    };
    const sourceCubes = [], targetCubes = [], targetQuads = [];
    const facesByUid = new Map();
    for (const [cache, skipDynamic] of [[this.staticCache, true], [this.selectedCache, false]]) {
      if (!cache) continue;
      for (const [uid, cubes] of cache.cubePoints) {
        if ((skipDynamic && dynamicUids.has(uid)) || !isVisible(uid)) continue;
        (sourceUids.has(uid) ? sourceCubes : targetCubes).push(...cubes);
      }
      for (const face of cache.faces) {
        if ((skipDynamic && dynamicUids.has(face.uid)) || !isVisible(face.uid)) continue;
        if (!facesByUid.has(face.uid)) facesByUid.set(face.uid, []);
        facesByUid.get(face.uid).push(face);
        if (!sourceUids.has(face.uid)) targetQuads.push(face.quad);
      }
    }
    if (!this.lastCameraInput?.modifierResultGhost) {
      for (const instance of this.mirrorCache?.instances || []) {
        for (const uid of instance.sourceUids) {
          if (!isVisible(uid)) continue;
          const cache = dynamicUids.has(uid) ? this.selectedCache : this.staticCache;
          const cubes = cache?.cubePoints?.get(uid) || [];
          const indices = instance.cubeIndices?.[uid] || cubes.map((_, index) => index);
          const allowed = new Set(indices);
          for (const index of indices) if (cubes[index]) {
            targetCubes.push(cubes[index].map(point => modifierInstancePoint(instance, point)));
          }
          for (const face of facesByUid.get(uid) || []) {
            if (allowed.has(face.cubeIndex ?? 0)) {
              targetQuads.push(face.quad.map(point => modifierInstancePoint(instance, point)));
            }
          }
        }
      }
    }
    return { sourceCubes, targetCubes, targetQuads };
  }

  getCurveNodeWorldPoints(project, uid) {
    const curve = project.getNode(uid);
    if (!curve || !['bezier2d', 'bezier3d'].includes(curve.type)) return [];
    const chain = project.getGroupChain(uid);
    return curve.nodes.map((node, index) => ({
      uid,
      index,
      point: applyGroupTransforms(nodeLocalPoint(curve, node.position), chain)
    }));
  }

  pickCurveNode(project, uid, screenX, screenY, radius = 14, excludeIndex = null) {
    let closest = null;
    for (const entry of this.getCurveNodeWorldPoints(project, uid)) {
      if (entry.index === excludeIndex) continue;
      const projected = projectScreenPoint(entry.point, this.lastViewProjection, this.lastViewport.width, this.lastViewport.height);
      if (projected.behind || projected.depth < -1 || projected.depth > 1) continue;
      const distance = Math.hypot(projected.x - screenX, projected.y - screenY);
      if (distance <= radius && (!closest || distance < closest.distance)) closest = { ...entry, projected, distance };
    }
    return closest;
  }

  getCurveHandleWorldPoints(project, uid, nodeIndex = null) {
    const curve = project.getNode(uid);
    if (!curve) return [];
    const chain = project.getGroupChain(uid);
    if (curve.type === 'node') {
      if (!curve.handlesEnabled) return [];
      return ['handleIn', 'handleOut'].map(property => ({
        uid,
        index: null,
        property,
        point: applyGroupTransforms(rotatePoint(
          curve.position.map((value, axis) => value + curve[property][axis]),
          curve.position,
          curve.rotation || [0, 0, 0]
        ), chain)
      }));
    }
    if (!['bezier2d', 'bezier3d'].includes(curve.type)) return [];
    const entries = [];
    curve.nodes.forEach((node, index) => {
      if (!node.handlesEnabled || (nodeIndex !== null && index !== nodeIndex)) return;
      const resolved = curve.resolvedNodeState(index);
      for (const property of ['handleIn', 'handleOut']) {
        const handle = property === 'handleIn' ? resolved.handleIn : resolved.handleOut;
        const localPoint = node.position.map((value, axis) => value + handle[axis]);
        entries.push({
          uid,
          index,
          property,
          point: applyGroupTransforms(nodeLocalPoint(curve, localPoint), chain)
        });
      }
    });
    return entries;
  }

  pickCurveHandle(project, uid, screenX, screenY, nodeIndex = null, radius = 13) {
    let closest = null;
    for (const entry of this.getCurveHandleWorldPoints(project, uid, nodeIndex)) {
      const projected = projectScreenPoint(entry.point, this.lastViewProjection, this.lastViewport.width, this.lastViewport.height);
      if (projected.behind || projected.depth < -1 || projected.depth > 1) continue;
      const distance = Math.hypot(projected.x - screenX, projected.y - screenY);
      if (distance <= radius && (!closest || distance < closest.distance)) closest = { ...entry, projected, distance };
    }
    return closest;
  }

  pickCurveSegment(project, screenX, screenY, candidateUid = null, radius = 11) {
    const curves = project.elements.filter(element => ['bezier2d', 'bezier3d'].includes(element.type)
      && element.visible !== false && (!candidateUid || element.uid === candidateUid));
    let closest = null;
    for (const curve of curves) {
      const chain = project.getGroupChain(curve.uid);
      const dense = curve.sampleCurve();
      for (let index = 0; index < dense.length - 1; index++) {
        if (dense[index].segment !== dense[index + 1].segment) continue;
        const startWorld = applyGroupTransforms(nodeLocalPoint(curve, dense[index].point), chain);
        const endWorld = applyGroupTransforms(nodeLocalPoint(curve, dense[index + 1].point), chain);
        const start = projectScreenPoint(startWorld, this.lastViewProjection, this.lastViewport.width, this.lastViewport.height);
        const end = projectScreenPoint(endWorld, this.lastViewProjection, this.lastViewport.width, this.lastViewport.height);
        if (start.behind || end.behind) continue;
        const dx = end.x - start.x, dy = end.y - start.y;
        const lengthSquared = dx * dx + dy * dy;
        const amount = lengthSquared > 1e-8
          ? Math.max(0, Math.min(1, ((screenX - start.x) * dx + (screenY - start.y) * dy) / lengthSquared)) : 0;
        const distance = Math.hypot(screenX - (start.x + dx * amount), screenY - (start.y + dy * amount));
        if (distance <= radius && (!closest || distance < closest.distance)) {
          closest = { uid: curve.uid, segmentIndex: dense[index].segment, distance };
        }
      }
    }
    return closest;
  }

  getSelectionBounds(project, selection) {
    const descriptor = this.getSelectionDescriptor(project, selection);
    if (this.selectedCache?.project !== project
      || this.selectedCache.selectedKey !== descriptor.selectedKey) return null;
    return this.selectedCache.bounds ? {
      min: [...this.selectedCache.bounds.min],
      max: [...this.selectedCache.bounds.max],
      center: [...this.selectedCache.bounds.center]
    } : null;
  }

  getSelectionProjectionExtent(project, selection, origin, axis) {
    const descriptor = this.getSelectionDescriptor(project, selection);
    if (this.selectedCache?.project !== project
      || this.selectedCache.selectedKey !== descriptor.selectedKey) return null;
    let extent = 0;
    let found = false;
    for (const point of this.selectedCache.boundsPoints || []) {
      const projection = (point[0] - origin[0]) * axis[0]
        + (point[1] - origin[1]) * axis[1]
        + (point[2] - origin[2]) * axis[2];
      extent = Math.max(extent, Math.abs(projection));
      found = true;
    }
    return found ? extent : null;
  }

  projectPoint(point) {
    return projectScreenPoint(point, this.lastViewProjection, this.lastViewport.width, this.lastViewport.height);
  }

  getLocatorScreenSize(point) {
    return locatorScreenSize(point, this.lastCameraState);
  }

  getScreenRay(screenX, screenY) {
    if (!this.lastCameraState || !this.lastCameraInput) return null;
    const ray = screenRay(screenX, screenY, this.lastViewport, this.lastCameraState, this.lastCameraInput);
    return { origin: [...ray.origin], direction: [...ray.direction] };
  }

  getCameraFrame() {
    return this.lastCameraState;
  }

  getGeometryCenter(project, uid) {
    const node = project.getNode(uid);
    if (!node) return null;
    const uids = node.type === 'group' ? project.getDescendantElementUids(uid) : [uid];
    const points = uids.flatMap(elementUid => this.lastOwnerPoints.get(elementUid) || []);
    if (!points.length) return null;
    return [0, 1, 2].map(axis => {
      const values = points.map(point => point[axis]);
      return (Math.min(...values) + Math.max(...values)) / 2;
    });
  }

  uploadBuffer(buffer, vertices, usage) {
    const { gl } = this;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), usage);
  }

  drawVertices(vertices, primitive, matrix, options = {}) {
    if (!vertices.length) return;
    this.uploadBuffer(this.dynamicBuffer, vertices, this.gl.DYNAMIC_DRAW);
    this.drawBuffer(this.dynamicBuffer, vertices.length / 12, primitive, matrix, options);
  }

  drawFaceLabel(camera, viewProjection) {
    const label = camera.faceLabel;
    if (!label?.source || label.quad?.length !== 4) return;
    const { gl } = this;
    if (this.faceLabelTextureKey !== label.key) {
      gl.bindTexture(gl.TEXTURE_2D, this.faceLabelTexture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, label.source);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.faceLabelTextureKey = label.key;
    }
    const edgeU = subtract(label.quad[1], label.quad[0]);
    const edgeV = subtract(label.quad[2], label.quad[0]);
    let normal = normalize(cross(edgeU, edgeV));
    if (this.lastCameraState?.eye
      && dot(normal, subtract(this.lastCameraState.eye, label.quad[0])) < 0) {
      normal = normal.map(value => -value);
    }
    // A shader-written logarithmic depth bypasses the useful part of
    // polygonOffset on several WebGL drivers. Lift only the rasterized helper
    // by a sub-pixel world-space epsilon so it remains attached to the face
    // while receiving an unambiguous depth value.
    const epsilon = Math.max(Math.hypot(...edgeU), Math.hypot(...edgeV), 1) * .0005;
    const renderQuad = label.quad.map(point => add(point, scale(normal, epsilon)));
    const uv = [[0, 1], [1, 1], [0, 0], [1, 0]];
    const vertices = [];
    FACE_TRIANGLE_SLOTS.forEach(slot => pushVertex(vertices, renderQuad[slot], [1, 1, 1, 1], [0, 0, 0], uv[slot]));
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(-4, -4);
    this.drawVertices(vertices, gl.TRIANGLES, viewProjection, {
      depthWrite: false,
      cull: false,
      renderMode: 2,
      alphaMode: 2,
      blend: true,
      texture: this.faceLabelTexture
    });
    gl.disable(gl.POLYGON_OFFSET_FILL);
  }

  drawBuffer(buffer, vertexCount, primitive, matrix, {
    depthWrite = true, cull = true, renderMode = 1, alphaMode = 0, blend = false, first = 0, opacity = 1,
    modelTransform = null, depthTest = true, texture = null, flipWinding = false, colorOverride = null
  } = {}) {
    if (!vertexCount) return;
    const { gl } = this;
    gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.uniformMatrix4fv(this.matrixLocation, false, matrix);
    gl.uniformMatrix4fv(this.modelTransformLocation, false, modelTransform || IDENTITY_MATRIX);
    // Vanilla Java entity diffuse-light directions (Lighting/RenderSystem).
    gl.uniform3fv(this.light0Location, normalize([.2, 1, -.7]));
    gl.uniform3fv(this.light1Location, normalize([-.2, 1, .7]));
    gl.uniform1i(this.previewShadeLocation, this.previewShade ? 1 : 0);
    gl.uniform1i(this.renderModeLocation, renderMode);
    gl.uniform1i(this.alphaModeLocation, alphaMode);
    gl.uniform1f(this.opacityLocation, opacity);
    gl.uniform4fv(this.colorOverrideLocation, colorOverride || [0, 0, 0, 0]);
    if (this.useLogDepthLocation) gl.uniform1i(this.useLogDepthLocation,
      this.logDepthEnabled && this.lastCameraState?.projection === 'perspective' ? 1 : 0);
    if (this.logDepthFactorLocation) gl.uniform1f(this.logDepthFactorLocation, 1 / Math.log2(30001));
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture || this.texture);
    gl.uniform1i(this.textureLocation, 0);
    gl.uniform1i(this.paintPixelGridLocation, this.paintPixelGrid && renderMode === 2
      && primitive === gl.TRIANGLES && (!texture || texture === this.texture) ? 1 : 0);
    gl.uniform2f(this.paintGridSizeLocation, this.texturePixelSize[0], this.texturePixelSize[1]);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.selectionMaskTexture);
    gl.uniform1i(this.selectionMaskLocation, 1);
    gl.uniform1i(this.selectionActiveLocation, this.paintSelectionActive && (!texture || texture === this.texture) ? 1 : 0);
    gl.uniform2f(this.selectionTexelLocation, 1 / this.selectionMaskSize[0], 1 / this.selectionMaskSize[1]);
    gl.uniform1f(this.selectionPixelRadiusLocation, this.selectionPixelRadius || 1.5);
    gl.uniform1f(this.selectionPhaseLocation, selectionStripePhase());
    gl.uniform4fv(this.selectionStripeViewportLocation, this.selectionStripeViewport || [0, 0, 1, 1]);
    if (this.paintSelectionActive) {
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.selectionStripeTexture);
      gl.uniform1i(this.selectionStripeLocation, 2);
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.enableVertexAttribArray(this.positionLocation);
    gl.vertexAttribPointer(this.positionLocation, 3, gl.FLOAT, false, 48, 0);
    gl.enableVertexAttribArray(this.colorLocation);
    gl.vertexAttribPointer(this.colorLocation, 4, gl.FLOAT, false, 48, 12);
    gl.enableVertexAttribArray(this.normalLocation);
    gl.vertexAttribPointer(this.normalLocation, 3, gl.FLOAT, false, 48, 28);
    gl.enableVertexAttribArray(this.uvLocation);
    gl.vertexAttribPointer(this.uvLocation, 2, gl.FLOAT, false, 48, 40);
    gl.depthMask(depthWrite);
    depthTest ? gl.enable(gl.DEPTH_TEST) : gl.disable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    cull ? gl.enable(gl.CULL_FACE) : gl.disable(gl.CULL_FACE);
    gl.frontFace(flipWinding ? gl.CW : gl.CCW);
    if (blend) {
      gl.enable(gl.BLEND);
      gl.blendEquation(gl.FUNC_ADD);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    } else gl.disable(gl.BLEND);
    gl.drawArrays(primitive, first, vertexCount);
    gl.frontFace(gl.CCW);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }
}

function mergeAdjacentVertexRanges(ranges) {
  const sorted = ranges.map(range => ({ ...range })).sort((left, right) => left.start - right.start);
  const merged = [];
  for (const range of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && previous.start + previous.count === range.start) previous.count += range.count;
    else merged.push(range);
  }
  return merged;
}

function complementVertexRanges(totalCount, excludedUids, rangesByUid, extraRanges = []) {
  if (!excludedUids?.size && !extraRanges.length) return totalCount ? [{ start: 0, count: totalCount }] : [];
  const excluded = [...(excludedUids || [])]
    .map(uid => rangesByUid.get(uid))
    .concat(extraRanges)
    .filter(range => range?.count)
    .sort((left, right) => left.start - right.start);
  const merged = [];
  for (const range of excluded) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.start + last.count) {
      last.count = Math.max(last.start + last.count, range.start + range.count) - last.start;
    } else merged.push({ ...range });
  }
  const visible = [];
  let cursor = 0;
  for (const range of merged) {
    if (range.start > cursor) visible.push({ start: cursor, count: range.start - cursor });
    cursor = Math.max(cursor, range.start + range.count);
  }
  if (cursor < totalCount) visible.push({ start: cursor, count: totalCount - cursor });
  return visible;
}

function patchVertexArrays(targetVertices, targetRanges, sourceVertices, sourceRanges, uids) {
  for (const uid of uids) {
    const target = targetRanges.get(uid), source = sourceRanges.get(uid);
    if (!target?.count) continue;
    const sourceStart = source.start * 12;
    const targetStart = target.start * 12;
    for (let index = 0; index < source.count * 12; index++) targetVertices[targetStart + index] = sourceVertices[sourceStart + index];
  }
}

function collectVertexRanges(vertices, ranges) {
  const list = Array.isArray(ranges) ? ranges : [...ranges];
  const output = new Array(list.reduce((total, range) => total + range.count * 12, 0));
  let cursor = 0;
  for (const range of list) {
    const end = (range.start + range.count) * 12;
    for (let index = range.start * 12; index < end; index++) output[cursor++] = vertices[index];
  }
  return output;
}

function normalizeSelectedNodeUids(selection) {
  if (!selection) return new Set();
  if (typeof selection === 'string') return new Set([selection]);
  return new Set(selection);
}

function indexFaces(faces) {
  const index = new Map();
  for (const face of faces || []) index.set(`${face.uid}::${face.faceName}`, face);
  return index;
}

function buildFaceBvh(faces, leafSize = 8) {
  if (!faces?.length) return null;
  const entries = faces.map(face => {
    const min = [0, 1, 2].map(axis => Math.min(...face.quad.map(point => point[axis])) - 1e-6);
    const max = [0, 1, 2].map(axis => Math.max(...face.quad.map(point => point[axis])) + 1e-6);
    return { face, min, max, center: min.map((value, axis) => (value + max[axis]) / 2) };
  });
  const build = list => {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const entry of list) for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], entry.min[axis]);
      max[axis] = Math.max(max[axis], entry.max[axis]);
    }
    if (list.length <= leafSize) return { min, max, entries: list };
    const extent = max.map((value, axis) => value - min[axis]);
    const axis = extent.indexOf(Math.max(...extent));
    list.sort((left, right) => left.center[axis] - right.center[axis]);
    const middle = Math.floor(list.length / 2);
    return { min, max, left: build(list.slice(0, middle)), right: build(list.slice(middle)) };
  };
  return build(entries);
}

function rayBoundsDistance(origin, direction, min, max, maximum = Infinity) {
  let near = 0, far = maximum;
  for (let axis = 0; axis < 3; axis++) {
    if (Math.abs(direction[axis]) < 1e-10) {
      if (origin[axis] < min[axis] || origin[axis] > max[axis]) return null;
      continue;
    }
    let first = (min[axis] - origin[axis]) / direction[axis];
    let second = (max[axis] - origin[axis]) / direction[axis];
    if (first > second) [first, second] = [second, first];
    near = Math.max(near, first);
    far = Math.min(far, second);
    if (far < near) return null;
  }
  return far >= 0 ? near : null;
}

function queryFaceBvh(root, ray) {
  if (!root) return [];
  const candidates = [];
  const firstDistance = rayBoundsDistance(ray.origin, ray.direction, root.min, root.max);
  if (firstDistance === null) return candidates;
  const stack = [{ node: root, distance: firstDistance }];
  while (stack.length) {
    const { node } = stack.pop();
    if (node.entries) {
      for (const entry of node.entries) {
        const distance = rayBoundsDistance(ray.origin, ray.direction, entry.min, entry.max);
        if (distance !== null) candidates.push({ face: entry.face, distance });
      }
      continue;
    }
    const children = [node.left, node.right]
      .map(child => ({ node: child, distance: rayBoundsDistance(ray.origin, ray.direction, child.min, child.max) }))
      .filter(entry => entry.distance !== null)
      .sort((left, right) => right.distance - left.distance);
    stack.push(...children);
  }
  candidates.sort((left, right) => left.distance - right.distance);
  return candidates.map(entry => entry.face);
}

function getDynamicElementUids(project, selection) {
  const dynamic = new Set();
  const visit = uid => {
    const node = project.getNode(uid);
    if (!node) return;
    if (node.type === 'group') node.children.forEach(visit);
    else dynamic.add(node.uid);
  };
  normalizeSelectedNodeUids(selection).forEach(visit);
  return dynamic;
}

function collectLockedState(project) {
  const nodes = new Map([...project.elements, ...project.groups].map(node => [node.uid, node]));
  const elementUids = new Set(project.elements.map(element => element.uid));
  const uids = new Set(project.elements.filter(element => element.locked).map(element => element.uid));
  const visitedGroups = new Map();
  const visit = (uid, inheritedLocked = false) => {
    const node = nodes.get(uid);
    if (!node || node.type !== 'group') return;
    const locked = inheritedLocked || node.locked === true;
    const previous = visitedGroups.get(uid);
    if (previous === true || previous === locked) return;
    visitedGroups.set(uid, locked);
    for (const childUid of node.children) {
      if (elementUids.has(childUid)) {
        const child = nodes.get(childUid);
        if (locked || child?.locked) uids.add(childUid);
      } else visit(childUid, locked);
    }
  };
  project.outliner.forEach(uid => visit(uid, false));
  project.groups.forEach(group => visit(group.uid, false));
  return { uids, nodes };
}

function buildElementGeometry(project, elements, selection, selectionOutline = [1, 1, 1], faceDistinct = false, textureLayout = null) {
  const selectedUids = normalizeSelectedNodeUids(selection);
  const renderFormatRules = formatRules(project);
  const triangles = [];
  const faces = [];
  const edges = [];
  const helpers = [];
  const ownerPoints = new Map();
  const boundsPoints = [];
  const triangleRanges = new Map();
  const edgeRanges = new Map();
  const helperRanges = new Map();
  const cubeTriangleRanges = new Map();
  const cubeEdgeRanges = new Map();
  const cubePoints = new Map();
  for (const element of elements) {
    const triangleStart = triangles.length / 12;
    const edgeStart = edges.length / 12;
    const helperStart = helpers.length / 12;
    const elementCubeTriangles = [], elementCubeEdges = [];
    const elementCubePoints = [];
    const finishRanges = () => {
      triangleRanges.set(element.uid, { start: triangleStart, count: triangles.length / 12 - triangleStart });
      edgeRanges.set(element.uid, { start: edgeStart, count: edges.length / 12 - edgeStart });
      helperRanges.set(element.uid, { start: helperStart, count: helpers.length / 12 - helperStart });
      cubeTriangleRanges.set(element.uid, elementCubeTriangles);
      cubeEdgeRanges.set(element.uid, elementCubeEdges);
      cubePoints.set(element.uid, elementCubePoints);
    };
    const subdivisionOwner = element.subdivisionOwnerUid && project.getNode(element.subdivisionOwnerUid);
    const groupChain = project.getGroupChain(subdivisionOwner?.uid || element.uid);
    const selectedByGroup = groupChain.some(group => selectedUids.has(group.uid));
    const selectedForBounds = selectedUids.has(element.uid) || selectedByGroup;
    if (element.type === 'locator' || element.type === 'node') {
      const geometry = element.type === 'locator' ? locatorGeometry(element, groupChain) : nodeElementGeometry(element, groupChain);
      if (element.visible) helpers.push(...geometry.lines);
      if (element.visible) ownerPoints.set(element.uid, geometry.points);
      if (element.visible || selectedForBounds) boundsPoints.push(...geometry.points);
      finishRanges();
      continue;
    }
    if (element.type === 'bezier2d' || element.type === 'bezier3d') {
      const curveGeometry = bezierHelperGeometry(element, groupChain);
      if (element.visible) helpers.push(...curveGeometry.lines);
    }
    const cubes = subdivisionOwner
      ? [{ cube: element, offset: subdivisionOwner.origin || [0, 0, 0], ownerRotation: subdivisionOwner.rotation || [0, 0, 0], ownerOrigin: subdivisionOwner.pivot || subdivisionOwner.origin || [0, 0, 0], groupChain, textureSize: project.textureSize, shade: element.shade !== false && subdivisionOwner.shade !== false }]
      : typeof element.toCubes === 'function'
      ? element.toCubes().map((cube, cubeIndex) => ({ cube: renderFormatRules.javaBlock || renderFormatRules.moddedEntity ? constrainCube(cube, renderFormatRules) : cube, cubeIndex, offset: element.origin, ownerRotation: element.rotation, ownerOrigin: element.pivot || element.origin, groupChain, textureSize: project.textureSize, shade: element.shade }))
      : [{ cube: element, offset: [0, 0, 0], ownerRotation: [0, 0, 0], ownerOrigin: element.pivot, groupChain, textureSize: project.textureSize, shade: element.shade }];

    if (!element.visible) {
      if (selectedForBounds) boundsPoints.push(...cubes.flatMap(cubeWorldCorners));
      finishRanges();
      continue;
    }

    for (const entry of cubes) {
      const cubeTriangleStart = triangles.length / 12;
      const cubeEdgeStart = edges.length / 12;
      const geometry = cubeGeometry(entry, element.color, selectedForBounds, selectionOutline, faceDistinct, textureLayout);
      triangles.push(...geometry.triangles);
      faces.push(...geometry.faces.map(face => ({
        ...face, uid: element.uid, cube: entry.cube,
        cubeUid: entry.cube.uid || element.uid,
        cubeIndex: entry.cubeIndex ?? entry.cube.subdivisionIndex ?? null
      })));
      edges.push(...geometry.edges);
      elementCubeTriangles.push({ start: cubeTriangleStart, count: triangles.length / 12 - cubeTriangleStart });
      elementCubeEdges.push({ start: cubeEdgeStart, count: edges.length / 12 - cubeEdgeStart });
      elementCubePoints.push(geometry.corners);
      if (!ownerPoints.has(element.uid)) ownerPoints.set(element.uid, []);
      ownerPoints.get(element.uid).push(...geometry.corners);
      boundsPoints.push(...geometry.corners);
    }
    finishRanges();
  }
  const bounds = geometryBounds(boundsPoints);
  return { triangles, faces, edges, helpers, ownerPoints, triangleRanges, edgeRanges, helperRanges,
    cubeTriangleRanges, cubeEdgeRanges, cubePoints, bounds, boundsPoints };
}

function geometryBounds(points) {
  const minimum = [Infinity, Infinity, Infinity];
  const maximum = [-Infinity, -Infinity, -Infinity];
  let found = false;
  for (const point of points) {
    for (let axis = 0; axis < 3; axis++) {
      minimum[axis] = Math.min(minimum[axis], point[axis]);
      maximum[axis] = Math.max(maximum[axis], point[axis]);
    }
    found = true;
  }
  if (!found) return null;
  return {
    min: minimum,
    max: maximum,
    center: minimum.map((value, axis) => (value + maximum[axis]) / 2)
  };
}

function locatorGeometry(locator, groupChain) {
  const origin = locator.position || [0, 0, 0];
  const points = [applyGroupTransforms(origin, groupChain)];
  return { lines: [], points };
}

function nodeLocalPoint(element, point) {
  const translated = point.map((value, axis) => value + element.origin[axis]);
  return rotatePoint(translated, element.origin, element.rotation || [0, 0, 0]);
}

function appendLine(lines, start, end, color = [1, 1, 1, .9]) {
  pushVertex(lines, start, color);
  pushVertex(lines, end, color);
}

function curveNodeMark(node, transformPoint) {
  const lines = [], points = [];
  const center = transformPoint(node.position);
  const oriented = offset => transformPoint(rotatePoint(
    node.position.map((value, axis) => value + offset[axis]), node.position, node.rotation || [0, 0, 0]));
  const rawDirection = node.directionVector || (node.handlesEnabled ? node.handleOut : null) || [0, 0, 1];
  const directionLength = Math.hypot(...rawDirection) || 1;
  const directionEnd = oriented(rawDirection.map(value => value / directionLength * 1.25));
  appendLine(lines, center, directionEnd);
  points.push(center, directionEnd);
  let previous = oriented([.38, 0, 0]);
  for (let index = 1; index <= 20; index++) {
    const angle = index / 20 * Math.PI * 2;
    const next = oriented([Math.cos(angle) * .38, 0, Math.sin(angle) * .38]);
    appendLine(lines, previous, next, [1, 1, 1, .78]);
    points.push(next);
    previous = next;
  }
  if (node.handlesEnabled) {
    const handleIn = oriented(node.handleIn);
    const handleOut = oriented(node.handleOut);
    appendLine(lines, handleIn, center, [1, 1, 1, .58]);
    appendLine(lines, center, handleOut, [1, 1, 1, .58]);
    points.push(handleIn, handleOut);
  }
  return { lines, points };
}

function nodeElementGeometry(element, groupChain) {
  const node = {
    position: element.position,
    rotation: element.rotation,
    handlesEnabled: element.handlesEnabled,
    handleIn: element.handleIn,
    handleOut: element.handleOut
  };
  const transformPoint = point => applyGroupTransforms(point, groupChain);
  return curveNodeMark(node, transformPoint);
}

function bezierHelperGeometry(element, groupChain) {
  const lines = [], points = [];
  const transformPoint = point => applyGroupTransforms(nodeLocalPoint(element, point), groupChain);
  const sampled = element.sampleCurve();
  for (let index = 0; index < sampled.length - 1; index++) {
    const start = transformPoint(sampled[index].point);
    const end = transformPoint(sampled[index + 1].point);
    appendLine(lines, start, end, [1, 1, 1, .7]);
    points.push(start, end);
  }
  element.nodes.forEach((node, index) => {
    const resolved = element.resolvedNodeState(index);
    const directionVector = index < element.nodes.length - 1
      ? resolved.localHandleOut
      : resolved.localHandleIn.map(value => -value);
    const geometry = curveNodeMark({
      ...node,
      rotation: resolved.rotation,
      handleIn: resolved.localHandleIn,
      handleOut: resolved.localHandleOut,
      directionVector
    }, transformPoint);
    lines.push(...geometry.lines);
    points.push(...geometry.points);
  });
  return { lines, points };
}

function mergeOwnerPoints(staticPoints, dynamicPoints) {
  const merged = new Map();
  for (const [uid, points] of staticPoints) merged.set(uid, points);
  for (const [uid, points] of dynamicPoints) merged.set(uid, points);
  return merged;
}

export function createSignedCubeCorners(position, size, inflate = 0) {
  const direction = size.map(value => value < 0 ? -1 : 1);
  const from = position.map((value, axis) => value - direction[axis] * inflate);
  const to = position.map((value, axis) => value + size[axis] + direction[axis] * inflate);
  return [
    [from[0], from[1], from[2]], [to[0], from[1], from[2]], [to[0], to[1], from[2]], [from[0], to[1], from[2]],
    [from[0], from[1], to[2]], [to[0], from[1], to[2]], [to[0], to[1], to[2]], [from[0], to[1], to[2]]
  ];
}

function cubeGeometry(entry, color, selected, selectionOutline = [1, 1, 1], faceDistinct = false, textureLayout = null) {
  const corners = cubeWorldCorners(entry);
  const { cube, offset, ownerRotation, ownerOrigin, groupChain, textureSize, shade } = entry;

  const edgeBoost = selected ? 1.08 : 1;
  const triangles = [], faceBatches = [];
  for (const [faceName, quadIndices] of Object.entries(FACE_LAYOUTS)) {
    const faceData = cube.faces?.[faceName];
    // A face without a texture remains renderable using the same display
    // colour as solid mode. Only an explicitly culled face is omitted.
    if (isCubeFaceCulled(faceData)) continue;
    const textured = hasAssignedFaceTexture(faceData);
    const indices = FACE_TRIANGLE_SLOTS.map(slot => quadIndices[slot]);
    const a = corners[indices[0]], b = corners[indices[1]], c = corners[indices[2]];
    const normal = normalize(cross(subtract(b, a), subtract(c, a)));
    const sourceColor = getCubeFaceDisplayColor(color, faceName, faceDistinct);
    const faceColor = sourceColor.map(channel => Math.min(1, channel * edgeBoost));
    const faceUv = textured
      ? getFaceUv(cube, faceName, textureSize, textureLayout)
      : Array.from({ length: 6 }, () => [UNTEXTURED_UV_SENTINEL, UNTEXTURED_UV_SENTINEL]);
    const faceVertices = [];
    const textureEntry = textureLayoutEntry(textureLayout, faceData?.texture);
    const quad = quadIndices.map(index => corners[index]);
    if (textured && textureEntry?.mode === 'tiled') {
      const regions = tiledFaceRegions(cube, faceName, textureEntry.width, textureEntry.height);
      const point = (u, v) => quad[0].map((value, axis) => value + (quad[1][axis] - value) * u + (quad[2][axis] - value) * v);
      for (const region of regions) {
        const tileEntry = textureLayout.byReference.get(tiledFaceReference(cube, faceName, textureEntry, region));
        if (!tileEntry) continue;
        const points = [point(region.x / region.faceWidth, region.y / region.faceHeight), point((region.x + region.width) / region.faceWidth, region.y / region.faceHeight), point(region.x / region.faceWidth, (region.y + region.height) / region.faceHeight), point((region.x + region.width) / region.faceWidth, (region.y + region.height) / region.faceHeight)];
        const uvs = createAtlasFaceUvs([0, 0, tileEntry.width, tileEntry.height], 0, tileEntry, [textureLayout.width, textureLayout.height]);
        FACE_TRIANGLE_SLOTS.forEach((slot, index) => pushVertex(faceVertices, points[slot], [...faceColor, selected ? 2 : 1], shade === false ? [0, 0, 0] : normal, uvs[index]));
      }
    } else indices.forEach((index, vertexIndex) => pushVertex(faceVertices, corners[index], [...faceColor, selected ? 2 : 1], shade === false ? [0, 0, 0] : normal, faceUv[vertexIndex]));
    triangles.push(...faceVertices);
    faceBatches.push({ faceName, quad, vertices: faceVertices, center: averagePoints(quad) });
  }
  const edges = [], edgeColor = selected ? [...selectionOutline, 1] : [.46, .56, .4, 1];
  for (const [a, b] of [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]]) {
    pushVertex(edges, corners[a], edgeColor); pushVertex(edges, corners[b], edgeColor);
  }
  return { triangles, faces: faceBatches, edges, corners };
}

const UNTEXTURED_UV_SENTINEL = -1000000;

export function hasAssignedFaceTexture(face) {
  return face?.texture !== undefined && face?.texture !== null;
}

export function getCubeFaceDisplayColor(color, faceName, faceDistinct = false) {
  return faceDistinct ? FACE_PREVIEW_COLORS[faceName] : hexToRgb(color);
}

export function isCubeFaceCulled(face) {
  return face === null || face?.enabled === false || face?.texture === null;
}

export function getSurfaceRenderMode(mode) {
  return mode === 'textured' ? 2 : mode === 'normal' ? 4 : 1;
}

function cubeWorldCorners(entry) {
  const { cube, offset, ownerRotation, ownerOrigin, groupChain } = entry;
  const inflate = getEffectiveInflate(cube, groupChain);
  const start = cube.position.map((value, axis) => value + offset[axis]);
  const cubePivot = cube.pivot.map((value, axis) => value + offset[axis]);
  return createSignedCubeCorners(start, cube.size, inflate)
    .map(point => rotatePoint(point, cubePivot, cube.rotation || [0, 0, 0]))
    .map(point => rotatePoint(point, ownerOrigin, ownerRotation || [0, 0, 0]))
    .map(point => applyGroupTransforms(point, groupChain));
}

export function getEffectiveInflate(cube, groupChain = []) {
  return (Number(cube?.inflate) || 0)
    + groupChain.reduce((total, group) => total + (Number(group?.inflate) || 0), 0);
}

function gridGeometry(subdivisions = 16) {
  const fine = [], major = [], direction = [];
  const floorY = -.025;
  const majorColor = [.43, .34, .5, .38];
  const fineColor = [.46, .37, .54, .28];
  for (const coordinate of [-24, -8, 8, 24]) {
    pushVertex(major, [coordinate, floorY, -24], majorColor); pushVertex(major, [coordinate, floorY, 24], majorColor);
    pushVertex(major, [-24, floorY, coordinate], majorColor); pushVertex(major, [24, floorY, coordinate], majorColor);
  }

  const count = Math.max(1, Math.min(512, Number(subdivisions) || 16));
  const step = 16 / count;
  for (let index = 1; index < count; index++) {
    const coordinate = -8 + index * step;
    if (Math.abs(coordinate) < .00001) continue;
    pushVertex(fine, [coordinate, floorY, -8], fineColor); pushVertex(fine, [coordinate, floorY, 8], fineColor);
    pushVertex(fine, [-8, floorY, coordinate], fineColor); pushVertex(fine, [8, floorY, coordinate], fineColor);
  }
  pushVertex(fine, [0, floorY, -8], fineColor); pushVertex(fine, [0, floorY, 0], fineColor);
  pushVertex(fine, [-8, floorY, 0], fineColor); pushVertex(fine, [0, floorY, 0], fineColor);

  const addLine = (a, b, color) => { pushVertex(direction, a, color); pushVertex(direction, b, color); };
  const red = [.96, .18, .28, .9], blue = [.18, .42, 1, .9], marker = [.55, .43, .65, .72];
  addLine([0, floorY + .004, 0], [8, floorY + .004, 0], red);
  addLine([0, floorY + .004, 0], [0, floorY + .004, 8], blue);
  const y = floorY + .006;
  // Minecraft north is negative Z. Keep the N and arrow centred above the central cell.
  addLine([-.45, y, -8.65], [-.45, y, -9.75], marker);
  addLine([-.45, y, -9.75], [.45, y, -8.65], marker);
  addLine([.45, y, -8.65], [.45, y, -9.75], marker);
  addLine([-.42, y, -10.15], [0, y, -10.57], marker);
  addLine([0, y, -10.57], [.42, y, -10.15], marker);
  return { fine, major, direction };
}

function boundsWireGeometry(points) {
  if (!points.length) return [];
  const min = [0, 1, 2].map(axis => Math.min(...points.map(point => point[axis])));
  const max = [0, 1, 2].map(axis => Math.max(...points.map(point => point[axis])));
  const corners = [
    [min[0],min[1],min[2]], [max[0],min[1],min[2]], [max[0],max[1],min[2]], [min[0],max[1],min[2]],
    [min[0],min[1],max[2]], [max[0],min[1],max[2]], [max[0],max[1],max[2]], [min[0],max[1],max[2]]
  ];
  const edges = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
  const vertices = [], color = [.82, 1, .48, .68];
  for (const [a, b] of edges) { pushVertex(vertices, corners[a], color); pushVertex(vertices, corners[b], color); }
  return vertices;
}

function buildCameraState(camera, aspect, width, height) {
  const pitch = clamp(camera.pitch, -Math.PI / 2 + .001, Math.PI / 2 - .001);
  const distance = camera.projection === 'perspective' ? 42 / camera.zoom : 4096;
  const baseTarget = camera.target || [0, 9, 0];
  const direction = [Math.sin(camera.yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(camera.yaw) * Math.cos(pitch)];
  const preliminaryEye = add(baseTarget, scale(direction, distance));
  const forward = normalize(subtract(baseTarget, preliminaryEye));
  const right = normalize(cross(forward, [0, 1, 0]));
  const up = normalize(cross(right, forward));
  const worldPerPixel = camera.projection === 'perspective'
    ? 2 * distance * Math.tan(45 * DEG / 2) / height
    : 36 / (height * camera.zoom);
  const pan = add(scale(right, -camera.panX * worldPerPixel), scale(up, camera.panY * worldPerPixel));
  const target = add(baseTarget, pan);
  const eye = add(preliminaryEye, pan);
  const view = lookAt(eye, target, [0, 1, 0]);
  const projection = camera.projection === 'perspective'
    ? perspective(45 * DEG, aspect, .05, 30000)
    : orthographic(-18 * aspect / camera.zoom, 18 * aspect / camera.zoom, -18 / camera.zoom, 18 / camera.zoom, -30000, 30000);
  return { matrix: multiply(projection, view), eye, target, forward, right, up, worldPerPixel, projection: camera.projection };
}

function projectScreenPoint(point, matrix, width, height) {
  const clip = transform(matrix, [...point, 1]);
  const w = clip[3] || .00001;
  return {
    x: (clip[0] / w * .5 + .5) * width,
    y: (1 - (clip[1] / w * .5 + .5)) * height,
    depth: clip[2] / w,
    behind: w < 0
  };
}

function screenRay(screenX, screenY, viewport, cameraState, camera) {
  const ndcX = screenX / viewport.width * 2 - 1;
  const ndcY = 1 - screenY / viewport.height * 2;
  const aspect = viewport.width / viewport.height;
  if (cameraState.projection === 'perspective') {
    const halfFovTangent = Math.tan(45 * DEG / 2);
    const direction = normalize(add(cameraState.forward,
      add(scale(cameraState.right, ndcX * aspect * halfFovTangent), scale(cameraState.up, ndcY * halfFovTangent))));
    return { origin: cameraState.eye, direction };
  }
  const halfHeight = 18 / camera.zoom;
  const origin = add(cameraState.eye,
    add(scale(cameraState.right, ndcX * halfHeight * aspect), scale(cameraState.up, ndcY * halfHeight)));
  return { origin, direction: cameraState.forward };
}

function rayTriangleDistance(origin, direction, a, b, c) {
  const epsilon = 1e-7;
  const edge1 = subtract(b, a), edge2 = subtract(c, a);
  const p = cross(direction, edge2);
  const determinant = dot(edge1, p);
  if (Math.abs(determinant) < epsilon) return null;
  const inverse = 1 / determinant;
  const fromA = subtract(origin, a);
  const u = dot(fromA, p) * inverse;
  if (u < 0 || u > 1) return null;
  const q = cross(fromA, edge1);
  const v = dot(direction, q) * inverse;
  if (v < 0 || u + v > 1) return null;
  const distance = dot(edge2, q) * inverse;
  return distance > epsilon ? distance : null;
}

function screenBounds(points, matrix, width, height) {
  const projected = points.map(point => projectScreenPoint(point, matrix, width, height)).filter(point => !point.behind);
  if (!projected.length) return { x1: -1, y1: -1, x2: -1, y2: -1 };
  return {
    x1: Math.min(...projected.map(point => point.x)), y1: Math.min(...projected.map(point => point.y)),
    x2: Math.max(...projected.map(point => point.x)), y2: Math.max(...projected.map(point => point.y))
  };
}

function normalizeScreenRect(rect) {
  return {
    x1: Math.min(rect.x1, rect.x2),
    y1: Math.min(rect.y1, rect.y2),
    x2: Math.max(rect.x1, rect.x2),
    y2: Math.max(rect.y1, rect.y2)
  };
}

function screenPointInRect(point, rect) {
  return point.x >= rect.x1 && point.x <= rect.x2 && point.y >= rect.y1 && point.y <= rect.y2;
}

function screenSegmentIntersectsRect(first, second, rect) {
  if (screenPointInRect(first, rect) || screenPointInRect(second, rect)) return true;
  const dx = second.x - first.x, dy = second.y - first.y;
  let start = 0, end = 1;
  for (const [p, q] of [[-dx, first.x - rect.x1], [dx, rect.x2 - first.x], [-dy, first.y - rect.y1], [dy, rect.y2 - first.y]]) {
    if (Math.abs(p) < 1e-9) {
      if (q < 0) return false;
      continue;
    }
    const ratio = q / p;
    if (p < 0) start = Math.max(start, ratio);
    else end = Math.min(end, ratio);
    if (start > end) return false;
  }
  return true;
}

function screenPointInPolygon(point, polygon) {
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
    const a = polygon[current], b = polygon[previous];
    if ((a.y > point.y) !== (b.y > point.y)
      && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function screenPolygonIntersectsRect(points, screenRect) {
  const polygon = points.filter(point => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (!polygon.length) return false;
  const rect = normalizeScreenRect(screenRect);
  if (polygon.some(point => screenPointInRect(point, rect))) return true;
  if (polygon.length >= 3 && [
    { x: rect.x1, y: rect.y1 }, { x: rect.x2, y: rect.y1 },
    { x: rect.x2, y: rect.y2 }, { x: rect.x1, y: rect.y2 }
  ].some(point => screenPointInPolygon(point, polygon))) return true;
  const edgeCount = polygon.length === 2 ? 1 : polygon.length;
  for (let index = 0; index < edgeCount; index++) {
    if (screenSegmentIntersectsRect(polygon[index], polygon[(index + 1) % polygon.length], rect)) return true;
  }
  return false;
}

function rotatePoint(point, pivot, rotation) {
  let [x, y, z] = subtract(point, pivot);
  const [rx, ry, rz] = rotation.map(value => value * DEG);
  let c = Math.cos(rx), s = Math.sin(rx); [y, z] = [y * c - z * s, y * s + z * c];
  c = Math.cos(ry); s = Math.sin(ry); [x, z] = [x * c + z * s, -x * s + z * c];
  c = Math.cos(rz); s = Math.sin(rz); [x, y] = [x * c - y * s, x * s + y * c];
  return add([x, y, z], pivot);
}

export function applyGroupTransforms(point, groupChain = []) {
  let transformed = [...point];
  for (const group of [...groupChain].reverse()) {
    transformed = rotatePoint(transformed, group.pivot, group.rotation || [0, 0, 0]);
  }
  return transformed;
}

function pushVertex(target, position, color, normal = [0, 0, 0], uv = [0, 0]) { target.push(position[0], position[1], position[2], color[0], color[1], color[2], color[3], normal[0], normal[1], normal[2], uv[0], uv[1]); }
function textureLayoutEntry(layout, reference) {
  if (!layout) return null;
  if (reference === null || reference === undefined) return layout.defaultEntry;
  const raw = String(reference);
  return layout.byReference.get(raw) || layout.byReference.get(raw.startsWith('#') ? raw.slice(1) : `#${raw}`) || layout.defaultEntry;
}

function getFaceUv(cube, faceName, textureSize, textureLayout = null) {
  const face = cube.faces?.[faceName] || {};
  const uv = cube.uvMode === 'box' ? getBlockbenchBoxUv(cube, faceName)
    : face.uv?.length >= 4 ? face.uv : getBlockbenchBoxUv(cube, faceName);
  const rectangle = uv?.length >= 4 ? [...uv] : [0, 0, textureSize[0], textureSize[1]];
  const atlasEntry = textureLayoutEntry(textureLayout, face.texture);
  if (atlasEntry) {
    return createAtlasFaceUvs(rectangle, face.rotation || 0, atlasEntry,
      [textureLayout.width, textureLayout.height], cube.uvMode === 'box');
  }
  return createBlockbenchFaceUvs(rectangle, textureSize, face.rotation || 0, cube.uvMode === 'box');
}

export function createAtlasFaceUvs(rectangle, rotation, atlasEntry, atlasSize, insetBoxUv = false) {
  const uv = [...rectangle];
  if (insetBoxUv) {
    for (let axis = 0; axis < 2; axis++) {
      const margin = uv[axis] > uv[axis + 2] ? -1 / 64 : 1 / 64;
      uv[axis] += margin;
      uv[axis + 2] -= margin;
    }
  }
  const atlasWidth = Math.max(1, atlasSize?.[0] || 1);
  const atlasHeight = Math.max(1, atlasSize?.[1] || 1);
  const slots = createBlockbenchFaceUvSlots(uv, rotation).map(slot => {
    const u = Math.max(0, Math.min(atlasEntry.width,
      slot[0] * atlasEntry.width / Math.max(1, atlasEntry.uvWidth || atlasEntry.width)));
    const v = Math.max(0, Math.min(atlasEntry.height,
      slot[1] * atlasEntry.height / Math.max(1, atlasEntry.uvHeight || atlasEntry.height)));
    return [(atlasEntry.x + u) / atlasWidth, 1 - (atlasEntry.y + v) / atlasHeight];
  });
  return FACE_TRIANGLE_SLOTS.map(slot => slots[slot]);
}

export function createBlockbenchFaceUvs(rectangle, textureSize = [64, 64], rotation = 0, insetBoxUv = false) {
  const uv = [...rectangle];
  if (insetBoxUv) {
    for (let axis = 0; axis < 2; axis++) {
      const margin = uv[axis] > uv[axis + 2] ? -1 / 64 : 1 / 64;
      uv[axis] += margin;
      uv[axis + 2] -= margin;
    }
  }
  const width = textureSize[0] || 1;
  const height = textureSize[1] || 1;
  const slots = createBlockbenchFaceUvSlots(uv, rotation)
    .map(slot => [slot[0] / width, 1 - slot[1] / height]);
  return FACE_TRIANGLE_SLOTS.map(slot => slots[slot]);
}

export function createBlockbenchFaceUvSlots(rectangle, rotation = 0) {
  let slots = [
    [rectangle[0], rectangle[1]],
    [rectangle[2], rectangle[1]],
    [rectangle[0], rectangle[3]],
    [rectangle[2], rectangle[3]]
  ];
  let turns = ((Math.round(rotation / 90) % 4) + 4) % 4;
  while (turns-- > 0) slots = [slots[2], slots[0], slots[3], slots[1]];
  return slots;
}

export function getBlockbenchBoxUv(cube, faceName) {
  const [u, v] = cube.uv || [0, 0];
  const scale = Number(cube.uvScale) || 1;
  const [x, y, z] = cube.size.map(value => {
    const length = Math.abs(Number(value) || 0) * scale;
    return scale === 1 ? length : length > 0 ? Math.max(1, Math.round(length)) : 0;
  });
  const rectangles = {
    east: [u, v + z, u + z, v + z + y],
    north: [u + z, v + z, u + z + x, v + z + y],
    west: [u + z + x, v + z, u + z + x + z, v + z + y],
    south: [u + z + x + z, v + z, u + z + x + z + x, v + z + y],
    up: [u + z + x, v + z, u + z, v],
    down: [u + z + x + x, v, u + z + x, v + z]
  };
  if (cube.mirrorUv) {
    for (const rectangle of Object.values(rectangles)) [rectangle[0], rectangle[2]] = [rectangle[2], rectangle[0]];
    [rectangles.east, rectangles.west] = [rectangles.west, rectangles.east];
  }
  return rectangles[faceName];
}
function averagePoints(points) { return points.reduce((sum, point) => add(sum, point), [0, 0, 0]).map(value => value / (points.length || 1)); }
function cameraDepth(point, cameraState) { return dot(subtract(point, cameraState.eye), cameraState.forward); }
function locatorScreenSize(point, cameraState) {
  if (!cameraState || cameraState.projection !== 'perspective') return LOCATOR_ICON_PIXELS;
  const distance = Math.max(.05, cameraDepth(point, cameraState));
  if (distance >= LOCATOR_NEAR_DISTANCE) return LOCATOR_ICON_PIXELS;
  return Math.min(LOCATOR_MAX_PIXELS, LOCATOR_ICON_PIXELS * LOCATOR_NEAR_DISTANCE / distance);
}
function hexToRgb(hex) { const n = parseInt(hex.replace('#', ''), 16); return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; }
function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function subtract(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function scale(v, amount) { return [v[0] * amount, v[1] * amount, v[2] * amount]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function normalize(v) { const length = Math.hypot(...v) || 1; return scale(v, 1 / length); }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

function identity() { return [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]; }
function mirrorModelMatrix(matrix, center) {
  const transformedCenter = matrix.map(row => row[0] * center[0] + row[1] * center[1] + row[2] * center[2]);
  const translation = center.map((value, axis) => value - transformedCenter[axis]);
  return [
    matrix[0][0], matrix[1][0], matrix[2][0], 0,
    matrix[0][1], matrix[1][1], matrix[2][1], 0,
    matrix[0][2], matrix[1][2], matrix[2][2], 0,
    translation[0], translation[1], translation[2], 1
  ];
}
function modifierModelMatrix(matrix, translation, center = [0, 0, 0]) {
  if (!Array.isArray(translation)) return mirrorModelMatrix(matrix, center);
  return [
    matrix[0][0], matrix[1][0], matrix[2][0], 0,
    matrix[0][1], matrix[1][1], matrix[2][1], 0,
    matrix[0][2], matrix[1][2], matrix[2][2], 0,
    translation[0], translation[1], translation[2], 1
  ];
}
function modifierInstancePoint(instance, point) {
  return instance.matrix.map((row, axis) =>
    row[0] * point[0] + row[1] * point[1] + row[2] * point[2] + instance.translation[axis]);
}
function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let column = 0; column < 4; column++) for (let row = 0; row < 4; row++) {
    for (let k = 0; k < 4; k++) out[column * 4 + row] += a[k * 4 + row] * b[column * 4 + k];
  }
  return out;
}
export function scaleAroundPoint(center, factor) {
  return [factor, 0, 0, 0, 0, factor, 0, 0, 0, 0, factor, 0,
    center[0] * (1 - factor), center[1] * (1 - factor), center[2] * (1 - factor), 1];
}
function transform(matrix, vector) {
  return [0, 1, 2, 3].map(row => matrix[row] * vector[0] + matrix[4 + row] * vector[1] + matrix[8 + row] * vector[2] + matrix[12 + row] * vector[3]);
}
function perspective(fov, aspect, near, far) {
  const f = 1 / Math.tan(fov / 2), range = 1 / (near - far);
  return [f/aspect,0,0,0, 0,f,0,0, 0,0,(far+near)*range,-1, 0,0,2*far*near*range,0];
}
function orthographic(left, right, bottom, top, near, far) {
  return [2/(right-left),0,0,0, 0,2/(top-bottom),0,0, 0,0,-2/(far-near),0, -(right+left)/(right-left),-(top+bottom)/(top-bottom),-(far+near)/(far-near),1];
}
function lookAt(eye, target, up) {
  const z = normalize(subtract(eye, target));
  const x = normalize(cross(up, z));
  const y = cross(z, x);
  return [x[0],y[0],z[0],0, x[1],y[1],z[1],0, x[2],y[2],z[2],0, -dot(x,eye),-dot(y,eye),-dot(z,eye),1];
}

function createProgram(gl, vertexSource, fragmentSource) {
  const program = gl.createProgram();
  const vertex = createShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  return program;
}
function createShader(gl, type, source) {
  const shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
  return shader;
}

const POST_VERTEX_SHADER = `
  attribute vec2 aPosition;
  varying vec2 vScreenUv;
  void main() {
    vScreenUv = aPosition * 0.5 + 0.5;
    gl_Position = vec4(aPosition, 0.0, 1.0);
  }
`;

// Resolve a genuinely higher-resolution framebuffer into the canvas. Model
// textures are still fetched with NEAREST in the scene pass; only the finished
// screen image is averaged here.
const SSAA_RESOLVE_FRAGMENT_SHADER = `
  precision mediump float;
  varying vec2 vScreenUv;
  uniform sampler2D uScreenTexture;
  uniform vec2 uResolution;
  void main() {
    vec2 offset = 0.35 / uResolution;
    vec4 a = texture2D(uScreenTexture, vScreenUv + vec2(-offset.x, -offset.y));
    vec4 b = texture2D(uScreenTexture, vScreenUv + vec2( offset.x, -offset.y));
    vec4 c = texture2D(uScreenTexture, vScreenUv + vec2(-offset.x,  offset.y));
    vec4 d = texture2D(uScreenTexture, vScreenUv + vec2( offset.x,  offset.y));
    float alpha = (a.a + b.a + c.a + d.a) * 0.25;
    vec3 color = (a.rgb * a.a + b.rgb * b.a + c.rgb * c.a + d.rgb * d.a) * 0.25;
    gl_FragColor = vec4(alpha > 0.0001 ? color / alpha : vec3(0.0), alpha);
  }
`;

const COPY_FRAGMENT_SHADER = `
  precision mediump float;
  varying vec2 vScreenUv;
  uniform sampler2D uScreenTexture;
  void main() {
    gl_FragColor = texture2D(uScreenTexture, vScreenUv);
  }
`;

const LOCKED_COMPOSITE_FRAGMENT_SHADER = `
  precision highp float;
  varying vec2 vScreenUv;
  uniform sampler2D uScreenTexture;
  uniform vec2 uOutputResolution;
  uniform vec2 uPointer;
  uniform float uHoverRadius;
  uniform float uBaseOpacity;
  uniform float uHoverOpacity;
  uniform float uHoverStrength;
  uniform int uHoverEnabled;
  void main() {
    vec4 color = texture2D(uScreenTexture, vScreenUv);
    if (color.a <= 0.001) discard;
    float opacity = uBaseOpacity;
    if (uHoverEnabled == 1) {
      float radial = smoothstep(0.0, max(1.0, uHoverRadius), distance(gl_FragCoord.xy, uPointer));
      opacity = mix(uBaseOpacity, mix(uHoverOpacity, uBaseOpacity, radial), uHoverStrength);
    }
    color.a *= opacity;
    if (color.a <= 0.001) discard;
    gl_FragColor = color;
  }
`;

const VERTEX_SHADER = `
  precision highp int;
  attribute vec3 aPosition;
  attribute vec4 aColor;
  attribute vec3 aNormal;
  attribute vec2 aUv;
  uniform mat4 uViewProjection;
  uniform mat4 uModelTransform;
  uniform vec3 uLight0Direction;
  uniform vec3 uLight1Direction;
  uniform int uPreviewShade;
  uniform int uRenderMode;
  varying vec4 vColor;
  varying vec2 vUv;
  varying float vSelected;
  varying float vFragDepth;
  void main() {
    gl_Position = uViewProjection * uModelTransform * vec4(aPosition, 1.0);
    vFragDepth = 1.0 + gl_Position.w;
    float normalLength = length(aNormal);
    vec3 transformedNormal = normalLength > 0.1
      ? normalize((uModelTransform * vec4(aNormal, 0.0)).xyz)
      : vec3(0.0);
    float diffuse = 1.0;
    if (uPreviewShade == 1 && normalLength > 0.1) {
      float light0 = max(0.0, dot(uLight0Direction, transformedNormal));
      float light1 = max(0.0, dot(uLight1Direction, transformedNormal));
      // Exact vanilla minecraft_mix_light constants: ambient 0.4 and
      // equal 0.6-power contribution from both directional lights.
      diffuse = min(1.0, (light0 + light1) * 0.6 + 0.4);
    }
    // Textured faces keep source chroma; untextured faces retain the cube's
    // solid-mode display colour instead of falling back to white.
    vSelected = step(1.5, aColor.a);
    vColor = uRenderMode == 4 && normalLength > 0.1
      ? vec4(transformedNormal * 0.5 + 0.5, min(aColor.a, 1.0))
      : uRenderMode == 2 && aUv.x > -999999.0
        ? vec4(vec3(diffuse), min(aColor.a, 1.0))
        : vec4(aColor.rgb * diffuse, min(aColor.a, 1.0));
    vUv = aUv;
  }
`;
const FRAGMENT_SHADER = `
  precision highp float;
  precision highp int;
  varying vec4 vColor;
  varying vec2 vUv;
  uniform sampler2D uTexture;
  uniform int uPaintPixelGrid;
  uniform vec2 uPaintGridSize;
  uniform sampler2D uSelectionMask;
  uniform int uSelectionActive;
  uniform vec2 uSelectionTexel;
  uniform float uSelectionPixelRadius;
  uniform float uSelectionPhase;
  uniform sampler2D uSelectionStripe;
  uniform vec4 uSelectionStripeViewport;
  uniform int uRenderMode;
  uniform int uAlphaMode;
  uniform float uOpacity;
  uniform vec4 uColorOverride;
  varying float vSelected;
  void main() {
    vec4 color = vColor;
    bool hasTexture = vUv.x > -999999.0;
    bool gridOnly = false;
    if ((uRenderMode == 2 || uRenderMode == 3) && hasTexture) {
      vec4 texel = texture2D(uTexture, vUv);
      if (uRenderMode == 2) color *= texel;
      else color.a *= texel.a;
      if (uAlphaMode == 0) color.a = 1.0;
      if (uAlphaMode == 1) {
        if (color.a < 0.1) {
          if (uPaintPixelGrid == 1 && uRenderMode == 2) gridOnly = true;
          else discard;
        } else color.a = 1.0;
      }
      if (uAlphaMode == 2 && color.a < 0.1) {
        if (uPaintPixelGrid == 1 && uRenderMode == 2) gridOnly = true;
        else discard;
      }
    }
    color.rgb = mix(color.rgb, vec3(1.0), vSelected * 0.13);
    #ifdef SCREEN_SELECTION_DERIVATIVES
    vec2 selectionStepX = dFdx(vUv) * uSelectionPixelRadius;
    vec2 selectionStepY = dFdy(vUv) * uSelectionPixelRadius;
    #else
    vec2 selectionStepX = vec2(uSelectionTexel.x, 0.0);
    vec2 selectionStepY = vec2(0.0, uSelectionTexel.y);
    #endif
    if (uSelectionActive == 1 && (uRenderMode == 1 || uRenderMode == 2)) {
      float selected = hasTexture ? texture2D(uSelectionMask, vUv).r : 0.0;
      if (selected < 0.5) color.rgb *= 0.57;
      else if (hasTexture) {
        float nearest = min(min(texture2D(uSelectionMask, vUv + selectionStepX).r,
          texture2D(uSelectionMask, vUv - selectionStepX).r),
          min(texture2D(uSelectionMask, vUv + selectionStepY).r,
          texture2D(uSelectionMask, vUv - selectionStepY).r));
        if (nearest < 0.5) {
          vec2 screenPoint = vec2(gl_FragCoord.x,
            uSelectionStripeViewport.w - gl_FragCoord.y) / uSelectionStripeViewport.z
            + uSelectionStripeViewport.xy;
          color.rgb = texture2D(uSelectionStripe,
            (screenPoint + vec2(uSelectionPhase, 0.0)) / 8.0).rgb;
        }
      }
    }
    if (uPaintPixelGrid == 1 && hasTexture) {
      vec2 pixelPoint = vUv * uPaintGridSize;
      vec2 boundary = min(fract(pixelPoint), 1.0 - fract(pixelPoint));
      #ifdef SCREEN_SELECTION_DERIVATIVES
      vec2 footprint = max(fwidth(pixelPoint), vec2(0.0001));
      vec2 visibility = smoothstep(vec2(1.0), vec2(2.0), 1.0 / footprint);
      vec2 lines = 1.0 - smoothstep(vec2(0.1), vec2(0.65), boundary / footprint);
      float line = max(lines.x * visibility.x, lines.y * visibility.y);
      #else
      float line = 1.0 - smoothstep(0.01, 0.05, min(boundary.x, boundary.y));
      #endif
      vec3 ink = dot(color.rgb, vec3(0.299, 0.587, 0.114)) > 0.45 ? vec3(0.0) : vec3(1.0);
      if (gridOnly) {
        if (line < 0.001) discard;
        color.rgb = ink;
        color.a = line * 0.45;
      } else color.rgb = mix(color.rgb, ink, line * 0.45);
    }
    if (uColorOverride.a > 0.5) color.rgb = uColorOverride.rgb;
    color.a *= uOpacity;
    gl_FragColor = color;
  }
`;

const LOG_DEPTH_FRAGMENT_SHADER = `
  #extension GL_EXT_frag_depth : enable
  precision highp float;
  precision highp int;
  varying vec4 vColor;
  varying vec2 vUv;
  varying float vSelected;
  varying float vFragDepth;
  uniform sampler2D uTexture;
  uniform int uPaintPixelGrid;
  uniform vec2 uPaintGridSize;
  uniform sampler2D uSelectionMask;
  uniform int uSelectionActive;
  uniform vec2 uSelectionTexel;
  uniform float uSelectionPixelRadius;
  uniform float uSelectionPhase;
  uniform sampler2D uSelectionStripe;
  uniform vec4 uSelectionStripeViewport;
  uniform int uRenderMode;
  uniform int uAlphaMode;
  uniform float uOpacity;
  uniform vec4 uColorOverride;
  uniform int uUseLogDepth;
  uniform float uLogDepthFactor;
  void main() {
    vec4 color = vColor;
    bool hasTexture = vUv.x > -999999.0;
    bool gridOnly = false;
    if ((uRenderMode == 2 || uRenderMode == 3) && hasTexture) {
      vec4 texel = texture2D(uTexture, vUv);
      if (uRenderMode == 2) color *= texel;
      else color.a *= texel.a;
      if (uAlphaMode == 0) color.a = 1.0;
      if (uAlphaMode == 1) {
        if (color.a < 0.1) {
          if (uPaintPixelGrid == 1 && uRenderMode == 2) gridOnly = true;
          else discard;
        } else color.a = 1.0;
      }
      if (uAlphaMode == 2 && color.a < 0.1) {
        if (uPaintPixelGrid == 1 && uRenderMode == 2) gridOnly = true;
        else discard;
      }
    }
    color.rgb = mix(color.rgb, vec3(1.0), vSelected * 0.13);
    #ifdef SCREEN_SELECTION_DERIVATIVES
    vec2 selectionStepX = dFdx(vUv) * uSelectionPixelRadius;
    vec2 selectionStepY = dFdy(vUv) * uSelectionPixelRadius;
    #else
    vec2 selectionStepX = vec2(uSelectionTexel.x, 0.0);
    vec2 selectionStepY = vec2(0.0, uSelectionTexel.y);
    #endif
    if (uSelectionActive == 1 && (uRenderMode == 1 || uRenderMode == 2)) {
      float selected = hasTexture ? texture2D(uSelectionMask, vUv).r : 0.0;
      if (selected < 0.5) color.rgb *= 0.57;
      else if (hasTexture) {
        float nearest = min(min(texture2D(uSelectionMask, vUv + selectionStepX).r,
          texture2D(uSelectionMask, vUv - selectionStepX).r),
          min(texture2D(uSelectionMask, vUv + selectionStepY).r,
          texture2D(uSelectionMask, vUv - selectionStepY).r));
        if (nearest < 0.5) {
          vec2 screenPoint = vec2(gl_FragCoord.x,
            uSelectionStripeViewport.w - gl_FragCoord.y) / uSelectionStripeViewport.z
            + uSelectionStripeViewport.xy;
          color.rgb = texture2D(uSelectionStripe,
            (screenPoint + vec2(uSelectionPhase, 0.0)) / 8.0).rgb;
        }
      }
    }
    if (uPaintPixelGrid == 1 && hasTexture) {
      vec2 pixelPoint = vUv * uPaintGridSize;
      vec2 boundary = min(fract(pixelPoint), 1.0 - fract(pixelPoint));
      #ifdef SCREEN_SELECTION_DERIVATIVES
      vec2 footprint = max(fwidth(pixelPoint), vec2(0.0001));
      vec2 visibility = smoothstep(vec2(1.0), vec2(2.0), 1.0 / footprint);
      vec2 lines = 1.0 - smoothstep(vec2(0.1), vec2(0.65), boundary / footprint);
      float line = max(lines.x * visibility.x, lines.y * visibility.y);
      #else
      float line = 1.0 - smoothstep(0.01, 0.05, min(boundary.x, boundary.y));
      #endif
      vec3 ink = dot(color.rgb, vec3(0.299, 0.587, 0.114)) > 0.45 ? vec3(0.0) : vec3(1.0);
      if (gridOnly) {
        if (line < 0.001) discard;
        color.rgb = ink;
        color.a = line * 0.45;
      } else color.rgb = mix(color.rgb, ink, line * 0.45);
    }
    if (uColorOverride.a > 0.5) color.rgb = uColorOverride.rgb;
    color.a *= uOpacity;
    gl_FragDepthEXT = uUseLogDepth == 1
      ? log2(max(1.0e-6, vFragDepth)) * uLogDepthFactor
      : gl_FragCoord.z;
    gl_FragColor = color;
  }
`;
