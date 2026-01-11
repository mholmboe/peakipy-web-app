/**
 * Levenberg-Marquardt optimizer for nonlinear least squares fitting.
 * This is a pure TypeScript implementation that provides functionality
 * similar to lmfit in Python.
 */

export interface LMOptions {
    maxIterations?: number;
    tolerance?: number;
    lambdaInit?: number;
    lambdaUp?: number;
    lambdaDown?: number;
}

export interface LMResult {
    params: number[];
    residuals: number[];
    chiSquared: number;
    iterations: number;
    converged: boolean;
}

/**
 * Levenberg-Marquardt algorithm for nonlinear least squares optimization.
 * 
 * @param x - Independent variable values
 * @param y - Observed dependent variable values
 * @param initialParams - Initial parameter guesses
 * @param modelFunc - Function that computes y values given x and params
 * @param options - Algorithm options
 * @returns Optimized parameters and fit statistics
 */
export function levenbergMarquardt(
    x: number[],
    y: number[],
    initialParams: number[],
    modelFunc: (x: number[], params: number[]) => number[],
    options: LMOptions = {}
): LMResult {
    const {
        maxIterations = 200,
        tolerance = 1e-8,
        lambdaInit = 0.001,
        lambdaUp = 10,
        lambdaDown = 0.1,
    } = options;

    const n = x.length;
    const p = initialParams.length;
    let params = [...initialParams];
    let lambda = lambdaInit;

    // Calculate initial residuals
    let yPred = modelFunc(x, params);
    let residuals = y.map((yi, i) => yi - yPred[i]);
    let chiSquared = residuals.reduce((sum, r) => sum + r * r, 0);

    let converged = false;
    let iterations = 0;

    for (let iter = 0; iter < maxIterations; iter++) {
        iterations = iter + 1;

        // Calculate Jacobian matrix using finite differences
        const J = calculateJacobian(x, params, modelFunc);

        // Calculate J^T * J (approximate Hessian)
        const JtJ = matrixMultiply(transpose(J), J);

        // Calculate J^T * residuals
        const JtR = new Array(p).fill(0);
        for (let j = 0; j < p; j++) {
            for (let i = 0; i < n; i++) {
                JtR[j] += J[i][j] * residuals[i];
            }
        }

        // Add damping (lambda * diag(J^T * J))
        const H = JtJ.map((row, i) => row.map((val, j) =>
            i === j ? val + lambda * Math.max(val, 1e-10) : val
        ));

        // Solve H * delta = JtR for delta
        const delta = solveLinear(H, JtR);
        if (!delta) {
            // Singular matrix, increase lambda
            lambda *= lambdaUp;
            continue;
        }

        // Try new parameters
        const newParams = params.map((p, i) => p + delta[i]);
        const newYPred = modelFunc(x, newParams);
        const newResiduals = y.map((yi, i) => yi - newYPred[i]);
        const newChiSquared = newResiduals.reduce((sum, r) => sum + r * r, 0);

        // Check for improvement
        if (newChiSquared < chiSquared) {
            // Accept step
            params = newParams;
            yPred = newYPred;
            residuals = newResiduals;

            // Check convergence
            const relChange = (chiSquared - newChiSquared) / (chiSquared + 1e-10);
            chiSquared = newChiSquared;

            if (relChange < tolerance) {
                converged = true;
                break;
            }

            lambda *= lambdaDown;
        } else {
            // Reject step, increase damping
            lambda *= lambdaUp;

            // Prevent lambda from getting too large
            if (lambda > 1e10) {
                break;
            }
        }
    }

    return {
        params,
        residuals,
        chiSquared,
        iterations,
        converged,
    };
}

/**
 * Calculate Jacobian matrix using finite differences.
 */
function calculateJacobian(
    x: number[],
    params: number[],
    modelFunc: (x: number[], params: number[]) => number[]
): number[][] {
    const n = x.length;
    const p = params.length;
    const J: number[][] = [];
    const y0 = modelFunc(x, params);
    const epsilon = 1e-8;

    for (let i = 0; i < n; i++) {
        J[i] = [];
    }

    for (let j = 0; j < p; j++) {
        const paramsPlus = [...params];
        paramsPlus[j] += epsilon;
        const yPlus = modelFunc(x, paramsPlus);

        for (let i = 0; i < n; i++) {
            J[i][j] = (yPlus[i] - y0[i]) / epsilon;
        }
    }

    return J;
}

/**
 * Transpose a matrix.
 */
function transpose(matrix: number[][]): number[][] {
    const rows = matrix.length;
    const cols = matrix[0].length;
    const result: number[][] = [];

    for (let j = 0; j < cols; j++) {
        result[j] = [];
        for (let i = 0; i < rows; i++) {
            result[j][i] = matrix[i][j];
        }
    }

    return result;
}

/**
 * Multiply two matrices.
 */
function matrixMultiply(A: number[][], B: number[][]): number[][] {
    const rowsA = A.length;
    const colsA = A[0].length;
    const colsB = B[0].length;
    const result: number[][] = [];

    for (let i = 0; i < rowsA; i++) {
        result[i] = [];
        for (let j = 0; j < colsB; j++) {
            let sum = 0;
            for (let k = 0; k < colsA; k++) {
                sum += A[i][k] * B[k][j];
            }
            result[i][j] = sum;
        }
    }

    return result;
}

/**
 * Solve linear system Ax = b using LU decomposition with partial pivoting.
 */
function solveLinear(A: number[][], b: number[]): number[] | null {
    const n = A.length;
    const aug = A.map((row, i) => [...row, b[i]]);

    // Forward elimination with partial pivoting
    for (let i = 0; i < n; i++) {
        // Find pivot
        let maxRow = i;
        for (let k = i + 1; k < n; k++) {
            if (Math.abs(aug[k][i]) > Math.abs(aug[maxRow][i])) {
                maxRow = k;
            }
        }
        [aug[i], aug[maxRow]] = [aug[maxRow], aug[i]];

        if (Math.abs(aug[i][i]) < 1e-12) {
            return null; // Singular matrix
        }

        // Eliminate column
        for (let k = i + 1; k < n; k++) {
            const factor = aug[k][i] / aug[i][i];
            for (let j = i; j <= n; j++) {
                aug[k][j] -= factor * aug[i][j];
            }
        }
    }

    // Back substitution
    const x = new Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) {
        x[i] = aug[i][n];
        for (let j = i + 1; j < n; j++) {
            x[i] -= aug[i][j] * x[j];
        }
        x[i] /= aug[i][i];
    }

    return x;
}
