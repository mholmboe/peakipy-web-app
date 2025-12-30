import { useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Upload, FileText } from 'lucide-react';

interface FileUploadProps {
  onFileLoad: (content: string, fileName: string) => void;
  acceptedFormats?: string;
}

export function FileUpload({ onFileLoad, acceptedFormats = '.txt,.csv,.dat,.xy' }: FileUploadProps) {
  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      readFile(files[0]);
    }
  }, [onFileLoad]);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      readFile(files[0]);
    }
  }, [onFileLoad]);

  const readFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      onFileLoad(content, file.name);
    };
    reader.readAsText(file);
  };

  return (
    <Card className="border-2 border-dashed border-primary/30 bg-card/50 hover:border-primary/50 hover:bg-card/80 transition-all duration-300">
      <CardContent className="p-8">
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          className="flex flex-col items-center justify-center gap-4 cursor-pointer"
        >
          <label htmlFor="file-upload" className="cursor-pointer w-full">
            <div className="flex flex-col items-center gap-4">
              <div className="p-4 rounded-full bg-primary/10">
                <Upload className="w-8 h-8 text-primary" />
              </div>
              <div className="text-center">
                <p className="text-lg font-medium text-foreground">
                  Drop your data file here
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  or click to browse
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <FileText className="w-4 h-4" />
                <span>Supports: TXT, CSV, DAT (two columns: X, Y)</span>
              </div>
            </div>
            <input
              id="file-upload"
              type="file"
              accept={acceptedFormats}
              onChange={handleFileInput}
              className="hidden"
            />
          </label>
        </div>
      </CardContent>
    </Card>
  );
}
