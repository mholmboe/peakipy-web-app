# PeakiPy Web App

A browser-based peak fitting application for analyzing X/Y spectral data with multiple peak profiles and advanced baseline correction.

## Features

### Profile Functions
- **Gaussian**: Standard normal distribution peak
- **Lorentzian**: Cauchy distribution peak, ideal for spectral broadening
- **Voigt**: Pseudo-Voigt approximation of Gaussian-Lorentzian convolution

### Baseline Correction
- **None**: No baseline subtraction
- **Linear**: Two-point linear baseline with adjustable slope/intercept
- **Polynomial**: Robust iterative polynomial fitting (degree 1-5)
- **AsLS**: Asymmetric Least Squares with λ and p parameters
- **Rolling Ball**: Morphological baseline with adjustable radius
- **Shirley**: Classical XPS background correction
- **Manual (Click Points)**: Click on chart to define control points with linear or cubic spline interpolation

### Data Processing
- **X Range**: Crop data to specific min/max values
- **Interpolation**: Resample data to uniform step size (supports extending beyond data range)
- **Outlier Removal**: Z-score or IQR methods with adjustable threshold
- **Smoothing**: Savitzky-Golay filter with window length and polynomial order
- **Normalization**: Scale intensities to max = 1

### Fitting
- **Levenberg-Marquardt**: Robust nonlinear least squares optimization
- **Component Weights**: Adjustable contribution of each peak
- **Live Preview**: Real-time visualization while adjusting parameters

### Export
- **SVG Charts**: Export publication-quality vector graphics
- **Fit Results**: Download fitting statistics and parameters

## Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

## Technology Stack
- **Vite** - Fast build tool
- **React** + **TypeScript** - UI framework
- **Recharts** - Chart library
- **shadcn/ui** - UI components
- **Tailwind CSS** - Styling

## Processing Pipeline

1. **Outlier Removal** (optional) - Remove statistical outliers
2. **Crop** - Select X range of interest
3. **Interpolation** - Resample to uniform spacing
4. **Smoothing** (optional) - Apply Savitzky-Golay filter
5. **Normalization** (optional) - Scale to max = 1

## License
MIT License

## Author
M. Holmboe  
michael.holmboe@umu.se
