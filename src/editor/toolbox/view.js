const icon = (name, axis = '', clockwise = false) => `<i class="ui-mask-icon ${axis ? `axis-${axis}` : ''} ${clockwise ? 'toolbox-clockwise' : ''}" style="--ui-icon:url(assets/ui-icons/${name}.svg)" aria-hidden="true"></i>`;
const categories = [['scale', 'scale-uniform'], ['flip', 'symmetry'], ['rotate', 'rotate'], ['center', 'center']];
const picker = (id, items) => `<div class="toolbox-picker"><button type="button" class="toolbox-select" data-toolbox-picker="${id}" aria-haspopup="menu" aria-expanded="false"><span data-toolbox-label="${id}"></span><b aria-hidden="true">⌄</b></button><div class="paint-tool-menu" data-toolbox-menu="${id}" role="menu" hidden>${items.map(([value, label, asset]) => `<button type="button" data-toolbox-choice="${id}" data-value="${value}" role="menuitem">${asset ? icon(asset) : ''}<span>${label}</span></button>`).join('')}</div></div>`;
const button = (action, axis, asset, options = '') => `<button type="button" class="toolbox-action" data-toolbox-action="${action}" data-axis="${axis}" ${options}>${icon(asset, axis === 'all' ? '' : axis)}</button>`;

export function toolboxMarkup() {
  return `${picker('category', categories.map(([value, asset]) => [value, `ui.toolbox-${value}`, asset]))}
  <div class="toolbox-category" data-toolbox-category="scale">${picker('snap', [['bounds', 'ui.toolbox-snap-bounds'], ['elements', 'ui.toolbox-snap-elements'], ['none', 'ui.toolbox-snap-none']])}</div>
  <div class="toolbox-category" data-toolbox-category="flip" hidden>
    <span class="toolbox-caption">ui.toolbox-origin</span>${['x', 'y', 'z'].map(axis => button('flip', axis, `symmetry-${axis}`, `data-base="origin" title="ui.toolbox-flip-origin-${axis}"`)).join('')}
    <span class="toolbox-caption">ui.toolbox-pivot</span>${['x', 'y', 'z'].map(axis => button('flip', axis, `symmetry-${axis}`, `data-base="pivot" title="ui.toolbox-flip-pivot-${axis}"`)).join('')}
    <label class="toolbox-check" title="ui.toolbox-flip-names-help"><input type="checkbox" data-toolbox-rename-directions checked /><span>ui.toolbox-flip-names</span></label>
  </div>
  <div class="toolbox-category" data-toolbox-category="rotate" hidden>${['origin', 'pivot'].map(base => `
    <span class="toolbox-caption">ui.toolbox-${base}</span>${['x', 'y', 'z'].map(axis => [90, -90].map(angle => `
      <button type="button" class="toolbox-action" data-toolbox-action="rotate" data-base="${base}" data-axis="${axis}" data-angle="${angle}" title="ui.toolbox-rotate-${base}-${axis}-${angle > 0 ? 'positive' : 'negative'}">${icon('rotate-ccw-90', axis, angle < 0)}</button>`).join('')).join('')}`).join('')}</div>
  <div class="toolbox-category" data-toolbox-category="center" hidden>${picker('centerBase', [['geometry', 'ui.toolbox-center-geometry'], ['pivot', 'ui.toolbox-center-pivot']])}
    ${['x', 'y', 'z', 'all'].map(axis => button('center', axis, axis === 'all' ? 'center' : `center-${axis}`, `title="ui.toolbox-center-${axis}"`)).join('')}
  </div>`;
}
