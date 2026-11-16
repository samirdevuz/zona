/**
 * Deterministic trigonometry built only from + - * / and Math.round/abs.
 * Math.sin/cos/atan2 are not guaranteed to be bit-identical across JS engines,
 * and the shared simulation must produce identical results on the server (V8)
 * and every client browser (V8, SpiderMonkey) for prediction to replay exactly.
 */
export const PI = 3.141592653589793;
export const TWO_PI = 6.283185307179586;
export const HALF_PI = 1.5707963267948966;
export const DEG2RAD = PI / 180;
export const RAD2DEG = 180 / PI;

/** Wrap an angle into [-PI, PI]. */
export function wrapAngle(a: number): number {
  return a - TWO_PI * Math.round(a / TWO_PI);
}

function sinPoly(x: number): number {
  // Taylor series up to x^15 on [-PI/2, PI/2]; max error ~1e-12.
  const x2 = x * x;
  return (
    x *
    (1 +
      x2 *
        (-1 / 6 +
          x2 *
            (1 / 120 +
              x2 * (-1 / 5040 + x2 * (1 / 362880 + x2 * (-1 / 39916800 + x2 * (1 / 6227020800 + x2 * (-1 / 1307674368000))))))))
  );
}

export function dsin(a: number): number {
  let x = wrapAngle(a);
  if (x > HALF_PI) x = PI - x;
  else if (x < -HALF_PI) x = -PI - x;
  return sinPoly(x);
}

export function dcos(a: number): number {
  return dsin(a + HALF_PI);
}

function atanUnit(x: number): number {
  // atan on [0, 1] via reduction around tan(PI/8) and a Taylor series.
  const T8 = 0.41421356237309503; // tan(PI/8)
  let offset = 0;
  if (x > T8) {
    x = (x - 1) / (x + 1);
    offset = PI / 4;
  }
  const x2 = x * x;
  let sum = 0;
  let term = x;
  for (let k = 0; k < 14; k++) {
    sum += term / (2 * k + 1);
    term *= -x2;
  }
  return offset + sum;
}

export function datan(x: number): number {
  const ax = Math.abs(x);
  const r = ax <= 1 ? atanUnit(ax) : HALF_PI - atanUnit(1 / ax);
  return x < 0 ? -r : r;
}

export function datan2(y: number, x: number): number {
  if (x === 0) {
    if (y > 0) return HALF_PI;
    if (y < 0) return -HALF_PI;
    return 0;
  }
  const a = datan(y / x);
  if (x > 0) return a;
  return y >= 0 ? a + PI : a - PI;
}
