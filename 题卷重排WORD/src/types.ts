export type UploadedPage = {
  pageIndex: number;
  width: number;
  height: number;
  imageDataUrl: string;
};

export type BBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type QuestionFigureKind = "diagram" | "table" | "option-group" | "option";

export type QuestionFigure = {
  id: string;
  kind?: QuestionFigureKind;
  optionLabel?: string;
  pageIndex?: number;
  bbox?: BBox;
  dataUrl: string;
  width: number;
  height: number;
  caption?: string;
  confidence?: number;
};

export type DocumentItemKind = "question" | "content";

export type QuestionItem = {
  id: string;
  kind?: DocumentItemKind;
  number: string;
  pageIndex: number;
  stemMarkdown: string;
  options: string[];
  figures: QuestionFigure[];
};

export type RecognitionResult = {
  questions: Array<{
    id: string;
    kind: DocumentItemKind;
    number: string;
    pageIndex: number;
    sourcePageIndexes: number[];
    stemMarkdown: string;
    options: string[];
    figures: Array<{
      kind?: QuestionFigureKind;
      optionLabel?: string;
      pageIndex: number;
      bbox: BBox;
      caption?: string;
      confidence?: number;
    }>;
  }>;
  processedPageIndexes: number[];
  emptyPageIndexes: number[];
  warnings: string[];
};
