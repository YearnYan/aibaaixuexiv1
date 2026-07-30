import type { AnalysisResponse, ConfigFormData, ConfigStatus } from "../types";
import type { Analysis, AnalysisMeta } from "../types";

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error || `请求失败（${response.status}）`);
  }
  return payload;
}

export async function analyzeFiles(formData: FormData, signal?: AbortSignal) {
  const response = await fetch("/api/analyze", {
    method: "POST",
    body: formData,
    signal,
  });
  return readJson<AnalysisResponse>(response);
}

export async function getConfigStatus() {
  const response = await fetch("/api/config/status");
  return readJson<ConfigStatus>(response);
}

export async function saveAiConfig(data: ConfigFormData, password: string) {
  const response = await fetch("/api/config", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "x-config-password": password,
    },
    body: JSON.stringify(data),
  });
  return readJson<ConfigStatus>(response);
}

export async function testAiConfig(data: ConfigFormData, password: string) {
  const response = await fetch("/api/config/test", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-config-password": password,
    },
    body: JSON.stringify(data),
  });
  return readJson<{ ok: true; message: string }>(response);
}

export type ReportFormat = "pdf" | "word";

function exportFileName(response: Response, format: ReportFormat) {
  const disposition = response.headers.get("Content-Disposition") || "";
  const utf8Name = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (utf8Name) {
    try {
      return decodeURIComponent(utf8Name);
    } catch {
      // 服务端文件名编码异常时使用稳定的本地文件名。
    }
  }
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  return `AI审题分析报告-${stamp}.${format === "pdf" ? "pdf" : "docx"}`;
}

export async function downloadReport(format: ReportFormat, analysis: Analysis, meta: AnalysisMeta) {
  const response = await fetch(`/api/export/${format}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ analysis, meta }),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error || "报告生成失败，请稍后重试");
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = exportFileName(response, format);
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}
