export type HighlightCategory = "task" | "restriction" | "data" | "hidden" | "scope";

export interface Analysis {
  questionText: string;
  problemType: string;
  confidence: number;
  potentialOmissions: string[];
  taskWords: Array<{ label: string; text: string }>;
  restrictions: string[];
  keyData: Array<{ label: string; value: string }>;
  hiddenConditions: string[];
  distractions: string[];
  answerScope: string;
  paraphrase: string;
  highlights: Array<{ text: string; category: HighlightCategory }>;
}

export interface AnalysisMeta {
  subject: string;
  grade: string;
  source: string;
  recognizedAt: string;
  fileNames: string[];
}

export interface AnalysisResponse {
  analysis: Analysis;
  meta: AnalysisMeta;
}

export interface ConfigStatus {
  configured: boolean;
  source: "environment" | "file" | "none";
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  temperature: number;
  maxTokens: number;
  customInstructions: string;
}

export interface ConfigFormData {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  customInstructions: string;
}
