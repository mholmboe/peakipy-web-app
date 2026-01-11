/**
 * Peak initialization methods for automatic parameter estimation.
 * Implements GMM (Gaussian Mixture Model) and evenly-spaced initialization.
 */

import type { DataPoint, PeakComponent } from './peakFitting';

/**
 * Initialize peaks using a simplified GMM-like approach.
 * Finds local maxima and estimates peak parameters from them.
 * 
 * @param data - Data points (baseline-corrected)
 * @param nPeaks - Number of peaks to find
 * @param profile - Peak profile type
 * @returns Array of initialized peak components
 */
export function initWithGMM(
    data: DataPoint[],
    nPeaks: number,
    profile: 'gaussian' | 'lorentzian' | 'voigt' = 'gaussian'
): PeakComponent[] {
    if (data.length < 3 || nPeaks < 1) {
        return initEvenlySpaced(data, nPeaks, profile);
    }

    const y = data.map(d => d.y);
    const x = data.map(d => d.x);
    const yMax = Math.max(...y);
    const yMin = Math.min(...y);
    const yRange = yMax - yMin;

    if (yRange === 0) {
        return initEvenlySpaced(data, nPeaks, profile);
    }

    // Find local maxima
    const peaks: { x: number; y: number; prominence: number }[] = [];

    for (let i = 1; i < data.length - 1; i++) {
        if (y[i] > y[i - 1] && y[i] > y[i + 1]) {
            // Calculate prominence (height above surrounding valleys)
            let leftValley = y[i];
            for (let j = i - 1; j >= 0; j--) {
                if (y[j] < leftValley) leftValley = y[j];
                if (y[j] > y[i]) break;
            }

            let rightValley = y[i];
            for (let j = i + 1; j < data.length; j++) {
                if (y[j] < rightValley) rightValley = y[j];
                if (y[j] > y[i]) break;
            }

            const prominence = y[i] - Math.max(leftValley, rightValley);

            if (prominence > yRange * 0.05) { // Only consider peaks with >5% prominence
                peaks.push({ x: x[i], y: y[i], prominence });
            }
        }
    }

    // Sort by prominence and take top nPeaks
    peaks.sort((a, b) => b.prominence - a.prominence);
    const selectedPeaks = peaks.slice(0, nPeaks);

    // Sort by x position for consistent ordering
    selectedPeaks.sort((a, b) => a.x - b.x);

    // If we didn't find enough peaks, use evenly spaced
    if (selectedPeaks.length < nPeaks) {
        const evenlySpaced = initEvenlySpaced(data, nPeaks - selectedPeaks.length, profile);

        // Merge found peaks with evenly spaced ones
        const result: PeakComponent[] = [];
        let nextId = 1;

        for (const peak of selectedPeaks) {
            result.push({
                id: nextId++,
                profile,
                center: peak.x,
                amplitude: peak.y,
                width: estimateWidth(data, peak.x),
                weight: 1.0,
            });
        }

        for (const comp of evenlySpaced) {
            result.push({ ...comp, id: nextId++ });
        }

        return result.sort((a, b) => a.center - b.center).map((c, i) => ({ ...c, id: i + 1 }));
    }

    // Estimate parameters for each peak
    return selectedPeaks.map((peak, i) => ({
        id: i + 1,
        profile,
        center: peak.x,
        amplitude: peak.y,
        width: estimateWidth(data, peak.x),
        weight: 1.0,
    }));
}

/**
 * Estimate peak width at half maximum from data.
 */
function estimateWidth(data: DataPoint[], center: number): number {
    const xRange = Math.max(...data.map(d => d.x)) - Math.min(...data.map(d => d.x));

    // Find the data point closest to center
    let centerIdx = 0;
    let minDist = Infinity;
    for (let i = 0; i < data.length; i++) {
        const dist = Math.abs(data[i].x - center);
        if (dist < minDist) {
            minDist = dist;
            centerIdx = i;
        }
    }

    const centerY = data[centerIdx].y;
    const halfMax = centerY / 2;

    // Find half-max points on each side
    let leftWidth = xRange / 20;
    for (let i = centerIdx - 1; i >= 0; i--) {
        if (data[i].y <= halfMax) {
            leftWidth = center - data[i].x;
            break;
        }
    }

    let rightWidth = xRange / 20;
    for (let i = centerIdx + 1; i < data.length; i++) {
        if (data[i].y <= halfMax) {
            rightWidth = data[i].x - center;
            break;
        }
    }

    // FWHM is approximately 2 * average of half-widths
    return Math.max(leftWidth + rightWidth, xRange / (data.length / 10));
}

/**
 * Initialize peaks evenly spaced across the data range.
 * Estimates amplitude from the data.
 * 
 * @param data - Data points
 * @param nPeaks - Number of peaks to create
 * @param profile - Peak profile type
 * @returns Array of initialized peak components
 */
export function initEvenlySpaced(
    data: DataPoint[],
    nPeaks: number,
    profile: 'gaussian' | 'lorentzian' | 'voigt' = 'gaussian'
): PeakComponent[] {
    if (data.length === 0 || nPeaks < 1) {
        return [];
    }

    const xMin = Math.min(...data.map(d => d.x));
    const xMax = Math.max(...data.map(d => d.x));
    const xRange = xMax - xMin || 1;

    const yMax = Math.max(...data.map(d => d.y));
    const yMin = Math.min(...data.map(d => d.y));

    // Estimate amplitude based on data range and number of peaks
    const baseAmplitude = Math.max((yMax - yMin) / nPeaks, yMax * 0.5);
    const defaultWidth = xRange / (4 * nPeaks);

    const components: PeakComponent[] = [];

    for (let i = 0; i < nPeaks; i++) {
        // Place peaks at evenly spaced positions
        const center = xMin + ((i + 1) / (nPeaks + 1)) * xRange;

        components.push({
            id: i + 1,
            profile,
            center,
            amplitude: baseAmplitude,
            width: defaultWidth,
            weight: 1.0,
        });
    }

    return components;
}
