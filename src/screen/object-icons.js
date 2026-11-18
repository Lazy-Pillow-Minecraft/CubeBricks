// One asset mapping for built-in creation menus and scene hierarchy entries.
const ASSETS = Object.freeze({ cube: 'cube', shape: 'shape', polygon_prism: 'polygon-prism',
  dodecahedron: 'dodecahedron', truncated_icosahedron: 'soccer-ball', bezier2d: 'bezier2d', bezier3d: 'bezier3d',
  'bezier2d-envelope': 'bezier2d-envelope', 'bezier3d-envelope': 'bezier3d-envelope' });

export function objectIconAsset(type, variant = null, fallback = 'shape') {
  const key = variant === 'envelope' ? `${type}-envelope` : type;
  return ASSETS[key] || ASSETS[fallback] || 'shape';
}

export function objectAssetMarkup(type, variant = null, className = 'object-icon', fallback = 'shape') {
  return `<span class="ui-mask-icon ${className}" style="--ui-icon:url(assets/ui-icons/${objectIconAsset(type, variant, fallback)}.svg)" aria-hidden="true"></span>`;
}

export function syncCreationIcons(menu) {
  for (const button of menu?.querySelectorAll('[data-create-shape]') || []) {
    if (button.dataset.externalShape) continue;
    button.style.setProperty('--ui-icon', `url(assets/ui-icons/${objectIconAsset(button.dataset.createShape)}.svg)`);
  }
}
