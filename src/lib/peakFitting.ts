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
  sigma?: number;
  gamma?: number;
}

export interface FitResult {
  fittedData: DataPoint[];
  residuals: DataPoint[];
  components: DataPoint[][];
  baseline: DataPoint[];
  rSquared: number;
  rmse: number;
  parameters: PeakComponent[];
}

export interface ProcessingOptions {
  xMin?: number;
  xMax?: number;
  interpolationStep?: number;
  normalize: boolean;
}

export interface BaselineOptions {
  method: 'none' | 'linear' | 'polynomial' | 'asls' | 'rolling_ball';
  degree?: number;
  lambda?: number;
  p?: number;
  radius?: number;
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
export function calculatePeak(x: number, component: PeakComponent): number {
  const sigma = component.sigma || component.width / 2.355; // FWHM to sigma
  const gamma = component.gamma || component.width / 2;
  
  switch (component.profile) {
    case 'gaussian':
      return gaussian(x, component.center, component.amplitude, sigma);
    case 'lorentzian':
      return lorentzian(x, component.center, component.amplitude, gamma);
    case 'voigt':
      return voigt(x, component.center, component.amplitude, sigma, gamma);
    default:
      return 0;
  }
}

// Calculate linear baseline
export function linearBaseline(data: DataPoint[]): DataPoint[] {
  if (data.length < 2) return data.map(d => ({ x: d.x, y: 0 }));
  
  const x1 = data[0].x;
  const y1 = data[0].y;
  const x2 = data[data.length - 1].x;
  const y2 = data[data.length - 1].y;
  
  const slope = (y2 - y1) / (x2 - x1);
  const intercept = y1 - slope * x1;
  
  return data.map(d => ({
    x: d.x,
    y: slope * d.x + intercept
  }));
}

// Calculate polynomial baseline
export function polynomialBaseline(data: DataPoint[], degree: number = 2): DataPoint[] {
  if (data.length < degree + 1) return linearBaseline(data);
  
  // Simple least squares polynomial fit
  const n = data.length;
  const xValues = data.map(d => d.x);
  const yValues = data.map(d => d.y);
  
  // Normalize x values to prevent numerical issues
  const xMin = Math.min(...xValues);
  const xMax = Math.max(...xValues);
  const xRange = xMax - xMin || 1;
  const xNorm = xValues.map(x => (x - xMin) / xRange);
  
  // Build matrix for least squares
  const matrix: number[][] = [];
  const vector: number[] = [];
  
  for (let i = 0; i <= degree; i++) {
    matrix[i] = [];
    vector[i] = 0;
    for (let j = 0; j <= degree; j++) {
      matrix[i][j] = xNorm.reduce((sum, x) => sum + Math.pow(x, i + j), 0);
    }
    vector[i] = xNorm.reduce((sum, x, idx) => sum + Math.pow(x, i) * yValues[idx], 0);
  }
  
  // Solve using Gaussian elimination
  const coeffs = solveLinearSystem(matrix, vector);
  
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
  switch (options.method) {
    case 'linear':
      return linearBaseline(data);
    case 'polynomial':
      return polynomialBaseline(data, options.degree || 2);
    case 'asls':
      return aslsBaseline(data, options.lambda || 1e5, options.p || 0.01);
    case 'rolling_ball':
      return rollingBallBaseline(data, options.radius || 10);
    case 'none':
    default:
      return data.map(d => ({ x: d.x, y: 0 }));
  }
}

// AsLS (Asymmetric Least Squares) baseline
export function aslsBaseline(data: DataPoint[], lambda: number = 1e5, p: number = 0.01, iterations: number = 10): DataPoint[] {
  const n = data.length;
  if (n < 3) return data.map(d => ({ x: d.x, y: 0 }));
  
  const y = data.map(d => d.y);
  let z = [...y];
  const w = new Array(n).fill(1);
  
  for (let iter = 0; iter < iterations; iter++) {
    // Simplified smoothing
    const newZ = [...z];
    for (let i = 1; i < n - 1; i++) {
      const smoothTerm = (z[i - 1] + z[i + 1]) / 2;
      const diff = y[i] - z[i];
      const weight = diff > 0 ? p : 1 - p;
      newZ[i] = smoothTerm * (1 - 1 / lambda) + y[i] * (1 / lambda) * weight;
    }
    z = newZ;
  }
  
  return data.map((d, i) => ({ x: d.x, y: z[i] }));
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

// Process data (crop, interpolate, normalize)
export function processData(data: DataPoint[], options: ProcessingOptions): DataPoint[] {
  let processed = [...data];
  
  // Crop to X range
  if (options.xMin !== undefined || options.xMax !== undefined) {
    processed = processed.filter(d => {
      const aboveMin = options.xMin === undefined || d.x >= options.xMin;
      const belowMax = options.xMax === undefined || d.x <= options.xMax;
      return aboveMin && belowMax;
    });
  }
  
  // Interpolate
  if (options.interpolationStep && options.interpolationStep > 0 && processed.length >= 2) {
    const xMin = processed[0].x;
    const xMax = processed[processed.length - 1].x;
    const newData: DataPoint[] = [];
    
    for (let x = xMin; x <= xMax; x += options.interpolationStep) {
      // Linear interpolation
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
        newData.push({ x, y: y1 + t * (y2 - y1) });
      }
    }
    processed = newData;
  }
  
  // Normalize
  if (options.normalize && processed.length > 0) {
    const maxY = Math.max(...processed.map(d => Math.abs(d.y)));
    if (maxY > 0) {
      processed = processed.map(d => ({ x: d.x, y: d.y / maxY }));
    }
  }
  
  return processed;
}

// Simple fitting using gradient descent
export function fitPeaks(
  data: DataPoint[],
  components: PeakComponent[],
  baseline: DataPoint[],
  iterations: number = 100
): FitResult {
  if (data.length === 0) {
    return {
      fittedData: [],
      residuals: [],
      components: [],
      baseline: [],
      rSquared: 0,
      rmse: 0,
      parameters: components
    };
  }
  
  // Create a map for baseline values
  const baselineMap = new Map<number, number>();
  baseline.forEach(b => baselineMap.set(b.x, b.y));
  
  // Optimize parameters using simple gradient descent
  const params = components.map(c => ({ ...c }));
  const learningRate = 0.01;
  
  for (let iter = 0; iter < iterations; iter++) {
    for (const param of params) {
      // Calculate current error
      const currentError = calculateTotalError(data, params, baselineMap);
      
      // Try adjusting each parameter
      const delta = 0.01;
      
      // Adjust center
      param.center += delta;
      const errorAfterCenter = calculateTotalError(data, params, baselineMap);
      const gradCenter = (errorAfterCenter - currentError) / delta;
      param.center -= delta + learningRate * gradCenter;
      
      // Adjust amplitude
      param.amplitude += delta;
      const errorAfterAmp = calculateTotalError(data, params, baselineMap);
      const gradAmp = (errorAfterAmp - currentError) / delta;
      param.amplitude -= delta + learningRate * gradAmp;
      param.amplitude = Math.max(0, param.amplitude);
      
      // Adjust width
      param.width += delta;
      const errorAfterWidth = calculateTotalError(data, params, baselineMap);
      const gradWidth = (errorAfterWidth - currentError) / delta;
      param.width -= delta + learningRate * gradWidth;
      param.width = Math.max(0.1, param.width);
    }
  }
  
  // Calculate final results
  const fittedData: DataPoint[] = [];
  const residuals: DataPoint[] = [];
  const componentData: DataPoint[][] = params.map(() => []);
  
  let sumSquaredResiduals = 0;
  let sumSquaredTotal = 0;
  const meanY = data.reduce((sum, d) => sum + d.y, 0) / data.length;
  
  for (const d of data) {
    const baselineY = baselineMap.get(d.x) || 0;
    const correctedY = d.y - baselineY;
    
    let fittedY = 0;
    params.forEach((comp, i) => {
      const peakY = calculatePeak(d.x, comp);
      fittedY += peakY;
      componentData[i].push({ x: d.x, y: peakY });
    });
    
    fittedData.push({ x: d.x, y: fittedY + baselineY });
    residuals.push({ x: d.x, y: correctedY - fittedY });
    
    sumSquaredResiduals += (correctedY - fittedY) ** 2;
    sumSquaredTotal += (d.y - meanY) ** 2;
  }
  
  const rSquared = 1 - sumSquaredResiduals / (sumSquaredTotal || 1);
  const rmse = Math.sqrt(sumSquaredResiduals / data.length);
  
  return {
    fittedData,
    residuals,
    components: componentData,
    baseline,
    rSquared: Math.max(0, rSquared),
    rmse,
    parameters: params
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
  
  for (const param of fitResult.parameters) {
    lines.push(`#   Peak ${param.id}: ${param.profile}`);
    lines.push(`#     Center: ${param.center.toFixed(4)}`);
    lines.push(`#     Amplitude: ${param.amplitude.toFixed(4)}`);
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
