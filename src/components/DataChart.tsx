import { useMemo } from 'react';
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
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { DataPoint, FitResult } from '@/lib/peakFitting';

interface DataChartProps {
  data: DataPoint[];
  fitResult?: FitResult;
  showBaseline?: boolean;
  showComponents?: boolean;
  showResiduals?: boolean;
  title?: string;
}

const COLORS = {
  experimental: 'hsl(var(--chart-1))',
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

export function DataChart({
  data,
  fitResult,
  showBaseline = true,
  showComponents = true,
  showResiduals = false,
  title = 'Data Visualization',
}: DataChartProps) {
  const chartData = useMemo(() => {
    if (data.length === 0) return [];

    return data.map((d, i) => {
      const point: Record<string, number> = {
        x: d.x,
        experimental: d.y,
      };

      if (fitResult) {
        const fitted = fitResult.fittedData.find(f => Math.abs(f.x - d.x) < 0.0001);
        if (fitted) point.fitted = fitted.y;

        const baseline = fitResult.baseline.find(b => Math.abs(b.x - d.x) < 0.0001);
        if (baseline) point.baseline = baseline.y;

        const residual = fitResult.residuals.find(r => Math.abs(r.x - d.x) < 0.0001);
        if (residual) point.residual = residual.y;

        fitResult.components.forEach((comp, compIdx) => {
          const compPoint = comp.find(c => Math.abs(c.x - d.x) < 0.0001);
          if (compPoint) point[`component${compIdx + 1}`] = compPoint.y;
        });
      }

      return point;
    });
  }, [data, fitResult]);

  if (data.length === 0) {
    return (
      <Card className="bg-card/80 backdrop-blur">
        <CardContent className="flex items-center justify-center h-[400px] text-muted-foreground">
          Load data to visualize
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card/80 backdrop-blur">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[400px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
              <XAxis
                dataKey="x"
                tick={{ fill: 'hsl(var(--foreground))', fontSize: 12 }}
                axisLine={{ stroke: 'hsl(var(--border))' }}
                tickLine={{ stroke: 'hsl(var(--border))' }}
              />
              <YAxis
                tick={{ fill: 'hsl(var(--foreground))', fontSize: 12 }}
                axisLine={{ stroke: 'hsl(var(--border))' }}
                tickLine={{ stroke: 'hsl(var(--border))' }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--popover))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                  color: 'hsl(var(--popover-foreground))',
                }}
              />
              <Legend />

              {/* Experimental data */}
              <Line
                type="monotone"
                dataKey="experimental"
                stroke={COLORS.experimental}
                strokeWidth={2}
                dot={false}
                name="Experimental"
              />

              {/* Fitted curve */}
              {fitResult && (
                <Line
                  type="monotone"
                  dataKey="fitted"
                  stroke={COLORS.fitted}
                  strokeWidth={2}
                  strokeDasharray="5 5"
                  dot={false}
                  name="Fitted"
                />
              )}

              {/* Baseline */}
              {showBaseline && fitResult && (
                <Line
                  type="monotone"
                  dataKey="baseline"
                  stroke={COLORS.baseline}
                  strokeWidth={1}
                  strokeDasharray="3 3"
                  dot={false}
                  name="Baseline"
                />
              )}

              {/* Components */}
              {showComponents &&
                fitResult?.components.map((_, idx) => (
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

              {/* Zero reference for residuals */}
              {showResiduals && <ReferenceLine y={0} stroke="hsl(var(--border))" />}
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Residuals chart */}
        {showResiduals && fitResult && (
          <div className="mt-4 h-[150px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
                <XAxis
                  dataKey="x"
                  tick={{ fill: 'hsl(var(--foreground))', fontSize: 10 }}
                  axisLine={{ stroke: 'hsl(var(--border))' }}
                  tickLine={{ stroke: 'hsl(var(--border))' }}
                />
                <YAxis
                  tick={{ fill: 'hsl(var(--foreground))', fontSize: 10 }}
                  axisLine={{ stroke: 'hsl(var(--border))' }}
                  tickLine={{ stroke: 'hsl(var(--border))' }}
                />
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
        )}
      </CardContent>
    </Card>
  );
}
