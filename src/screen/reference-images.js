export function createReferenceImageController({ state, $, $$, escapeHtml, viewport, sceneRenderer,
  referenceImageInput, referenceImageLayer, referenceImageHint, snapshot, markDirty, toast,
  setPaintColor, updateToolOptions }) {
let referenceImageEditing = false;
let referenceImageDrag = null;
let referenceControlsProject = null;
let referenceControlsKey = '';
let referenceImportViewKey = 'general';
const sampleCanvases = new WeakMap();

function referenceViewKey() {
  return state.axisView || 'general';
}

function referenceImageStore() {
  state.project.referenceImages ||= { general: [], x: [], y: [], z: [] };
  for (const key of ['general', 'x', 'y', 'z']) {
    const stored = state.project.referenceImages[key];
    const records = Array.isArray(stored) ? stored : stored ? [stored] : [];
    for (const record of records) record.uid ||= `reference_${crypto.randomUUID().slice(0, 8)}`;
    state.project.referenceImages[key] = records;
  }
  return state.project.referenceImages;
}

function referenceImagesForView(key = referenceViewKey()) {
  return referenceImageStore()[key];
}

function currentReferenceImage(key = referenceViewKey()) {
  const records = referenceImagesForView(key);
  if (!records.length) {
    state.referenceImageSelection[key] = null;
    return null;
  }
  let record = records.find(entry => entry.uid === state.referenceImageSelection[key]);
  if (!record) {
    record = records.at(-1);
    state.referenceImageSelection[key] = record.uid;
  }
  return record;
}

function axisReferenceBasis(axis) {
  if (axis === 'x') return { horizontal: [0, 0, -1], vertical: [0, 1, 0] };
  if (axis === 'y') return { horizontal: [1, 0, 0], vertical: [0, 0, -1] };
  return { horizontal: [1, 0, 0], vertical: [0, 1, 0] };
}

function referenceDefaultScale(record, key = referenceViewKey()) {
  if (key !== 'general') return 16 / Math.max(1, record.naturalWidth, record.naturalHeight);
  const width = Math.max(1, viewport.clientWidth * .68);
  const height = Math.max(1, viewport.clientHeight * .68);
  return Math.min(width / record.naturalWidth, height / record.naturalHeight);
}

function updateReferenceImageControls() {
  const key = referenceViewKey();
  const records = referenceImagesForView(key);
  const record = currentReferenceImage(key);
  const renderKey = JSON.stringify([key, record?.uid, referenceImageEditing,
    records.map(entry => [entry.uid, entry.name])]);
  if (referenceControlsProject === state.project && referenceControlsKey === renderKey) return;
  referenceControlsProject = state.project;
  referenceControlsKey = renderKey;
  const labels = { general: '一般視圖參考圖', x: 'X 軸視圖參考圖', y: 'Y 軸視圖參考圖', z: 'Z 軸視圖參考圖' };
  $('#referenceImageViewLabel').textContent = labels[key];
  $('#referenceImageName').textContent = record ? `${record.name} · ${records.indexOf(record) + 1}/${records.length}` : '尚未導入';
  $('#referenceImageList').innerHTML = records.length
    ? records.map((entry, index) => `<button type="button" class="reference-image-entry ${entry === record ? 'active' : ''}" data-reference-select="${escapeHtml(entry.uid)}" title="${escapeHtml(entry.name)}"><span>${index + 1}</span><b>${escapeHtml(entry.name)}</b></button>`).join('')
    : '<small class="reference-image-empty">這個視圖還沒有參考圖</small>';
  const control = $('[data-action="referenceImage"]');
  control.classList.toggle('active', records.length > 0);
  control.classList.toggle('editing', referenceImageEditing && Boolean(record));
  $$('[data-reference-action="edit"], [data-reference-action="reset"], [data-reference-action="remove"]')
    .forEach(button => { button.disabled = !record; });
  const editButton = $('[data-reference-action="edit"]');
  if (editButton) editButton.textContent = referenceImageEditing ? '結束調整' : '調整位置與尺寸';
}

function applyReferenceImageTransform(element, record, key) {
  if (key === 'general') {
    const scale = record.scale;
    const x = viewport.clientWidth / 2 + record.offset[0] - record.naturalWidth * scale / 2;
    const y = viewport.clientHeight / 2 + record.offset[1] - record.naturalHeight * scale / 2;
    element.style.transform = `matrix(${scale},0,0,${scale},${x},${y})`;
    return;
  }
  const basis = axisReferenceBasis(key);
  const origin = [0, 0, 0];
  const centerWorld = origin.map((value, index) => value
    + basis.horizontal[index] * record.offset[0]
    + basis.vertical[index] * record.offset[1]);
  const center = sceneRenderer.projectPoint(centerWorld);
  const horizontal = sceneRenderer.projectPoint(basis.horizontal);
  const vertical = sceneRenderer.projectPoint(basis.vertical);
  const base = sceneRenderer.projectPoint(origin);
  const a = (horizontal.x - base.x) * record.scale;
  const b = (horizontal.y - base.y) * record.scale;
  const c = -(vertical.x - base.x) * record.scale;
  const d = -(vertical.y - base.y) * record.scale;
  const x = center.x - a * record.naturalWidth / 2 - c * record.naturalHeight / 2;
  const y = center.y - b * record.naturalWidth / 2 - d * record.naturalHeight / 2;
  element.style.transform = `matrix(${a},${b},${c},${d},${x},${y})`;
}

function updateReferenceImageLayer() {
  const key = referenceViewKey();
  const records = referenceImagesForView(key);
  const selected = currentReferenceImage(key);
  if (!records.length) {
    if (!referenceImageLayer.hidden) {
      referenceImageLayer.hidden = true;
      referenceImageLayer.querySelectorAll('img').forEach(image => image.remove());
    }
    updateReferenceImageControls();
    return;
  }
  referenceImageLayer.hidden = false;
  referenceImageLayer.classList.toggle('editing', referenceImageEditing && Boolean(selected));
  const existing = new Map([...referenceImageLayer.querySelectorAll('img')].map(image => [image.dataset.referenceUid, image]));
  for (const record of records) {
    let image = existing.get(record.uid);
    if (!image) {
      image = document.createElement('img');
      image.dataset.referenceUid = record.uid;
      image.alt = record.name;
      image.draggable = false;
      referenceImageLayer.insertBefore(image, referenceImageHint);
    }
    existing.delete(record.uid);
    if (image.getAttribute('src') !== record.source) image.src = record.source;
    image.width = record.naturalWidth;
    image.height = record.naturalHeight;
    image.classList.toggle('selected', record === selected);
    applyReferenceImageTransform(image, record, key);
  }
  existing.forEach(image => image.remove());
  updateReferenceImageControls();
}

function sampleReferenceImage(clientX, clientY) {
  if (referenceImageLayer.hidden) return null;
  const rect = referenceImageLayer.getBoundingClientRect();
  const screenX = clientX - rect.left;
  const screenY = clientY - rect.top;
  // Last imported image is drawn on top. Invert its exact CSS transform so
  // axis views, negative-axis views and general-view zoom use the same picker.
  const images = [...referenceImageLayer.querySelectorAll('img')].reverse();
  for (const image of images) {
    if (!image.complete || !image.naturalWidth || !image.naturalHeight) continue;
    let position;
    try {
      position = new DOMMatrix(image.style.transform).inverse().transformPoint({ x: screenX, y: screenY });
    } catch { continue; }
    const x = Math.floor(position.x);
    const y = Math.floor(position.y);
    if (x < 0 || y < 0 || x >= image.naturalWidth || y >= image.naturalHeight) continue;
    let cached = sampleCanvases.get(image);
    if (!cached || cached.source !== image.src) {
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) continue;
      context.drawImage(image, 0, 0);
      cached = { source: image.src, context };
      sampleCanvases.set(image, cached);
    }
    const pixel = cached.context.getImageData(x, y, 1, 1).data;
    if (!pixel[3]) continue;
    return `#${[pixel[0], pixel[1], pixel[2]].map(value => value.toString(16).padStart(2, '0')).join('')}`;
  }
  return null;
}

function setReferenceImageEditing(value) {
  referenceImageEditing = Boolean(value && currentReferenceImage());
  referenceImageDrag = null;
  referenceImageLayer.classList.remove('dragging');
  updateReferenceImageLayer();
}

function setReferenceImageMenu(open) {
  $('#referenceImageMenu').hidden = !open;
  $('[data-action="referenceImage"]').setAttribute('aria-expanded', String(open));
  if (open) updateReferenceImageControls();
}

function beginReferenceImageImport() {
  referenceImportViewKey = referenceViewKey();
  referenceImageInput.value = '';
  referenceImageInput.click();
  setReferenceImageMenu(false);
}

function resetReferenceImage() {
  const record = currentReferenceImage();
  if (!record) return;
  snapshot('core.reference.reset');
  record.offset = [0, 0];
  record.scale = referenceDefaultScale(record);
  markDirty();
  updateReferenceImageLayer();
}

function removeReferenceImage() {
  const key = referenceViewKey();
  const records = referenceImagesForView(key);
  const record = currentReferenceImage(key);
  if (!record) return;
  snapshot('core.reference.remove');
  const index = records.indexOf(record);
  records.splice(index, 1);
  const next = records[Math.min(index, records.length - 1)] || null;
  state.referenceImageSelection[key] = next?.uid || null;
  if (!next) referenceImageEditing = false;
  markDirty();
  updateReferenceImageLayer();
}

function readReferenceImageFile(file, key) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const image = new Image();
      image.onerror = reject;
      image.onload = () => {
        const record = {
          uid: `reference_${crypto.randomUUID().slice(0, 8)}`,
          name: file.name || 'reference.png',
          source: String(reader.result),
          naturalWidth: Math.max(1, image.naturalWidth || image.width),
          naturalHeight: Math.max(1, image.naturalHeight || image.height),
          offset: [0, 0],
          scale: 1
        };
        record.scale = referenceDefaultScale(record, key);
        resolve(record);
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

async function loadReferenceImageFiles(files, key) {
  if (!['general', 'x', 'y', 'z'].includes(key)) return;
  const candidates = [...(files || [])];
  if (!candidates.length) return;
  const settled = await Promise.allSettled(candidates.map(file => readReferenceImageFile(file, key)));
  const records = settled.filter(result => result.status === 'fulfilled').map(result => result.value);
  if (!records.length) return toast('無法讀取這些參考圖');
  snapshot('core.reference.add');
  referenceImagesForView(key).push(...records);
  state.referenceImageSelection[key] = records.at(-1).uid;
  referenceImageEditing = key === referenceViewKey();
  markDirty();
  updateReferenceImageLayer();
  if (settled.some(result => result.status === 'rejected')) toast(`已導入 ${records.length} 張參考圖，部分檔案無法讀取`);
  else toast(`已導入${key === 'general' ? '一般視圖' : key.toUpperCase() + ' 軸視圖'}參考圖 · ${records.length} 張`);
}

function referenceDragBasis() {
  if (!state.axisView) return null;
  const basis = axisReferenceBasis(state.axisView);
  const origin = sceneRenderer.projectPoint([0, 0, 0]);
  const horizontal = sceneRenderer.projectPoint(basis.horizontal);
  const vertical = sceneRenderer.projectPoint(basis.vertical);
  return {
    horizontal: [horizontal.x - origin.x, horizontal.y - origin.y],
    vertical: [vertical.x - origin.x, vertical.y - origin.y]
  };
}

function beginReferenceImageDrag(event) {
  if (state.mode === 'paint' && state.tool === 'eyedropper' && event.button === 0) {
    const color = sampleReferenceImage(event.clientX, event.clientY);
    if (color) {
      event.preventDefault();
      setPaintColor(color, true);
      updateToolOptions();
    }
    return;
  }
  if (!referenceImageEditing || !currentReferenceImage() || ![0, 1].includes(event.button)) return;
  event.preventDefault();
  event.stopPropagation();
  referenceImageLayer.setPointerCapture(event.pointerId);
  const record = currentReferenceImage();
  referenceImageDrag = {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    offset: [...record.offset],
    uid: record.uid,
    key: referenceViewKey(),
    basis: referenceDragBasis(),
    snapshotTaken: false
  };
  referenceImageLayer.classList.add('dragging');
}

function moveReferenceImageDrag(event) {
  const drag = referenceImageDrag;
  if (!drag || drag.pointerId !== event.pointerId || drag.key !== referenceViewKey()) return;
  const dx = event.clientX - drag.x;
  const dy = event.clientY - drag.y;
  if (!drag.snapshotTaken && Math.hypot(dx, dy) < .5) return;
  if (!drag.snapshotTaken) {
    snapshot('core.reference.move');
    drag.snapshotTaken = true;
  }
  const record = currentReferenceImage();
  if (!record || record.uid !== drag.uid) return;
  if (!drag.basis) {
    record.offset = [drag.offset[0] + dx, drag.offset[1] + dy];
  } else {
    const [hx, hy] = drag.basis.horizontal;
    const [vx, vy] = drag.basis.vertical;
    const determinant = hx * vy - hy * vx;
    if (Math.abs(determinant) < .000001) return;
    const horizontalDelta = (dx * vy - dy * vx) / determinant;
    const verticalDelta = (hx * dy - hy * dx) / determinant;
    record.offset = [drag.offset[0] + horizontalDelta, drag.offset[1] + verticalDelta];
  }
  markDirty();
  updateReferenceImageLayer();
}

function endReferenceImageDrag(event) {
  if (!referenceImageDrag || referenceImageDrag.pointerId !== event.pointerId) return;
  if (referenceImageLayer.hasPointerCapture?.(event.pointerId)) referenceImageLayer.releasePointerCapture(event.pointerId);
  referenceImageDrag = null;
  referenceImageLayer.classList.remove('dragging');
}

function scaleReferenceImage(event) {
  if (!referenceImageEditing) return;
  const record = currentReferenceImage();
  if (!record) return;
  event.preventDefault();
  snapshot('core.reference.scale');
  const factor = event.deltaY > 0 ? .9 : 1.1;
  record.scale = Math.max(.00001, Math.min(100, record.scale * factor));
  markDirty();
  updateReferenceImageLayer();
}
function resetInteraction() {
  referenceImageEditing = false;
  referenceImageDrag = null;
}

function selectReference(uid) {
  state.referenceImageSelection[referenceViewKey()] = uid;
  updateReferenceImageLayer();
}

return { get editing() { return referenceImageEditing; }, get drag() { return referenceImageDrag; },
  get importViewKey() { return referenceImportViewKey; }, resetInteraction, selectReference,
  referenceViewKey, updateReferenceImageLayer, sampleReferenceImage, setReferenceImageEditing, setReferenceImageMenu,
  beginReferenceImageImport, resetReferenceImage, removeReferenceImage, loadReferenceImageFiles,
  beginReferenceImageDrag, moveReferenceImageDrag, endReferenceImageDrag, scaleReferenceImage };
}
