// Generated cubes stay in the live hierarchy only during subdivision editing.
export function createSubdivisionController({
  state, sceneRenderer, setTool, renderAll, updateToolVisibility,
  invalidateAllRenderGeometry, toast
}) {
  let subdivisionSession = null;

  function isProceduralShape(item) {
    return Boolean(item && item.type !== 'cube' && typeof item.toCubes === 'function' && typeof item.toBaseCubes === 'function');
  }

  function subdivisionOwner(item) {
    return item?.subdivisionOwnerUid ? state.project.getNode(item.subdivisionOwnerUid) : null;
  }

  function subdivisionPatch(owner, cube, index) {
    const base = (owner.toFormatBaseCubes?.(state.project) || owner.toBaseCubes?.())[index];
    if (!base) return null;
    const patch = {};
    for (const field of ['position', 'size', 'pivot', 'rotation']) {
      const delta = cube[field].map((value, axis) => Number(value) - Number(base[field][axis]));
      if (delta.some(value => Math.abs(value) > 1e-8)) patch[`${field}Delta`] = delta;
    }
    const inflateDelta = Number(cube.inflate || 0) - Number(base.inflate || 0);
    if (Math.abs(inflateDelta) > 1e-8) patch.inflateDelta = inflateDelta;
    for (const field of ['name', 'unnamed', 'uvMode', 'uvNormalized', 'uv', 'mirrorUv', 'faces', 'autoUv', 'exported', 'locked', 'shade', 'visible', 'color']) {
      if (JSON.stringify(cube[field]) !== JSON.stringify(base[field])) patch[field] = structuredClone(cube[field]);
    }
    return Object.keys(patch).length ? patch : null;
  }

  function syncSubdivisionEdits() {
    if (!subdivisionSession) return;
    const owner = state.project.getNode(subdivisionSession.ownerUid);
    if (!owner?.toBaseCubes) return;
    const edits = {};
    subdivisionSession.cubes.forEach((cube, index) => {
      const patch = subdivisionPatch(owner, cube, index);
      if (patch) edits[index] = patch;
    });
    owner.subdivisionEdits = edits;
  }

  function enterSubdivisionEdit(owner) {
    if (!isProceduralShape(owner)) return;
    if (state.mode === 'paint') return toast('繪畫模式可直接在 Shape 上繪畫，不使用細分編輯');
    if (subdivisionSession?.ownerUid === owner.uid) return;
    if (subdivisionSession) exitSubdivisionEdit(false);
    const cubes = owner.toCubes().map((cube, index) => {
      cube.uid = `${owner.uid}::subdivision::${index}`;
      cube.subdivisionOwnerUid = owner.uid;
      cube.subdivisionIndex = index;
      return cube;
    });
    if (!cubes.length) return toast('這個 Shape 目前沒有可編輯的 Cube');
    subdivisionSession = { ownerUid: owner.uid, cubes };
    if (state.tool === 'knife') setTool('move');
    state.project.elements.push(...cubes);
    state.project.invalidateHierarchyIndex();
    sceneRenderer.invalidateLockState();
    state.selectedUid = cubes[0].uid;
    state.selectedUids = new Set([cubes[0].uid]);
    state.selectionAnchorUid = cubes[0].uid;
    state.selectedUvFaces = new Set();
    renderAll('all');
    updateToolVisibility();
    toast('已進入細分編輯；其他物件已虛化');
  }

  function exitSubdivisionEdit(render = true) {
    if (!subdivisionSession) return;
    syncSubdivisionEdits();
    const ownerUid = subdivisionSession.ownerUid;
    const transientUids = new Set(subdivisionSession.cubes.map(cube => cube.uid));
    state.project.elements = state.project.elements.filter(element => !transientUids.has(element.uid));
    state.project.invalidateHierarchyIndex();
    sceneRenderer.invalidateLockState();
    subdivisionSession = null;
    state.selectedUid = state.project.getNode(ownerUid) ? ownerUid : null;
    state.selectedUids = new Set(state.selectedUid ? [state.selectedUid] : []);
    state.selectionAnchorUid = state.selectedUid;
    state.selectedUvFaces = new Set();
    updateToolVisibility();
    if (render) renderAll('all');
    else invalidateAllRenderGeometry();
  }

  function discardSubdivisionEdits(target) {
    if (!isProceduralShape(target) || target.preserveSubdivisionEdits) return;
    target.subdivisionEdits = {};
  }

  return {
    get subdivisionSession() { return subdivisionSession; },
    set subdivisionSession(value) { subdivisionSession = value; },
    isProceduralShape, subdivisionOwner, subdivisionPatch,
    syncSubdivisionEdits, enterSubdivisionEdit, exitSubdivisionEdit, discardSubdivisionEdits
  };
}
