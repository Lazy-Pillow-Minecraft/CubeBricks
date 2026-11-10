export function bindTextureCreateDialogEvents({
  $, textureInput, openTextureCreateDialog, updateTextureCreateDialog,
  createTextureTemplate, createSimpleTexture
}) {
  $('[data-action="addTexture"]').addEventListener('click', () => textureInput.click());
  $('[data-action="createTexture"]').addEventListener('click', openTextureCreateDialog);
  $('#textureCreateType').addEventListener('change', updateTextureCreateDialog);
  $('#textureTemplatePowerOfTwo').addEventListener('change', updateTextureCreateDialog);
  $('#textureTemplatePaddingEnabled').addEventListener('change', updateTextureCreateDialog);
  $('[data-action="cancelTextureCreate"]').addEventListener('click', () => $('#textureCreateDialog').close());
  $('#textureCreateDialog').addEventListener('click', event => {
    if (event.target === event.currentTarget) event.currentTarget.close();
  });
  $('#textureCreateDialog .close-button').addEventListener('click', event => {
    event.preventDefault();
    $('#textureCreateDialog').close();
  });
  $('#textureCreateForm').addEventListener('submit', async event => {
    event.preventDefault();
    const type = $('#textureCreateType').value;
    const name = $('#textureCreateName').value.trim() || 'texture.png';
    // Read every form control before closing its method="dialog" parent.
    // The chosen UV reuse mode must be fixed for this generation pass.
    const templateOptions = type === 'template' ? {
      name,
      selectedOnly: $('#textureTemplateSelectedOnly').checked,
      cleanInvalidFaces: $('#textureTemplateCleanInvalid').checked,
      boxUv: $('#textureTemplateBoxUv').checked,
      powerOfTwo: $('#textureTemplatePowerOfTwo').checked,
      keepMultiTexture: $('#textureTemplateKeepMulti').checked,
      keepLayers: $('#textureTemplateKeepLayers').checked,
      paddingEnabled: $('#textureTemplatePaddingEnabled').checked,
      padding: Number($('#textureTemplatePadding').value) || 0,
      multiple: Number($('#textureTemplateMultiple').value) || 4
    } : null;
    const basicOptions = type !== 'template' ? {
      type, name,
      width: Number($('#textureCreateWidth').value) || 1,
      height: Number($('#textureCreateHeight').value) || 1,
      color: $('#textureCreateColor').value
    } : null;
    $('#textureCreateDialog').close();
    if (templateOptions) await createTextureTemplate(templateOptions);
    else createSimpleTexture(basicOptions);
  });
}
