import { ConfigKey, configRegistry, replaceLanguagePacks } from '../common/config/app-config.js';
import { showAppConfirm } from './prompt-dialog.js';

const KIND_LABELS = { language: '語言包', font: '字體包', shape: 'Shape 包' };
const BUILTIN_FONTS = [
  { value: 'pixel', label: 'Fusion Pixel（內置）' },
  { value: 'system', label: '系統字體' }
];

export function createPacksController({ $, toast, reloadShapePacks }) {
  const desktop = window.cubeBricksDesktop;
  const dialog = $('#packsDialog');
  const list = $('#packsList');
  const errors = $('#packsErrors');
  const fontSelect = $('#fontSelect');
  let packs = [];
  let kind = 'language';
  let fontFaces = [];
  let fontGeneration = 0;
  const fontSourceCache = new Map();
  let draggedPackId = null;

  function clearFontFaces() {
    for (const face of fontFaces) document.fonts.delete(face);
    fontFaces = [];
  }

  async function applyFont() {
    const generation = ++fontGeneration;
    clearFontFaces();
    const selected = configRegistry.get(ConfigKey.FONT);
    if (selected === 'pixel') {
      document.documentElement.style.removeProperty('--ui-font');
      return;
    }
    if (selected === 'system') {
      document.documentElement.style.setProperty('--ui-font', 'system-ui, sans-serif');
      return;
    }
    const pack = packs.find(entry => entry.kind === 'font' && entry.id === selected);
    if (!pack) {
      document.documentElement.style.removeProperty('--ui-font');
      return;
    }
    const language = configRegistry.get(ConfigKey.LANGUAGE).toLowerCase();
    if (!fontSourceCache.has(pack.id)) {
      try { fontSourceCache.set(pack.id, await desktop.readFontPack(pack.id)); }
      catch (error) {
        console.warn('字體包讀取失敗', pack.id, error);
        if (generation === fontGeneration) document.documentElement.style.setProperty('--ui-font', 'system-ui, sans-serif');
        return;
      }
    }
    if (generation !== fontGeneration) return;
    const fontFiles = [...fontSourceCache.get(pack.id).fonts].sort((a, b) => {
      const score = file => {
        const name = file.file.toLowerCase();
        if (language.startsWith('zh-hans') && /zh[_-]?hans/.test(name)) return 0;
        if (language.startsWith('zh-hant') && /zh[_-]?hant/.test(name)) return 0;
        if (language.startsWith('ja') && /(?:^|[-_])ja(?:\.|[-_])/.test(name)) return 0;
        if (language.startsWith('ko') && /(?:^|[-_])ko(?:\.|[-_])/.test(name)) return 0;
        if (/(?:^|[-_])latin(?:\.|[-_])/.test(name)) return 1;
        return 2;
      };
      return score(a) - score(b);
    });
    const loaded = [];
    for (const [index, file] of fontFiles.entries()) {
      const family = `CubeBricks Pack ${index} ${generation}`;
      try {
        const face = await new FontFace(family, `url("${file.source}")`).load();
        if (generation !== fontGeneration) {
          loaded.forEach(entry => document.fonts.delete(entry.face));
          return;
        }
        document.fonts.add(face);
        loaded.push({ family, face });
      } catch (error) { console.warn('字體載入失敗', file.file, error); }
    }
    if (generation !== fontGeneration) return;
    fontFaces = loaded.map(entry => entry.face);
    document.documentElement.style.setProperty('--ui-font',
      loaded.length ? [...loaded.map(entry => `"${entry.family}"`), 'system-ui', 'sans-serif'].join(', ')
        : 'system-ui, sans-serif');
  }

  function updateFontSelect() {
    const options = [...BUILTIN_FONTS, ...packs.filter(pack => pack.kind === 'font')
      .map(pack => ({ value: pack.id, label: pack.name }))];
    fontSelect.replaceChildren(...options.map(option => new Option(option.label, option.value)));
    const current = configRegistry.get(ConfigKey.FONT);
    if (!options.some(option => option.value === current)) configRegistry.set(ConfigKey.FONT, 'pixel', { source: 'font-pack' });
    fontSelect.value = configRegistry.get(ConfigKey.FONT);
  }

  function action(label, operation, title, disabled = false) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.title = title;
    button.setAttribute('aria-label', title);
    button.dataset.packOperation = operation;
    button.disabled = disabled;
    return button;
  }

  function render() {
    const visible = packs.filter(pack => pack.kind === kind);
    $('[data-pack-kind].active')?.classList.remove('active');
    $(`[data-pack-kind="${kind}"]`)?.classList.add('active');
    list.replaceChildren();
    if (!visible.length) {
      const empty = document.createElement('div');
      empty.className = 'packs-empty';
      empty.textContent = desktop ? `尚未加入${KIND_LABELS[kind]}` : '本機包管理只在桌面版提供';
      list.append(empty);
      return;
    }
    for (const [index, pack] of visible.entries()) {
      const row = document.createElement('div');
      row.className = 'pack-entry';
      row.dataset.packId = pack.id;
      row.draggable = true;
      const info = document.createElement('div');
      info.className = 'pack-entry-info';
      const heading = document.createElement('strong');
      heading.textContent = kind === 'language' ? `${pack.label} · ${pack.code}` : pack.name;
      const details = document.createElement('small');
      details.textContent = `${pack.filename} · v${pack.version}`;
      info.append(heading, details);
      const actions = document.createElement('div');
      actions.className = 'pack-entry-actions';
      actions.append(action('↑', 'up', '上移', index === 0), action('↓', 'down', '下移', index === visible.length - 1));
      if (pack.hotReload) actions.append(action('↻', 'reload', '熱重載'));
      actions.append(action('×', 'remove', '移除'));
      row.append(info, actions);
      list.append(row);
    }
  }

  async function refresh({ shapes = false } = {}) {
    if (!desktop?.listResourcePacks) {
      packs = [];
      render();
      updateFontSelect();
      return;
    }
    const result = await desktop.listResourcePacks();
    packs = result.packs;
    fontSourceCache.clear();
    errors.textContent = result.errors.join('\n');
    errors.hidden = !result.errors.length;
    replaceLanguagePacks(packs.filter(pack => pack.kind === 'language'));
    updateFontSelect();
    await applyFont();
    if (shapes) await reloadShapePacks();
    render();
  }

  async function runOperation(pack, operation) {
    if (operation === 'remove') {
      if (!await showAppConfirm(`移除「${pack.name}」？`, { title: '移除資源包',
        detail: '包會移到工作空間的 removed-packs，可以手動找回。', buttons: ['移除', '取消'] })) return;
      await desktop.removeResourcePack(pack.id);
      await refresh({ shapes: pack.kind === 'shape' });
      toast('資源包已移除');
      return;
    }
    if (operation === 'reload') {
      await refresh({ shapes: pack.kind === 'shape' });
      toast('資源包已重新載入');
      return;
    }
    const visible = packs.filter(item => item.kind === pack.kind);
    const at = visible.findIndex(item => item.id === pack.id);
    const other = visible[at + (operation === 'up' ? -1 : 1)];
    if (!other) return;
    const first = packs.findIndex(item => item.id === pack.id);
    const second = packs.findIndex(item => item.id === other.id);
    [packs[first], packs[second]] = [packs[second], packs[first]];
    await desktop.orderResourcePacks(packs.map(item => item.id));
    await refresh({ shapes: pack.kind === 'shape' });
  }

  async function movePack(sourceId, targetId, after = false) {
    const source = packs.find(item => item.id === sourceId);
    const target = packs.find(item => item.id === targetId);
    if (!source || !target || source.id === target.id || source.kind !== target.kind) return;
    const from = packs.findIndex(item => item.id === sourceId);
    packs.splice(from, 1);
    const destination = packs.findIndex(item => item.id === targetId);
    packs.splice(destination + (after ? 1 : 0), 0, source);
    await desktop.orderResourcePacks(packs.map(item => item.id));
    await refresh({ shapes: source.kind === 'shape' });
  }

  function bind() {
    $('#openPacksButton').addEventListener('click', () => {
      dialog.showModal();
      void refresh().catch(error => toast(`資源包讀取失敗：${error.message}`));
    });
    $('#closePacksButton').addEventListener('click', () => dialog.close());
    $('#refreshPacksButton').addEventListener('click', () => {
      void refresh({ shapes: true }).catch(error => toast(`資源包讀取失敗：${error.message}`));
    });
    $('#installPackButton').disabled = !desktop?.installResourcePack;
    $('#installPackButton').addEventListener('click', async () => {
      try {
        const installed = await desktop.installResourcePack(kind);
        if (installed) { await refresh({ shapes: kind === 'shape' }); toast('資源包已加入'); }
      } catch (error) { toast(`加入失敗：${error.message}`); }
    });
    dialog.querySelectorAll('[data-pack-kind]').forEach(button => button.addEventListener('click', () => {
      kind = button.dataset.packKind;
      render();
    }));
    list.addEventListener('click', event => {
      const button = event.target.closest('[data-pack-operation]');
      const pack = packs.find(entry => entry.id === button?.closest('[data-pack-id]')?.dataset.packId);
      if (pack) void runOperation(pack, button.dataset.packOperation)
        .catch(error => toast(`資源包操作失敗：${error.message}`));
    });
    list.addEventListener('dragstart', event => {
      const row = event.target.closest('[data-pack-id]');
      draggedPackId = row?.dataset.packId || null;
      if (draggedPackId) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', draggedPackId);
      }
    });
    list.addEventListener('dragover', event => {
      const row = event.target.closest('[data-pack-id]');
      if (!row || !draggedPackId) return;
      const dragged = packs.find(entry => entry.id === draggedPackId);
      const target = packs.find(entry => entry.id === row.dataset.packId);
      if (dragged?.kind !== target?.kind) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    });
    list.addEventListener('drop', event => {
      const row = event.target.closest('[data-pack-id]');
      if (!row || !draggedPackId) return;
      event.preventDefault();
      const after = event.clientY > row.getBoundingClientRect().top + row.clientHeight / 2;
      void movePack(draggedPackId, row.dataset.packId, after)
        .catch(error => toast(`資源包排序失敗：${error.message}`));
      draggedPackId = null;
    });
    list.addEventListener('dragend', () => { draggedPackId = null; });
    fontSelect.addEventListener('change', () => configRegistry.set(ConfigKey.FONT, fontSelect.value, { source: 'font-setting' }));
    configRegistry.subscribe(ConfigKey.FONT, () => { fontSelect.value = configRegistry.get(ConfigKey.FONT); void applyFont(); });
    configRegistry.subscribe(ConfigKey.LANGUAGE, () => { void applyFont(); });
    window.addEventListener('cubebricks:workspace-change', () => { void refresh().catch(error => toast(error.message)); });
  }

  bind();
  return { refresh };
}
