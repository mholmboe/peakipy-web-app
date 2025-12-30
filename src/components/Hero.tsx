import heroBg from '@/assets/hero-bg.jpg';

export function Hero() {
  return (
    <section className="relative overflow-hidden py-20">
      {/* Background image */}
      <div 
        className="absolute inset-0 z-0"
        style={{
          backgroundImage: `url(${heroBg})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      />
      
      {/* Overlay */}
      <div className="absolute inset-0 z-10 bg-gradient-to-b from-background/80 via-background/60 to-background" />
      
      {/* Content */}
      <div className="container relative z-20">
        <div className="max-w-3xl mx-auto text-center space-y-6">
          <h2 className="text-4xl md:text-5xl font-bold tracking-tight">
            Advanced Peak <span className="text-primary">Profile Fitting</span>
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            A powerful web application for fitting experimental X/Y data with Gaussian, Lorentzian, 
            and Voigt profiles. Features advanced baseline correction and real-time visualization.
          </p>
          <div className="flex flex-wrap justify-center gap-4 text-sm">
            <FeatureTag>Gaussian</FeatureTag>
            <FeatureTag>Lorentzian</FeatureTag>
            <FeatureTag>Voigt</FeatureTag>
            <FeatureTag>AsLS Baseline</FeatureTag>
            <FeatureTag>Polynomial</FeatureTag>
            <FeatureTag>Rolling Ball</FeatureTag>
          </div>
        </div>
      </div>
    </section>
  );
}

function FeatureTag({ children }: { children: React.ReactNode }) {
  return (
    <span className="px-3 py-1 rounded-full bg-primary/10 text-primary border border-primary/20 font-medium">
      {children}
    </span>
  );
}
