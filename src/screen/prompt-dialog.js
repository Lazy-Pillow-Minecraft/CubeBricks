// All application decisions use the same themed in-window prompt. Native file
// pickers remain native because they provide filesystem access, not UI choices.
export function showAppChoice({ title = 'CubeBricks', message = '', detail = '',
  buttons = ['確認', '取消'], defaultIndex = 0, cancelIndex = buttons.length - 1,
  checkboxLabel = '', checkboxChecked = false } = {}) {
  return new Promise(resolve => {
    const dialog = document.createElement('dialog');
    dialog.className = 'theme-dialog app-prompt-dialog';
    const shell = document.createElement('div');
    shell.className = 'app-prompt-shell';
    const heading = document.createElement('div');
    heading.className = 'dialog-heading app-prompt-heading';
    const titleNode = document.createElement('h2');
    titleNode.textContent = title;
    heading.append(titleNode);
    const messageNode = document.createElement('strong');
    messageNode.className = 'app-prompt-message';
    messageNode.textContent = message;
    shell.append(heading, messageNode);
    if (detail) {
      const detailNode = document.createElement('p');
      detailNode.textContent = detail;
      shell.append(detailNode);
    }
    let checkbox = null;
    if (checkboxLabel) {
      const label = document.createElement('label');
      label.className = 'config-toggle-label app-prompt-check';
      const text = document.createElement('span');
      text.textContent = checkboxLabel;
      checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = checkboxChecked;
      label.append(text, checkbox);
      shell.append(label);
    }
    const actions = document.createElement('div');
    actions.className = 'dialog-actions app-prompt-actions';
    buttons.forEach((label, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      if (index === defaultIndex) button.className = 'primary-button';
      button.addEventListener('click', () => dialog.close(String(index)));
      actions.append(button);
    });
    shell.append(actions);
    dialog.append(shell);
    document.body.append(dialog);
    dialog.addEventListener('close', () => {
      const index = /^\d+$/.test(dialog.returnValue) ? Number(dialog.returnValue) : cancelIndex;
      const checked = checkbox?.checked ?? false;
      dialog.remove();
      resolve({ index, checked });
    }, { once: true });
    heading.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      const bounds = dialog.getBoundingClientRect();
      const startX = event.clientX, startY = event.clientY;
      heading.setPointerCapture(event.pointerId);
      dialog.style.position = 'fixed';
      dialog.style.margin = '0';
      dialog.style.left = `${bounds.left}px`;
      dialog.style.top = `${bounds.top}px`;
      const move = next => {
        const left = Math.max(0, Math.min(window.innerWidth - Math.min(bounds.width, 80), bounds.left + next.clientX - startX));
        const top = Math.max(0, Math.min(window.innerHeight - Math.min(bounds.height, 42), bounds.top + next.clientY - startY));
        dialog.style.left = `${left}px`;
        dialog.style.top = `${top}px`;
      };
      const stop = () => {
        heading.removeEventListener('pointermove', move);
        heading.removeEventListener('pointerup', stop);
        heading.removeEventListener('pointercancel', stop);
      };
      heading.addEventListener('pointermove', move);
      heading.addEventListener('pointerup', stop);
      heading.addEventListener('pointercancel', stop);
    });
    dialog.showModal();
  });
}

export async function showAppConfirm(message, options = {}) {
  const result = await showAppChoice({ message, ...options });
  return result.index === 0;
}
