import { useMemo, useRef, useCallback } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceDot,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';
import type { DataPoint, FitResult, PeakComponent } from '@/lib/peakFitting';
import { calculatePeak } from '@/lib/peakFitting';

interface DataChartProps {
  data: DataPoint[];
  fitResult?: FitResult;
  showBaseline?: boolean;
  showComponents?: boolean;
  showResiduals?: boolean;
  title?: string;
  previewComponents?: PeakComponent[];
  previewBaseline?: DataPoint[];
  onExport?: () => void;
  /** Manual baseline control points */
  manualBaselinePoints?: DataPoint[];
  /** Callback when user clicks chart to add a manual baseline point */
  onAddManualPoint?: (point: DataPoint) => void;
  /** Whether to show manual baseline point markers */
  showManualMarkers?: boolean;
  /** Whether to normalize the baseline-corrected data to max=1 */
  normalize?: boolean;
}

// Format tick values to show clean, nicely spaced values
const formatTick = (value: number): string => {
  if (value === 0) return '0';
  const absVal = Math.abs(value);
  if (absVal >= 10000 || (absVal < 0.001 && absVal !== 0)) {
    return value.toExponential(1);
  }
  if (absVal >= 100) return Math.round(value).toString();
  if (absVal >= 10) return value.toFixed(1);
  if (absVal >= 1) return value.toFixed(2).replace(/\.?0+$/, '');
  if (absVal >= 0.01) return value.toFixed(2).replace(/\.?0+$/, '');
  return value.toFixed(3).replace(/\.?0+$/, '');
};

const COLORS = {
  experimental: 'hsl(var(--chart-1))',
  corrected: 'hsl(32, 95%, 55%)',
  fitted: 'hsl(var(--chart-2))',
  baseline: 'hsl(var(--muted))',
  residual: 'hsl(var(--destructive))',
  components: [
    'hsl(198, 93%, 59%)',
    'hsl(213, 93%, 67%)',
    'hsl(158, 64%, 51%)',
    'hsl(270, 60%, 60%)',
    'hsl(45, 95%, 55%)',
  ],
};

// Generate nice evenly-spaced tick values
const generateNiceTicks = (min: number, max: number, targetCount: number = 5): number[] => {
  const range = max - min;
  if (range === 0) return [min];
  const roughStep = range / (targetCount - 1);
  const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const normalizedStep = roughStep / magnitude;
  let niceStep: number;
  if (normalizedStep <= 1) niceStep = 1;
  else if (normalizedStep <= 2) niceStep = 2;
  else if (normalizedStep <= 2.5) niceStep = 2.5;
  else if (normalizedStep <= 5) niceStep = 5;
  else niceStep = 10;
  const step = niceStep * magnitude;
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let tick = niceMin; tick <= niceMax + step * 0.001; tick += step) {
    ticks.push(Math.round(tick * 1e10) / 1e10);
  }
  return ticks;
};

export function DataChart({
  data,
  fitResult,
  showBaseline = true,
  showComponents = true,
  showResiduals = false,
  title = 'Data Visualization',
  previewComponents,
  previewBaseline,
  manualBaselinePoints,
  onAddManualPoint,
  showManualMarkers = false,
  normalize = false,
}: DataChartProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const plot1Ref = useRef<HTMLDivElement>(null);

  const exportChart = useCallback(() => {
    if (!chartRef.current) return;
    const svg = chartRef.current.querySelector('svg');
    if (!svg) return;
    const svgData = new XMLSerializer().serializeToString(svg);
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${title.replace(/\s+/g, '_')}_chart.svg`;
    link.click();
    URL.revokeObjectURL(url);
  }, [title]);

  // Prepare chart data for all three plots
  const { plot1Data, plot2Data, plot3Data, axisConfig } = useMemo(() => {
    if (data.length === 0) {
      return {
        plot1Data: [],
        plot2Data: [],
        plot3Data: [],
        axisConfig: {
          xDomain: [0, 100] as [number, number],
          xTicks: [0, 20, 40, 60, 80, 100],
          yDomain1: [0, 1] as [number, number],
          yTicks1: [0, 0.2, 0.4, 0.6, 0.8, 1.0],
          yDomain2: [-0.2, 1.2] as [number, number],
          yTicks2: [-0.2, 0, 0.2, 0.4, 0.6, 0.8, 1.0, 1.2],
          yDomain3: [-0.1, 0.1] as [number, number],
          yTicks3: [-0.1, 0, 0.1],
        },
      };
    }

    const activeBaseline = previewBaseline || fitResult?.baseline;
    const activeComponents = previewComponents || (fitResult?.parameters ?? []);

    // Plot 1: Original data + baseline
    const p1Data = data.map(d => {
      const point: Record<string, number> = { x: d.x, experimental: d.y };
      if (activeBaseline) {
        const bl = activeBaseline.find(b => Math.abs(b.x - d.x) < 0.0001);
        if (bl) point.baseline = bl.y;
      }
      return point;
    });

    // Plot 2: Baseline-corrected + fitted components
    // First pass: calculate raw corrected values to find max for normalization
    let rawCorrectedValues: { x: number; corrected: number }[] = [];
    if (!fitResult?.baselineCorrectedData && normalize) {
      rawCorrectedValues = data.map(d => {
        const bl = activeBaseline?.find(b => Math.abs(b.x - d.x) < 0.0001)?.y ?? 0;
        return { x: d.x, corrected: d.y - bl };
      });
    }
    const preFitMaxCorrected = rawCorrectedValues.length > 0
      ? Math.max(...rawCorrectedValues.map(v => v.corrected), 0.001)
      : 1;
    const preFitScaleFactor = normalize && !fitResult?.baselineCorrectedData ? 1.0 / preFitMaxCorrected : 1;

    const p2Data = data.map((d, i) => {
      const point: Record<string, number> = { x: d.x };

      // Always use fitResult.baselineCorrectedData when available (it's scaled for normalization)
      if (fitResult?.baselineCorrectedData) {
        const correctedPoint = fitResult.baselineCorrectedData.find(c => Math.abs(c.x - d.x) < 0.0001);
        point.corrected = correctedPoint?.y ?? (d.y - (activeBaseline?.find(b => Math.abs(b.x - d.x) < 0.0001)?.y ?? 0));
      } else {
        // No fit result: calculate from raw data, apply normalization scaling
        const bl = activeBaseline?.find(b => Math.abs(b.x - d.x) < 0.0001)?.y ?? 0;
        point.corrected = (d.y - bl) * preFitScaleFactor;
      }

      // For fitted/preview curves, use fitResult when no preview, else calculate preview
      if (previewComponents && previewComponents.length > 0) {
        // Live Preview mode: calculate from current component parameters
        let sumY = 0;
        previewComponents.forEach((comp, idx) => {
          const yVal = calculatePeak(d.x, comp);
          point[`component${idx + 1}`] = yVal;
          sumY += yVal;
        });
        point.fitted = sumY;
      } else if (fitResult) {
        // Use fitResult data (already scaled)
        const fitted = fitResult.fittedData.find(f => Math.abs(f.x - d.x) < 0.0001);
        if (fitted) point.fitted = fitted.y;

        fitResult.components.forEach((comp, idx) => {
          const compPoint = comp.find(c => Math.abs(c.x - d.x) < 0.0001);
          if (compPoint) point[`component${idx + 1}`] = compPoint.y;
        });
      }
      return point;
    });

    // Plot 3: Residuals
    const p3Data = data.map(d => {
      const point: Record<string, number> = { x: d.x, residual: 0 };
      if (fitResult) {
        const res = fitResult.residuals.find(r => Math.abs(r.x - d.x) < 0.0001);
        if (res) point.residual = res.y;
      }
      return point;
    });

    // Calculate axis config
    const xValues = data.map(d => d.x);
    const xDataMin = Math.min(...xValues);
    const xDataMax = Math.max(...xValues);
    const xRange = xDataMax - xDataMin;
    let xDomainMin = xDataMin >= 0 && xDataMin < xRange * 0.15 ? 0 : xDataMin;
    const xTicks = generateNiceTicks(xDomainMin, xDataMax, 6);
    const xDomain: [number, number] = [xTicks[0], xTicks[xTicks.length - 1]];

    // Y domain for plot 1 (original data)
    const y1Values = p1Data.flatMap(d => [d.experimental, d.baseline].filter(v => v !== undefined) as number[]);
    const y1Min = Math.min(...y1Values);
    const y1Max = Math.max(...y1Values);
    const isNormalized1 = y1Max > 0.8 && y1Max <= 1.3 && y1Min >= -0.3;
    let yDomain1: [number, number], yTicks1: number[];
    if (isNormalized1) {
      yTicks1 = [-0.2, 0, 0.2, 0.4, 0.6, 0.8, 1.0, 1.2];
      yDomain1 = [-0.2, 1.2];
    } else {
      yTicks1 = generateNiceTicks(y1Min >= 0 ? 0 : y1Min, y1Max, 6);
      yDomain1 = [yTicks1[0], yTicks1[yTicks1.length - 1]];
    }

    // Y domain for plot 2 (corrected data)
    const y2Values = p2Data.flatMap(d =>
      Object.entries(d).filter(([k]) => k !== 'x').map(([, v]) => v)
    );
    const y2Min = Math.min(...y2Values);
    const y2Max = Math.max(...y2Values);
    const isNormalized2 = y2Max > 0.8 && y2Max <= 1.3 && y2Min >= -0.3;
    let yDomain2: [number, number], yTicks2: number[];
    if (isNormalized2) {
      yTicks2 = [-0.2, 0, 0.2, 0.4, 0.6, 0.8, 1.0, 1.2];
      yDomain2 = [-0.2, 1.2];
    } else {
      yTicks2 = generateNiceTicks(y2Min >= 0 ? 0 : y2Min, y2Max, 6);
      yDomain2 = [yTicks2[0], yTicks2[yTicks2.length - 1]];
    }

    // Y domain for plot 3 (residuals)
    const y3Values = p3Data.map(d => d.residual);
    const y3Min = Math.min(...y3Values, 0);
    const y3Max = Math.max(...y3Values, 0);
    const y3Bound = Math.max(Math.abs(y3Min), Math.abs(y3Max), 0.05);
    const yTicks3 = generateNiceTicks(-y3Bound, y3Bound, 5);
    const yDomain3: [number, number] = [yTicks3[0], yTicks3[yTicks3.length - 1]];

    return {
      plot1Data: p1Data,
      plot2Data: p2Data,
      plot3Data: p3Data,
      axisConfig: { xDomain, xTicks, yDomain1, yTicks1, yDomain2, yTicks2, yDomain3, yTicks3 },
    };
  }, [data, fitResult, previewComponents, previewBaseline]);

  if (data.length === 0) {
    return (
      <Card className="bg-card/80 backdrop-blur">
        <CardContent className="flex items-center justify-center h-[400px] text-muted-foreground">
          Load data to visualize
        </CardContent>
      </Card>
    );
  }

  const numComps = previewComponents?.length || fitResult?.components?.length || 0;
  const hasBaseline = showBaseline && (fitResult || previewBaseline);
  const hasFitOrPreview = fitResult || (previewComponents && previewComponents.length > 0);

  const tooltipStyle = {
    backgroundColor: 'hsl(var(--popover))',
    border: '1px solid hsl(var(--border))',
    borderRadius: '8px',
    color: 'hsl(var(--popover-foreground))',
  };

  const tooltipFormatter = (value: number) => {
    if (typeof value !== 'number') return value;
    if (Math.abs(value) >= 1000 || (Math.abs(value) < 0.01 && value !== 0)) {
      return value.toExponential(3);
    }
    return value.toPrecision(4);
  };

  const tooltipLabelFormatter = (label: number) => {
    if (typeof label !== 'number') return label;
    if (Math.abs(label) >= 1000 || (Math.abs(label) < 0.01 && label !== 0)) {
      return `x = ${label.toExponential(3)}`;
    }
    return `x = ${label.toPrecision(4)}`;
  };

  return (
    <Card className="bg-card/80 backdrop-blur">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg font-medium flex items-center justify-between">
          {title}
          <Button variant="outline" size="sm" onClick={exportChart}>
            <Download className="w-4 h-4 mr-1" />
            Export
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent ref={chartRef} className="space-y-4">

        {/* Plot 1: Original Data + Baseline */}
        <div>
          <h4 className="text-sm font-medium text-muted-foreground mb-2">
            Original Data
            {showManualMarkers && <span className="text-xs ml-2 text-blue-400">(Click to add baseline points)</span>}
          </h4>
          <div className="h-[250px]" ref={plot1Ref}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={plot1Data}
                margin={{ top: 10, right: 30, left: 10, bottom: 10 }}
                onClick={(e, event) => {
                  if (!showManualMarkers || !onAddManualPoint) return;

                  // Get x from activePayload (snaps to nearest data point)
                  let x: number;
                  if (e?.activePayload?.[0]?.payload?.x !== undefined) {
                    x = e.activePayload[0].payload.x;
                  } else {
                    return;
                  }

                  // Get y from native mouse event + actual plot area
                  const nativeEvent = event as unknown as MouseEvent;
                  if (!nativeEvent?.clientY || !plot1Ref.current) return;

                  // Find the actual cartesian grid area (the plot surface)
                  const gridArea = plot1Ref.current.querySelector('.recharts-cartesian-grid');
                  if (!gridArea) return;

                  const gridRect = gridArea.getBoundingClientRect();
                  const plotHeight = gridRect.height;

                  const yPixel = nativeEvent.clientY - gridRect.top;
                  const yRatio = 1 - Math.max(0, Math.min(1, yPixel / plotHeight));

                  const [yMin, yMax] = axisConfig.yDomain1;
                  const y = yMin + yRatio * (yMax - yMin);

                  onAddManualPoint({ x, y });
                }}
                style={{ cursor: showManualMarkers ? 'crosshair' : 'default' }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
                <XAxis
                  dataKey="x"
                  type="number"
                  domain={axisConfig.xDomain}
                  ticks={axisConfig.xTicks}
                  tickFormatter={formatTick}
                  tick={{ fill: 'hsl(var(--foreground))', fontSize: 12 }}
                  axisLine={{ stroke: 'hsl(var(--border))' }}
                  tickLine={{ stroke: 'hsl(var(--border))' }}
                />
                <YAxis
                  domain={axisConfig.yDomain1}
                  ticks={axisConfig.yTicks1}
                  tickFormatter={formatTick}
                  tick={{ fill: 'hsl(var(--foreground))', fontSize: 12 }}
                  axisLine={{ stroke: 'hsl(var(--border))' }}
                  tickLine={{ stroke: 'hsl(var(--border))' }}
                />
                <Tooltip contentStyle={tooltipStyle} formatter={tooltipFormatter} labelFormatter={tooltipLabelFormatter} />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="experimental"
                  stroke={COLORS.experimental}
                  strokeWidth={2}
                  dot={false}
                  name="Experimental"
                />
                {hasBaseline && (
                  <Line
                    type="monotone"
                    dataKey="baseline"
                    stroke={COLORS.baseline}
                    strokeWidth={1.5}
                    strokeDasharray="5 5"
                    dot={false}
                    name="Baseline"
                  />
                )}
                {/* Manual baseline control point markers */}
                {showManualMarkers && manualBaselinePoints?.map((pt, idx) => (
                  <ReferenceDot
                    key={`manual-pt-${idx}`}
                    x={pt.x}
                    y={pt.y}
                    r={6}
                    fill="hsl(45, 95%, 55%)"
                    stroke="hsl(45, 95%, 35%)"
                    strokeWidth={2}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Plot 2: Baseline Corrected + Fitted Components */}
        <div>
          <h4 className="text-sm font-medium text-muted-foreground mb-2">Baseline Corrected</h4>
          <div className="h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={plot2Data} margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
                <XAxis
                  dataKey="x"
                  type="number"
                  domain={axisConfig.xDomain}
                  ticks={axisConfig.xTicks}
                  tickFormatter={formatTick}
                  tick={{ fill: 'hsl(var(--foreground))', fontSize: 12 }}
                  axisLine={{ stroke: 'hsl(var(--border))' }}
                  tickLine={{ stroke: 'hsl(var(--border))' }}
                />
                <YAxis
                  domain={axisConfig.yDomain2}
                  ticks={axisConfig.yTicks2}
                  tickFormatter={formatTick}
                  tick={{ fill: 'hsl(var(--foreground))', fontSize: 12 }}
                  axisLine={{ stroke: 'hsl(var(--border))' }}
                  tickLine={{ stroke: 'hsl(var(--border))' }}
                />
                <Tooltip contentStyle={tooltipStyle} formatter={tooltipFormatter} labelFormatter={tooltipLabelFormatter} />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="corrected"
                  stroke={COLORS.corrected}
                  strokeWidth={2}
                  dot={false}
                  name="Exp (Corrected)"
                />
                {hasFitOrPreview && (
                  <Line
                    type="monotone"
                    dataKey="fitted"
                    stroke={COLORS.fitted}
                    strokeWidth={2}
                    strokeDasharray={previewComponents ? "3 3" : undefined}
                    dot={false}
                    name={previewComponents ? "Preview" : "Fitted"}
                  />
                )}
                {showComponents && Array.from({ length: numComps }, (_, idx) => (
                  <Line
                    key={`component-${idx}`}
                    type="monotone"
                    dataKey={`component${idx + 1}`}
                    stroke={COLORS.components[idx % COLORS.components.length]}
                    strokeWidth={1.5}
                    dot={false}
                    name={`Peak ${idx + 1}`}
                    opacity={0.7}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Plot 3: Residuals (shown after fitting) */}
        {showResiduals && fitResult && (
          <div>
            <h4 className="text-sm font-medium text-muted-foreground mb-2">Residuals</h4>
            <div className="h-[120px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={plot3Data} margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
                  <XAxis
                    dataKey="x"
                    type="number"
                    domain={axisConfig.xDomain}
                    ticks={axisConfig.xTicks}
                    tickFormatter={formatTick}
                    tick={{ fill: 'hsl(var(--foreground))', fontSize: 10 }}
                    axisLine={{ stroke: 'hsl(var(--border))' }}
                    tickLine={{ stroke: 'hsl(var(--border))' }}
                  />
                  <YAxis
                    domain={axisConfig.yDomain3}
                    ticks={axisConfig.yTicks3}
                    tickFormatter={formatTick}
                    tick={{ fill: 'hsl(var(--foreground))', fontSize: 10 }}
                    axisLine={{ stroke: 'hsl(var(--border))' }}
                    tickLine={{ stroke: 'hsl(var(--border))' }}
                  />
                  <Tooltip contentStyle={tooltipStyle} formatter={tooltipFormatter} labelFormatter={tooltipLabelFormatter} />
                  <ReferenceLine y={0} stroke="hsl(var(--muted))" />
                  <Line
                    type="monotone"
                    dataKey="residual"
                    stroke={COLORS.residual}
                    strokeWidth={1}
                    dot={false}
                    name="Residuals"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
