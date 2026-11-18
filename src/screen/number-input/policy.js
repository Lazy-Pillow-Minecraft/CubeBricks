const positive = (value, fallback) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback;
const tidy = value => Number(Number(value).toPrecision(12));
const declaredStep = input => input.dataset.numericStep ?? input.getAttribute('step');

export function numericKind(input) {
  const data = input.dataset;
  const vector = data.vector ?? data.modifierVector ?? data.operatorVector;
  if (vector) return /(?:^|[.:])rotation$/.test(vector) ? 'angle' : 'distance';
  if (data.curveNodeRoll !== undefined || /rangeStart|rangeEnd/.test(data.modifierField ?? data.operatorField ?? '')) return 'angle';
  if (data.uvCoordinate !== undefined || data.curveNodeRadius !== undefined || data.field === 'inflate') return 'distance';
  if (data.parameter !== undefined) {
    if (/angle|roll/i.test(data.parameter)) return 'angle';
    if (input.previousElementSibling?.tagName === 'B') return 'distance';
    // Discrete shape parameters (edge counts etc.) retain their declared step.
    return Number(declaredStep(input)) === 1 ? 'local' : 'distance';
  }
  if (input.closest('.precise-rotation-input')) return 'angle';
  return 'local';
}

export function numericStep(input, event, { getSnapStep, getAngleSnapStep }) {
  const kind = numericKind(input);
  if (kind === 'angle') return positive(getAngleSnapStep(event), 1);
  if (kind === 'distance') return positive(getSnapStep(event), 1);
  const base = positive(declaredStep(input), 1);
  // Counts, pixels and percentage integers must stay integral. Other fields
  // keep their own units while using the same configured fine/coarse modifiers.
  const ratio = positive(getSnapStep(event), 1) / positive(getSnapStep({}), 1);
  return base >= 1 && Number.isInteger(base) ? Math.max(1, Math.round(base * ratio)) : positive(base * ratio, base);
}

export function numericBounds(input) {
  const bound = (name, fallback) => {
    const raw = input.getAttribute(name) ?? input.getAttribute(`data-${name}`);
    return raw !== null && raw !== '' && Number.isFinite(Number(raw)) ? Number(raw) : fallback;
  };
  return { min: bound('min', -Infinity), max: bound('max', Infinity) };
}

// Move to the next grid point, including off-grid and negative starting values.
export function incrementNumber(value, ticks, step, { min = -Infinity, max = Infinity } = {}) {
  if (!ticks) return value;
  const current = Number.isFinite(value) ? value : 0;
  const grid = current / step;
  const next = ticks > 0 ? Math.floor(grid + 1e-9) + ticks : Math.ceil(grid - 1e-9) + ticks;
  return tidy(Math.max(min, Math.min(max, next * step)));
}

export function nextSelectIndex(options, currentIndex, direction) {
  for (let index = currentIndex + direction; index >= 0 && index < options.length; index += direction) {
    const option = options[index];
    if (!option.disabled && !option.hidden && !option.parentElement?.disabled && !option.parentElement?.hidden) return index;
  }
  return currentIndex;
}
