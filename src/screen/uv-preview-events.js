export function bindUvPreviewEvents({
  state, $, $$, uvPreviewCanvas, uvPreviewViewport, uvPreviewRenderer, uvPreviewController,
  stopUvPreviewAnimation, refreshUvPreview, renderUvPreview, uvPreviewIsActive, uvPreviewElements,
  getUvPreviewProject, editSelectedUvFace, renderTextureUvOverlay, updateFaceSelectionOverlay,
  textureAssetForReference, activateProjectTexture, uvFaceKey, getDockManager,
  setDockHotspotFocus, focusSelectedTextureUvs, toast
}) {
  $('#uvPreviewEnabled').addEventListener('change', event => {
    state.uvPreviewEnabled = event.target.checked;
    if (!state.uvPreviewEnabled) stopUvPreviewAnimation();
    refreshUvPreview();
  });
  $('#uvPreviewAutoRotate').addEventListener('change', event => {
    state.uvPreviewAutoRotate = event.target.checked;
    if (!state.uvPreviewAutoRotate) stopUvPreviewAnimation();
    refreshUvPreview();
  });
  $('#uvPreviewFaceColors').addEventListener('change', event => {
    state.uvPreviewFaceColors = event.target.checked;
    uvPreviewRenderer.invalidateGeometry();
    renderUvPreview();
  });
  $('#uvPreviewAutoFocusTexture').addEventListener('change', event => {
    state.uvPreviewAutoFocusTexture = event.target.checked;
  });
  $$('[data-uv-face-action]').forEach(button => button.addEventListener('click', () => {
    editSelectedUvFace(button.dataset.uvFaceAction);
  }));
  uvPreviewViewport.addEventListener('pointerdown', event => {
    if (![0, 1].includes(event.button) || !uvPreviewIsActive() || !uvPreviewElements().length) return;
    event.preventDefault();
    uvPreviewController.uvPreviewDrag = {
      pointerId: event.pointerId,
      button: event.button,
      rotates: event.button === 1,
      x: event.clientX, y: event.clientY,
      startX: event.clientX, startY: event.clientY,
      moved: false
    };
    if (uvPreviewController.uvPreviewDrag.rotates) uvPreviewViewport.classList.add('is-rotating');
    uvPreviewViewport.setPointerCapture(event.pointerId);
  });
  uvPreviewViewport.addEventListener('pointermove', event => {
    if (!uvPreviewController.uvPreviewDrag || uvPreviewController.uvPreviewDrag.pointerId !== event.pointerId) return;
    const dx = event.clientX - uvPreviewController.uvPreviewDrag.x;
    const dy = event.clientY - uvPreviewController.uvPreviewDrag.y;
    if (!uvPreviewController.uvPreviewDrag.moved && Math.hypot(event.clientX - uvPreviewController.uvPreviewDrag.startX, event.clientY - uvPreviewController.uvPreviewDrag.startY) < 4) return;
    uvPreviewController.uvPreviewDrag.moved = true;
    uvPreviewController.uvPreviewDrag.x = event.clientX;
    uvPreviewController.uvPreviewDrag.y = event.clientY;
    if (!uvPreviewController.uvPreviewDrag.rotates) return;
    state.uvPreviewYaw -= dx * .01;
    state.uvPreviewPitch = Math.max(-Math.PI / 2 + .02, Math.min(Math.PI / 2 - .02, state.uvPreviewPitch + dy * .01));
    renderUvPreview();
  });
  const endUvPreviewDrag = event => {
    if (!uvPreviewController.uvPreviewDrag || uvPreviewController.uvPreviewDrag.pointerId !== event.pointerId) return;
    const wasClick = !uvPreviewController.uvPreviewDrag.moved && uvPreviewController.uvPreviewDrag.button === 0;
    uvPreviewViewport.releasePointerCapture?.(event.pointerId);
    uvPreviewViewport.classList.remove('is-rotating');
    uvPreviewController.uvPreviewDrag = null;
    if (wasClick) {
      const rect = uvPreviewCanvas.getBoundingClientRect();
      const cache = getUvPreviewProject();
      const hit = uvPreviewRenderer.pickDetailed(cache.project,
        event.clientX - rect.left, event.clientY - rect.top, true);
      if (!hit) {
        state.uvPreviewSelectedFace = null;
        state.selectedUvFaces = new Set();
        renderTextureUvOverlay(true);
        updateFaceSelectionOverlay();
      }
      else if (state.project.getNode(hit.uid)?.type !== 'cube') {
        state.uvPreviewSelectedFace = null;
        toast('程序化 Shape 請先轉換為 Cube 才能編輯逐面 UV');
      } else state.uvPreviewSelectedFace = {
        uid: hit.uid,
        faceName: hit.faceName,
        points: hit.facePoints.map(point => [...point])
      };
      if (state.uvPreviewSelectedFace) {
        if (state.uvPreviewAutoFocusTexture) {
          const selection = state.uvPreviewSelectedFace;
          const asset = textureAssetForReference(state.project.getNode(selection.uid)?.faces?.[selection.faceName]?.texture);
          if (asset && state.activeTextureUid !== asset._uid)
            activateProjectTexture(state.textureAssets.indexOf(asset));
        }
        state.selectedUvFaces = new Set([uvFaceKey(state.uvPreviewSelectedFace.uid, state.uvPreviewSelectedFace.faceName)]);
        renderTextureUvOverlay(true);
        updateFaceSelectionOverlay();
        if (state.uvPreviewAutoFocusTexture) {
          getDockManager()?.expand('texture');
          setDockHotspotFocus('texture');
          requestAnimationFrame(focusSelectedTextureUvs);
        }
      }
      renderUvPreview();
    }
  };
  uvPreviewViewport.addEventListener('pointerup', endUvPreviewDrag);
  uvPreviewViewport.addEventListener('pointercancel', endUvPreviewDrag);
  uvPreviewViewport.addEventListener('auxclick', event => event.preventDefault());
}
