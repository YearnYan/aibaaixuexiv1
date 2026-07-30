import { startTransition, useRef, useState } from "react";
import { Header } from "../components/Header";
import { InputPanel } from "../components/InputPanel";
import { ResultPanel } from "../components/ResultPanel";
import { demoAnalysis, demoMeta } from "../data/demo";
import { analyzeFiles } from "../lib/api";
import type { Analysis, AnalysisMeta } from "../types";

interface AnalyzeRequest {
  subject: string;
  grade: string;
  notes: string;
  files: File[];
}

export function AnalyzerPage() {
  const [analysis, setAnalysis] = useState<Analysis>(demoAnalysis);
  const [meta, setMeta] = useState<AnalysisMeta>(demoMeta);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState("");
  const requestController = useRef<AbortController | null>(null);

  const handleAnalyze = async (request: AnalyzeRequest) => {
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    setAnalyzing(true);
    setError("");

    const formData = new FormData();
    formData.set("subject", request.subject);
    formData.set("grade", request.grade);
    formData.set("notes", request.notes);
    request.files.forEach((file) => formData.append("files", file));

    try {
      const result = await analyzeFiles(formData, controller.signal);
      startTransition(() => {
        setAnalysis(result.analysis);
        setMeta(result.meta);
      });
    } catch (caughtError) {
      if ((caughtError as Error).name !== "AbortError") {
        setError(caughtError instanceof Error ? caughtError.message : "分析失败，请稍后重试");
      }
    } finally {
      if (requestController.current === controller) {
        setAnalyzing(false);
      }
    }
  };

  return (
    <div className="app-shell">
      <Header />
      <div className="workspace">
        <InputPanel analyzing={analyzing} onAnalyze={handleAnalyze} />
        <ResultPanel analysis={analysis} meta={meta} analyzing={analyzing} error={error} />
      </div>
    </div>
  );
}
