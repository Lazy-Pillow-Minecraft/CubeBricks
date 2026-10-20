import { ConfigKey, configRegistry } from '../common/config/app-config.js';
import { DEFAULT_PLAYER_REFERENCE_TEXTURE } from '../assets/player-reference.js';

export function createPlayerReferenceController({
  $, sceneRenderer, playerReferenceProject, renderScene, toast
}) {
let playerReferenceTextureRevision = 0;
function updatePlayerReferenceTexture(setting = configRegistry.get(ConfigKey.PLAYER_REFERENCE_TEXTURE)) {
  const customSource = typeof setting?.source === 'string' ? setting.source : '';
  const source = customSource || DEFAULT_PLAYER_REFERENCE_TEXTURE;
  const name = customSource ? (setting.name || '自定義玩家紋理') : '內置玩家紋理';
  const preview = $('#playerReferenceTexturePreview');
  const label = $('#playerReferenceTextureName');
  if (preview) preview.src = source;
  if (label) label.textContent = name;
  const revision = ++playerReferenceTextureRevision;
  const image = new Image();
  image.onload = () => {
    if (revision !== playerReferenceTextureRevision) return;
    sceneRenderer.setPlayerReference(playerReferenceProject, image);
    renderScene();
  };
  image.onerror = () => {
    if (revision !== playerReferenceTextureRevision) return;
    if (!customSource) return toast('無法讀取內置玩家紋理');
    toast('無法讀取自定義玩家紋理，已回退內置紋理');
    updatePlayerReferenceTexture({ name: '內置玩家紋理', source: '' });
  };
  image.src = source;
}

function importPlayerReferenceTexture(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onerror = () => toast('無法讀取這張玩家紋理');
  reader.onload = () => {
    const image = new Image();
    image.onerror = () => toast('這個檔案不是可用的 PNG 玩家紋理');
    image.onload = () => {
      if (image.naturalWidth !== image.naturalHeight || image.naturalWidth < 64) {
        toast('玩家紋理必須是至少 64×64 的正方形圖片');
        return;
      }
      configRegistry.set(ConfigKey.PLAYER_REFERENCE_TEXTURE, {
        name: file.name || '自定義玩家紋理.png',
        source: String(reader.result)
      }, { source: 'player-reference-settings' });
      toast(`玩家參考紋理：${file.name || '已導入'}`);
    };
    image.src = String(reader.result);
  };
  reader.readAsDataURL(file);
}

return {
  updatePlayerReferenceTexture,
  importPlayerReferenceTexture,
};
}
