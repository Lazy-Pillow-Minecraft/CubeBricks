export function createExternalFileDropHandler({
  $, projectTabsController, referenceImages,
  openProject, loadProjectFile, importTexture, loadReferenceImageFiles, toast
}) {
  const droppedFileExtension = file => String(file.name || '').split('.').at(-1)?.toLowerCase() || '';
  async function isPngFile(file) {
    const header = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    return header.length === 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => header[index] === byte);
  }
  function choosePngDestination(file) {
    const dialog = $('#droppedPngDialog');
    $('#droppedPngName').textContent = file.name;
    dialog.returnValue = 'cancel';
    return new Promise(resolve => {
      dialog.addEventListener('close', () => resolve(dialog.returnValue), { once: true });
      dialog.showModal();
    });
  }
  async function handleExternalFiles(files) {
    for (const file of files) {
      const extension = droppedFileExtension(file);
      if (['cbmodel', 'bbmodel', 'json', 'java'].includes(extension)) {
        if (window.cubeBricksDesktop?.getPathForFile) {
          const filePath = window.cubeBricksDesktop.getPathForFile(file);
          if (!filePath) throw new Error(`無法取得 ${file.name} 的本機路徑`);
          await openProject(filePath);
        } else if (extension !== 'cbmodel') await loadProjectFile(file);
        else toast('.cbmodel 需要在桌面版打開');
        continue;
      }
      const isReference = file.type?.startsWith('image/')
        || ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif'].includes(extension);
      if (!isReference) {
        toast(`不支援拖入 ${file.name}`);
        continue;
      }
      if (!projectTabsController.activeId) {
        toast('請先打開或建立項目，再導入圖片');
        continue;
      }
      const isPng = extension === 'png' && await isPngFile(file);
      const choice = isPng ? await choosePngDestination(file) : 'reference';
      if (choice === 'texture') importTexture(file);
      else if (choice === 'reference') await loadReferenceImageFiles([file], referenceImages.referenceViewKey());
    }
  }

  return handleExternalFiles;
}
