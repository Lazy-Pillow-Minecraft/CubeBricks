// One screen-space tile supplies every marching-ants edge. Geometry only
// determines where the tile is visible; it never restarts the stripe phase.
export const SELECTION_STRIPE_SIZE = 8;

function buildSelectionStripePixels() {
  const pixels = new Uint8Array(SELECTION_STRIPE_SIZE * SELECTION_STRIPE_SIZE * 4);
  for (let y = 0; y < SELECTION_STRIPE_SIZE; y++) for (let x = 0; x < SELECTION_STRIPE_SIZE; x++) {
    const value = (x + y) % SELECTION_STRIPE_SIZE < SELECTION_STRIPE_SIZE / 2 ? 255 : 0;
    const offset = (y * SELECTION_STRIPE_SIZE + x) * 4;
    pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = value;
    pixels[offset + 3] = 255;
  }
  return pixels;
}

export const SELECTION_STRIPE_PIXELS = buildSelectionStripePixels();

export function selectionStripePhase(now = performance.now()) {
  return Math.floor(now / 140) % SELECTION_STRIPE_SIZE;
}
