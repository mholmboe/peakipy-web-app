// Peak profile functions and fitting utilities

export interface DataPoint {
  x: number;
  y: number;
}

export interface PeakComponent {
  id: number;
  profile: 'gaussian' | 'lorentzian' | 'voigt';
  center: number;
  amplitude: number;
  width: number;
  /** Relative weight (0-2), normalized to sum to 1 across all components */
  weight: number;
  sigma?: number;
  gamma?: number;
}

export interface FitResult {
  fittedData: DataPoint[];
  residuals: DataPoint[];
  components: DataPoint[][];
  baseline: DataPoint[];
  baselineCorrectedData: DataPoint[]; // Experimental data after baseline subtraction
  rSquared: number;
  adjustedRSquared: number;
  rmse: number;
  chiSquared: number;
  reducedChiSquared: number;
  aic: number;
  bic: number;
  parameters: PeakComponent[];
  iterations: number;
  converged: boolean;
  /** Optimized baseline (when simultaneous optimization is enabled) */
  optimizedBaseline?: DataPoint[];
  /** Optimized baseline parameters (when simultaneous optimization is enabled) */
  baselineParams?: {
    slope?: number;
    intercept?: number;
    coeffs?: number[];
    lambda?: number;
    p?: number;
    radius?: number;
  };
}

export interface ProcessingOptions {
  xMin?: number;
  xMax?: number;
  interpolationStep?: number;
  normalize: boolean;
  /** Savitzky-Golay smoothing options */
  smoothing?: {
    enabled: boolean;
    windowLength: number;  // Must be odd, default 11
    polyOrder: number;     // Default 3
  };
  /** Outlier removal options */
  outlierRemoval?: {
    method: 'none' | 'zscore' | 'iqr';
    threshold: number;     // Default 3.0 for zscore, 1.5 for iqr
  };
}

export interface BaselineOptions {
  method: 'none' | 'linear' | 'polynomial' | 'asls' | 'rolling_ball' | 'shirley' | 'manual';
  /** Auto-determine baseline parameters (when true, manual params below are ignored) */
  autoBaseline?: boolean;
  /** Optimize baseline parameters simultaneously with peak parameters */
  optimizeSimultaneously?: boolean;
  degree?: number;
  lambda?: number;
  p?: number;
  radius?: number;
  shirleyIterations?: number;
  shirleyTolerance?: number;
  /** Linear baseline slope (only used when autoBaseline is false) */
  slope?: number;
  /** Linear baseline intercept (only used when autoBaseline is false) */
  intercept?: number;
  /** Calc range for baseline - only calculate within this range, extend flat outside */
  calcRangeMin?: number;
  calcRangeMax?: number;
  /** Manual baseline control points */
  manualPoints?: DataPoint[];
  /** Manual baseline interpolation type */
  manualInterp?: 'linear' | 'cubic';
  /** Maximum number of manual baseline points */
  manualMaxPoints?: number;
  /** Whether user is currently selecting manual baseline points */
  manualEditMode?: boolean;
}

// Gaussian profile
export function gaussian(x: number, center: number, amplitude: number, sigma: number): number {
  const exponent = -((x - center) ** 2) / (2 * sigma ** 2);
  return amplitude * Math.exp(exponent);
}

// Lorentzian profile
export function lorentzian(x: number, center: number, amplitude: number, gamma: number): number {
  return amplitude * (gamma ** 2) / ((x - center) ** 2 + gamma ** 2);
}

// Voigt profile (approximation using pseudo-Voigt)
export function voigt(x: number, center: number, amplitude: number, sigma: number, gamma: number): number {
  const eta = gamma / (sigma + gamma); // Mixing parameter
  const g = gaussian(x, center, 1, sigma);
  const l = lorentzian(x, center, 1, gamma);
  return amplitude * (eta * l + (1 - eta) * g);
}

// Calculate peak value at x for a component
// Applies weight to amplitude: effective_amp = amplitude × weight
export function calculatePeak(x: number, component: PeakComponent): number {
  const sigma = component.sigma || component.width / 2.355; // FWHM to sigma
  const gamma = component.gamma || component.width / 2;
  // Apply weight to amplitude (default weight is 1.0)
  const effectiveAmp = component.amplitude * (component.weight ?? 1.0);

  switch (component.profile) {
    case 'gaussian':
      return gaussian(x, component.center, effectiveAmp, sigma);
    case 'lorentzian':
      return lorentzian(x, component.center, effectiveAmp, gamma);
    case 'voigt':
      return voigt(x, component.center, effectiveAmp, sigma, gamma);
    default:
      return 0;
  }
}

// Calculate linear baseline
// When slope and intercept are provided, use them directly; otherwise auto-fit to endpoints
export function linearBaseline(data: DataPoint[], slope?: number, intercept?: number): DataPoint[] {
  if (data.length < 2) return data.map(d => ({ x: d.x, y: 0 }));

  let m: number;
  let b: number;

  if (slope !== undefined && intercept !== undefined) {
    // Use manual slope and intercept
    m = slope;
    b = intercept;
  } else {
    // Auto-fit to endpoints
    const x1 = data[0].x;
    const y1 = data[0].y;
    const x2 = data[data.length - 1].x;
    const y2 = data[data.length - 1].y;

    m = (y2 - y1) / (x2 - x1);
    b = y1 - m * x1;
  }

  return data.map(d => ({
    x: d.x,
    y: m * d.x + b
  }));
}

// Calculate polynomial baseline with robust iterative fitting
// Uses sigma clipping to fit to bottom of data (not mean)
export function polynomialBaseline(data: DataPoint[], degree: number = 2, maxIter: number = 10, sigma: number = 1.5): DataPoint[] {
  if (data.length < degree + 1) return linearBaseline(data);

  const n = data.length;
  const xValues = data.map(d => d.x);
  const yValues = data.map(d => d.y);

  // Normalize x values to prevent numerical issues
  const xMin = Math.min(...xValues);
  const xMax = Math.max(...xValues);
  const xRange = xMax - xMin || 1;
  const xNorm = xValues.map(x => (x - xMin) / xRange);

  // Initialize mask - all points included
  let mask = new Array(n).fill(true);
  let coeffs: number[] = [];

  // Iterative robust fitting
  for (let iter = 0; iter < maxIter; iter++) {
    // Get masked data
    const maskedX: number[] = [];
    const maskedY: number[] = [];
    for (let i = 0; i < n; i++) {
      if (mask[i]) {
        maskedX.push(xNorm[i]);
        maskedY.push(yValues[i]);
      }
    }

    if (maskedX.length < degree + 1) break;

    // Build matrix for least squares with masked data
    const matrix: number[][] = [];
    const vector: number[] = [];

    for (let i = 0; i <= degree; i++) {
      matrix[i] = [];
      vector[i] = 0;
      for (let j = 0; j <= degree; j++) {
        matrix[i][j] = maskedX.reduce((sum, x) => sum + Math.pow(x, i + j), 0);
      }
      vector[i] = maskedX.reduce((sum, x, idx) => sum + Math.pow(x, i) * maskedY[idx], 0);
    }

    coeffs = solveLinearSystem(matrix, vector);

    // Calculate residuals for all points
    const baseline = xNorm.map(x => {
      let y = 0;
      for (let i = 0; i <= degree; i++) {
        y += coeffs[i] * Math.pow(x, i);
      }
      return y;
    });

    const residuals = yValues.map((y, i) => y - baseline[i]);

    // Calculate threshold: keep only points below baseline + sigma*std
    const maskedResiduals = residuals.filter((_, i) => mask[i]);
    const std = Math.sqrt(maskedResiduals.reduce((sum, r) => sum + r * r, 0) / maskedResiduals.length);
    const threshold = sigma * std;

    // Update mask - exclude points above threshold
    const newMask = residuals.map(r => r < threshold);

    // Check convergence
    if (newMask.every((m, i) => m === mask[i])) break;
    mask = newMask;
  }

  // Calculate final baseline
  return data.map(d => {
    const xn = (d.x - xMin) / xRange;
    let y = 0;
    for (let i = 0; i <= degree; i++) {
      y += coeffs[i] * Math.pow(xn, i);
    }
    return { x: d.x, y };
  });
}

function solveLinearSystem(matrix: number[][], vector: number[]): number[] {
  const n = vector.length;
  const a = matrix.map(row => [...row]);
  const b = [...vector];

  // Forward elimination
  for (let i = 0; i < n; i++) {
    let maxRow = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(a[k][i]) > Math.abs(a[maxRow][i])) {
        maxRow = k;
      }
    }
    [a[i], a[maxRow]] = [a[maxRow], a[i]];
    [b[i], b[maxRow]] = [b[maxRow], b[i]];

    for (let k = i + 1; k < n; k++) {
      const factor = a[k][i] / a[i][i];
      for (let j = i; j < n; j++) {
        a[k][j] -= factor * a[i][j];
      }
      b[k] -= factor * b[i];
    }
  }

  // Back substitution
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = b[i];
    for (let j = i + 1; j < n; j++) {
      sum -= a[i][j] * x[j];
    }
    x[i] = sum / a[i][i];
  }

  return x;
}

// Calculate baseline based on options
export function calculateBaseline(data: DataPoint[], options: BaselineOptions): DataPoint[] {
  if (options.method === 'none') {
    return data.map(d => ({ x: d.x, y: 0 }));
  }

  // Determine calc range
  const calcMin = options.calcRangeMin;
  const calcMax = options.calcRangeMax;
  const hasRange = calcMin !== undefined || calcMax !== undefined;

  // Filter data to calc range if specified
  let rangeData = data;
  let rangeIndices: number[] = [];

  if (hasRange) {
    rangeData = [];
    for (let i = 0; i < data.length; i++) {
      const x = data[i].x;
      const inRange = (calcMin === undefined || x >= calcMin) && (calcMax === undefined || x <= calcMax);
      if (inRange) {
        rangeData.push(data[i]);
        rangeIndices.push(i);
      }
    }
    // Fall back to all data if range is too small
    if (rangeData.length < 2) {
      rangeData = data;
      rangeIndices = data.map((_, i) => i);
    }
  }

  // Calculate baseline on the (possibly filtered) data
  let rangeBaseline: DataPoint[];
  switch (options.method) {
    case 'linear':
      // Use manual slope/intercept if auto is off and values are provided
      if (options.autoBaseline === false && options.slope !== undefined && options.intercept !== undefined) {
        rangeBaseline = linearBaseline(rangeData, options.slope, options.intercept);
      } else {
        rangeBaseline = linearBaseline(rangeData);
      }
      break;
    case 'polynomial':
      // Use stored coefficients if autoBaseline is off and coeffs are provided
      if (options.autoBaseline === false && (options as any).coeffs) {
        const coeffs = (options as any).coeffs as number[];
        rangeBaseline = rangeData.map(d => {
          let y = 0;
          for (let i = 0; i < coeffs.length; i++) {
            y += coeffs[i] * Math.pow(d.x, i);
          }
          return { x: d.x, y };
        });
      } else {
        rangeBaseline = polynomialBaseline(rangeData, options.degree || 2);
      }
      break;
    case 'asls':
      rangeBaseline = aslsBaseline(rangeData, options.lambda || 1e5, options.p || 0.01);
      break;
    case 'rolling_ball':
      rangeBaseline = rollingBallBaseline(rangeData, options.radius || 10);
      break;
    case 'shirley':
      rangeBaseline = shirleyBaseline(rangeData, options.shirleyIterations || 50, options.shirleyTolerance || 1e-5);
      break;
    case 'manual':
      if (options.manualPoints && options.manualPoints.length >= 2) {
        // Use rangeData like other baselines - extends flat outside calc range
        rangeBaseline = manualBaseline(rangeData, options.manualPoints, options.manualInterp || 'linear');
      } else {
        rangeBaseline = rangeData.map(d => ({ x: d.x, y: 0 }));
      }
      break;
    default:
      rangeBaseline = rangeData.map(d => ({ x: d.x, y: 0 }));
  }

  // If no range specified, return as-is
  if (!hasRange || rangeIndices.length === data.length) {
    return rangeBaseline;
  }

  // Extend baseline flat outside the calc range
  const fullBaseline: DataPoint[] = [];
  const leftBoundaryY = rangeBaseline.length > 0 ? rangeBaseline[0].y : 0;
  const rightBoundaryY = rangeBaseline.length > 0 ? rangeBaseline[rangeBaseline.length - 1].y : 0;

  let rangeIdx = 0;
  for (let i = 0; i < data.length; i++) {
    if (rangeIdx < rangeIndices.length && i === rangeIndices[rangeIdx]) {
      // This point is in the range, use calculated baseline
      fullBaseline.push({ x: data[i].x, y: rangeBaseline[rangeIdx].y });
      rangeIdx++;
    } else if (i < rangeIndices[0]) {
      // Before the range - use left boundary value
      fullBaseline.push({ x: data[i].x, y: leftBoundaryY });
    } else {
      // After the range - use right boundary value
      fullBaseline.push({ x: data[i].x, y: rightBoundaryY });
    }
  }

  return fullBaseline;
}

// AsLS (Asymmetric Least Squares) baseline - proper Whittaker smoother implementation
// Matches the Python scipy-based algorithm by solving: (W + λ·D²ᵀ·D²)·z = W·y
export function aslsBaseline(data: DataPoint[], lambda: number = 1e5, p: number = 0.01, iterations: number = 10): DataPoint[] {
  const n = data.length;
  if (n < 3) return data.map(d => ({ x: d.x, y: 0 }));

  const y = data.map(d => d.y);
  let z = [...y];
  let w = new Array(n).fill(1);

  // Iterative reweighting
  for (let iter = 0; iter < iterations; iter++) {
    // Solve weighted smoothing: (W + lambda * D2^T * D2) * z = W * y
    z = whittakerSmooth(y, w, lambda);

    // Update weights asymmetrically: higher weight for points below baseline
    for (let i = 0; i < n; i++) {
      w[i] = y[i] > z[i] ? p : 1 - p;
    }
  }

  return data.map((d, i) => ({ x: d.x, y: z[i] }));
}

/**
 * Whittaker smoother - solves (W + lambda * D2^T * D2) * z = W * y
 * Uses pentadiagonal matrix solver for the system.
 * D2 is the second difference operator [1, -2, 1]
 * D2^T * D2 gives a pentadiagonal pattern [1, -4, 6, -4, 1]
 */
function whittakerSmooth(y: number[], w: number[], lambda: number): number[] {
  const n = y.length;
  if (n < 3) return [...y];

  // Build pentadiagonal matrix coefficients for D2^T * D2 + W
  // The pattern for interior points is [lambda, -4*lambda, w[i]+6*lambda, -4*lambda, lambda]
  const a = new Array(n).fill(0);  // sub-sub diagonal (2 below main)
  const b = new Array(n).fill(0);  // sub diagonal (1 below main)
  const c = new Array(n).fill(0);  // main diagonal
  const d = new Array(n).fill(0);  // super diagonal (1 above main)
  const e = new Array(n).fill(0);  // super-super diagonal (2 above main)

  // Build the pentadiagonal system
  // The second difference matrix D2 applied to n points gives (n-2) rows
  // D2^T * D2 is n x n with specific boundary conditions
  for (let i = 0; i < n; i++) {
    if (i === 0) {
      c[i] = w[i] + lambda;
      d[i] = -2 * lambda;
      e[i] = lambda;
    } else if (i === 1) {
      b[i] = -2 * lambda;
      c[i] = w[i] + 5 * lambda;
      d[i] = -4 * lambda;
      e[i] = lambda;
    } else if (i === n - 2) {
      a[i] = lambda;
      b[i] = -4 * lambda;
      c[i] = w[i] + 5 * lambda;
      d[i] = -2 * lambda;
    } else if (i === n - 1) {
      a[i] = lambda;
      b[i] = -2 * lambda;
      c[i] = w[i] + lambda;
    } else {
      // Interior points
      a[i] = lambda;
      b[i] = -4 * lambda;
      c[i] = w[i] + 6 * lambda;
      d[i] = -4 * lambda;
      e[i] = lambda;
    }
  }

  // RHS: W * y
  const rhs = y.map((yi, i) => w[i] * yi);

  // Solve pentadiagonal system
  return solvePentadiagonal(a, b, c, d, e, rhs);
}

/**
 * Solve symmetric pentadiagonal system Ax = rhs using Cholesky-like LDL^T factorization.
 * a: sub-sub diagonal, b: sub diagonal, c: main diagonal, d: super diagonal, e: super-super diagonal
 */
function solvePentadiagonal(a: number[], b: number[], c: number[], d: number[], e: number[], rhs: number[]): number[] {
  const n = rhs.length;
  if (n < 3) return [...rhs];

  // For numerical stability, use modified Cholesky factorization
  // We factor A = L * D * L^T where L is unit lower triangular and D is diagonal

  // Working arrays for factorization
  const diagD = new Array(n).fill(0);      // Diagonal of D
  const subL1 = new Array(n).fill(0);      // First sub-diagonal of L
  const subL2 = new Array(n).fill(0);      // Second sub-diagonal of L
  const z = new Array(n).fill(0);          // Intermediate solution
  const x = new Array(n).fill(0);          // Final solution

  // Forward pass: compute L and D
  diagD[0] = c[0];
  if (Math.abs(diagD[0]) < 1e-14) diagD[0] = 1e-14;  // Avoid division by zero

  subL1[0] = d[0] / diagD[0];
  subL2[0] = e[0] / diagD[0];

  diagD[1] = c[1] - b[1] * subL1[0];
  if (Math.abs(diagD[1]) < 1e-14) diagD[1] = 1e-14;

  subL1[1] = (d[1] - b[1] * subL2[0]) / diagD[1];
  subL2[1] = e[1] / diagD[1];

  for (let i = 2; i < n; i++) {
    const li2 = a[i] / diagD[i - 2];  // L[i, i-2]
    const tmp = b[i] - li2 * diagD[i - 2] * subL1[i - 2];
    const li1 = tmp / diagD[i - 1];   // L[i, i-1]

    diagD[i] = c[i] - li2 * diagD[i - 2] * subL2[i - 2] - li1 * diagD[i - 1] * subL1[i - 1];
    if (Math.abs(diagD[i]) < 1e-14) diagD[i] = 1e-14;

    if (i < n - 1) {
      subL1[i] = (d[i] - li1 * diagD[i - 1] * subL2[i - 1]) / diagD[i];
    }
    if (i < n - 2) {
      subL2[i] = e[i] / diagD[i];
    }

    subL2[i - 2] = li2;  // Store L[i, i-2] for back substitution
    subL1[i - 1] = li1;  // Store L[i, i-1] for back substitution
  }

  // Forward substitution: solve L * z = rhs
  z[0] = rhs[0];
  z[1] = rhs[1] - subL1[0] * z[0];
  for (let i = 2; i < n; i++) {
    z[i] = rhs[i] - subL2[i - 2] * z[i - 2] - subL1[i - 1] * z[i - 1];
  }

  // Scale by D^-1
  for (let i = 0; i < n; i++) {
    z[i] = z[i] / diagD[i];
  }

  // Back substitution: solve L^T * x = z
  x[n - 1] = z[n - 1];
  x[n - 2] = z[n - 2] - subL1[n - 2] * x[n - 1];
  for (let i = n - 3; i >= 0; i--) {
    x[i] = z[i] - subL1[i] * x[i + 1] - subL2[i] * x[i + 2];
  }

  return x;
}

// Rolling ball baseline
export function rollingBallBaseline(data: DataPoint[], radius: number = 10): DataPoint[] {
  const n = data.length;
  if (n < 3) return data.map(d => ({ x: d.x, y: 0 }));

  const y = data.map(d => d.y);
  const baseline = new Array(n).fill(0);

  // Calculate baseline as minimum in rolling window
  const halfWindow = Math.ceil(radius);
  for (let i = 0; i < n; i++) {
    const start = Math.max(0, i - halfWindow);
    const end = Math.min(n, i + halfWindow + 1);
    let minVal = Infinity;
    for (let j = start; j < end; j++) {
      if (y[j] < minVal) minVal = y[j];
    }
    baseline[i] = minVal;
  }

  // Smooth the baseline
  const smoothed = [...baseline];
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 1; i < n - 1; i++) {
      smoothed[i] = (baseline[i - 1] + baseline[i] + baseline[i + 1]) / 3;
    }
  }

  return data.map((d, i) => ({ x: d.x, y: smoothed[i] }));
}

/**
 * Shirley baseline - commonly used in XPS analysis.
 * Calculates a step-shaped background where the step height at each point
 * is proportional to the integrated peak area above the baseline.
 */
export function shirleyBaseline(
  data: DataPoint[],
  maxIterations: number = 50,
  tolerance: number = 1e-5
): DataPoint[] {
  const n = data.length;
  if (n < 3) return data.map(d => ({ x: d.x, y: 0 }));

  const y = data.map(d => d.y);
  const x = data.map(d => d.x);

  // Initial endpoint values
  const yStart = y[0];
  const yEnd = y[n - 1];

  // Initialize baseline as linear between endpoints
  let baseline = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    baseline[i] = yStart * (1 - t) + yEnd * t;
  }

  // Iterative Shirley calculation
  for (let iter = 0; iter < maxIterations; iter++) {
    const newBaseline = new Array(n).fill(0);

    // Calculate total integrated area above baseline
    let totalArea = 0;
    for (let i = 0; i < n; i++) {
      totalArea += Math.max(0, y[i] - baseline[i]);
    }

    if (totalArea === 0) break;

    // Calculate baseline at each point based on area ratio
    for (let i = 0; i < n; i++) {
      // Area to the right of point i
      let areaRight = 0;
      for (let j = i; j < n; j++) {
        areaRight += Math.max(0, y[j] - baseline[j]);
      }

      // Baseline is proportional to area ratio
      const ratio = areaRight / totalArea;
      newBaseline[i] = yEnd + (yStart - yEnd) * ratio;
    }

    // Check convergence
    let maxChange = 0;
    for (let i = 0; i < n; i++) {
      maxChange = Math.max(maxChange, Math.abs(newBaseline[i] - baseline[i]));
    }

    baseline = newBaseline;

    if (maxChange < tolerance * (Math.abs(yStart - yEnd) + 1e-10)) {
      break;
    }
  }

  return data.map((d, i) => ({ x: d.x, y: baseline[i] }));
}

/**
 * Manual baseline from user-defined control points.
 * Interpolates between points using linear or cubic spline interpolation.
 */
export function manualBaseline(
  data: DataPoint[],
  points: DataPoint[],
  interp: 'linear' | 'cubic' = 'linear'
): DataPoint[] {
  if (!points || points.length < 2) {
    return data.map(d => ({ x: d.x, y: 0 }));
  }

  // Sort points by x
  const sortedPoints = [...points].sort((a, b) => a.x - b.x);
  const px = sortedPoints.map(p => p.x);
  const py = sortedPoints.map(p => p.y);

  const result: DataPoint[] = [];

  for (const d of data) {
    let y: number;

    if (interp === 'cubic' && sortedPoints.length >= 3) {
      // Cubic spline interpolation
      y = cubicSplineInterpolate(px, py, d.x);
    } else {
      // Linear interpolation
      y = linearInterpolate(px, py, d.x);
    }

    result.push({ x: d.x, y });
  }

  return result;
}

/**
 * Linear interpolation between control points.
 */
function linearInterpolate(px: number[], py: number[], x: number): number {
  const n = px.length;

  // Handle extrapolation
  if (x <= px[0]) return py[0];
  if (x >= px[n - 1]) return py[n - 1];

  // Find the segment containing x
  for (let i = 0; i < n - 1; i++) {
    if (x >= px[i] && x <= px[i + 1]) {
      const t = (x - px[i]) / (px[i + 1] - px[i]);
      return py[i] + t * (py[i + 1] - py[i]);
    }
  }

  return py[n - 1];
}

/**
 * Natural cubic spline interpolation.
 * Implements the classic algorithm for smooth curve through all points.
 */
function cubicSplineInterpolate(px: number[], py: number[], x: number): number {
  const n = px.length;
  if (n < 3) return linearInterpolate(px, py, x);

  // Handle extrapolation with linear extension
  if (x <= px[0]) {
    const slope = (py[1] - py[0]) / (px[1] - px[0]);
    return py[0] + slope * (x - px[0]);
  }
  if (x >= px[n - 1]) {
    const slope = (py[n - 1] - py[n - 2]) / (px[n - 1] - px[n - 2]);
    return py[n - 1] + slope * (x - px[n - 1]);
  }

  // Compute natural cubic spline coefficients
  const h = new Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    h[i] = px[i + 1] - px[i];
  }

  // Tridiagonal system for second derivatives
  const alpha = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    alpha[i] = (3 / h[i]) * (py[i + 1] - py[i]) - (3 / h[i - 1]) * (py[i] - py[i - 1]);
  }

  // Solve tridiagonal system
  const l = new Array(n).fill(1);
  const mu = new Array(n).fill(0);
  const z = new Array(n).fill(0);

  for (let i = 1; i < n - 1; i++) {
    l[i] = 2 * (px[i + 1] - px[i - 1]) - h[i - 1] * mu[i - 1];
    mu[i] = h[i] / l[i];
    z[i] = (alpha[i] - h[i - 1] * z[i - 1]) / l[i];
  }

  const c = new Array(n).fill(0);
  const b = new Array(n - 1).fill(0);
  const d = new Array(n - 1).fill(0);

  for (let j = n - 2; j >= 0; j--) {
    c[j] = z[j] - mu[j] * c[j + 1];
    b[j] = (py[j + 1] - py[j]) / h[j] - h[j] * (c[j + 1] + 2 * c[j]) / 3;
    d[j] = (c[j + 1] - c[j]) / (3 * h[j]);
  }

  // Find segment and evaluate
  for (let i = 0; i < n - 1; i++) {
    if (x >= px[i] && x <= px[i + 1]) {
      const dx = x - px[i];
      return py[i] + b[i] * dx + c[i] * dx * dx + d[i] * dx * dx * dx;
    }
  }

  return py[n - 1];
}

/**
 * Savitzky-Golay smoothing filter.
 * Fits a polynomial to a sliding window and evaluates at center point.
 */
function savitzkyGolaySmooth(y: number[], windowLength: number, polyOrder: number): number[] {
  const n = y.length;
  if (n < windowLength) {
    return [...y]; // Return copy if not enough points
  }

  // Ensure window length is odd
  if (windowLength % 2 === 0) {
    windowLength += 1;
  }

  // Ensure polyOrder < windowLength
  if (polyOrder >= windowLength) {
    polyOrder = windowLength - 1;
  }

  const halfWindow = Math.floor(windowLength / 2);
  const result = new Array(n);

  // Compute Savitzky-Golay coefficients for each position
  for (let i = 0; i < n; i++) {
    // Determine window bounds
    let start = i - halfWindow;
    let end = i + halfWindow;

    // Handle edges by extending with reflection
    const windowY: number[] = [];
    for (let j = start; j <= end; j++) {
      if (j < 0) {
        windowY.push(y[-j]); // Reflect left
      } else if (j >= n) {
        windowY.push(y[2 * n - j - 2]); // Reflect right
      } else {
        windowY.push(y[j]);
      }
    }

    // Fit polynomial to window (least squares)
    const m = windowY.length;
    const x = Array.from({ length: m }, (_, k) => k - halfWindow);

    // Build Vandermonde matrix
    const V: number[][] = [];
    for (let k = 0; k < m; k++) {
      const row: number[] = [];
      for (let p = 0; p <= polyOrder; p++) {
        row.push(Math.pow(x[k], p));
      }
      V.push(row);
    }

    // Solve V^T * V * coeffs = V^T * y using normal equations
    const VtV: number[][] = [];
    const VtY: number[] = [];

    for (let r = 0; r <= polyOrder; r++) {
      VtV.push([]);
      let sumY = 0;
      for (let c = 0; c <= polyOrder; c++) {
        let sum = 0;
        for (let k = 0; k < m; k++) {
          sum += V[k][r] * V[k][c];
        }
        VtV[r].push(sum);
      }
      for (let k = 0; k < m; k++) {
        sumY += V[k][r] * windowY[k];
      }
      VtY.push(sumY);
    }

    // Solve using Gaussian elimination
    const coeffs = solveLinearSystem(VtV, VtY);

    // Evaluate polynomial at center (x = 0)
    result[i] = coeffs[0]; // When x=0, only the constant term survives
  }

  return result;
}

/**
 * Remove outliers using z-score method.
 */
function removeOutliersZScore(data: DataPoint[], threshold: number): DataPoint[] {
  if (data.length < 3) return data;

  const y = data.map(d => d.y);
  const mean = y.reduce((a, b) => a + b, 0) / y.length;
  const std = Math.sqrt(y.reduce((sum, val) => sum + (val - mean) ** 2, 0) / y.length);

  if (std === 0) return data;

  return data.filter(d => Math.abs((d.y - mean) / std) < threshold);
}

/**
 * Remove outliers using Interquartile Range (IQR) method.
 */
function removeOutliersIQR(data: DataPoint[], factor: number): DataPoint[] {
  if (data.length < 4) return data;

  const sorted = data.map(d => d.y).sort((a, b) => a - b);
  const n = sorted.length;
  const q1 = sorted[Math.floor(n * 0.25)];
  const q3 = sorted[Math.floor(n * 0.75)];
  const iqr = q3 - q1;

  const lowerBound = q1 - factor * iqr;
  const upperBound = q3 + factor * iqr;

  return data.filter(d => d.y >= lowerBound && d.y <= upperBound);
}

// Process data (crop, interpolate, smooth, normalize)
export function processData(data: DataPoint[], options: ProcessingOptions): DataPoint[] {
  let processed = [...data];

  // Step 1: Outlier removal (on raw data before any other processing)
  if (options.outlierRemoval && options.outlierRemoval.method !== 'none') {
    if (options.outlierRemoval.method === 'zscore') {
      processed = removeOutliersZScore(processed, options.outlierRemoval.threshold);
    } else if (options.outlierRemoval.method === 'iqr') {
      processed = removeOutliersIQR(processed, options.outlierRemoval.threshold);
    }
  }

  // Step 2: Crop to X range
  if (options.xMin !== undefined || options.xMax !== undefined) {
    processed = processed.filter(d => {
      const aboveMin = options.xMin === undefined || d.x >= options.xMin;
      const belowMax = options.xMax === undefined || d.x <= options.xMax;
      return aboveMin && belowMax;
    });
  }

  // Interpolate - use options.xMin/xMax if provided to allow extending beyond data
  if (options.interpolationStep && options.interpolationStep > 0 && processed.length >= 2) {
    // Use options range if provided, otherwise use data range
    const dataXMin = processed[0].x;
    const dataXMax = processed[processed.length - 1].x;
    const interpMin = options.xMin !== undefined ? options.xMin : dataXMin;
    const interpMax = options.xMax !== undefined ? options.xMax : dataXMax;
    const newData: DataPoint[] = [];

    for (let x = interpMin; x <= interpMax + options.interpolationStep * 0.001; x += options.interpolationStep) {
      let y: number;

      if (x <= dataXMin) {
        // Extrapolate left using first two points
        if (processed.length >= 2) {
          const slope = (processed[1].y - processed[0].y) / (processed[1].x - processed[0].x);
          y = processed[0].y + slope * (x - processed[0].x);
        } else {
          y = processed[0].y;
        }
      } else if (x >= dataXMax) {
        // Extrapolate right using last two points
        if (processed.length >= 2) {
          const n = processed.length;
          const slope = (processed[n - 1].y - processed[n - 2].y) / (processed[n - 1].x - processed[n - 2].x);
          y = processed[n - 1].y + slope * (x - processed[n - 1].x);
        } else {
          y = processed[processed.length - 1].y;
        }
      } else {
        // Linear interpolation within data range
        let i = 0;
        while (i < processed.length - 1 && processed[i + 1].x < x) {
          i++;
        }

        if (i < processed.length - 1) {
          const x1 = processed[i].x;
          const y1 = processed[i].y;
          const x2 = processed[i + 1].x;
          const y2 = processed[i + 1].y;
          const t = (x - x1) / (x2 - x1);
          y = y1 + t * (y2 - y1);
        } else {
          y = processed[processed.length - 1].y;
        }
      }

      newData.push({ x, y });
    }
    processed = newData;
  }

  // Step 4: Smoothing (after interpolation for uniform spacing)
  if (options.smoothing?.enabled && processed.length >= (options.smoothing.windowLength || 11)) {
    const yValues = processed.map(d => d.y);
    const windowLength = options.smoothing.windowLength || 11;
    const polyOrder = options.smoothing.polyOrder || 3;
    const smoothed = savitzkyGolaySmooth(yValues, windowLength, polyOrder);
    processed = processed.map((d, i) => ({ x: d.x, y: smoothed[i] }));
  }

  // Step 5: Normalize
  if (options.normalize && processed.length > 0) {
    const maxY = Math.max(...processed.map(d => Math.abs(d.y)));
    if (maxY > 0) {
      processed = processed.map(d => ({ x: d.x, y: d.y / maxY }));
    }
  }

  return processed;
}

import { levenbergMarquardt } from './levenbergMarquardt';

// Fitting using Levenberg-Marquardt algorithm
export function fitPeaks(
  data: DataPoint[],
  components: PeakComponent[],
  baseline: DataPoint[],
  baselineOptions?: BaselineOptions,
  maxIterations: number = 200
): FitResult {
  if (data.length === 0 || components.length === 0) {
    return {
      fittedData: [],
      residuals: [],
      components: [],
      baseline: [],
      baselineCorrectedData: [],
      rSquared: 0,
      adjustedRSquared: 0,
      rmse: 0,
      chiSquared: 0,
      reducedChiSquared: 0,
      aic: 0,
      bic: 0,
      parameters: components,
      iterations: 0,
      converged: false,
    };
  }

  const xVals = data.map(d => d.x);
  const yVals = data.map(d => d.y);

  // No internal normalization - work directly on input data scale like Python
  // This assumes input data may already be normalized by the caller
  const normFactor = 1.0;

  // Create baseline lookup
  const baselineMap = new Map<number, number>();
  baseline.forEach(b => baselineMap.set(b.x, b.y));

  // Determine if we should optimize baseline simultaneously
  const optimizeBaseline = baselineOptions?.optimizeSimultaneously && baselineOptions.method !== 'none';
  const isParametricBaseline = baselineOptions?.method === 'linear' || baselineOptions?.method === 'polynomial';

  // Calculate initial baseline-corrected data for non-simultaneous case
  const initialBaselineYVals = xVals.map(x => baselineMap.get(x) || 0);

  // Pack component parameters into flat array: [center1, amp1, width1, center2, ...]
  // Apply weight to amplitude (weight × amplitude), then add baseline params if simultaneous
  const initialParams: number[] = [];
  for (const comp of components) {
    // Apply weight to amplitude (default weight is 1.0)
    const effectiveAmp = comp.amplitude * (comp.weight ?? 1.0);
    initialParams.push(comp.center, effectiveAmp, comp.width);
  }

  // Add baseline parameters for simultaneous optimization
  let numBaselineParams = 0;
  if (optimizeBaseline) {
    if (baselineOptions.method === 'linear') {
      // Linear: slope and intercept (normalized)
      const initialSlope = (baselineOptions.slope ?? 0) / normFactor;
      const initialIntercept = (baselineOptions.intercept ?? 0) / normFactor;
      initialParams.push(initialSlope, initialIntercept);
      numBaselineParams = 2;
    } else if (baselineOptions.method === 'polynomial') {
      // Polynomial: coefficients c0, c1, ..., c{degree}
      const degree = baselineOptions.degree ?? 2;
      for (let i = 0; i <= degree; i++) {
        initialParams.push(0); // Start with zero coefficients
      }
      numBaselineParams = degree + 1;
    } else if (baselineOptions.method === 'asls') {
      // AsLS: log10(lambda) and p
      const initLogLam = Math.log10(baselineOptions.lambda ?? 1e5);
      const initP = baselineOptions.p ?? 0.01;
      initialParams.push(initLogLam, initP);
      numBaselineParams = 2;
    } else if (baselineOptions.method === 'rolling_ball') {
      // Rolling Ball: radius
      const initRadius = baselineOptions.radius ?? 10;
      initialParams.push(initRadius);
      numBaselineParams = 1;
    } else if (baselineOptions.method === 'shirley') {
      // Shirley: start_offset and end_offset (normalized)
      // These offsets adjust the boundary values
      initialParams.push(0, 0); // Start with zero offsets
      numBaselineParams = 2;
    }
  }

  // Model function that computes y values for all x given packed params
  const modelFunc = (x: number[], params: number[]): number[] => {
    const result = new Array(x.length).fill(0);
    const nComps = components.length;

    // Compute peak contributions
    for (let c = 0; c < nComps; c++) {
      const center = params[c * 3];
      const amplitude = params[c * 3 + 1];
      const width = params[c * 3 + 2];
      const sigma = width / 2.355; // FWHM to sigma
      const gamma = width / 2;

      const profile = components[c]?.profile || 'gaussian';

      for (let i = 0; i < x.length; i++) {
        switch (profile) {
          case 'gaussian':
            result[i] += gaussian(x[i], center, amplitude, sigma);
            break;
          case 'lorentzian':
            result[i] += lorentzian(x[i], center, amplitude, gamma);
            break;
          case 'voigt':
            result[i] += voigt(x[i], center, amplitude, sigma, gamma);
            break;
        }
      }
    }

    // Add baseline contribution if optimizing simultaneously
    if (optimizeBaseline && numBaselineParams > 0) {
      const blParamsStart = nComps * 3;

      if (baselineOptions!.method === 'linear') {
        const slope = params[blParamsStart];
        const intercept = params[blParamsStart + 1];
        for (let i = 0; i < x.length; i++) {
          result[i] += slope * x[i] + intercept;
        }
      } else if (baselineOptions!.method === 'polynomial') {
        const degree = (baselineOptions!.degree ?? 2);
        for (let i = 0; i < x.length; i++) {
          let bl = 0;
          for (let d = 0; d <= degree; d++) {
            bl += params[blParamsStart + d] * Math.pow(x[i], d);
          }
          result[i] += bl;
        }
      } else if (baselineOptions!.method === 'asls') {
        // For AsLS, we need to compute baseline on (y - peaks) using current params
        // This is computationally expensive but necessary for non-parametric baselines
        const logLam = params[blParamsStart];
        const p = Math.max(0.0001, Math.min(0.5, params[blParamsStart + 1])); // Clamp p
        const lambda = Math.pow(10, Math.max(2, Math.min(10, logLam))); // Clamp lambda

        // Compute peak-only model for baseline calculation
        const peakOnly = new Array(x.length).fill(0);
        for (let c = 0; c < nComps; c++) {
          const center = params[c * 3];
          const amplitude = params[c * 3 + 1];
          const width = params[c * 3 + 2];
          const sigma = width / 2.355;
          const gamma = width / 2;
          const profile = components[c]?.profile || 'gaussian';

          for (let i = 0; i < x.length; i++) {
            switch (profile) {
              case 'gaussian':
                peakOnly[i] += gaussian(x[i], center, amplitude, sigma);
                break;
              case 'lorentzian':
                peakOnly[i] += lorentzian(x[i], center, amplitude, gamma);
                break;
              case 'voigt':
                peakOnly[i] += voigt(x[i], center, amplitude, sigma, gamma);
                break;
            }
          }
        }

        // Compute AsLS baseline on (y - peaks)
        const yMinusPeaks = yVals.map((y, i) => y - peakOnly[i]);
        const aslsData = x.map((xi, i) => ({ x: xi, y: yMinusPeaks[i] }));
        const aslsBl = aslsBaseline(aslsData, lambda, p, 5); // Reduced iterations for speed

        // Return peaks + baseline
        return x.map((_, i) => peakOnly[i] + (aslsBl[i]?.y || 0));
      } else if (baselineOptions!.method === 'rolling_ball') {
        // Rolling ball: optimize radius
        const radius = Math.max(1, Math.round(params[blParamsStart])); // Clamp and round radius

        // Compute peak-only model
        const peakOnly = new Array(x.length).fill(0);
        for (let c = 0; c < nComps; c++) {
          const center = params[c * 3];
          const amplitude = params[c * 3 + 1];
          const width = params[c * 3 + 2];
          const sigma = width / 2.355;
          const gamma = width / 2;
          const profile = components[c]?.profile || 'gaussian';

          for (let i = 0; i < x.length; i++) {
            switch (profile) {
              case 'gaussian':
                peakOnly[i] += gaussian(x[i], center, amplitude, sigma);
                break;
              case 'lorentzian':
                peakOnly[i] += lorentzian(x[i], center, amplitude, gamma);
                break;
              case 'voigt':
                peakOnly[i] += voigt(x[i], center, amplitude, sigma, gamma);
                break;
            }
          }
        }

        // Compute rolling ball baseline on (y - peaks)
        const yMinusPeaks = yVals.map((y, i) => y - peakOnly[i]);
        const rbData = x.map((xi, i) => ({ x: xi, y: yMinusPeaks[i] }));
        const rbBl = rollingBallBaseline(rbData, radius);

        return x.map((_, i) => peakOnly[i] + (rbBl[i]?.y || 0));
      } else if (baselineOptions!.method === 'shirley') {
        // Shirley: optimize start and end offsets
        const startOffset = params[blParamsStart];
        const endOffset = params[blParamsStart + 1];

        // Compute peak-only model
        const peakOnly = new Array(x.length).fill(0);
        for (let c = 0; c < nComps; c++) {
          const center = params[c * 3];
          const amplitude = params[c * 3 + 1];
          const width = params[c * 3 + 2];
          const sigma = width / 2.355;
          const gamma = width / 2;
          const profile = components[c]?.profile || 'gaussian';

          for (let i = 0; i < x.length; i++) {
            switch (profile) {
              case 'gaussian':
                peakOnly[i] += gaussian(x[i], center, amplitude, sigma);
                break;
              case 'lorentzian':
                peakOnly[i] += lorentzian(x[i], center, amplitude, gamma);
                break;
              case 'voigt':
                peakOnly[i] += voigt(x[i], center, amplitude, sigma, gamma);
                break;
            }
          }
        }

        // Compute shirley baseline on (y - peaks) with offset adjustments
        const yMinusPeaks = yVals.map((y, i) => y - peakOnly[i]);
        // Apply offsets: adjust first and last values
        const adjustedData = yMinusPeaks.map((y, i) => {
          if (i === 0) return y + startOffset;
          if (i === yMinusPeaks.length - 1) return y + endOffset;
          return y;
        });
        const shirleyData = x.map((xi, i) => ({ x: xi, y: adjustedData[i] }));
        const shirleyBl = shirleyBaseline(shirleyData, baselineOptions!.shirleyIterations ?? 50, baselineOptions!.shirleyTolerance ?? 1e-5);

        return x.map((_, i) => peakOnly[i] + (shirleyBl[i]?.y || 0));
      }
    } else if (!optimizeBaseline) {
      // Use pre-computed baseline
      for (let i = 0; i < x.length; i++) {
        // We're fitting baseline-corrected data, so no baseline added here
      }
    }

    return result;
  };

  // For non-simultaneous optimization, fit to baseline-corrected data
  // For simultaneous optimization, fit to raw data with baseline as part of model
  const targetYVals = optimizeBaseline ? yVals : yVals.map((y, i) => y - initialBaselineYVals[i]);

  // Run Levenberg-Marquardt optimization
  const lmResult = levenbergMarquardt(xVals, targetYVals, initialParams, modelFunc, {
    maxIterations,
    tolerance: 1e-8,
  });

  // Unpack optimized peak parameters
  // Reset weight to 1.0 so caller can recalculate weights from fitted amplitudes
  const optimizedParams: PeakComponent[] = components.map((comp, i) => ({
    ...comp,
    center: lmResult.params[i * 3],
    amplitude: Math.max(0, lmResult.params[i * 3 + 1]),
    width: Math.max(0.01, lmResult.params[i * 3 + 2]),
    weight: 1.0,  // Reset - caller will recalculate as fraction of total
  }));

  // Extract optimized baseline parameters if applicable
  let optimizedBaselineParams: FitResult['baselineParams'] = undefined;
  let optimizedBaseline: DataPoint[] | undefined = undefined;

  if (optimizeBaseline && numBaselineParams > 0) {
    const blParamsStart = components.length * 3;

    if (baselineOptions!.method === 'linear') {
      const slope = lmResult.params[blParamsStart];
      const intercept = lmResult.params[blParamsStart + 1];
      optimizedBaselineParams = { slope, intercept };
      optimizedBaseline = xVals.map(x => ({ x, y: slope * x + intercept }));
    } else if (baselineOptions!.method === 'polynomial') {
      const degree = baselineOptions!.degree ?? 2;
      const coeffs = [];
      for (let d = 0; d <= degree; d++) {
        coeffs.push(lmResult.params[blParamsStart + d]);
      }
      optimizedBaselineParams = { coeffs };
      optimizedBaseline = xVals.map(x => {
        let bl = 0;
        for (let d = 0; d <= degree; d++) {
          bl += coeffs[d] * Math.pow(x, d);
        }
        return { x, y: bl };
      });
    } else if (baselineOptions!.method === 'asls') {
      const logLam = lmResult.params[blParamsStart];
      const p = lmResult.params[blParamsStart + 1];
      const lambda = Math.pow(10, logLam);
      optimizedBaselineParams = { lambda, p };

      // Compute final baseline with optimized parameters
      const peakModel = modelFunc(xVals, lmResult.params.slice(0, components.length * 3));
      const yMinusPeaks = yVals.map((y, i) => y - peakModel[i]);
      const aslsData = xVals.map((x, i) => ({ x, y: yMinusPeaks[i] }));
      optimizedBaseline = aslsBaseline(aslsData, lambda, p, 10);
    } else if (baselineOptions!.method === 'rolling_ball') {
      const radius = Math.max(1, Math.round(lmResult.params[blParamsStart]));
      optimizedBaselineParams = { radius };

      // Compute final baseline with optimized radius
      const peakModel = modelFunc(xVals, lmResult.params.slice(0, components.length * 3));
      const yMinusPeaks = yVals.map((y, i) => y - peakModel[i]);
      const rbData = xVals.map((x, i) => ({ x, y: yMinusPeaks[i] }));
      optimizedBaseline = rollingBallBaseline(rbData, radius);
    } else if (baselineOptions!.method === 'shirley') {
      const startOffset = lmResult.params[blParamsStart];
      const endOffset = lmResult.params[blParamsStart + 1];

      // Compute final baseline with optimized offsets
      const peakModel = modelFunc(xVals, lmResult.params.slice(0, components.length * 3));
      const yMinusPeaks = yVals.map((y, i) => y - peakModel[i]);
      // Apply offsets
      const adjustedData = yMinusPeaks.map((y, i) => {
        if (i === 0) return y + startOffset;
        if (i === yMinusPeaks.length - 1) return y + endOffset;
        return y;
      });
      const shirleyData = xVals.map((x, i) => ({ x, y: adjustedData[i] }));
      optimizedBaseline = shirleyBaseline(shirleyData, baselineOptions!.shirleyIterations ?? 50, baselineOptions!.shirleyTolerance ?? 1e-5);
    }
  }

  // Use optimized baseline if available, otherwise use input baseline
  const finalBaseline = optimizedBaseline ?? baseline;
  const finalBaselineMap = new Map<number, number>();
  finalBaseline.forEach(b => finalBaselineMap.set(b.x, b.y));

  // Calculate final results
  const fittedData: DataPoint[] = [];
  const residuals: DataPoint[] = [];
  const baselineCorrectedData: DataPoint[] = [];
  const componentData: DataPoint[][] = optimizedParams.map(() => []);

  let sumSquaredResiduals = 0;
  let sumSquaredTotal = 0;
  const meanY = data.reduce((sum, d) => sum + d.y, 0) / data.length;
  const n = data.length;
  const p = optimizedParams.length * 3 + numBaselineParams;

  for (let i = 0; i < data.length; i++) {
    const d = data[i];
    const baselineY = finalBaselineMap.get(d.x) || 0;
    const correctedY = d.y - baselineY;
    // Store corrected data in NORMALIZED scale (matches input data scale)
    baselineCorrectedData.push({ x: d.x, y: correctedY });

    let fittedY = 0;
    optimizedParams.forEach((comp, j) => {
      const peakY = calculatePeak(d.x, comp);
      fittedY += peakY;
      // Store component data in NORMALIZED scale (matching input data)
      componentData[j].push({ x: d.x, y: peakY });
    });

    // Store fitted data in NORMALIZED scale
    fittedData.push({ x: d.x, y: fittedY });
    residuals.push({ x: d.x, y: correctedY - fittedY });

    // Use normalized values for statistics
    const correctedYNorm = correctedY / normFactor;
    const fittedYNorm = fittedY / normFactor;
    sumSquaredResiduals += (correctedYNorm - fittedYNorm) ** 2;
    sumSquaredTotal += (d.y / normFactor - meanY / normFactor) ** 2;
  }

  // Return baseline in same scale as input data
  const finalBaselineOutput = finalBaseline;

  // Calculate fit statistics
  const rSquared = 1 - sumSquaredResiduals / (sumSquaredTotal || 1);
  const adjustedRSquared = 1 - (1 - rSquared) * (n - 1) / (n - p - 1);
  const rmse = Math.sqrt(sumSquaredResiduals / n);
  const chiSquared = lmResult.chiSquared;
  const dof = Math.max(1, n - p);
  const reducedChiSquared = chiSquared / dof;

  // AIC and BIC
  const logLikelihood = -n / 2 * Math.log(sumSquaredResiduals / n);
  const aic = 2 * p - 2 * logLikelihood;
  const bic = p * Math.log(n) - 2 * logLikelihood;

  return {
    fittedData,
    residuals,
    components: componentData,
    baseline: finalBaselineOutput,
    baselineCorrectedData,
    rSquared: Math.max(0, rSquared),
    adjustedRSquared: Math.max(0, adjustedRSquared),
    rmse,
    chiSquared,
    reducedChiSquared,
    aic,
    bic,
    parameters: optimizedParams,
    iterations: lmResult.iterations,
    converged: lmResult.converged,
    optimizedBaseline: optimizedBaseline,
    baselineParams: optimizedBaselineParams,
  };
}

function calculateTotalError(data: DataPoint[], params: PeakComponent[], baselineMap: Map<number, number>): number {
  let totalError = 0;
  for (const d of data) {
    const baselineY = baselineMap.get(d.x) || 0;
    const correctedY = d.y - baselineY;

    let fittedY = 0;
    for (const comp of params) {
      fittedY += calculatePeak(d.x, comp);
    }

    totalError += (correctedY - fittedY) ** 2;
  }
  return totalError;
}

// Parse data file content
export function parseDataFile(content: string): DataPoint[] {
  const lines = content.trim().split('\n');
  const data: DataPoint[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) {
      continue;
    }

    const parts = trimmed.split(/[\s,;]+/);
    if (parts.length >= 2) {
      const x = parseFloat(parts[0]);
      const y = parseFloat(parts[1]);
      if (!isNaN(x) && !isNaN(y)) {
        data.push({ x, y });
      }
    }
  }

  // Sort by x value
  data.sort((a, b) => a.x - b.x);

  return data;
}

// Export results to text
export function exportResults(
  originalData: DataPoint[],
  fitResult: FitResult,
  processingOptions: ProcessingOptions,
  baselineOptions: BaselineOptions
): string {
  const lines: string[] = [];

  lines.push('# PeakiPy Web - Fitting Results');
  lines.push(`# Date: ${new Date().toISOString()}`);
  lines.push('#');
  lines.push('# Processing Options:');
  lines.push(`#   X Range: ${processingOptions.xMin ?? 'auto'} - ${processingOptions.xMax ?? 'auto'}`);
  lines.push(`#   Interpolation Step: ${processingOptions.interpolationStep || 'none'}`);
  lines.push(`#   Normalize: ${processingOptions.normalize}`);
  lines.push('#');
  lines.push('# Baseline Options:');
  lines.push(`#   Method: ${baselineOptions.method}`);
  if (baselineOptions.degree) lines.push(`#   Degree: ${baselineOptions.degree}`);
  if (baselineOptions.lambda) lines.push(`#   Lambda: ${baselineOptions.lambda}`);
  if (baselineOptions.p) lines.push(`#   P: ${baselineOptions.p}`);
  if (baselineOptions.radius) lines.push(`#   Radius: ${baselineOptions.radius}`);
  lines.push('#');
  lines.push('# Fit Statistics:');
  lines.push(`#   R²: ${fitResult.rSquared.toFixed(6)}`);
  lines.push(`#   RMSE: ${fitResult.rmse.toFixed(6)}`);
  lines.push('#');
  lines.push('# Fitted Parameters:');

  // Calculate Total Amplitude and Weights
  const fittedAmps = fitResult.parameters.map(p => p.amplitude * (p.weight ?? 1));
  const totalAmp = fittedAmps.reduce((sum, a) => sum + a, 0);

  lines.push(`#   Total Amplitude: ${totalAmp.toFixed(6)}`);
  lines.push('#');

  for (let i = 0; i < fitResult.parameters.length; i++) {
    const param = fitResult.parameters[i];
    const weight = totalAmp > 0 ? fittedAmps[i] / totalAmp : 0;
    lines.push(`#   Peak ${param.id}: ${param.profile}`);
    lines.push(`#     Center: ${param.center.toFixed(4)}`);
    lines.push(`#     Weight: ${(weight * 100).toFixed(2)}%`);
    lines.push(`#     Width (FWHM): ${param.width.toFixed(4)}`);
  }

  lines.push('#');
  lines.push('# Data Columns: X, Y_Exp, Y_Fit, Residual, Baseline' +
    fitResult.parameters.map((_, i) => `, Comp_${i + 1}`).join(''));
  lines.push('#');

  for (let i = 0; i < fitResult.fittedData.length; i++) {
    const x = fitResult.fittedData[i].x;
    const yExp = originalData.find(d => Math.abs(d.x - x) < 0.0001)?.y || 0;
    const yFit = fitResult.fittedData[i].y;
    const residual = fitResult.residuals[i].y;
    const baseline = fitResult.baseline[i]?.y || 0;
    const comps = fitResult.components.map(c => c[i]?.y || 0);

    lines.push([x, yExp, yFit, residual, baseline, ...comps].map(v => v.toFixed(6)).join('\t'));
  }

  return lines.join('\n');
}

// Export data to simple format
export function exportDataFile(data: DataPoint[]): string {
  const lines = ['# X\tY'];
  for (const d of data) {
    lines.push(`${d.x.toFixed(6)}\t${d.y.toFixed(6)}`);
  }
  return lines.join('\n');
}
