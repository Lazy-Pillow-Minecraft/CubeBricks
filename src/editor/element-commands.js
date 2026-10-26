import { Cube, Shape, Locator, NodeElement, BezierElement, Group, allocateGroupName, refreshAutomaticNodeName } from '../model.js';
import { shapeRegistry } from '../shapes/builtins.js';

export function createElementCommands({
  state, selectedNodeUids, topLevelSelectedUids, snapshot, markDirty,
  renderAll, toast, captureOutlinerRowPositions, animateOutlinerReorder,
  inspectorController
}) {
function nodeContainer(uidValue) {
  const parent = state.project.getParentGroup(uidValue);
  return { parent, items: parent ? parent.children : state.project.outliner };
}

function insertNewNodeUid(uidValue) {
  const selectedIds = selectedNodeUids();
  const reference = state.project.getNode(state.selectedUid);
  if (!reference) {
    state.project.outliner.push(uidValue);
    state.project.invalidateHierarchyIndex();
    refreshAutomaticNodeName(state.project, state.project.getNode(uidValue));
    return;
  }
  // A single selected group is an insertion target. In a multi-selection it is
  // treated like any other row, so creation follows the last selected row.
  if (selectedIds.length === 1 && reference.type === 'group') {
    reference.children.push(uidValue);
    state.collapsedGroups.delete(reference.uid);
    state.project.invalidateHierarchyIndex();
    refreshAutomaticNodeName(state.project, state.project.getNode(uidValue));
    return;
  }
  const { items } = nodeContainer(reference.uid);
  const index = items.indexOf(reference.uid);
  items.splice(index < 0 ? items.length : index + 1, 0, uidValue);
  state.project.invalidateHierarchyIndex();
  refreshAutomaticNodeName(state.project, state.project.getNode(uidValue));
}

function selectCreatedNode(uidValue) {
  state.selectedUid = uidValue;
  state.selectedUids = new Set([uidValue]);
  state.selectionAnchorUid = uidValue;
  state.selectedCurveNodeIndex = null;
}

function alignNewNodeWithParent(uidValue) {
  const node = state.project.getNode(uidValue);
  const parent = state.project.getParentGroup(uidValue);
  if (!node || !parent) return;
  const anchor = parent.pivot;
  const pivot = node.pivot || node.origin || node.position;
  if (!pivot) return;
  const delta = anchor.map((value, axis) => value - pivot[axis]);
  if (node.type === 'cube') node.position = node.position.map((value, axis) => value + delta[axis]);
  if (node.origin) node.origin = node.origin.map((value, axis) => value + delta[axis]);
  if (node.position && node.type !== 'cube') node.position = node.position.map((value, axis) => value + delta[axis]);
  if (node.pivot) node.pivot = [...anchor];
}

function addCube() {
  if (state.mode === 'paint') return;
  snapshot('core.cube.create');
  const cube = new Cube({ position: [-1, 0, -1], size: [2, 2, 2], pivot: [0, 0, 0], color: '#a7d352' });
  state.project.elements.push(cube);
  insertNewNodeUid(cube.uid);
  alignNewNodeWithParent(cube.uid);
  selectCreatedNode(cube.uid);
  markDirty(); renderAll(); toast('已新增 Cube');
}

function addShape(shapeType = 'polygon_prism') {
  if (state.mode === 'paint') return;
  const definition = shapeRegistry.get(shapeType);
  if (!definition || ['bezier2d', 'bezier3d'].includes(shapeType)) return;
  snapshot('core.shape.create');
  const type = shapeType;
  const shape = new Shape({ type, shapeType: type, origin: [0, 2, 0], pivot: [0, 2, 0] });
  state.project.elements.push(shape);
  insertNewNodeUid(shape.uid);
  alignNewNodeWithParent(shape.uid);
  selectCreatedNode(shape.uid);
  const label = definition.label;
  markDirty(); renderAll(); toast(`已新增${label} Shape`);
}

function addLocator() {
  if (state.mode === 'paint') return;
  snapshot('core.locator.create');
  const locator = new Locator({ position: [0, 4, 0] });
  state.project.elements.push(locator);
  insertNewNodeUid(locator.uid);
  alignNewNodeWithParent(locator.uid);
  selectCreatedNode(locator.uid);
  markDirty(); renderAll(); toast('已新增 Locator');
}

function addBezierElement(dimension, variant = 'standard') {
  if (state.mode === 'paint') return;
  snapshot('core.curve.create');
  const curve = new BezierElement({ origin: [0, 0, 0], rotation: dimension === 2 ? [-90, 0, 0] : [0, 0, 0], variant }, dimension);
  state.project.elements.push(curve);
  insertNewNodeUid(curve.uid);
  alignNewNodeWithParent(curve.uid);
  selectCreatedNode(curve.uid);
  state.selectedCurveNodeIndex = null;
  markDirty(); renderAll(); toast(`已新增${dimension === 2 ? '二維' : '三維'}${variant === 'envelope' ? '包絡' : ''}貝塞爾元素`);
}

function addGroup() {
  if (state.mode === 'paint') return;
  const previousRowPositions = captureOutlinerRowPositions();
  snapshot('core.group.create');
  const group = new Group({ name: allocateGroupName(state.project), unnamed: true, children: [] });
  const hadMultipleSelection = selectedNodeUids().length > 1;
  const selectedIds = topLevelSelectedUids();
  state.project.groups.push(group);
  state.project.invalidateHierarchyIndex();
  if (hadMultipleSelection && selectedIds.length) {
    const sourceContainers = selectedIds.map(uidValue => nodeContainer(uidValue));
    const sharedContainer = sourceContainers.every(container => container.items === sourceContainers[0].items)
      ? sourceContainers[0]
      : null;
    // When every selected row is already in the same directory, keep the new
    // group exactly where those rows lived. This makes grouping an in-place
    // wrap instead of unexpectedly sending the selection to the directory end.
    const sharedInsertionIndex = sharedContainer
      ? Math.min(...selectedIds.map(uidValue => sharedContainer.items.indexOf(uidValue)).filter(index => index >= 0))
      : -1;
    const chains = selectedIds.map(uidValue => state.project.getGroupChain(uidValue));
    let commonParent = null;
    const shortest = Math.min(...chains.map(chain => chain.length));
    for (let index = 0; index < shortest; index++) {
      const candidate = chains[0][index];
      if (chains.every(chain => chain[index]?.uid === candidate.uid)) commonParent = candidate;
      else break;
    }
    const order = new Map((state.outlinerRows || []).filter(row => row.node?.uid).map((row, index) => [row.node.uid, index]));
    selectedIds.sort((left, right) => (order.get(left) ?? Infinity) - (order.get(right) ?? Infinity));
    for (const uidValue of selectedIds) {
      const { items } = nodeContainer(uidValue);
      const index = items.indexOf(uidValue);
      if (index >= 0) items.splice(index, 1);
    }
    group.children.push(...selectedIds);
    if (sharedContainer && sharedInsertionIndex >= 0) {
      sharedContainer.items.splice(sharedInsertionIndex, 0, group.uid);
    } else {
      (commonParent ? commonParent.children : state.project.outliner).push(group.uid);
    }
    state.collapsedGroups.delete(group.uid);
  } else {
    insertNewNodeUid(group.uid);
  }
  state.project.invalidateHierarchyIndex();
  alignNewNodeWithParent(group.uid);
  group.children.forEach(childUid => refreshAutomaticNodeName(state.project, state.project.getNode(childUid)));
  selectCreatedNode(group.uid);
  markDirty(); renderAll(); animateOutlinerReorder(previousRowPositions); toast('已新增組');
}

function deleteSelected(operationId = 'core.element.delete') {
  if (state.mode === 'paint') return;
  const selectedIds = topLevelSelectedUids();
  if (!selectedIds.length) return;
  if (inspectorController.subdivisionSession && selectedIds.some(uidValue => state.project.getNode(uidValue)?.subdivisionOwnerUid)) {
    return toast('細分 Cube 由 Shape 管理，不能單獨刪除');
  }
  snapshot(operationId);
  selectedIds.forEach(uidValue => state.project.removeNode(uidValue));
  state.selectedUid = null;
  state.selectedUids = new Set();
  state.selectionAnchorUid = null;
  state.selectedCurveNodeIndex = null;
  markDirty(); renderAll(); toast(selectedIds.length > 1 ? `已刪除 ${selectedIds.length} 項` : '物件已刪除');
}

let elementClipboard = null;

function captureSelectedElements() {
  const order = new Map((state.outlinerRows || []).filter(row => row.node?.uid).map((row, index) => [row.node.uid, index]));
  const roots = topLevelSelectedUids()
    .sort((left, right) => (order.get(left) ?? Infinity) - (order.get(right) ?? Infinity));
  if (!roots.length) return null;
  const records = new Map();
  const visit = uidValue => {
    if (records.has(uidValue)) return;
    const node = state.project.getNode(uidValue);
    if (!node) return;
    records.set(uidValue, structuredClone(node));
    if (node.type === 'group') node.children.forEach(visit);
  };
  roots.forEach(visit);
  return { roots: [...roots], records: [...records.entries()] };
}

function copySelected({ notify = true } = {}) {
  const payload = captureSelectedElements();
  if (!payload) return false;
  elementClipboard = payload;
  if (notify) toast(payload.roots.length > 1 ? `已複製 ${payload.roots.length} 項` : '已複製選中項');
  return true;
}

function instantiateClipboard(payload) {
  if (!payload?.records?.length) return null;
  const instances = new Map();
  const reservedGroupNames = [];
  for (const [oldUid, source] of payload.records) {
    const data = structuredClone(source);
    delete data.uid;
    delete data.uuid;
    if (data.type === 'group') {
      data.name = allocateGroupName(state.project, data.unnamed ? 'group_1' : data.name || 'group', {
        duplicate: true, reservedNames: reservedGroupNames
      });
      reservedGroupNames.push(data.name);
    }
    let node;
    if (data.type === 'group') node = new Group({ ...data, children: [] });
    else if (data.type === 'shape' || shapeRegistry.has(data.shapeType || data.type) && !['bezier2d', 'bezier3d'].includes(data.type)) node = new Shape(data);
    else if (data.type === 'locator') node = new Locator(data);
    else if (data.type === 'node') node = new NodeElement(data);
    else if (data.type === 'bezier2d') node = new BezierElement(data, 2);
    else if (data.type === 'bezier3d') node = new BezierElement(data, 3);
    else node = new Cube(data);
    instances.set(oldUid, node);
  }
  for (const [oldUid, source] of payload.records) {
    const node = instances.get(oldUid);
    if (node?.type === 'group') node.children = (source.children || [])
      .map(childUid => instances.get(childUid)?.uid).filter(Boolean);
  }
  return {
    nodes: [...instances.values()],
    roots: payload.roots.map(uidValue => instances.get(uidValue)).filter(Boolean)
  };
}

function insertClonedRoots(cloned, sourceRootUids = null) {
  const roots = cloned.roots.map(node => node.uid);
  if (sourceRootUids?.length) {
    sourceRootUids.forEach((sourceUid, index) => {
      const { items } = nodeContainer(sourceUid);
      const sourceIndex = items.indexOf(sourceUid);
      items.splice(sourceIndex < 0 ? items.length : sourceIndex + 1, 0, roots[index]);
    });
    return;
  }
  const selectedIds = selectedNodeUids();
  const reference = state.project.getNode(state.selectedUid);
  if (selectedIds.length === 1 && reference?.type === 'group') {
    reference.children.push(...roots);
    state.collapsedGroups.delete(reference.uid);
    return;
  }
  if (reference) {
    const { items } = nodeContainer(reference.uid);
    const index = items.indexOf(reference.uid);
    items.splice(index < 0 ? items.length : index + 1, 0, ...roots);
  } else state.project.outliner.push(...roots);
}

function pasteElements({ inPlace = false } = {}) {
  if (state.mode === 'paint') return;
  const payload = inPlace ? captureSelectedElements() : elementClipboard;
  if (!payload) return toast(inPlace ? '沒有可複製的選中項' : '元素剪貼簿是空的');
  const cloned = instantiateClipboard(payload);
  if (!cloned?.roots.length) return;
  snapshot(inPlace ? 'core.element.duplicate' : 'core.element.paste');
  for (const node of cloned.nodes) {
    if (node.type === 'group') state.project.groups.push(node);
    else state.project.elements.push(node);
  }
  insertClonedRoots(cloned, inPlace ? payload.roots : null);
  state.project.invalidateHierarchyIndex();
  state.selectedUids = new Set(cloned.roots.map(node => node.uid));
  state.selectedUid = cloned.roots.at(-1).uid;
  state.selectionAnchorUid = state.selectedUid;
  state.selectedCurveNodeIndex = null;
  markDirty(); renderAll();
  toast(inPlace ? '已就地複製選中項' : '已貼上元素');
}

function cutSelected() {
  if (state.mode === 'paint') return;
  if (!copySelected({ notify: false })) return;
  const count = elementClipboard.roots.length;
  deleteSelected('core.element.cut');
  toast(count > 1 ? `已剪切 ${count} 項` : '已剪切選中項');
}

return {
  nodeContainer,
  insertNewNodeUid,
  selectCreatedNode,
  addCube,
  addShape,
  addLocator,
  addBezierElement,
  addGroup,
  deleteSelected,
  captureSelectedElements,
  copySelected,
  instantiateClipboard,
  insertClonedRoots,
  pasteElements,
  cutSelected,
};
}
