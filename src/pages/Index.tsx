import { useState, useCallback, useMemo } from 'react';
import { Header } from '@/components/Header';
import { Hero } from '@/components/Hero';
import { FileUpload } from '@/components/FileUpload';
import { DataChart } from '@/components/DataChart';
import { ControlPanel } from '@/components/ControlPanel';
import { ResultsPanel } from '@/components/ResultsPanel';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import {
  parseDataFile,
  processData,
  calculateBaseline,
  fitPeaks,
  type DataPoint,
  type PeakComponent,
  type ProcessingOptions,
  type BaselineOptions,
  type FitResult,
} from '@/lib/peakFitting';

const Index = () => {
  const [rawData, setRawData] = useState<DataPoint[]>([]);
  const [fileName, setFileName] = useState<string>();
  const [processing, setProcessing] = useState<ProcessingOptions>({
    normalize: false,
  });
  const [baseline, setBaseline] = useState<BaselineOptions>({
    method: 'none',
    degree: 2,
    lambda: 1e5,
    p: 0.01,
    radius: 10,
    shirleyIterations: 50,
    shirleyTolerance: 1e-5,
  });
  const [components, setComponents] = useState<PeakComponent[]>([]);
  const [fitResult, setFitResult] = useState<FitResult>();
  const [isLoading, setIsLoading] = useState(false);
  const [showBaseline, setShowBaseline] = useState(true);
  const [showComponents, setShowComponents] = useState(true);
  const [showResiduals, setShowResiduals] = useState(false);
  const [livePreview, setLivePreview] = useState(true);

  // Process data when raw data or options change
  const processedData = useMemo(() => {
    if (rawData.length === 0) return [];
    return processData(rawData, processing);
  }, [rawData, processing]);

  // Calculate data range
  const dataRange = useMemo(() => {
    if (processedData.length === 0) return { min: 0, max: 100 };
    const xValues = processedData.map(d => d.x);
    return {
      min: Math.min(...xValues),
      max: Math.max(...xValues),
    };
  }, [processedData]);

  // Calculate baseline when options change
  // For manual baseline, only calculate when not in edit mode
  const calculatedBaseline = useMemo(() => {
    if (processedData.length === 0) return [];
    // Skip manual baseline while selecting points
    if (baseline.method === 'manual' && baseline.manualEditMode) {
      return processedData.map(d => ({ x: d.x, y: 0 }));
    }
    return calculateBaseline(processedData, baseline);
  }, [processedData, baseline]);

  // Handle file load
  const handleFileLoad = useCallback((content: string, name: string) => {
    try {
      const data = parseDataFile(content);
      if (data.length === 0) {
        toast.error('No valid data found in file');
        return;
      }

      setRawData(data);
      setFileName(name);
      setComponents([]);
      setFitResult(undefined);
      toast.success(`Loaded ${data.length} data points from ${name}`);
    } catch (error) {
      toast.error('Failed to parse data file');
      console.error(error);
    }
  }, []);

  // Run fitting
  const handleFit = useCallback(() => {
    if (processedData.length === 0) {
      toast.error('No data loaded');
      return;
    }
    if (components.length === 0) {
      toast.error('Add at least one peak component');
      return;
    }

    setIsLoading(true);

    // Use setTimeout to allow UI to update
    setTimeout(() => {
      try {
        const result = fitPeaks(processedData, components, calculatedBaseline, baseline, 200);
        setFitResult(result);

        // Recalculate Total Amplitude and Weights from fitted parameters
        // Total Amplitude = sum of all component amplitudes
        // Weight = component amplitude / total amplitude (fractions summing to 1)
        const fittedAmps = result.parameters.map(p => p.amplitude);
        const totalAmp = fittedAmps.reduce((sum, a) => sum + a, 0);
        const updatedComponents = result.parameters.map(p => ({
          ...p,
          amplitude: totalAmp,  // All components share the total amplitude
          weight: totalAmp > 0 ? p.amplitude / totalAmp : 1 / result.parameters.length,
        }));
        setComponents(updatedComponents);

        // After simultaneous optimization, update baseline state with optimized params
        // This ensures calculatedBaseline is recomputed with correct values
        if (baseline.optimizeSimultaneously && result.baselineParams) {
          const updatedBaseline = { ...baseline, autoBaseline: false };
          if (result.baselineParams.slope !== undefined) {
            updatedBaseline.slope = result.baselineParams.slope;
          }
          if (result.baselineParams.intercept !== undefined) {
            updatedBaseline.intercept = result.baselineParams.intercept;
          }
          if (result.baselineParams.coeffs !== undefined) {
            // Store coefficients for polynomial baseline
            (updatedBaseline as any).coeffs = result.baselineParams.coeffs;
          }
          if (result.baselineParams.lambda !== undefined) {
            updatedBaseline.lambda = result.baselineParams.lambda;
          }
          if (result.baselineParams.p !== undefined) {
            updatedBaseline.p = result.baselineParams.p;
          }
          if (result.baselineParams.radius !== undefined) {
            updatedBaseline.radius = result.baselineParams.radius;
          }
          setBaseline(updatedBaseline);
        }

        const status = result.converged ? '✓ Converged' : '⚠ Not converged';
        toast.success(`Fit complete! R² = ${result.rSquared.toFixed(4)} (${status}, ${result.iterations} iter)`);
      } catch (error) {
        toast.error('Fitting failed');
        console.error(error);
      } finally {
        setIsLoading(false);
      }
    }, 50);
  }, [processedData, components, calculatedBaseline, baseline]);

  // Reset everything
  const handleReset = useCallback(() => {
    setComponents([]);
    setFitResult(undefined);
    setProcessing({ normalize: false });
    setBaseline({
      method: 'none',
      degree: 2,
      lambda: 1e5,
      p: 0.01,
      radius: 10,
      shirleyIterations: 50,
      shirleyTolerance: 1e-5,
    });
    toast.info('Settings reset');
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <Hero />

      <main className="container py-8 space-y-8">
        {/* File Upload Section */}
        {rawData.length === 0 && (
          <section className="max-w-2xl mx-auto">
            <FileUpload onFileLoad={handleFileLoad} />
          </section>
        )}

        {/* Main Content */}
        {rawData.length > 0 && (
          <div className="grid lg:grid-cols-3 gap-6">
            {/* Left Column - Controls */}
            <div className="space-y-6">
              <ControlPanel
                processing={processing}
                baseline={baseline}
                components={components}
                dataRange={dataRange}
                processedData={processedData}
                calculatedBaseline={calculatedBaseline}
                onProcessingChange={setProcessing}
                onBaselineChange={setBaseline}
                onComponentsChange={setComponents}
                onFit={handleFit}
                onReset={handleReset}
                isLoading={isLoading}
              />

              {/* Upload new file button */}
              <div className="text-center">
                <label className="cursor-pointer text-sm text-primary hover:underline">
                  Load different file
                  <input
                    type="file"
                    accept=".txt,.csv,.dat,.xy"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onload = (evt) => {
                          handleFileLoad(evt.target?.result as string, file.name);
                        };
                        reader.readAsText(file);
                      }
                    }}
                  />
                </label>
              </div>
            </div>

            {/* Middle Column - Chart */}
            <div className="lg:col-span-2 space-y-4">
              {/* Display Options */}
              <div className="flex flex-wrap gap-6 justify-end">
                <div className="flex items-center gap-2 border-r pr-4">
                  <Switch
                    id="livePreview"
                    checked={livePreview}
                    onCheckedChange={setLivePreview}
                  />
                  <Label htmlFor="livePreview" className="text-sm font-medium">Live Preview</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    id="showBaseline"
                    checked={showBaseline}
                    onCheckedChange={setShowBaseline}
                  />
                  <Label htmlFor="showBaseline" className="text-sm">Baseline</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    id="showComponents"
                    checked={showComponents}
                    onCheckedChange={setShowComponents}
                  />
                  <Label htmlFor="showComponents" className="text-sm">Components</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    id="showResiduals"
                    checked={showResiduals}
                    onCheckedChange={setShowResiduals}
                  />
                  <Label htmlFor="showResiduals" className="text-sm">Residuals</Label>
                </div>
              </div>

              <DataChart
                data={processedData}
                fitResult={fitResult}
                previewComponents={livePreview ? components : undefined}
                previewBaseline={livePreview && baseline.method !== 'none' ? calculatedBaseline : undefined}
                showBaseline={showBaseline}
                showComponents={showComponents}
                showResiduals={showResiduals}
                title={fileName || 'Spectrum Data'}
                manualBaselinePoints={baseline.manualPoints}
                showManualMarkers={baseline.method === 'manual' && baseline.manualEditMode}
                onAddManualPoint={(point) => {
                  if (!baseline.manualEditMode) return;
                  const currentPoints = baseline.manualPoints || [];
                  setBaseline({
                    ...baseline,
                    manualPoints: [...currentPoints, point].sort((a, b) => a.x - b.x),
                  });
                }}
              />

              <ResultsPanel
                fitResult={fitResult}
                originalData={rawData}
                processedData={processedData}
                processingOptions={processing}
                baselineOptions={baseline}
                fileName={fileName}
              />
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-border py-8 mt-16">
        <div className="container text-center text-sm text-muted-foreground">
          <p>
            Based on <a href="https://github.com/mholmboe/peakipy" className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">PeakiPy</a>
          </p>
          <p className="mt-1">
            Profile fitting application for baseline subtraction and peak analysis
          </p>
        </div>
      </footer>
    </div>
  );
};

export default Index;
