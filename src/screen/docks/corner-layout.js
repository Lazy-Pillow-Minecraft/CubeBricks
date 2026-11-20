const MODES = new Set(['edit', 'uv', 'paint', 'animate', 'display']);
const SIDES = ['left', 'right'];

// A true corner gives the bottom dock that end of the workspace. Missing
// preferences keep side docks full height, except in the animation workspace.
export function normalizeDockCorners(value) {
  const result = {};
  for (const mode of MODES) {
    const entry = value?.[mode];
    if (!entry || typeof entry !== 'object') continue;
    const sides = Object.fromEntries(SIDES.filter(side => typeof entry[side] === 'boolean')
      .map(side => [side, entry[side]]));
    if (Object.keys(sides).length) result[mode] = sides;
  }
  return result;
}

export class DockCornerLayout {
  constructor({ root, controls = [], saved, onChange = () => {} }) {
    this.root = root;
    this.controls = [...controls];
    this.preferences = normalizeDockCorners(saved);
    this.onChange = onChange;
    this.mode = 'edit';
    for (const button of this.controls) button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      this.toggle(button.dataset.dockCorner);
    });
    this.apply();
  }

  get current() {
    const bottom = this.mode === 'animate';
    return { left: bottom, right: bottom, ...this.preferences[this.mode] };
  }

  setMode(mode) {
    this.mode = MODES.has(mode) ? mode : 'edit';
    this.apply();
  }

  restore(saved) {
    this.preferences = normalizeDockCorners(saved);
    this.apply();
  }

  serialize() {
    return normalizeDockCorners(this.preferences);
  }

  toggle(side) {
    if (!SIDES.includes(side)) return;
    const current = this.current;
    this.preferences[this.mode] = { ...current, [side]: !current[side] };
    this.apply();
    this.onChange();
  }

  apply() {
    const current = this.current;
    this.root.dataset.dockBottomLeft = String(current.left);
    this.root.dataset.dockBottomRight = String(current.right);
    for (const button of this.controls) {
      const side = button.dataset.dockCorner;
      const priority = current[side] ? 'bottom' : 'side';
      button.dataset.priority = priority;
      button.setAttribute('aria-pressed', String(Boolean(current[side])));
      const title = `ui.dock-corner-${side}-${priority}`;
      button.title = title;
      button.setAttribute('aria-label', title);
    }
  }
}
