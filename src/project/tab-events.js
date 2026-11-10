export function bindProjectTabEvents({
  $, $$, projectTabsNode, projectTabsController, projectInfoDialog,
  activateProjectTab, closeProjectTab, openProjectInfo, applyProjectInfo,
  projectTabInsertionIndex, previewProjectTabInsertion, moveProjectTabToIndex
}) {
  projectTabsNode.addEventListener('click', event => {
    const close = event.target.closest('[data-close-project-tab]');
    if (close) {
      event.stopPropagation();
      closeProjectTab(close.dataset.closeProjectTab);
      return;
    }
    const tab = event.target.closest('[data-project-tab]');
    if (tab) activateProjectTab(tab.dataset.projectTab);
  });
  projectTabsNode.addEventListener('auxclick', event => {
    if (event.button !== 1) return;
    const tab = event.target.closest('[data-project-tab]');
    if (!tab) return;
    event.preventDefault();
    closeProjectTab(tab.dataset.projectTab);
  });
  projectTabsNode.addEventListener('contextmenu', event => {
    const tab = event.target.closest('[data-project-tab]');
    if (!tab) return;
    event.preventDefault();
    event.stopPropagation();
    openProjectInfo(tab.dataset.projectTab);
  });
  projectTabsNode.addEventListener('keydown', event => {
    const tab = event.target.closest('[data-project-tab]');
    if (tab && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      activateProjectTab(tab.dataset.projectTab);
    }
  });
  projectTabsNode.addEventListener('dragstart', event => {
    const tab = event.target.closest('[data-project-tab]');
    if (!tab || event.target.closest('[data-close-project-tab]')) {
      event.preventDefault();
      return;
    }
    projectTabsController.draggingTabId = tab.dataset.projectTab;
    projectTabsController.draggingInsertIndex = projectTabInsertionIndex(event.clientX, projectTabsController.draggingTabId);
    tab.classList.add('is-dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/x-cubebricks-project-tab', projectTabsController.draggingTabId);
  });
  projectTabsNode.addEventListener('dragover', event => {
    if (!projectTabsController.draggingTabId) return;
    event.preventDefault();
    projectTabsController.draggingInsertIndex = projectTabInsertionIndex(event.clientX);
    previewProjectTabInsertion(projectTabsController.draggingInsertIndex);
  });
  projectTabsNode.addEventListener('drop', event => {
    if (!projectTabsController.draggingTabId) return;
    event.preventDefault();
    projectTabsController.draggingInsertIndex = projectTabInsertionIndex(event.clientX);
    moveProjectTabToIndex(projectTabsController.draggingTabId, projectTabsController.draggingInsertIndex);
    projectTabsController.draggingTabId = null;
    projectTabsController.draggingInsertIndex = null;
  });
  projectTabsNode.addEventListener('dragend', event => {
    if (projectTabsController.draggingTabId) {
      moveProjectTabToIndex(projectTabsController.draggingTabId, projectTabInsertionIndex(event.clientX));
    }
    projectTabsController.draggingTabId = null;
    projectTabsController.draggingInsertIndex = null;
    projectTabsNode.querySelectorAll('.is-dragging,.drop-before,.drop-after').forEach(node => node.classList.remove('is-dragging', 'drop-before', 'drop-after'));
  });
  $('#newProjectTab').addEventListener('click', () => projectTabsController.addHomeTab());
  $('#projectInfoForm').addEventListener('submit', event => {
    event.preventDefault();
    applyProjectInfo();
  });
  $$('[data-action="closeProjectInfo"]').forEach(button => button.addEventListener('click', () => {
    projectInfoDialog.close();
    projectTabsController.editingTabId = null;
  }));
}
