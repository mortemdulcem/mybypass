import type { Point3D, VolumeData } from "./types";

export function vecSub(a: number[], b: number[]): number[] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function vecCross(a: number[], b: number[]): number[] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function vecDot(a: number[], b: number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function vecNorm(a: number[]): number[] {
  const n = Math.hypot(a[0], a[1], a[2]) || 1e-9;
  return [a[0] / n, a[1] / n, a[2] / n];
}

export function matFromRodrigues(axis: number[], angle: number): number[][] {
  const [x, y, z] = axis;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  return [
    [t * x * x + c, t * x * y - s * z, t * x * z + s * y],
    [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
    [t * x * z - s * y, t * y * z + s * x, t * z * z + c],
  ];
}

export function matTranspose(M: number[][]): number[][] {
  return [
    [M[0][0], M[1][0], M[2][0]],
    [M[0][1], M[1][1], M[2][1]],
    [M[0][2], M[1][2], M[2][2]],
  ];
}

export function matVec(M: number[][], v: number[]): number[] {
  return [
    M[0][0] * v[0] + M[0][1] * v[1] + M[0][2] * v[2],
    M[1][0] * v[0] + M[1][1] * v[1] + M[1][2] * v[2],
    M[2][0] * v[0] + M[2][1] * v[1] + M[2][2] * v[2],
  ];
}

export function toPhys(p: Point3D, px: number, sl: number): number[] {
  return [p.x * px, p.y * px, p.z * sl];
}

export function computeAlignRotation(
  poR: Point3D,
  poL: Point3D,
  orL: Point3D,
  px: number,
  sl: number
): { R: number[][]; pivot: number[] } {
  const A = toPhys(poR, px, sl);
  const B = toPhys(poL, px, sl);
  const C = toPhys(orL, px, sl);

  let n = vecNorm(vecCross(vecSub(B, A), vecSub(C, A)));
  const target = [0, 0, 1];
  if (vecDot(n, target) < 0) {
    n = [-n[0], -n[1], -n[2]];
  }

  let axis = vecCross(n, target);
  const axisLen = Math.hypot(axis[0], axis[1], axis[2]);
  let R: number[][];
  if (axisLen < 1e-6) {
    R = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
  } else {
    axis = [axis[0] / axisLen, axis[1] / axisLen, axis[2] / axisLen];
    const angle = Math.acos(Math.max(-1, Math.min(1, vecDot(n, target))));
    R = matFromRodrigues(axis, angle);
  }
  const pivot = [
    (A[0] + B[0] + C[0]) / 3,
    (A[1] + B[1] + C[1]) / 3,
    (A[2] + B[2] + C[2]) / 3,
  ];
  return { R, pivot };
}

export function resampleVolumeFrankfort(
  vol: VolumeData,
  R: number[][],
  pivot: number[]
): {
  newData: Uint8Array;
  transformPoint: (p: Point3D) => Point3D;
} {
  const Rt = matTranspose(R);
  const { w, h, z, data, px, sl } = vol;
  const out = new Uint8Array(w * h * z);

  for (let zz = 0; zz < z; zz++) {
    const relZ = zz * sl - pivot[2];
    for (let yy = 0; yy < h; yy++) {
      const relY = yy * px - pivot[1];
      for (let xx = 0; xx < w; xx++) {
        const relX = xx * px - pivot[0];
        const orig = matVec(Rt, [relX, relY, relZ]);
        const ox = Math.round((orig[0] + pivot[0]) / px);
        const oy = Math.round((orig[1] + pivot[1]) / px);
        const oz = Math.round((orig[2] + pivot[2]) / sl);
        let val = 0;
        if (ox >= 0 && ox < w && oy >= 0 && oy < h && oz >= 0 && oz < z) {
          val = data[oz * h * w + oy * w + ox];
        }
        out[zz * h * w + yy * w + xx] = val;
      }
    }
  }

  const transformPoint = (p: Point3D): Point3D => {
    const rel = vecSub(toPhys(p, px, sl), pivot);
    const newRel = matVec(R, rel);
    return {
      x: Math.max(0, Math.min(w - 1, Math.round((newRel[0] + pivot[0]) / px))),
      y: Math.max(0, Math.min(h - 1, Math.round((newRel[1] + pivot[1]) / px))),
      z: Math.max(0, Math.min(z - 1, Math.round((newRel[2] + pivot[2]) / sl))),
    };
  };

  return { newData: out, transformPoint };
}
