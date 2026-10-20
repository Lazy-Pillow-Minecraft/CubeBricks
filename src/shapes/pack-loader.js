import { shapeRegistry } from './builtins.js';

export function createShapePackLoader({ $, toast, renderAll }) {
async function loadExternalShapePacks() {
  if (!window.cubeBricksDesktop?.listShapePacks) return;
  const menu = $('#shapeCreateMenu');
  menu.querySelectorAll('[data-external-shape]').forEach(node => node.remove());
  shapeRegistry.removeExternal();
  try {
    const { packs, errors } = await window.cubeBricksDesktop.listShapePacks();
    const failures = [...errors];
    for (const pack of packs) {
      for (const record of pack.shapes) {
        try {
          // Installing a pack explicitly opts into its JavaScript running in
          // the editor. Keep pack scripts self-contained and source-size bound.
          const module = await import(`data:text/javascript;base64,${record.source}`);
          const definition = module.default;
          if (definition?.id !== record.id) throw new Error('模組 ID 與包清單不一致');
          const registered = shapeRegistry.register({ ...definition, label: record.label,
            icon: record.icon || 'shape' }, { external: true, pack: `${pack.name} ${pack.version}` });
          const button = document.createElement('button');
          button.type = 'button';
          button.dataset.createShape = registered.id;
          button.dataset.externalShape = 'true';
          if (registered.icon.startsWith('data:image/')) {
            const icon = document.createElement('img');
            icon.src = registered.icon;
            icon.alt = '';
            icon.className = 'object-icon';
            button.append(icon);
          } else button.innerHTML = '<svg class="object-icon" aria-hidden="true"><use href="#icon-shape"></use></svg>';
          const label = document.createElement('span');
          label.textContent = registered.label;
          button.append(label);
          menu.append(button);
        } catch (error) { failures.push(`${pack.name}/${record.id}: ${error.message}`); }
      }
    }
    if (failures.length) {
      console.warn('Shape 包載入失敗', failures);
      toast(`${failures.length} 個 Shape 包項目未載入，詳見主控台`);
    }
    renderAll();
  } catch (error) { console.warn('Shape 包掃描失敗', error); toast(`Shape 包掃描失敗：${error.message}`); }
}
return { loadExternalShapePacks };
}
