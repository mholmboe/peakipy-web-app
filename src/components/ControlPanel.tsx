import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Play, Plus, Minus, RotateCcw, Wand2 } from 'lucide-react';
import type { PeakComponent, ProcessingOptions, BaselineOptions, DataPoint } from '@/lib/peakFitting';
import { initWithGMM, initEvenlySpaced } from '@/lib/peakInitializers';

interface ControlPanelProps {
  processing: ProcessingOptions;
  baseline: BaselineOptions;
  components: PeakComponent[];
  dataRange: { min: number; max: number };
  processedData: DataPoint[];
  calculatedBaseline: DataPoint[]; // For baseline-corrected initialization
  onProcessingChange: (options: ProcessingOptions) => void;
  onBaselineChange: (options: BaselineOptions) => void;
  onComponentsChange: (components: PeakComponent[]) => void;
  onFit: () => void;
  onReset: () => void;
  isLoading?: boolean;
}

export function ControlPanel({
  processing,
  baseline,
  components,
  dataRange,
  processedData,
  calculatedBaseline,
  onProcessingChange,
  onBaselineChange,
  onComponentsChange,
  onFit,
  onReset,
  isLoading = false,
}: ControlPanelProps) {
  const [activeTab, setActiveTab] = useState('processing');
  const [numPeaks, setNumPeaks] = useState(1);
  const [initMethod, setInitMethod] = useState<'gmm' | 'evenly'>('gmm');
  const [globalProfile, setGlobalProfile] = useState<'gaussian' | 'lorentzian' | 'voigt'>('gaussian');

  // Update all components when global profile changes
  const handleGlobalProfileChange = (profile: 'gaussian' | 'lorentzian' | 'voigt') => {
    setGlobalProfile(profile);
    if (components.length > 0) {
      onComponentsChange(components.map(c => ({ ...c, profile })));
    }
  };

  const addComponent = () => {
    const newId = components.length > 0 ? Math.max(...components.map(c => c.id)) + 1 : 1;
    const center = (dataRange.min + dataRange.max) / 2;
    // Initial amplitude based on data max
    const maxY = Math.max(...processedData.map(d => d.y), 1);
    const newComponents = [
      ...components,
      {
        id: newId,
        profile: 'gaussian' as const,
        center,
        amplitude: maxY,
        width: (dataRange.max - dataRange.min) / 10,
        weight: 1.0,
      },
    ];
    // Normalize weights after adding
    onComponentsChange(normalizeWeights(newComponents));
  };

  const removeComponent = (id: number) => {
    const remaining = components.filter(c => c.id !== id);
    // Normalize weights after removing
    onComponentsChange(normalizeWeights(remaining));
  };

  const updateComponent = (id: number, updates: Partial<PeakComponent>) => {
    onComponentsChange(
      components.map(c => (c.id === id ? { ...c, ...updates } : c))
    );
  };

  // Update weight and auto-normalize all weights to sum to 1
  const updateComponentWeight = (id: number, newWeight: number) => {
    const updated = components.map(c =>
      c.id === id ? { ...c, weight: newWeight } : c
    );
    onComponentsChange(normalizeWeights(updated));
  };

  // Normalize weights to sum to 1
  const normalizeWeights = (comps: PeakComponent[]): PeakComponent[] => {
    if (comps.length === 0) return comps;
    const total = comps.reduce((sum, c) => sum + (c.weight ?? 1), 0);
    if (total === 0) {
      // Equal distribution if all zero
      const equalWeight = 1 / comps.length;
      return comps.map(c => ({ ...c, weight: equalWeight }));
    }
    return comps.map(c => ({ ...c, weight: (c.weight ?? 1) / total }));
  };

  return (
    <Card className="bg-card/80 backdrop-blur">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg font-medium flex items-center justify-between">
          Control Panel
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onReset}>
              <RotateCcw className="w-4 h-4 mr-1" />
              Reset
            </Button>
            <Button size="sm" onClick={onFit} disabled={isLoading}>
              <Play className="w-4 h-4 mr-1" />
              {isLoading ? 'Fitting...' : 'Run Fit'}
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="processing">Preprocessing</TabsTrigger>
            <TabsTrigger value="baseline">Baseline</TabsTrigger>
            <TabsTrigger value="components">Components</TabsTrigger>
          </TabsList>

          <TabsContent value="processing" className="space-y-4 mt-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="xMin">X Min</Label>
                <Input
                  id="xMin"
                  type="number"
                  value={processing.xMin ?? ''}
                  placeholder="Auto"
                  onChange={e =>
                    onProcessingChange({
                      ...processing,
                      xMin: e.target.value ? parseFloat(e.target.value) : undefined,
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="xMax">X Max</Label>
                <Input
                  id="xMax"
                  type="number"
                  value={processing.xMax ?? ''}
                  placeholder="Auto"
                  onChange={e =>
                    onProcessingChange({
                      ...processing,
                      xMax: e.target.value ? parseFloat(e.target.value) : undefined,
                    })
                  }
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="interpStep">Interpolation Step</Label>
              <Input
                id="interpStep"
                type="number"
                step="0.01"
                value={processing.interpolationStep ?? ''}
                placeholder="None"
                onChange={e =>
                  onProcessingChange({
                    ...processing,
                    interpolationStep: e.target.value ? parseFloat(e.target.value) : undefined,
                  })
                }
              />
            </div>

            <div className="flex items-center justify-between">
              <Label htmlFor="normalize">Normalize Data</Label>
              <Switch
                id="normalize"
                checked={processing.normalize}
                onCheckedChange={checked =>
                  onProcessingChange({ ...processing, normalize: checked })
                }
              />
            </div>

            {/* Outlier Removal Section */}
            <div className="space-y-3 p-3 bg-muted/30 rounded-lg">
              <Label className="text-sm font-medium">Outlier Removal</Label>
              <Select
                value={processing.outlierRemoval?.method || 'none'}
                onValueChange={value =>
                  onProcessingChange({
                    ...processing,
                    outlierRemoval: {
                      method: value as 'none' | 'zscore' | 'iqr',
                      threshold: processing.outlierRemoval?.threshold || (value === 'iqr' ? 1.5 : 3.0),
                    },
                  })
                }
              >
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="zscore">Z-Score</SelectItem>
                  <SelectItem value="iqr">IQR</SelectItem>
                </SelectContent>
              </Select>
              {processing.outlierRemoval?.method && processing.outlierRemoval.method !== 'none' && (
                <div className="space-y-2">
                  <Label className="text-xs">
                    Threshold: {processing.outlierRemoval.threshold?.toFixed(1)}
                  </Label>
                  <Slider
                    value={[processing.outlierRemoval.threshold || 3.0]}
                    min={1.0}
                    max={5.0}
                    step={0.1}
                    onValueChange={([value]) =>
                      onProcessingChange({
                        ...processing,
                        outlierRemoval: { ...processing.outlierRemoval!, threshold: value },
                      })
                    }
                  />
                </div>
              )}
            </div>

            {/* Smoothing Section */}
            <div className="space-y-3 p-3 bg-muted/30 rounded-lg">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Smoothing (Savitzky-Golay)</Label>
                <Switch
                  checked={processing.smoothing?.enabled || false}
                  onCheckedChange={checked =>
                    onProcessingChange({
                      ...processing,
                      smoothing: {
                        enabled: checked,
                        windowLength: processing.smoothing?.windowLength || 11,
                        polyOrder: processing.smoothing?.polyOrder || 3,
                      },
                    })
                  }
                />
              </div>
              {processing.smoothing?.enabled && (
                <>
                  <div className="space-y-2">
                    <Label className="text-xs">
                      Window Length: {processing.smoothing.windowLength}
                    </Label>
                    <Slider
                      value={[processing.smoothing.windowLength]}
                      min={5}
                      max={31}
                      step={2}
                      onValueChange={([value]) =>
                        onProcessingChange({
                          ...processing,
                          smoothing: { ...processing.smoothing!, windowLength: value },
                        })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">
                      Polynomial Order: {processing.smoothing.polyOrder}
                    </Label>
                    <Slider
                      value={[processing.smoothing.polyOrder]}
                      min={1}
                      max={5}
                      step={1}
                      onValueChange={([value]) =>
                        onProcessingChange({
                          ...processing,
                          smoothing: { ...processing.smoothing!, polyOrder: value },
                        })
                      }
                    />
                  </div>
                </>
              )}
            </div>
          </TabsContent>

          <TabsContent value="baseline" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label>Baseline Method</Label>
              <Select
                value={baseline.method}
                onValueChange={value =>
                  onBaselineChange({ ...baseline, method: value as BaselineOptions['method'] })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="linear">Linear</SelectItem>
                  <SelectItem value="polynomial">Polynomial</SelectItem>
                  <SelectItem value="asls">AsLS (Asymmetric Least Squares)</SelectItem>
                  <SelectItem value="rolling_ball">Rolling Ball</SelectItem>
                  <SelectItem value="shirley">Shirley (XPS)</SelectItem>
                  <SelectItem value="manual">Manual (Click Points)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Auto Baseline checkbox - only show when method is not 'none' or 'manual' */}
            {baseline.method !== 'none' && baseline.method !== 'manual' && (
              <div className="flex items-center justify-between p-2 bg-muted/30 rounded-lg">
                <div className="space-y-0.5">
                  <Label htmlFor="autoBaseline">Auto Baseline</Label>
                  <p className="text-xs text-muted-foreground">
                    Uncheck to manually set parameters
                  </p>
                </div>
                <Switch
                  id="autoBaseline"
                  checked={baseline.autoBaseline !== false}
                  onCheckedChange={checked =>
                    onBaselineChange({ ...baseline, autoBaseline: checked })
                  }
                />
              </div>
            )}

            {/* Optimize Simultaneously - only show when method is not 'none' or 'manual' */}
            {baseline.method !== 'none' && baseline.method !== 'manual' && (
              <div className="flex items-center justify-between p-2 bg-muted/30 rounded-lg">
                <div className="space-y-0.5">
                  <Label htmlFor="optimizeSimultaneously">Optimize Simultaneously</Label>
                  <p className="text-xs text-muted-foreground">
                    Optimize baseline with peaks (slower)
                  </p>
                </div>
                <Switch
                  id="optimizeSimultaneously"
                  checked={baseline.optimizeSimultaneously ?? false}
                  onCheckedChange={checked =>
                    onBaselineChange({ ...baseline, optimizeSimultaneously: checked })
                  }
                />
              </div>
            )}

            {/* Calc Range - only show when baseline method is not 'none' or 'manual' */}
            {baseline.method !== 'none' && baseline.method !== 'manual' && (
              <div className="space-y-2 p-3 bg-muted/30 rounded-lg">
                <Label className="text-sm font-medium">Calc Range (optional)</Label>
                <p className="text-xs text-muted-foreground">
                  Baseline calculated within this range, flat outside
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label htmlFor="calcRangeMin" className="text-xs">Min</Label>
                    <Input
                      id="calcRangeMin"
                      type="number"
                      step="any"
                      value={baseline.calcRangeMin ?? ''}
                      placeholder="Auto"
                      onChange={e =>
                        onBaselineChange({
                          ...baseline,
                          calcRangeMin: e.target.value ? parseFloat(e.target.value) : undefined,
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="calcRangeMax" className="text-xs">Max</Label>
                    <Input
                      id="calcRangeMax"
                      type="number"
                      step="any"
                      value={baseline.calcRangeMax ?? ''}
                      placeholder="Auto"
                      onChange={e =>
                        onBaselineChange({
                          ...baseline,
                          calcRangeMax: e.target.value ? parseFloat(e.target.value) : undefined,
                        })
                      }
                    />
                  </div>
                </div>
              </div>
            )}

            {baseline.method === 'linear' && (
              <>
                <div className="space-y-2">
                  <Label className={baseline.autoBaseline !== false ? 'text-muted-foreground' : ''}>
                    Slope: {(baseline.slope ?? 0).toFixed(4)}
                  </Label>
                  <Slider
                    value={[baseline.slope ?? 0]}
                    min={-10}
                    max={10}
                    step={0.01}
                    disabled={baseline.autoBaseline !== false}
                    onValueChange={([value]) =>
                      onBaselineChange({ ...baseline, slope: value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label className={baseline.autoBaseline !== false ? 'text-muted-foreground' : ''}>
                    Intercept: {(baseline.intercept ?? 0).toFixed(4)}
                  </Label>
                  <Slider
                    value={[baseline.intercept ?? 0]}
                    min={-100}
                    max={100}
                    step={0.1}
                    disabled={baseline.autoBaseline !== false}
                    onValueChange={([value]) =>
                      onBaselineChange({ ...baseline, intercept: value })
                    }
                  />
                </div>
              </>
            )}

            {baseline.method === 'polynomial' && (
              <div className="space-y-2">
                <Label className={baseline.autoBaseline !== false ? 'text-muted-foreground' : ''}>
                  Polynomial Degree: {baseline.degree || 2}
                </Label>
                <Slider
                  value={[baseline.degree || 2]}
                  min={1}
                  max={6}
                  step={1}
                  disabled={baseline.autoBaseline !== false}
                  onValueChange={([value]) =>
                    onBaselineChange({ ...baseline, degree: value })
                  }
                />
              </div>
            )}

            {baseline.method === 'asls' && (
              <>
                <div className="space-y-2">
                  <Label className={baseline.autoBaseline !== false ? 'text-muted-foreground' : ''}>
                    Lambda (log₁₀): {Math.log10(baseline.lambda || 1e5).toFixed(1)}
                  </Label>
                  <Slider
                    value={[Math.log10(baseline.lambda || 1e5)]}
                    min={2}
                    max={9}
                    step={0.5}
                    disabled={baseline.autoBaseline !== false}
                    onValueChange={([value]) =>
                      onBaselineChange({ ...baseline, lambda: Math.pow(10, value) })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label className={baseline.autoBaseline !== false ? 'text-muted-foreground' : ''}>
                    P: {(baseline.p || 0.01).toFixed(3)}
                  </Label>
                  <Slider
                    value={[baseline.p || 0.01]}
                    min={0.001}
                    max={0.1}
                    step={0.001}
                    disabled={baseline.autoBaseline !== false}
                    onValueChange={([value]) =>
                      onBaselineChange({ ...baseline, p: value })
                    }
                  />
                </div>
              </>
            )}

            {baseline.method === 'rolling_ball' && (
              <div className="space-y-2">
                <Label className={baseline.autoBaseline !== false ? 'text-muted-foreground' : ''}>
                  Ball Radius: {baseline.radius || 10}
                </Label>
                <Slider
                  value={[baseline.radius || 10]}
                  min={1}
                  max={50}
                  step={1}
                  disabled={baseline.autoBaseline !== false}
                  onValueChange={([value]) =>
                    onBaselineChange({ ...baseline, radius: value })
                  }
                />
              </div>
            )}

            {baseline.method === 'shirley' && (
              <>
                <div className="space-y-2">
                  <Label className={baseline.autoBaseline !== false ? 'text-muted-foreground' : ''}>
                    Max Iterations: {baseline.shirleyIterations || 50}
                  </Label>
                  <Slider
                    value={[baseline.shirleyIterations || 50]}
                    min={10}
                    max={200}
                    step={10}
                    disabled={baseline.autoBaseline !== false}
                    onValueChange={([value]) =>
                      onBaselineChange({ ...baseline, shirleyIterations: value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label className={baseline.autoBaseline !== false ? 'text-muted-foreground' : ''}>
                    Tolerance (log₁₀): {Math.log10(baseline.shirleyTolerance || 1e-5).toFixed(0)}
                  </Label>
                  <Slider
                    value={[Math.log10(baseline.shirleyTolerance || 1e-5)]}
                    min={-8}
                    max={-2}
                    step={1}
                    disabled={baseline.autoBaseline !== false}
                    onValueChange={([value]) =>
                      onBaselineChange({ ...baseline, shirleyTolerance: Math.pow(10, value) })
                    }
                  />
                </div>
              </>
            )}

            {baseline.method === 'manual' && (
              <div className="space-y-3 p-3 bg-muted/30 rounded-lg">
                <div className="space-y-2">
                  <Label>Interpolation Type</Label>
                  <Select
                    value={baseline.manualInterp || 'linear'}
                    onValueChange={value =>
                      onBaselineChange({ ...baseline, manualInterp: value as 'linear' | 'cubic' })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="linear">Linear</SelectItem>
                      <SelectItem value="cubic">Cubic Spline</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm">Baseline Range (optional)</Label>
                  <p className="text-xs text-muted-foreground">
                    Extend baseline beyond control points via interpolation
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label htmlFor="manualCalcMin" className="text-xs">Min X</Label>
                      <Input
                        id="manualCalcMin"
                        type="number"
                        step="any"
                        value={baseline.calcRangeMin ?? ''}
                        placeholder="Auto"
                        onChange={e =>
                          onBaselineChange({
                            ...baseline,
                            calcRangeMin: e.target.value ? parseFloat(e.target.value) : undefined,
                          })
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="manualCalcMax" className="text-xs">Max X</Label>
                      <Input
                        id="manualCalcMax"
                        type="number"
                        step="any"
                        value={baseline.calcRangeMax ?? ''}
                        placeholder="Auto"
                        onChange={e =>
                          onBaselineChange({
                            ...baseline,
                            calcRangeMax: e.target.value ? parseFloat(e.target.value) : undefined,
                          })
                        }
                      />
                    </div>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button
                    variant={baseline.manualEditMode ? "default" : "outline"}
                    size="sm"
                    className="flex-1"
                    onClick={() => onBaselineChange({
                      ...baseline,
                      manualEditMode: !baseline.manualEditMode
                    })}
                  >
                    {baseline.manualEditMode
                      ? `Done Selecting (${baseline.manualPoints?.length || 0} pts)`
                      : 'Select Points'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onBaselineChange({ ...baseline, manualPoints: [], manualEditMode: false })}
                  >
                    Clear
                  </Button>
                </div>

                {baseline.manualEditMode && (
                  <p className="text-xs text-blue-400">
                    Click on the chart to add points. Click "Done Selecting" when finished.
                  </p>
                )}
              </div>
            )}
          </TabsContent>

          <TabsContent value="components" className="space-y-4 mt-4">
            {/* Global Profile Type */}
            <div className="flex items-center gap-3 p-2 border rounded-lg">
              <Label className="text-sm font-medium">Profile Type:</Label>
              <Select value={globalProfile} onValueChange={(v) => handleGlobalProfileChange(v as typeof globalProfile)}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gaussian">Gaussian</SelectItem>
                  <SelectItem value="lorentzian">Lorentzian</SelectItem>
                  <SelectItem value="voigt">Voigt</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Auto-initialization controls */}
            <div className="p-3 bg-muted/30 rounded-lg space-y-3">
              <div className="flex items-center gap-2">
                <Wand2 className="w-4 h-4 text-primary" />
                <span className="text-sm font-medium">Auto Initialize</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="numPeaks" className="text-xs">Peaks</Label>
                  <Input
                    id="numPeaks"
                    type="number"
                    min={1}
                    max={10}
                    value={numPeaks}
                    onChange={e => setNumPeaks(Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="initMethod" className="text-xs">Method</Label>
                  <Select value={initMethod} onValueChange={(v) => setInitMethod(v as 'gmm' | 'evenly')}>
                    <SelectTrigger id="initMethod">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gmm">GMM (auto detect)</SelectItem>
                      <SelectItem value="evenly">Evenly Spaced</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button
                variant="secondary"
                size="sm"
                className="w-full"
                disabled={processedData.length === 0}
                onClick={() => {
                  // Use baseline-corrected data for initialization (like Python app)
                  const baselineMap = new Map(calculatedBaseline.map(b => [b.x, b.y]));
                  let correctedData = processedData.map(d => ({
                    x: d.x,
                    y: d.y - (baselineMap.get(d.x) ?? 0)
                  }));

                  // Apply normalization scaling if normalize is enabled
                  // This matches what the chart displays
                  if (processing.normalize) {
                    const maxY = Math.max(...correctedData.map(d => d.y), 0.001);
                    correctedData = correctedData.map(d => ({ ...d, y: d.y / maxY }));
                  }

                  const dataForInit = calculatedBaseline.length > 0 ? correctedData : processedData;
                  const newComps = initMethod === 'gmm'
                    ? initWithGMM(dataForInit, numPeaks, globalProfile)
                    : initEvenlySpaced(dataForInit, numPeaks, globalProfile);
                  onComponentsChange(newComps);
                }}
              >
                <Wand2 className="w-4 h-4 mr-1" />
                Auto Init ({numPeaks} {globalProfile} peaks)
              </Button>
            </div>

            {/* Global Total Amplitude Control */}
            {components.length > 0 && (
              <div className="p-3 bg-muted/30 rounded-lg space-y-2">
                <Label className="text-sm font-medium">
                  Total Amplitude: {components[0]?.amplitude.toFixed(4)}
                </Label>
                <p className="text-xs text-muted-foreground">
                  Shared intensity of all peaks (individual peaks scaled by weights)
                </p>
                <Slider
                  value={[components[0]?.amplitude ?? 1]}
                  min={0.001}
                  max={Math.max(...processedData.map(d => d.y), 1) * 2}
                  step={Math.max(...processedData.map(d => d.y), 1) / 200}
                  onValueChange={([value]) => {
                    // Update all components to share the same amplitude
                    onComponentsChange(components.map(c => ({ ...c, amplitude: value })));
                  }}
                />
              </div>
            )}

            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {components.length} peak{components.length !== 1 ? 's' : ''} defined
              </span>
              <Button variant="outline" size="sm" onClick={addComponent}>
                <Plus className="w-4 h-4 mr-1" />
                Add Peak
              </Button>
            </div>

            <Accordion type="multiple" className="w-full">
              {components.map((comp, idx) => (
                <AccordionItem key={comp.id} value={`peak-${comp.id}`}>
                  <AccordionTrigger className="text-sm">
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
                      Peak {comp.id} ({comp.profile})
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="space-y-4 pt-2">
                      <div className="space-y-2">
                        <Label>Profile Type</Label>
                        <Select
                          value={comp.profile}
                          onValueChange={value =>
                            updateComponent(comp.id, {
                              profile: value as PeakComponent['profile'],
                            })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="gaussian">Gaussian</SelectItem>
                            <SelectItem value="lorentzian">Lorentzian</SelectItem>
                            <SelectItem value="voigt">Voigt</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label>Center: {comp.center.toFixed(2)}</Label>
                        <Slider
                          value={[comp.center]}
                          min={dataRange.min}
                          max={dataRange.max}
                          step={(dataRange.max - dataRange.min) / 100}
                          onValueChange={([value]) =>
                            updateComponent(comp.id, { center: value })
                          }
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>Weight: {(comp.weight ?? 1).toFixed(2)} ({((comp.weight ?? 1) * 100).toFixed(0)}%)</Label>
                        <Slider
                          value={[comp.weight ?? 1]}
                          min={0.01}
                          max={2}
                          step={0.01}
                          onValueChange={([value]) =>
                            updateComponentWeight(comp.id, value)
                          }
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>Width (FWHM): {comp.width.toFixed(3)}</Label>
                        <Slider
                          value={[comp.width]}
                          min={0.1}
                          max={(dataRange.max - dataRange.min) / 2}
                          step={0.01}
                          onValueChange={([value]) =>
                            updateComponent(comp.id, { width: value })
                          }
                        />
                      </div>

                      <Button
                        variant="destructive"
                        size="sm"
                        className="w-full"
                        onClick={() => removeComponent(comp.id)}
                      >
                        <Minus className="w-4 h-4 mr-1" />
                        Remove Peak
                      </Button>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>

            {components.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                No peaks defined. Click "Add Peak" to start.
              </p>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
