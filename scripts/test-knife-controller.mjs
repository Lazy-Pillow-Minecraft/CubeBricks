import assert from 'node:assert/strict';
import test from 'node:test';
import { BezierElement, Cube, CubeBricksProject, Group } from '../src/model.js';
import { createKnifeController } from '../src/editor/knife-controller.js';
import { createTransformGeometry } from '../src/editor/transform-geometry.js';
import { createTransformTargets } from '../src/editor/transform-targets.js';
import { buildCameraState, projectScreenPoint, screenRay } from '../src/render/viewport-math.js';

function fixture(projection = 'perspective', rotated = false) {
  let source = new Cube({ position: [0, 0, 0], size: [10, 10, 10], pivot: [5, 5, 5],
    rotation: rotated ? [17, 29, 9] : [0, 0, 0] });
  let other = new Cube({ position: [20, 0, 0], size: [10, 10, 10] });
  let curve = new BezierElement({ nodes: [0, 1, 2, 3].map(x => ({ position: [x * 4, 0, 0] })) }, 3);
  const group = new Group({ pivot: [1, 2, 3], rotation: [13, -19, 24], children: [source.uid] });
  const outer = new Group({ pivot: [-3, 5, 1], rotation: [-7, 10, 17], children: [group.uid] });
  const project = new CubeBricksProject({ formatId: 'generic_model', elements: [source, other, curve],
    groups: rotated ? [outer, group] : [], outliner: [rotated ? outer.uid : source.uid, other.uid, curve.uid] });
  [source, other, curve] = [source, other, curve].map(node => project.getNode(node.uid));
  const state = { project, tool: 'knife', selectedUid: source.uid, history: [], modifierResultGhost: false };
  const { worldPointToCubeLocal } = createTransformGeometry({ state });
  const { cubeLocalPointToWorld } = createTransformTargets({ state });
  const viewport = { width: 900, height: 700 };
  const camera = { projection, yaw: Math.PI + .3, pitch: .4, zoom: 1, panX: 0, panY: 0,
    target: cubeLocalPointToWorld(source, [5, 5, 5]) };
  const frame = buildCameraState(camera, viewport.width / viewport.height, viewport.width, viewport.height);
  const rect = { left: 47, top: 63 };
  let hit = { uid: source.uid, faceName: 'north', point: cubeLocalPointToWorld(source, [3, 4, 0]) };
  let curveHit = null, detailedPicks = 0, curvePicks = 0;
  const snapshots = [], notices = [];
  const controller = createKnifeController({
    state, sceneCanvas: { getBoundingClientRect: () => rect },
    sceneRenderer: {
      pickDetailed: () => { detailedPicks++; return hit; },
      pickCurveSegment: () => { curvePicks++; return curveHit; },
      getScreenRay: (x, y) => screenRay(x, y, viewport, frame, camera)
    },
    worldPointToCubeLocal, cubeLocalPointToWorld,
    snapValue: value => Math.round(value), clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
    updateToolOptions() {}, renderScene() {}, renderAll() {}, freezeCubeUvs() {}, markDirty() {},
    snapshot: id => { snapshots.push(id); state.history.push(id); }, toast: value => notices.push(value),
    isBezierElement: element => element?.type === 'bezier3d', selected: () => project.getNode(state.selectedUid),
    selectItem: uid => { state.selectedUid = uid; }
  });
  function eventAt(localPoint) {
    const point = projectScreenPoint(cubeLocalPointToWorld(source, localPoint), frame.matrix, viewport.width, viewport.height);
    return { clientX: point.x + rect.left, clientY: point.y + rect.top };
  }
  return { state, source, other, curve, controller, snapshots, notices, eventAt,
    setHit: value => { hit = value; }, setCurveHit: value => { curveHit = value; },
    get picks() { return { detailed: detailedPicks, curve: curvePicks }; } };
}

for (const projection of ['orthographic', 'perspective']) {
  for (const rotated of [false, true]) {
    test(`${projection}, ${rotated ? 'nested rotations' : 'unrotated'}: endpoint may be on another face, cube, curve or blank space`, () => {
      for (const endpoint of ['other-face', 'other-cube', 'curve', 'blank']) {
        const f = fixture(projection, rotated);
        const otherBefore = JSON.stringify(f.other), curveBefore = JSON.stringify(f.curve);
        f.controller.useKnifePoint(f.eventAt([3, 4, 0]));
        assert.equal(f.state.knifeSelection.uid, f.source.uid);
        const picks = f.picks;
        if (endpoint === 'other-face') f.setHit({ uid: f.source.uid, faceName: 'up', point: [1, 10, 4] });
        if (endpoint === 'other-cube') f.setHit({ uid: f.other.uid, faceName: 'south', point: [24, 4, 10] });
        if (endpoint === 'curve') f.setCurveHit({ uid: f.curve.uid, segmentIndex: 1 });
        if (endpoint === 'blank') f.setHit(null);
        const event = f.eventAt([3.2, 17, 0]);
        f.controller.updateKnifeHover(event);
        assert.equal(f.controller.getKnifePreviewLabel(), '豎切');
        assert.ok(Math.abs(f.state.knifeHover.localPoint[1] - 17) < 1e-6, 'endpoint is not clipped to cube bounds');
        f.controller.useKnifePoint(event);
        assert.deepEqual(f.snapshots, ['core.knife.cube']);
        assert.ok(Math.abs(f.source.size[0] - 3) < 1e-6, 'cut position comes only from the snapped starting point');
        assert.equal(f.state.project.elements.length, 4);
        assert.equal(f.state.knifeSelection, null);
        assert.equal(f.state.selectedUid, f.source.uid, 'endpoint never changes the selected object');
        assert.deepEqual(f.picks, picks, 'direction selection does not pick or cut any endpoint geometry');
        assert.equal(JSON.stringify(f.other), otherBefore);
        assert.equal(JSON.stringify(f.curve), curveBefore);
      }
    });
    test(`${projection}, ${rotated ? 'nested rotations' : 'unrotated'}: direction is continuous, unsnapped and shared by preview and click`, () => {
      const f = fixture(projection, rotated);
      f.controller.useKnifePoint(f.eventAt([3, 4, 0]));
      f.controller.updateKnifeHover(f.eventAt([3.3, 4.2, 0]));
      assert.equal(f.controller.getKnifePreviewLabel(), '橫切', 'small pointer movement does not snap into a direction tie');
      assert.ok(Math.abs(f.state.knifeHover.localPoint[0] - 3.3) < 1e-6);
      f.controller.useKnifePoint(f.eventAt([18, 4.2, 0]));
      assert.ok(Math.abs(f.source.size[1] - 4) < 1e-6);
      assert.equal(f.source.size[0], 10);
    });
  }
}

test('starting on empty space still requires a valid cube, and curves keep their single-click cut', () => {
  const f = fixture();
  f.setHit(null);
  f.controller.useKnifePoint(f.eventAt([3, 4, 0]));
  assert.equal(f.state.knifeSelection, undefined);
  assert.deepEqual(f.snapshots, []);
  f.setCurveHit({ uid: f.curve.uid, segmentIndex: 1 });
  f.controller.useKnifePoint(f.eventAt([3, 4, 0]));
  assert.deepEqual(f.snapshots, ['core.knife.curve']);
  assert.equal(f.curve.nodes.length, 2);
  assert.equal(f.state.project.elements.filter(element => element.type === 'bezier3d').length, 2);
});
