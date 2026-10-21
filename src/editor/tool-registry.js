export const TOOL_REGISTRY = Object.freeze({
  move: { modes: ['edit', 'animate'] },
  resize: { modes: ['edit', 'animate'] },
  rotate: { modes: ['edit', 'animate'] },
  pivot: { modes: ['edit'] },
  vertexSnap: { modes: ['edit'] },
  knife: { modes: ['edit'] },
  faceSelect: { modes: ['edit', 'uv'] },
  brush: { modes: ['paint'] },
  paintSelection: { modes: ['paint'] },
  line: { modes: ['paint'] },
  rectangle: { modes: ['paint'] },
  ellipse: { modes: ['paint'] },
  fill: { modes: ['paint'] },
  gradient: { modes: ['paint'] },
  eyedropper: { modes: ['paint'] }
});
export const PAINT_TOOLS = Object.freeze(['brush', 'line', 'rectangle', 'ellipse', 'fill', 'gradient', 'eyedropper']);
export const PAINT_STROKE_TOOLS = Object.freeze(['brush', 'line', 'rectangle', 'ellipse']);
export const PAINT_SHAPE_TOOLS = Object.freeze(['line', 'rectangle', 'ellipse']);
export const PAINT_ERASE_TOOLS = Object.freeze(['brush', 'line', 'rectangle', 'ellipse', 'fill']);
