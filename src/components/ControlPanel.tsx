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
import { Play, Plus, Minus, RotateCcw } from 'lucide-react';
import type { PeakComponent, ProcessingOptions, BaselineOptions } from '@/lib/peakFitting';

interface ControlPanelProps {
  processing: ProcessingOptions;
  baseline: BaselineOptions;
  components: PeakComponent[];
  dataRange: { min: number; max: number };
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
  onProcessingChange,
  onBaselineChange,
  onComponentsChange,
  onFit,
  onReset,
  isLoading = false,
}: ControlPanelProps) {
  const [activeTab, setActiveTab] = useState('processing');

  const addComponent = () => {
    const newId = components.length > 0 ? Math.max(...components.map(c => c.id)) + 1 : 1;
    const center = (dataRange.min + dataRange.max) / 2;
    onComponentsChange([
      ...components,
      {
        id: newId,
        profile: 'gaussian',
        center,
        amplitude: 1,
        width: (dataRange.max - dataRange.min) / 10,
      },
    ]);
  };

  const removeComponent = (id: number) => {
    onComponentsChange(components.filter(c => c.id !== id));
  };

  const updateComponent = (id: number, updates: Partial<PeakComponent>) => {
    onComponentsChange(
      components.map(c => (c.id === id ? { ...c, ...updates } : c))
    );
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
                </SelectContent>
              </Select>
            </div>

            {baseline.method === 'polynomial' && (
              <div className="space-y-2">
                <Label>Polynomial Degree: {baseline.degree || 2}</Label>
                <Slider
                  value={[baseline.degree || 2]}
                  min={1}
                  max={6}
                  step={1}
                  onValueChange={([value]) =>
                    onBaselineChange({ ...baseline, degree: value })
                  }
                />
              </div>
            )}

            {baseline.method === 'asls' && (
              <>
                <div className="space-y-2">
                  <Label>Lambda (log₁₀): {Math.log10(baseline.lambda || 1e5).toFixed(1)}</Label>
                  <Slider
                    value={[Math.log10(baseline.lambda || 1e5)]}
                    min={2}
                    max={8}
                    step={0.5}
                    onValueChange={([value]) =>
                      onBaselineChange({ ...baseline, lambda: Math.pow(10, value) })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>P: {(baseline.p || 0.01).toFixed(3)}</Label>
                  <Slider
                    value={[baseline.p || 0.01]}
                    min={0.001}
                    max={0.1}
                    step={0.001}
                    onValueChange={([value]) =>
                      onBaselineChange({ ...baseline, p: value })
                    }
                  />
                </div>
              </>
            )}

            {baseline.method === 'rolling_ball' && (
              <div className="space-y-2">
                <Label>Ball Radius: {baseline.radius || 10}</Label>
                <Slider
                  value={[baseline.radius || 10]}
                  min={1}
                  max={50}
                  step={1}
                  onValueChange={([value]) =>
                    onBaselineChange({ ...baseline, radius: value })
                  }
                />
              </div>
            )}
          </TabsContent>

          <TabsContent value="components" className="space-y-4 mt-4">
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
                        <Label>Amplitude: {comp.amplitude.toFixed(3)}</Label>
                        <Slider
                          value={[comp.amplitude]}
                          min={0}
                          max={2}
                          step={0.01}
                          onValueChange={([value]) =>
                            updateComponent(comp.id, { amplitude: value })
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
