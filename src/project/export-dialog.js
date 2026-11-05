import { bindDialogDrag } from '../utils/dom/dialog-drag.js';
import { nativeExportKind } from '../model/formats/native-json.js';

export function chooseProjectExport(formatId) {
  const native = nativeExportKind(formatId);
  return new Promise(resolve => {
    const dialog = document.createElement('dialog'); dialog.className = 'theme-dialog project-export-dialog';
    dialog.innerHTML = `<form method="dialog"><div class="dialog-heading"><h2>导出模型</h2><button class="close-button" value="cancel" aria-label="取消">×</button></div>
      <div class="export-format-options">
        <button value="cbmodel"><strong>CubeBricks · .cbmodel</strong><small>保留可编辑工程、贴图和可选历史</small></button>
        <button value="bbmodel"><strong>Blockbench · .bbmodel</strong><small>烘焙程序化对象和贴图，内嵌图片</small></button>
        ${native ? `<button value="${native}"><strong>${native === 'java' ? 'Java · .java' : 'JSON · .json'}</strong><small>${native === 'java' ? '导出模组实体模型层，原样文件可导回' : '先保存贴图，再导出原生模型文件'}</small></button>` : ''}
      </div></form>`;
    document.body.append(dialog); bindDialogDrag(dialog, dialog.querySelector('.dialog-heading'));
    dialog.addEventListener('close', () => { const value = dialog.returnValue; dialog.remove(); resolve(['cbmodel', 'bbmodel', 'json', 'java'].includes(value) ? value : null); }, { once: true });
    dialog.showModal();
  });
}
