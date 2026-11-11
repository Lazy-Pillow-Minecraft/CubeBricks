// Humanoid armor layers reuse the player equipment textures. They add no
// independent skin-painting target; animal and other armor remain selectable.
export function isSharedHumanoidArmor(record) {
  if (!/\.(?:armor(?:\.leggings)?|leggings)$/i.test(record?.variant || '')) return false;
  return (record.textures || []).some(texture => {
    const id = String(texture.id || '');
    return /\/equipment\/humanoid(?:_baby|_leggings)?\//.test(id)
      || /^textures\/models\/armor\/iron_(?:1|2|baby)$/.test(id);
  });
}
