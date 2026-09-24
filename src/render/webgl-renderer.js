const DEG = Math.PI / 180;
const MIPPED_SUPERSAMPLE = 1.5;

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
    this.program = createProgram(this.gl, VERTEX_SHADER, this.logDepthEnabled ? LOG_DEPTH_FRAGMENT_SHADER : FRAGMENT_SHADER);
    this.postProgram = createProgram(this.gl, POST_VERTEX_SHADER, SSAA_RESOLVE_FRAGMENT_SHADER);
    this.positionLocation = this.gl.getAttribLocation(this.program, 'aPosition');
    this.colorLocation = this.gl.getAttribLocation(this.program, 'aColor');
    this.normalLocation = this.gl.getAttribLocation(this.program, 'aNormal');
    this.uvLocation = this.gl.getAttribLocation(this.program, 'aUv');
    this.matrixLocation = this.gl.getUniformLocation(this.program, 'uViewProjection');
    this.light0Location = this.gl.getUniformLocation(this.program, 'uLight0Direction');
    this.light1Location = this.gl.getUniformLocation(this.program, 'uLight1Direction');
    this.previewShadeLocation = this.gl.getUniformLocation(this.program, 'uPreviewShade');
    this.renderModeLocation = this.gl.getUniformLocation(this.program, 'uRenderMode');
    this.alphaModeLocation = this.gl.getUniformLocation(this.program, 'uAlphaMode');
    this.textureLocation = this.gl.getUniformLocation(this.program, 'uTexture');
    this.useLogDepthLocation = this.gl.getUniformLocation(this.program, 'uUseLogDepth');
    this.logDepthFactorLocation = this.gl.getUniformLocation(this.program, 'uLogDepthFactor');
    this.postPositionLocation = this.gl.getAttribLocation(this.postProgram, 'aPosition');
    this.postTextureLocation = this.gl.getUniformLocation(this.postProgram, 'uScreenTexture');
    this.postResolutionLocation = this.gl.getUniformLocation(this.postProgram, 'uResolution');
    this.dynamicBuffer = this.gl.createBuffer();
    this.staticTriangleBuffer = this.gl.createBuffer();
    this.staticWireBuffer = this.gl.createBuffer();
    this.selectedTriangleBuffer = this.gl.createBuffer();
    this.selectedWireBuffer = this.gl.createBuffer();
    this.ghostWireBuffer = this.gl.createBuffer();
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
    this.ghostWireCount = 0;
    this.texture = this.gl.createTexture();
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
    this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, 1, 1, 0, this.gl.RGBA, this.gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    this.lastViewProjection = identity();
    this.lastViewport = { width: 1, height: 1 };
    this.lastCameraState = null;
    this.lastCameraInput = null;
    this.lastOwnerPoints = new Map();
    this.geometryRevision = 0;
    this.selectionRevision = 0;
    this.staticCache = null;
    this.selectedCache = null;
    this.selectionOutline = hexToRgb('#d8f59b');

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
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  setSelectionOutline(color) {
    this.selectionOutline = hexToRgb(color);
    this.invalidateSelectionGeometry();
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
    this.geometryRevision += 1;
    this.selectionRevision += 1;
    this.staticCache = null;
    this.selectedCache = null;
  }

  invalidateSelectionGeometry() {
    this.selectionRevision += 1;
    this.selectedCache = null;
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

  endTransformGhost() {
    this.ghostWireCount = 0;
  }

  commitSelectionGeometry(project, selectedUid) {
    if (!this.staticCache || this.staticCache.project !== project || !selectedUid) return false;
    const dynamicUids = getDynamicElementUids(project, selectedUid);
    if (!dynamicUids.size) return false;
    const elements = project.elements.filter(element => dynamicUids.has(element.uid));
    const geometry = buildElementGeometry(project, elements, null);
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
    for (const uid of dynamicUids) {
      if (geometry.ownerPoints.has(uid)) this.staticCache.ownerPoints.set(uid, geometry.ownerPoints.get(uid));
      else this.staticCache.ownerPoints.delete(uid);
    }
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
    for (const range of complementVertexRanges(totalCount, excludedUids, rangesByUid)) {
      this.drawBuffer(buffer, range.count, primitive, matrix, { ...options, first: range.start });
    }
  }

  drawSurfaceGeometry(project, camera, minecraftRenderType, dynamicUids, viewProjection, cameraState) {
    const { gl } = this;
    if (camera.renderMode === 'wireframe') return;
    if (camera.renderMode === 'textured' && minecraftRenderType.pass === RenderPass.TRANSLUCENT) {
      const sortedFaces = [...this.staticCache.faces.filter(face => !dynamicUids.has(face.uid)), ...this.selectedCache.faces]
        .sort((a, b) => cameraDepth(b.center, cameraState) - cameraDepth(a.center, cameraState));
      const translucentVertices = sortedFaces.flatMap(face => face.vertices);
      this.drawVertices(translucentVertices, gl.TRIANGLES, viewProjection, {
        depthWrite: minecraftRenderType.depthWrite,
        cull: project.cullFaces,
        renderMode: 2,
        alphaMode: minecraftRenderType.alphaMode,
        blend: minecraftRenderType.blend
      });
      return;
    }
    const renderMode = camera.renderMode === 'textured' ? 2 : 1;
    const pipeline = camera.renderMode === 'textured'
      ? minecraftRenderType
      : MINECRAFT_RENDER_TYPES[MinecraftRenderType.SOLID];
    const options = {
      depthWrite: pipeline.depthWrite,
      cull: project.cullFaces,
      renderMode,
      alphaMode: pipeline.alphaMode,
      blend: pipeline.blend
    };
    this.drawBufferExcluding(this.staticTriangleBuffer, this.staticCache.triangles.length / 12,
      dynamicUids, this.staticCache.triangleRanges, gl.TRIANGLES, viewProjection, options);
    this.drawBuffer(this.selectedTriangleBuffer, this.selectedCache.triangles.length / 12,
      gl.TRIANGLES, viewProjection, options);
  }

  drawGrid(camera, viewProjection) {
    if (!camera.grid) return;
    const { gl } = this;
    const grid = gridGeometry(camera.snap);
    this.drawVertices(grid.fine, gl.LINES, viewProjection, { depthWrite: true, cull: false, renderMode: 0 });
    this.drawVertices(grid.major, gl.LINES, viewProjection, { depthWrite: true, cull: false, renderMode: 0 });
    this.drawVertices(grid.direction, gl.LINES, viewProjection, { depthWrite: true, cull: false, renderMode: 0 });
  }

  drawEditorLines(project, camera, dynamicUids, ownerPoints, viewProjection) {
    const { gl } = this;
    if (camera.renderMode === 'wireframe') {
      this.drawBufferExcluding(this.staticWireBuffer, this.staticCache.edges.length / 12,
        dynamicUids, this.staticCache.edgeRanges, gl.LINES, viewProjection,
        { depthWrite: true, cull: false, renderMode: 0 });
      this.drawBuffer(this.selectedWireBuffer, this.selectedCache.edges.length / 12,
        gl.LINES, viewProjection, { depthWrite: true, cull: false, renderMode: 0 });
    }
    this.drawBuffer(this.ghostWireBuffer, this.ghostWireCount, gl.LINES, viewProjection, {
      depthWrite: false, cull: false, renderMode: 0
    });
    if (camera.renderMode !== 'wireframe') {
      this.drawBuffer(this.selectedWireBuffer, this.selectedCache.edges.length / 12,
        gl.LINES, viewProjection, { depthWrite: false, cull: false, renderMode: 0 });
    }
    if (camera.wire) {
      const wire = [];
      for (const points of ownerPoints.values()) wire.push(...boundsWireGeometry(points));
      this.drawVertices(wire, gl.LINES, viewProjection, { depthWrite: true, cull: false, renderMode: 0 });
    }
    if (!camera.geometryOnly) {
      const visibleHelpers = collectVertexRanges(this.staticCache.helpers,
        complementVertexRanges(this.staticCache.helpers.length / 12, dynamicUids, this.staticCache.helperRanges));
      this.drawVertices([...visibleHelpers, ...this.selectedCache.helpers], gl.LINES, viewProjection, {
        depthWrite: false, cull: false, renderMode: 0
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
  }

  render(project, selectedUid, camera) {
    const { gl, canvas } = this;
    this.previewShade = camera.previewShade !== false;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    const pixelWidth = camera.layoutResizing && canvas.width
      ? canvas.width
      : Math.max(1, Math.floor(width * dpr));
    const pixelHeight = camera.layoutResizing && canvas.height
      ? canvas.height
      : Math.max(1, Math.floor(height * dpr));
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

    const dynamicUids = getDynamicElementUids(project, selectedUid);
    if (!this.staticCache
      || this.staticCache.project !== project
      || this.staticCache.revision !== this.geometryRevision) {
      const geometry = buildElementGeometry(project, project.elements, null);
      this.staticCache = { project, revision: this.geometryRevision, ...geometry };
      this.uploadBuffer(this.staticTriangleBuffer, geometry.triangles, gl.STATIC_DRAW);
      this.uploadBuffer(this.staticWireBuffer, geometry.edges, gl.STATIC_DRAW);
    }

    if (!this.selectedCache
      || this.selectedCache.project !== project
      || this.selectedCache.revision !== this.selectionRevision
      || this.selectedCache.selectedUid !== selectedUid) {
      const selectedElements = project.elements.filter(element => dynamicUids.has(element.uid));
      const geometry = buildElementGeometry(project, selectedElements, selectedUid, this.selectionOutline);
      this.selectedCache = { project, revision: this.selectionRevision, selectedUid, ...geometry };
      this.uploadBuffer(this.selectedTriangleBuffer, geometry.triangles, gl.DYNAMIC_DRAW);
      this.uploadBuffer(this.selectedWireBuffer, geometry.edges, gl.DYNAMIC_DRAW);
    }
    const ownerPoints = mergeOwnerPoints(this.staticCache.ownerPoints, this.selectedCache.ownerPoints);
    this.lastOwnerPoints = ownerPoints;

    this.applyTextureSampling();

    if (useMippedAntialias) {
      // Only model surfaces are supersampled. Rebuild their depth in the
      // native-MSAA framebuffer, resolve the colour, then draw editor lines
      // directly so Mipped never changes grid or wire appearance.
      this.drawSurfaceGeometry(project, camera, minecraftRenderType, dynamicUids, viewProjection, cameraState);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, pixelWidth, pixelHeight);
      gl.clearColor(0, 0, 0, 0);
      gl.clearDepth(1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.colorMask(false, false, false, false);
      this.drawSurfaceGeometry(project, camera, minecraftRenderType, dynamicUids, viewProjection, cameraState);
      gl.colorMask(true, true, true, true);
      this.presentAntialiased(pixelWidth, pixelHeight, renderWidth, renderHeight);
      this.drawGrid(camera, viewProjection);
      this.drawEditorLines(project, camera, dynamicUids, ownerPoints, viewProjection);
    } else {
      this.drawGrid(camera, viewProjection);
      this.drawSurfaceGeometry(project, camera, minecraftRenderType, dynamicUids, viewProjection, cameraState);
      this.drawEditorLines(project, camera, dynamicUids, ownerPoints, viewProjection);
    }

  }

  getHitAreas(project, geometryOnly = false) {
    return [...this.lastOwnerPoints.entries()]
      .filter(([uid]) => !geometryOnly || project.getNode(uid)?.type !== 'locator')
      .map(([uid, points]) => ({ uid, ...screenBounds(points, this.lastViewProjection, this.lastViewport.width, this.lastViewport.height) }));
  }

  pick(project, screenX, screenY, geometryOnly = false) {
    return this.pickDetailed(project, screenX, screenY, geometryOnly)?.uid || null;
  }

  pickDetailed(project, screenX, screenY, geometryOnly = false) {
    if (!this.lastCameraState || !this.lastCameraInput) return null;
    const ray = screenRay(screenX, screenY, this.lastViewport, this.lastCameraState, this.lastCameraInput);
    let closest = null;
    let closestDistance = Infinity;
    let locatorHit = null;
    let locatorDistance = Infinity;
    for (const [uid, points] of this.lastOwnerPoints) {
      const node = project.getNode(uid);
      if (!node || (geometryOnly && node.type === 'locator')) continue;
      if (node.type === 'locator') {
        const projected = projectScreenPoint(points[0], this.lastViewProjection, this.lastViewport.width, this.lastViewport.height);
        const distance = dot(subtract(points[0], ray.origin), ray.direction);
        if (!projected.behind && projected.depth >= -1 && projected.depth <= 1
          && Math.hypot(projected.x - screenX, projected.y - screenY) <= 12 && distance > 0 && distance < locatorDistance) {
          locatorDistance = distance;
          locatorHit = { uid, distance, point: [...points[0]], faceName: null };
        }
      }
    }
    // Locator is a fixed-size editor overlay. Clicking its visible 17px icon
    // therefore takes priority over model geometry drawn beneath it.
    if (locatorHit) return locatorHit;
    const dynamicUids = new Set(this.selectedCache?.ownerPoints?.keys() || []);
    const faces = [
      ...(this.staticCache?.faces || []).filter(face => !dynamicUids.has(face.uid)),
      ...(this.selectedCache?.faces || [])
    ];
    for (const face of faces) {
      if (geometryOnly && project.getNode(face.uid)?.type === 'locator') continue;
      const indices = FACE_TRIANGLE_SLOTS;
      for (let triangle = 0; triangle < 2; triangle++) {
        const base = triangle * 3;
        const distance = rayTriangleDistance(ray.origin, ray.direction,
          face.quad[indices[base]], face.quad[indices[base + 1]], face.quad[indices[base + 2]]);
        if (distance !== null && distance < closestDistance) {
          closestDistance = distance;
          closest = {
            uid: face.uid,
            distance,
            faceName: face.faceName,
            facePoints: face.quad.map(point => [...point]),
            point: ray.origin.map((value, axis) => value + ray.direction[axis] * distance)
          };
        }
      }
    }
    return closest;
  }

  getWorldVertices(project, uid) {
    const node = project.getNode(uid);
    if (!node) return [];
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

  projectPoint(point) {
    return projectScreenPoint(point, this.lastViewProjection, this.lastViewport.width, this.lastViewport.height);
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

  drawBuffer(buffer, vertexCount, primitive, matrix, {
    depthWrite = true, cull = true, renderMode = 1, alphaMode = 0, blend = false, first = 0
  } = {}) {
    if (!vertexCount) return;
    const { gl } = this;
    gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.uniformMatrix4fv(this.matrixLocation, false, matrix);
    // Vanilla Java entity diffuse-light directions (Lighting/RenderSystem).
    gl.uniform3fv(this.light0Location, normalize([.2, 1, -.7]));
    gl.uniform3fv(this.light1Location, normalize([-.2, 1, .7]));
    gl.uniform1i(this.previewShadeLocation, this.previewShade ? 1 : 0);
    gl.uniform1i(this.renderModeLocation, renderMode);
    gl.uniform1i(this.alphaModeLocation, alphaMode);
    if (this.useLogDepthLocation) gl.uniform1i(this.useLogDepthLocation,
      this.logDepthEnabled && this.lastCameraState?.projection === 'perspective' ? 1 : 0);
    if (this.logDepthFactorLocation) gl.uniform1f(this.logDepthFactorLocation, 1 / Math.log2(30001));
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(this.textureLocation, 0);
    gl.enableVertexAttribArray(this.positionLocation);
    gl.vertexAttribPointer(this.positionLocation, 3, gl.FLOAT, false, 48, 0);
    gl.enableVertexAttribArray(this.colorLocation);
    gl.vertexAttribPointer(this.colorLocation, 4, gl.FLOAT, false, 48, 12);
    gl.enableVertexAttribArray(this.normalLocation);
    gl.vertexAttribPointer(this.normalLocation, 3, gl.FLOAT, false, 48, 28);
    gl.enableVertexAttribArray(this.uvLocation);
    gl.vertexAttribPointer(this.uvLocation, 2, gl.FLOAT, false, 48, 40);
    gl.depthMask(depthWrite);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    cull ? gl.enable(gl.CULL_FACE) : gl.disable(gl.CULL_FACE);
    if (blend) {
      gl.enable(gl.BLEND);
      gl.blendEquation(gl.FUNC_ADD);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    } else gl.disable(gl.BLEND);
    gl.drawArrays(primitive, first, vertexCount);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }
}

function complementVertexRanges(totalCount, excludedUids, rangesByUid) {
  if (!excludedUids?.size) return totalCount ? [{ start: 0, count: totalCount }] : [];
  const excluded = [...excludedUids]
    .map(uid => rangesByUid.get(uid))
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
  const output = [];
  for (const range of ranges) output.push(...vertices.slice(range.start * 12, (range.start + range.count) * 12));
  return output;
}

function getDynamicElementUids(project, selectedUid) {
  const dynamic = new Set();
  const selected = project.getNode(selectedUid);
  if (!selected) return dynamic;
  if (selected.type !== 'group') {
    dynamic.add(selected.uid);
    return dynamic;
  }
  const visit = uid => {
    const node = project.getNode(uid);
    if (!node) return;
    if (node.type === 'group') node.children.forEach(visit);
    else dynamic.add(node.uid);
  };
  selected.children.forEach(visit);
  return dynamic;
}

function buildElementGeometry(project, elements, selectedUid, selectionOutline = [1, 1, 1]) {
  const triangles = [];
  const faces = [];
  const edges = [];
  const helpers = [];
  const ownerPoints = new Map();
  const triangleRanges = new Map();
  const edgeRanges = new Map();
  const helperRanges = new Map();
  for (const element of elements) {
    const triangleStart = triangles.length / 12;
    const edgeStart = edges.length / 12;
    const helperStart = helpers.length / 12;
    const finishRanges = () => {
      triangleRanges.set(element.uid, { start: triangleStart, count: triangles.length / 12 - triangleStart });
      edgeRanges.set(element.uid, { start: edgeStart, count: edges.length / 12 - edgeStart });
      helperRanges.set(element.uid, { start: helperStart, count: helpers.length / 12 - helperStart });
    };
    if (!element.visible) { finishRanges(); continue; }
    const groupChain = project.getGroupChain(element.uid);
    if (groupChain.some(group => !group.visible)) { finishRanges(); continue; }
    const selectedByGroup = groupChain.some(group => group.uid === selectedUid);
    if (element.type === 'locator') {
      const geometry = locatorGeometry(element, groupChain);
      helpers.push(...geometry.lines);
      ownerPoints.set(element.uid, geometry.points);
      finishRanges();
      continue;
    }
    const cubes = element.type === 'shape'
      ? element.toCubes().map(cube => ({ cube, offset: element.origin, ownerRotation: element.rotation, ownerOrigin: element.origin, groupChain, textureSize: project.textureSize, shade: element.shade }))
      : [{ cube: element, offset: [0, 0, 0], ownerRotation: [0, 0, 0], ownerOrigin: element.pivot, groupChain, textureSize: project.textureSize, shade: element.shade }];

    for (const entry of cubes) {
      const geometry = cubeGeometry(entry, element.color, element.uid === selectedUid || selectedByGroup, selectionOutline);
      triangles.push(...geometry.triangles);
      faces.push(...geometry.faces.map(face => ({ ...face, uid: element.uid })));
      edges.push(...geometry.edges);
      if (!ownerPoints.has(element.uid)) ownerPoints.set(element.uid, []);
      ownerPoints.get(element.uid).push(...geometry.corners);
    }
    finishRanges();
  }
  return { triangles, faces, edges, helpers, ownerPoints, triangleRanges, edgeRanges, helperRanges };
}

function locatorGeometry(locator, groupChain) {
  const origin = locator.position || [0, 0, 0];
  const points = [applyGroupTransforms(origin, groupChain)];
  return { lines: [], points };
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

function cubeGeometry(entry, color, selected, selectionOutline = [1, 1, 1]) {
  const { cube, offset, ownerRotation, ownerOrigin, groupChain, textureSize, shade } = entry;
  const inflate = cube.inflate || 0;
  const start = cube.position.map((value, axis) => value + offset[axis]);
  const baseCorners = createSignedCubeCorners(start, cube.size, inflate);
  let corners = baseCorners.map(point => [...point]);
  const cubePivot = cube.pivot.map((value, axis) => value + offset[axis]);
  corners = corners.map(point => rotatePoint(point, cubePivot, cube.rotation || [0, 0, 0]));
  corners = corners.map(point => rotatePoint(point, ownerOrigin, ownerRotation || [0, 0, 0]));
  corners = corners.map(point => applyGroupTransforms(point, groupChain));

  const base = hexToRgb(color);
  const edgeBoost = selected ? 1.08 : 1;
  const triangles = [], faceBatches = [];
  for (const [faceName, quadIndices] of Object.entries(FACE_LAYOUTS)) {
    const faceData = cube.faces?.[faceName];
    if (faceData?.enabled === false || faceData?.texture === null) continue;
    const indices = FACE_TRIANGLE_SLOTS.map(slot => quadIndices[slot]);
    const a = corners[indices[0]], b = corners[indices[1]], c = corners[indices[2]];
    const normal = normalize(cross(subtract(b, a), subtract(c, a)));
    const faceColor = base.map(channel => Math.min(1, channel * edgeBoost));
    const faceUv = getFaceUv(cube, faceName, textureSize);
    const faceVertices = [];
    indices.forEach((index, vertexIndex) => pushVertex(faceVertices, corners[index], [...faceColor, selected ? 2 : 1], shade === false ? [0, 0, 0] : normal, faceUv[vertexIndex]));
    triangles.push(...faceVertices);
    const quad = quadIndices.map(index => corners[index]);
    faceBatches.push({ faceName, quad, vertices: faceVertices, center: averagePoints(quad) });
  }
  const edges = [], edgeColor = selected ? [...selectionOutline, 1] : [.46, .56, .4, 1];
  for (const [a, b] of [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]]) {
    pushVertex(edges, corners[a], edgeColor); pushVertex(edges, corners[b], edgeColor);
  }
  return { triangles, faces: faceBatches, edges, corners };
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
function getFaceUv(cube, faceName, textureSize) {
  const face = cube.faces?.[faceName] || {};
  const uv = face.uv?.length >= 4 ? face.uv : getBlockbenchBoxUv(cube, faceName);
  const rectangle = uv?.length >= 4 ? uv : [0, 0, textureSize[0], textureSize[1]];
  return createBlockbenchFaceUvs(rectangle, textureSize, face.rotation || 0, cube.uvMode === 'box');
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
  let slots = [
    [uv[0] / width, 1 - uv[1] / height],
    [uv[2] / width, 1 - uv[1] / height],
    [uv[0] / width, 1 - uv[3] / height],
    [uv[2] / width, 1 - uv[3] / height]
  ];
  let turns = ((Math.round(rotation / 90) % 4) + 4) % 4;
  while (turns-- > 0) slots = [slots[2], slots[0], slots[3], slots[1]];
  return FACE_TRIANGLE_SLOTS.map(slot => slots[slot]);
}

export function getBlockbenchBoxUv(cube, faceName) {
  const [u, v] = cube.uv || [0, 0];
  const [x, y, z] = cube.size.map(Math.abs);
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
function hexToRgb(hex) { const n = parseInt(hex.replace('#', ''), 16); return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; }
function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function subtract(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function scale(v, amount) { return [v[0] * amount, v[1] * amount, v[2] * amount]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function normalize(v) { const length = Math.hypot(...v) || 1; return scale(v, 1 / length); }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

function identity() { return [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]; }
function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let column = 0; column < 4; column++) for (let row = 0; row < 4; row++) {
    for (let k = 0; k < 4; k++) out[column * 4 + row] += a[k * 4 + row] * b[column * 4 + k];
  }
  return out;
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
    gl_FragColor = 0.25 * (
      texture2D(uScreenTexture, vScreenUv + vec2(-offset.x, -offset.y)) +
      texture2D(uScreenTexture, vScreenUv + vec2( offset.x, -offset.y)) +
      texture2D(uScreenTexture, vScreenUv + vec2(-offset.x,  offset.y)) +
      texture2D(uScreenTexture, vScreenUv + vec2( offset.x,  offset.y)));
  }
`;

const VERTEX_SHADER = `
  precision highp int;
  attribute vec3 aPosition;
  attribute vec4 aColor;
  attribute vec3 aNormal;
  attribute vec2 aUv;
  uniform mat4 uViewProjection;
  uniform vec3 uLight0Direction;
  uniform vec3 uLight1Direction;
  uniform int uPreviewShade;
  uniform int uRenderMode;
  varying vec4 vColor;
  varying vec2 vUv;
  varying float vSelected;
  varying float vFragDepth;
  void main() {
    gl_Position = uViewProjection * vec4(aPosition, 1.0);
    vFragDepth = 1.0 + gl_Position.w;
    float normalLength = length(aNormal);
    float diffuse = 1.0;
    if (uPreviewShade == 1 && normalLength > 0.1) {
      vec3 normal = normalize(aNormal);
      float light0 = max(0.0, dot(uLight0Direction, normal));
      float light1 = max(0.0, dot(uLight1Direction, normal));
      // Exact vanilla minecraft_mix_light constants: ambient 0.4 and
      // equal 0.6-power contribution from both directional lights.
      diffuse = min(1.0, (light0 + light1) * 0.6 + 0.4);
    }
    // Textured mode keeps the source texture chroma. Vertex color is only used
    // by solid mode; diffuse light remains available when shade is enabled.
    vSelected = step(1.5, aColor.a);
    vColor = uRenderMode == 2
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
  uniform int uRenderMode;
  uniform int uAlphaMode;
  varying float vSelected;
  void main() {
    vec4 color = vColor;
    if (uRenderMode == 2) {
      color *= texture2D(uTexture, vUv);
      if (uAlphaMode == 0) color.a = 1.0;
      if (uAlphaMode == 1) {
        if (color.a < 0.1) discard;
        color.a = 1.0;
      }
      if (uAlphaMode == 2 && color.a < 0.1) discard;
    }
    color.rgb = mix(color.rgb, vec3(1.0), vSelected * 0.13);
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
  uniform int uRenderMode;
  uniform int uAlphaMode;
  uniform int uUseLogDepth;
  uniform float uLogDepthFactor;
  void main() {
    vec4 color = vColor;
    if (uRenderMode == 2) {
      color *= texture2D(uTexture, vUv);
      if (uAlphaMode == 0) color.a = 1.0;
      if (uAlphaMode == 1) {
        if (color.a < 0.1) discard;
        color.a = 1.0;
      }
      if (uAlphaMode == 2 && color.a < 0.1) discard;
    }
    color.rgb = mix(color.rgb, vec3(1.0), vSelected * 0.13);
    gl_FragDepthEXT = uUseLogDepth == 1
      ? log2(max(1.0e-6, vFragDepth)) * uLogDepthFactor
      : gl_FragCoord.z;
    gl_FragColor = color;
  }
`;
