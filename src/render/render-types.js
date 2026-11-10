// Minecraft-like pass order: opaque geometry writes depth first, then overlays.
// Cutout/translucent passes are reserved here so textures can join the same pipeline.
export const RenderPass = Object.freeze({
  SOLID: 'solid',
  CUTOUT: 'cutout',
  TRANSLUCENT: 'translucent'
});

export const MinecraftRenderType = Object.freeze({
  SOLID: 'solid',
  SOLID_SMOOTH: 'solid_smooth',
  CUTOUT: 'cutout',
  CUTOUT_SMOOTH: 'cutout_smooth',
  TRANSLUCENT: 'translucent',
  TRANSLUCENT_SMOOTH: 'translucent_smooth'
});

const MINECRAFT_RENDER_TYPES = Object.freeze({
  // `smooth` means a supersampled screen resolve. It must never change how
  // the model texture itself is sampled; Minecraft pixel art stays NEAREST.
  [MinecraftRenderType.SOLID]: { pass: RenderPass.SOLID, smooth: false, alphaMode: 0, blend: false, cull: true, depthWrite: true },
  [MinecraftRenderType.SOLID_SMOOTH]: { pass: RenderPass.SOLID, smooth: true, alphaMode: 0, blend: false, cull: true, depthWrite: true },
  [MinecraftRenderType.CUTOUT]: { pass: RenderPass.CUTOUT, smooth: false, alphaMode: 1, blend: false, cull: true, depthWrite: true },
  [MinecraftRenderType.CUTOUT_SMOOTH]: { pass: RenderPass.CUTOUT, smooth: true, alphaMode: 1, blend: false, cull: true, depthWrite: true },
  [MinecraftRenderType.TRANSLUCENT]: { pass: RenderPass.TRANSLUCENT, smooth: false, alphaMode: 2, blend: true, cull: false, depthWrite: true },
  [MinecraftRenderType.TRANSLUCENT_SMOOTH]: { pass: RenderPass.TRANSLUCENT, smooth: true, alphaMode: 2, blend: true, cull: false, depthWrite: true }
});

export function getMinecraftRenderType(id) {
  return MINECRAFT_RENDER_TYPES[id] || MINECRAFT_RENDER_TYPES[MinecraftRenderType.CUTOUT];
}

export function getSurfaceRenderMode(mode) {
  return mode === 'textured' ? 2 : mode === 'normal' ? 4 : 1;
}
