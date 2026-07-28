/**
 * Ridge regression, solved through the normal equations.
 *
 * The gaze model maps a 9-element feature vector to a point in the visual
 * field. Calibration gathers many frames per target, so the system is well
 * over-determined, but the features are strongly correlated (both eyes move
 * together), which makes plain least squares numerically unhappy. A small
 * ridge term keeps the fit stable.
 */
export function ridgeFit(X: number[][], y: number[], lambda = 1e-3): number[] {
  const n = X.length;
  if (n === 0) throw new Error("ridgeFit: no samples");
  const d = X[0].length;

  // A = X'X + lambda*I, b = X'y
  const A: number[][] = Array.from({ length: d }, () => new Array(d).fill(0));
  const b: number[] = new Array(d).fill(0);
  for (let k = 0; k < n; k++) {
    const row = X[k];
    for (let i = 0; i < d; i++) {
      b[i] += row[i] * y[k];
      for (let j = 0; j < d; j++) A[i][j] += row[i] * row[j];
    }
  }
  for (let i = 0; i < d; i++) A[i][i] += lambda;

  return solve(A, b);
}

/** Gaussian elimination with partial pivoting. */
export function solve(A: number[][], b: number[]): number[] {
  const d = b.length;
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < d; col++) {
    let pivot = col;
    for (let r = col + 1; r < d; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    if (Math.abs(M[pivot][col]) < 1e-12) continue; // singular column: leave at 0
    [M[col], M[pivot]] = [M[pivot], M[col]];

    const p = M[col][col];
    for (let c = col; c <= d; c++) M[col][c] /= p;
    for (let r = 0; r < d; r++) {
      if (r === col) continue;
      const f = M[r][col];
      if (f === 0) continue;
      for (let c = col; c <= d; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row) => row[d]);
}

export function predict(weights: number[], features: number[]): number {
  let sum = 0;
  for (let i = 0; i < weights.length && i < features.length; i++) {
    sum += weights[i] * features[i];
  }
  return sum;
}

/** Root-mean-square residual of a fit, in the units of y. */
export function rmsError(X: number[][], y: number[], weights: number[]): number {
  if (X.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < X.length; i++) {
    const e = predict(weights, X[i]) - y[i];
    sum += e * e;
  }
  return Math.sqrt(sum / X.length);
}
