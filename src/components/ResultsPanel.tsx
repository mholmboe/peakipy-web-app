import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Download, FileText, Table2 } from 'lucide-react';
import type { FitResult, DataPoint, ProcessingOptions, BaselineOptions } from '@/lib/peakFitting';
import { exportResults, exportDataFile } from '@/lib/peakFitting';

interface ResultsPanelProps {
  fitResult?: FitResult;
  originalData: DataPoint[];
  processedData: DataPoint[];
  processingOptions: ProcessingOptions;
  baselineOptions: BaselineOptions;
  fileName?: string;
}

export function ResultsPanel({
  fitResult,
  originalData,
  processedData,
  processingOptions,
  baselineOptions,
  fileName,
}: ResultsPanelProps) {
  const downloadResults = () => {
    if (!fitResult) return;

    const content = exportResults(processedData, fitResult, processingOptions, baselineOptions);
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName ? `${fileName.replace(/\.[^/.]+$/, '')}_results.txt` : 'peakipy_results.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadData = () => {
    const content = exportDataFile(processedData);
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName ? `${fileName.replace(/\.[^/.]+$/, '')}_data.txt` : 'peakipy_data.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  const getRSquaredColor = (r2: number) => {
    if (r2 >= 0.99) return 'bg-green-500/20 text-green-700 dark:text-green-300';
    if (r2 >= 0.95) return 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-300';
    return 'bg-red-500/20 text-red-700 dark:text-red-300';
  };

  return (
    <Card className="bg-card/80 backdrop-blur">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg font-medium flex items-center justify-between">
          Results
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={downloadData}
              disabled={processedData.length === 0}
            >
              <Table2 className="w-4 h-4 mr-1" />
              Export Data
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={downloadResults}
              disabled={!fitResult}
            >
              <Download className="w-4 h-4 mr-1" />
              Export Results
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Data Info */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Data Points</p>
            <p className="text-2xl font-semibold">{processedData.length}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">X Range</p>
            <p className="text-sm font-mono">
              {processedData.length > 0
                ? `${processedData[0].x.toFixed(2)} — ${processedData[processedData.length - 1].x.toFixed(2)}`
                : '—'}
            </p>
          </div>
        </div>

        {/* Fit Statistics */}
        {fitResult && (
          <>
            <div className="border-t border-border pt-4">
              <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Fit Statistics
                {fitResult.converged ? (
                  <Badge variant="outline" className="bg-green-500/10 text-green-600">Converged</Badge>
                ) : (
                  <Badge variant="outline" className="bg-yellow-500/10 text-yellow-600">Not converged</Badge>
                )}
                <span className="text-xs text-muted-foreground">({fitResult.iterations} iter)</span>
              </h4>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">R²</p>
                  <Badge className={getRSquaredColor(fitResult.rSquared)}>
                    {fitResult.rSquared.toFixed(6)}
                  </Badge>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Adj. R²</p>
                  <p className="text-sm font-mono">{fitResult.adjustedRSquared.toFixed(6)}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">RMSE</p>
                  <p className="text-sm font-mono">{fitResult.rmse.toFixed(6)}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">χ² (reduced)</p>
                  <p className="text-sm font-mono">{fitResult.reducedChiSquared.toFixed(4)}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">AIC</p>
                  <p className="text-sm font-mono">{fitResult.aic.toFixed(2)}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">BIC</p>
                  <p className="text-sm font-mono">{fitResult.bic.toFixed(2)}</p>
                </div>
              </div>
            </div>

            {/* Fitted Parameters */}
            <div className="border-t border-border pt-4">
              <h4 className="text-sm font-medium mb-3">Fitted Parameters</h4>

              {/* Total Amplitude - shown once */}
              <div className="p-3 bg-primary/10 rounded-lg mb-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Total Amplitude</span>
                  <span className="font-mono text-lg">
                    {fitResult.parameters.length > 0
                      ? fitResult.parameters.reduce((sum, p) => sum + p.amplitude * (p.weight ?? 1), 0).toFixed(4)
                      : '—'}
                  </span>
                </div>
              </div>

              <div className="space-y-3">
                {fitResult.parameters.map((param, idx) => {
                  // Calculate weight as fraction (should already be set, but compute for display safety)
                  const totalAmp = fitResult.parameters.reduce((sum, p) => sum + p.amplitude * (p.weight ?? 1), 0);
                  const individualAmp = param.amplitude * (param.weight ?? 1);
                  const weight = totalAmp > 0 ? individualAmp / totalAmp : 0;

                  return (
                    <div
                      key={param.id}
                      className="p-3 bg-muted/30 rounded-lg space-y-2"
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{
                            backgroundColor: [
                              'hsl(198, 93%, 59%)',
                              'hsl(213, 93%, 67%)',
                              'hsl(158, 64%, 51%)',
                              'hsl(270, 60%, 60%)',
                              'hsl(45, 95%, 55%)',
                            ][idx % 5],
                          }}
                        />
                        <span className="font-medium text-sm">
                          Peak {param.id}
                        </span>
                        <Badge variant="outline" className="text-xs">
                          {param.profile}
                        </Badge>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div>
                          <p className="text-muted-foreground">Center</p>
                          <p className="font-mono">{param.center.toFixed(4)}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Weight</p>
                          <p className="font-mono">{(weight * 100).toFixed(1)}%</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Width</p>
                          <p className="font-mono">{param.width.toFixed(4)}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {!fitResult && processedData.length > 0 && (
          <div className="text-center py-8 text-muted-foreground">
            <p>Add peak components and run fit to see results</p>
          </div>
        )}

        {processedData.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            <p>Load data to get started</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
