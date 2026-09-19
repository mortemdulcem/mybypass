/**
 * Shape-based interpolation using Chamfer Signed Distance Fields (SDF)
 * Interpolates segment masks across missing slices between user-painted key-slices.
 */
function unsignedDT(zeroMask: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e6;
  const d = new Float32Array(w * h).fill(INF);
  for (let i = 0; i < w * h; i++) {
    if (zeroMask[i]) d[i] = 0;
  }
  const D1 = 1;
  const D2 = Math.SQRT2;

  // Forward pass
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      let best = d[idx];
      if (x > 0) best = Math.min(best, d[idx - 1] + D1);
      if (y > 0) best = Math.min(best, d[idx - w] + D1);
      if (x > 0 && y > 0) best = Math.min(best, d[idx - w - 1] + D2);
      if (x < w - 1 && y > 0) best = Math.min(best, d[idx - w + 1] + D2);
      d[idx] = best;
    }
  }

  // Backward pass
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const idx = y * w + x;
      let best = d[idx];
      if (x < w - 1) best = Math.min(best, d[idx + 1] + D1);
      if (y < h - 1) best = Math.min(best, d[idx + w] + D1);
      if (x < w - 1 && y < h - 1) best = Math.min(best, d[idx + w + 1] + D2);
      if (x > 0 && y < h - 1) best = Math.min(best, d[idx + w - 1] + D2);
      d[idx] = best;
    }
  }
  return d;
}

function computeSDF(mask: Uint8Array, w: number, h: number): Float32Array {
  const inv = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) {
    inv[i] = mask[i] ? 0 : 1;
  }
  const dFg = unsignedDT(mask, w, h);
  const dBg = unsignedDT(inv, w, h);
  const sdf = new Float32Array(w * h);
  for (let i = 0; i < sdf.length; i++) {
    sdf[i] = dBg[i] - dFg[i];
  }
  return sdf;
}

export function interpolateSlices(
  keySlices: Map<number, Uint8Array>,
  w: number,
  h: number
): Map<number, Uint8Array> {
  const filled = new Map<number, Uint8Array>();
  const zs = Array.from(keySlices.keys()).sort((a, b) => a - b);
  if (zs.length === 0) return filled;
  if (zs.length === 1) {
    filled.set(zs[0], new Uint8Array(keySlices.get(zs[0])!));
    return filled;
  }

  for (let k = 0; k < zs.length - 1; k++) {
    const z1 = zs[k];
    const z2 = zs[k + 1];
    const m1 = keySlices.get(z1)!;
    const m2 = keySlices.get(z2)!;
    filled.set(z1, new Uint8Array(m1));
    filled.set(z2, new Uint8Array(m2));

    if (z2 - z1 < 2) continue;

    const s1 = computeSDF(m1, w, h);
    const s2 = computeSDF(m2, w, h);

    for (let z = z1 + 1; z < z2; z++) {
      const t = (z - z1) / (z2 - z1);
      const mask = new Uint8Array(w * h);
      for (let i = 0; i < mask.length; i++) {
        mask[i] = (1 - t) * s1[i] + t * s2[i] > 0 ? 1 : 0;
      }
      filled.set(z, mask);
    }
  }

  return filled;
}
