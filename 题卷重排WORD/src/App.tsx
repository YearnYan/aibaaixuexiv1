import { memo, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex, { type Options as RehypeKatexOptions } from "rehype-katex";
import remarkMath from "remark-math";
import {
  Bot,
  CheckSquare,
  Download,
  FileText,
  GripVertical,
  Image as ImageIcon,
  Loader2,
  RefreshCcw,
  Scissors,
  Square,
  Upload,
  X,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Move,
  Maximize2,
  Minimize2,
} from "lucide-react";
import {
  completeDocxImportSession,
  exportDocx,
  recognizeWholeDocument,
  registerDocxImportSession,
} from "./lib/api";
import { cropFigureFromPage } from "./lib/crop";
import { isDocxFile, parseUploads } from "./lib/fileReaders";
import { collectCoveredRecognitionPageIndexes } from "./lib/recognitionCoverage";
import { mathTextForMarkdown, normalizeQuestionMathFields } from "../shared/mathText";
import {
  extractOptionLabel,
  isOptionLabelOnly,
  normalizeOptionLabel,
  restoreVisualOptionLabels,
} from "../shared/optionText";
import type { BBox, QuestionFigure, QuestionItem, RecognitionResult, UploadedPage } from "./types";

type CropTarget = {
  questionId: string;
  figureId: string;
  bbox: BBox;
  viewport: BBox;
};

type CropCardState = CropTarget & {
  page: UploadedPage;
};

// 裁切器只展示当前题图附近的局部区域，保留少量边缘空间供微调。
const CROP_VIEWPORT_SCALE = 1.65;
const CROP_VIEWPORT_MIN_SIZE = 0.14;
const CROP_VIEWPORT_MAX_SIZE = 0.92;
const CROP_VIEWPORT_PADDING_RATIO = 0.14;
const MIN_CROP_SIZE = 0.002;
// 前端批次保持 5 页，和平台“每 5 页 1 积分”的结算单位严格一致；批次内结果按项渐进显示。
const RECOGNITION_FRONTEND_BATCH_PAGE_COUNT = 5;
const markdownRemarkPlugins = [remarkMath];
// 与共享层的 KaTeX 预检保持一致；失败公式已在进入此处前降级为可读文本。
const markdownRehypePlugins: [typeof rehypeKatex, RehypeKatexOptions][] = [[rehypeKatex, { strict: "ignore", trust: false }]];

type DropPlacement = "before" | "after";

type QuestionDropTarget = {
  id: string;
  placement: DropPlacement;
};

type QuestionPointerDrag = {
  questionId: string;
  pointerId: number;
  startX: number;
  startY: number;
  hasMoved: boolean;
  element: HTMLElement;
  previousUserSelect: string;
};

export default function App() {
  return <QuestionWorkbench />;
}

function QuestionWorkbench() {
  const [fileName, setFileName] = useState("");
  const [pages, setPages] = useState<UploadedPage[]>([]);
  const [selectedPageIndexes, setSelectedPageIndexes] = useState<number[]>([]);
  const [questions, setQuestions] = useState<QuestionItem[]>([]);
  const [docxPageCount, setDocxPageCount] = useState(0);
  const [docxImportSessionId, setDocxImportSessionId] = useState("");
  const [isUsageSettled, setIsUsageSettled] = useState(false);
  const [status, setStatus] = useState("等待上传文件");
  const [error, setError] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [hasStartedRecognition, setHasStartedRecognition] = useState(false);
  const [activeQuestionId, setActiveQuestionId] = useState("");
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<string[]>([]);
  const [dragQuestionId, setDragQuestionId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<QuestionDropTarget | null>(null);
  const [cropTarget, setCropTarget] = useState<CropTarget | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cropEditorRef = useRef<HTMLDivElement | null>(null);
  const dropTargetRef = useRef<QuestionDropTarget | null>(null);
  const pointerDragRef = useRef<QuestionPointerDrag | null>(null);
  const pendingDragPointRef = useRef<{ clientX: number; clientY: number; pointerId: number } | null>(null);
  const dragHitTestFrameRef = useRef<number | null>(null);
  const cropApplyRef = useRef(false);
  const recognitionRequestRef = useRef(false);

  const questionById = useMemo(() => new Map(questions.map((question) => [question.id, question])), [questions]);
  const pageByIndex = useMemo(() => new Map(pages.map((page) => [page.pageIndex, page])), [pages]);
  const activeQuestion = useMemo(
    () => questionById.get(activeQuestionId) || questions[0],
    [activeQuestionId, questionById, questions],
  );
  const selectedQuestionIdSet = useMemo(() => new Set(selectedQuestionIds), [selectedQuestionIds]);
  const selectedPageIndexSet = useMemo(() => new Set(selectedPageIndexes), [selectedPageIndexes]);
  const selectedPages = useMemo(
    () => pages.filter((page) => selectedPageIndexSet.has(page.pageIndex)),
    [pages, selectedPageIndexSet],
  );
  const isAllPagesSelected = pages.length > 0 && selectedPageIndexes.length === pages.length;
  const isAllQuestionsSelected = questions.length > 0 && selectedQuestionIds.length === questions.length;
  const cropPage = useMemo(() => {
    if (!cropTarget) return null;
    const question = questionById.get(cropTarget.questionId);
    const figure = getQuestionFigures(question).find((item) => item.id === cropTarget.figureId);
    if (!figure || figure.pageIndex === undefined) return null;
    return pageByIndex.get(figure.pageIndex) || null;
  }, [cropTarget, pageByIndex, questionById]);
  const cropCardState = useMemo<CropCardState | null>(() => {
    if (!cropTarget || !cropPage) return null;
    return { ...cropTarget, page: cropPage };
  }, [cropPage, cropTarget]);

  useEffect(() => {
    const validQuestionIds = new Set(questions.map((question) => question.id));
    setSelectedQuestionIds((ids) => {
      const next = ids.filter((id) => validQuestionIds.has(id));
      return next.length === ids.length ? ids : next;
    });
    setActiveQuestionId((id) => (id && validQuestionIds.has(id) ? id : questions[0]?.id || ""));
  }, [questions]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Enter" || !cropTarget || !cropPage || isBusy || event.isComposing) return;
      if (!shouldApplyCropFromKeyboard(event.target)) return;
      event.preventDefault();
      cropEditorRef.current?.querySelector<HTMLButtonElement>("[data-crop-apply]")?.click();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [cropTarget, cropPage, isBusy]);

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;

    setError("");
    setIsBusy(true);
    setStatus("正在解析上传文件");
    try {
      const uploadedFiles = Array.from(files);
      const parsed = await parseUploads(uploadedFiles);
      const docxFiles = uploadedFiles.filter(isDocxFile);
      const docxPageCount = parsed.sourcePageCount - parsed.pages.length;
      let nextDocxImportSessionId = "";
      let nextUsageSettled = false;

      if (docxFiles.length) {
        const docxSession = await registerDocxImportSession(
          docxFiles,
          (progress) => setStatus(progress.message),
        );
        if (!docxSession || docxSession.pageCount !== docxPageCount) {
          throw new Error("Word 文件页数核验不一致，请重新上传。");
        }
        nextDocxImportSessionId = docxSession.sessionId;
        if (!parsed.pages.length) {
          setStatus(`正在按 ${docxSession.pageCount} 页结算并生成 Word 内容`);
          await completeDocxImportSession(docxSession.sessionId, docxSession.pageCount);
          nextUsageSettled = true;
        }
      }

      setFileName(parsed.fileName);
      setPages(parsed.pages);
      setSelectedPageIndexes(parsed.pages.map((page) => page.pageIndex));
      setHasStartedRecognition(false);
      setQuestions(parsed.questions);
      setDocxPageCount(docxPageCount);
      setDocxImportSessionId(nextDocxImportSessionId);
      setIsUsageSettled(nextUsageSettled);
      setActiveQuestionId(parsed.questions[0]?.id || "");
      setSelectedQuestionIds([]);
      setCropTarget(null);
      setStatus(buildUploadStatus(parsed.pages.length, parsed.questions.length));
    } catch (err) {
      setError(err instanceof Error ? err.message : "文件解析失败");
      setStatus("解析失败");
    } finally {
      setIsBusy(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  async function handleRecognize() {
    if (recognitionRequestRef.current) return;
    if (isUsageSettled) return;
    const targetPages = selectedPages;
    if (!targetPages.length) {
      setError("请先上传 PDF、PNG 或 JPG 文件。");
      return;
    }

    recognitionRequestRef.current = true;
    setIsBusy(true);
    setHasStartedRecognition(true);
    setError("");
    setStatus(`正在识别第 1/${targetPages.length} 页`);
    try {
      let mergedQuestions = [...questions];
      let completedPageCount = 0;
      const failedPageIndexes: number[] = [];
      const firstBatchSize = docxImportSessionId && docxPageCount > 0
        ? Math.min(targetPages.length, Math.max(1, 5 - (docxPageCount % 5 || 5)))
        : Math.min(RECOGNITION_FRONTEND_BATCH_PAGE_COUNT, targetPages.length);
      const batchSizes = [
        firstBatchSize,
        ...Array.from(
          { length: Math.ceil(Math.max(0, targetPages.length - firstBatchSize) / RECOGNITION_FRONTEND_BATCH_PAGE_COUNT) },
          () => RECOGNITION_FRONTEND_BATCH_PAGE_COUNT,
        ),
      ];
      const batches: UploadedPage[][] = [];
      let batchOffset = 0;
      for (const size of batchSizes) {
        if (batchOffset >= targetPages.length) break;
        batches.push(targetPages.slice(batchOffset, batchOffset + size));
        batchOffset += size;
      }

      for (const [batchIndex, globalBatchPages] of batches.entries()) {
        const offset = batches.slice(0, batchIndex).reduce((sum, batch) => sum + batch.length, 0);
        const batchPages = globalBatchPages.map((page, index) => ({ ...page, pageIndex: index }));
        const batchNumber = batchIndex + 1;
        const batchCount = batches.length;
        const includesDocx = batchIndex === 0 && Boolean(docxImportSessionId && docxPageCount > 0);
        const billablePageCount = batchPages.length + (includesDocx ? docxPageCount : 0);
        let batchQuestions: QuestionItem[] = [];

        setStatus(`正在识别第 ${offset + 1}-${Math.min(targetPages.length, offset + globalBatchPages.length)}/${targetPages.length} 页（批次 ${batchNumber}/${batchCount}）`);
        try {
          const result = await recognizeWholeDocument(batchPages, {
            onProgress: (progress) => {
              const current = Math.min(globalBatchPages.length, progress.current);
              setStatus(`正在识别第 ${offset + Math.max(1, current)}/${targetPages.length} 页（批次 ${batchNumber}/${batchCount}）`);
            },
            sourcePageCount: billablePageCount,
            ...(includesDocx ? { docxImportSessionId } : {}),
          });
          if (includesDocx) {
            // 首批成功返回即表示 DOCX 页数已经完成结算；失败页重试时不得再次计入。
            setDocxImportSessionId("");
            setDocxPageCount(0);
          }
          const globalResult = remapRecognitionResultPageIndexes(result, globalBatchPages);
          await buildQuestionsWithCrops(
            globalResult,
            pages,
            mergedQuestions.length,
            (current, total) => {
              setStatus(
                `正在整理第 ${offset + 1}-${Math.min(targetPages.length, offset + globalBatchPages.length)}/${targetPages.length} 页（图形 ${current}/${total}）`,
              );
            },
            (question, current, total) => {
              // 题目文本一完成就先进入 A4 预览，图形裁切不会再阻塞整批结果显示。
              batchQuestions.push(question);
              setQuestions([...mergedQuestions, ...batchQuestions]);
              setActiveQuestionId((activeId) => activeId || question.id);
              setStatus(
                `已识别至第 ${Math.min(targetPages.length, offset + globalBatchPages.length)}/${targetPages.length} 页，A4 预览已追加 ${current}/${total} 项内容`,
              );
            },
          );
          // 仅在整批整理成功后提交到累计结果，避免异常时留下半批重复内容。
          mergedQuestions = [...mergedQuestions, ...batchQuestions];
          completedPageCount += globalBatchPages.length;
          setQuestions(mergedQuestions);
          setActiveQuestionId((current) => current || mergedQuestions[0]?.id || "");
          setCropTarget(null);
          setStatus(`已完成 ${completedPageCount}/${targetPages.length} 页，A4 预览当前共 ${mergedQuestions.length} 项内容`);
        } catch {
          // 失败批次不能伪装成已识别内容；保留原上传页供下一次识别，只展示真实成功结果。
          setQuestions(mergedQuestions);
          setActiveQuestionId((current) => (
            mergedQuestions.some((question) => question.id === current)
              ? current
              : mergedQuestions[0]?.id || ""
          ));
          failedPageIndexes.push(...globalBatchPages.map((page) => page.pageIndex));
          setStatus(`第 ${offset + 1}-${Math.min(targetPages.length, offset + globalBatchPages.length)} 页识别失败，本批次积分已退回，继续处理后续页面`);
        }
      }

      setCropTarget(null);
      if (failedPageIndexes.length) {
        const retryPageIndexes = [...new Set(failedPageIndexes)].sort((left, right) => left - right);
        setSelectedPageIndexes(retryPageIndexes);
        setIsUsageSettled(false);
        setError(`有 ${retryPageIndexes.length} 页未生成可编辑内容，对应积分已退回；请点击“智能识别”重试这些页面。`);
        setStatus(`已识别 ${completedPageCount}/${targetPages.length} 页，剩余 ${retryPageIndexes.length} 页可重试`);
      } else {
        setIsUsageSettled(true);
        setStatus(`已完整识别 ${completedPageCount}/${targetPages.length} 页，A4 预览可继续编辑并导出`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "智能识别失败");
      setStatus("识别失败");
    } finally {
      recognitionRequestRef.current = false;
      setIsBusy(false);
    }
  }

  async function handleRefineFigure(questionId: string, figureId: string) {
    const question = questions.find((item) => item.id === questionId);
    const figure = getQuestionFigures(question).find((item) => item.id === figureId);
    if (!figure?.bbox || figure.pageIndex === undefined) return;
    const page = pages.find((item) => item.pageIndex === figure.pageIndex);
    if (!page) return;

    setIsBusy(true);
    setStatus("正在按完整图形边界重新裁切");
    try {
      const neighborBboxes = getQuestionFigures(question)
        .filter((candidate) => candidate !== figure && candidate.pageIndex === figure.pageIndex && candidate.bbox)
        .map((candidate) => candidate.bbox!);
      let crop: Awaited<ReturnType<typeof cropFigureFromPage>>;
      try {
        crop = await cropFigureFromPage(page, figure.bbox, { neighborBboxes });
      } catch {
        // 浏览器图形裁切失败时保留完整原页，保证文字和原始资料仍能继续输出。
        crop = {
          dataUrl: page.imageDataUrl,
          width: page.width,
          height: page.height,
          bbox: { x: 0, y: 0, width: 1, height: 1 },
        };
      }
      updateFigure(questionId, figureId, {
        bbox: crop.bbox,
        dataUrl: crop.dataUrl,
        width: crop.width,
        height: crop.height,
      });
      setStatus("图形边界已按完整范围重新裁切");
    } catch (err) {
      setError(err instanceof Error ? err.message : "重新裁切失败");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleApplyManualCrop(bbox: BBox) {
    const target = cropTarget;
    const page = cropPage;
    if (!target || !page || isBusy || cropApplyRef.current) return;

    cropApplyRef.current = true;
    setIsBusy(true);
    setError("");
    setStatus("正在按手动边界重新裁切图形");
    try {
      const normalizedBbox = normalizeBbox(bbox);
      const crop = await cropFigureFromPage(page, normalizedBbox, { refineContent: false });
      updateFigure(target.questionId, target.figureId, {
        bbox: crop.bbox,
        dataUrl: crop.dataUrl,
        width: crop.width,
        height: crop.height,
      });
      setCropTarget(null);
      setStatus("手动裁切已应用到资料图片");
    } catch (err) {
      setError(err instanceof Error ? err.message : "手动裁切失败");
    } finally {
      cropApplyRef.current = false;
      setIsBusy(false);
    }
  }

  async function handleExport() {
    if (!questions.length) {
      setError("没有可导出的资料内容。");
      return;
    }

    setIsExporting(true);
    setError("");
    setStatus("正在生成 A4 可编辑 Word");
    try {
      await exportDocx(fileName ? `${fileName} 资料重排` : "资料内容重排", questions);
      setStatus("Word 已生成");
    } catch (err) {
      setError(err instanceof Error ? err.message : "导出 Word 失败");
      setStatus("导出失败");
    } finally {
      setIsExporting(false);
    }
  }

  function togglePageSelected(pageIndex: number) {
    setSelectedPageIndexes((indexes) => (
      indexes.includes(pageIndex)
        ? indexes.filter((index) => index !== pageIndex)
        : [...indexes, pageIndex].sort((left, right) => left - right)
    ));
  }

  function toggleSelectAllPages() {
    if (!pages.length) return;
    if (isAllPagesSelected) {
      setSelectedPageIndexes([]);
      setStatus("已取消全部页面选择");
      return;
    }
    setSelectedPageIndexes(pages.map((page) => page.pageIndex));
    setStatus(`已全选 ${pages.length} 页，点击智能识别后只处理已选页面`);
  }

  function updateQuestion(id: string, patch: Partial<QuestionItem>) {
    setQuestions((items) => items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  function updateFigure(questionId: string, figureId: string, patch: Partial<QuestionFigure>) {
    setQuestions((items) => items.map((item) => {
      if (item.id !== questionId) return item;
      return {
        ...item,
        figures: getQuestionFigures(item).map((figure) => (figure.id === figureId ? { ...figure, ...patch } : figure)),
      };
    }));
  }

  function removeFigure(questionId: string, figureId: string) {
    setQuestions((items) => items.map((item) => {
      if (item.id !== questionId) return item;
      return {
        ...item,
        figures: getQuestionFigures(item).filter((figure) => figure.id !== figureId),
      };
    }));
    setCropTarget((target) => (target?.questionId === questionId && target.figureId === figureId ? null : target));
  }

  function closeCropEditor() {
    setCropTarget(null);
    setStatus("已取消图形裁切微调");
  }

  function openCropEditor(questionId: string, figure: QuestionFigure) {
    if (!figure.bbox) return;
    activateQuestion(questionId);
    setCropTarget({
      questionId,
      figureId: figure.id,
      bbox: figure.bbox,
      viewport: createCropViewport(figure.bbox),
    });
    setStatus("已在资料图片中打开裁切微调");
  }

  function activateQuestion(questionId: string) {
    setActiveQuestionId(questionId);
    setSelectedQuestionIds((ids) => (ids.includes(questionId) ? ids : [...ids, questionId]));
  }

  function toggleQuestionSelected(questionId: string) {
    setActiveQuestionId(questionId);
    setSelectedQuestionIds((ids) => (
      ids.includes(questionId) ? ids.filter((id) => id !== questionId) : [...ids, questionId]
    ));
  }

  function toggleSelectAllQuestions() {
    if (!questions.length) return;
    if (isAllQuestionsSelected) {
      setSelectedQuestionIds([]);
      setStatus("已取消全选内容");
      return;
    }
    setSelectedQuestionIds(questions.map((question) => question.id));
    setStatus(`已全选 ${questions.length} 项内容`);
  }

  function updateQuestionDropTarget(target: QuestionDropTarget | null) {
    const current = dropTargetRef.current;
    if (current?.id === target?.id && current?.placement === target?.placement) return;
    dropTargetRef.current = target;
    setDropTarget(target);
  }

  function handleQuestionPointerDown(questionId: string, event: React.PointerEvent<HTMLElement>) {
    if (isBusy || event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("button,input,textarea,a,label,.inline-crop-editor")) return;

    pointerDragRef.current = {
      questionId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      hasMoved: false,
      element: event.currentTarget,
      previousUserSelect: document.body.style.userSelect,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    window.addEventListener("pointermove", handleQuestionPointerMove);
    window.addEventListener("pointerup", handleQuestionPointerUp);
    window.addEventListener("pointercancel", handleQuestionPointerCancel);
  }

  function handleQuestionPointerMove(event: PointerEvent) {
    const drag = pointerDragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;

    const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
    if (!drag.hasMoved) {
      if (distance < 6) return;
      drag.hasMoved = true;
      document.body.style.userSelect = "none";
      setDragQuestionId(drag.questionId);
    }

    event.preventDefault();
    pendingDragPointRef.current = {
      clientX: event.clientX,
      clientY: event.clientY,
      pointerId: event.pointerId,
    };
    if (dragHitTestFrameRef.current !== null) return;

    dragHitTestFrameRef.current = window.requestAnimationFrame(() => {
      dragHitTestFrameRef.current = null;
      flushPendingQuestionDropTarget();
    });
  }

  function handleQuestionPointerUp(event: PointerEvent) {
    const drag = pointerDragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;

    flushPendingQuestionDropTarget();
    const target = dropTargetRef.current;
    if (drag.hasMoved && target) {
      moveQuestion(drag.questionId, target.id, target.placement);
    }
    cleanupQuestionPointerDrag();
  }

  function handleQuestionPointerCancel(event: PointerEvent) {
    const drag = pointerDragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    cleanupQuestionPointerDrag();
  }

  function cleanupQuestionPointerDrag() {
    const drag = pointerDragRef.current;
    if (drag) {
      if (drag.element.hasPointerCapture(drag.pointerId)) {
        drag.element.releasePointerCapture(drag.pointerId);
      }
      document.body.style.userSelect = drag.previousUserSelect;
    }
    pendingDragPointRef.current = null;
    if (dragHitTestFrameRef.current !== null) {
      window.cancelAnimationFrame(dragHitTestFrameRef.current);
      dragHitTestFrameRef.current = null;
    }
    pointerDragRef.current = null;
    window.removeEventListener("pointermove", handleQuestionPointerMove);
    window.removeEventListener("pointerup", handleQuestionPointerUp);
    window.removeEventListener("pointercancel", handleQuestionPointerCancel);
    finishQuestionDrag();
  }

  function flushPendingQuestionDropTarget() {
    const point = pendingDragPointRef.current;
    const drag = pointerDragRef.current;
    pendingDragPointRef.current = null;
    if (!point || !drag || point.pointerId !== drag.pointerId || !drag.hasMoved) return;
    updateQuestionDropTarget(getQuestionDropTargetFromPoint(point.clientX, point.clientY, drag.questionId));
  }

  function finishQuestionDrag() {
    setDragQuestionId(null);
    updateQuestionDropTarget(null);
  }

  function moveQuestion(sourceId: string, targetId: string, placement: DropPlacement) {
    if (sourceId === targetId) return;

    setQuestions((items) => {
      const sourceIndex = items.findIndex((item) => item.id === sourceId);
      if (sourceIndex < 0) return items;

      const source = items[sourceIndex];
      const withoutSource = items.filter((item) => item.id !== sourceId);
      const targetIndex = withoutSource.findIndex((item) => item.id === targetId);
      if (targetIndex < 0) return items;

      const insertIndex = placement === "after" ? targetIndex + 1 : targetIndex;
      const next = [...withoutSource];
      next.splice(insertIndex, 0, source);
      return next;
    });
    setActiveQuestionId(sourceId);
    setStatus("资料内容顺序已更新");
  }

  function getQuestionDropTargetFromPoint(clientX: number, clientY: number, sourceId: string): QuestionDropTarget | null {
    const element = document.elementFromPoint(clientX, clientY);
    const questionElement = element instanceof HTMLElement
      ? element.closest("[data-question-id]") as HTMLElement | null
      : null;
    const targetId = questionElement?.dataset.questionId;
    if (!questionElement || !targetId || targetId === sourceId) return null;
    return {
      id: targetId,
      placement: getQuestionDropPlacement(questionElement, clientY),
    };
  }

  function getQuestionDropPlacement(element: HTMLElement, clientY: number): DropPlacement {
    const rect = element.getBoundingClientRect();
    return clientY < rect.top + rect.height / 2 ? "before" : "after";
  }

  function shouldApplyCropFromKeyboard(target: EventTarget | null) {
    const element = target instanceof HTMLElement ? target : null;
    if (!element) return true;

    const editor = cropEditorRef.current;
    if (editor && !editor.contains(element) && element !== document.body) return false;
    if (element instanceof HTMLTextAreaElement) return false;
    if (element instanceof HTMLInputElement && element.type !== "range" && element.type !== "number") return false;

    const button = element.closest("button");
    if (button && !button.hasAttribute("data-crop-apply")) return false;
    return true;
  }

  return (
    <main className="workspace">
      <section className="left-panel">
        <div className="brand">
          <div>
            <span className="eyebrow">QUESTION PAPER WORKBENCH</span>
            <h1>题卷重排WORD工作台</h1>
          </div>
          <FileText aria-hidden />
        </div>

        <button
          className="upload-zone"
          type="button"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            void handleFiles(event.dataTransfer.files);
          }}
        >
          <Upload aria-hidden />
          <span>{fileName || "批量上传 PDF / DOCX / PNG / JPG"}</span>
        </button>
        <p className="upload-hint">
          支持<span className="hint-emphasis">任意内容</span>的 PDF、DOCX 和图片；标题、正文、题目、答案、表格与图片都会完整保留。
        </p>
        <p className="billing-hint">每5页纸消耗1积分，生成失败会退回积分（刷新后显示）</p>
        <input
          ref={fileInputRef}
          className="visually-hidden"
          type="file"
          multiple
          accept=".pdf,.docx,image/*,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          onChange={(event) => void handleFiles(event.target.files)}
        />

        <div className="action-row">
          <button
            className="primary-button"
            type="button"
            disabled={isBusy || !selectedPages.length || isUsageSettled}
            onClick={() => void handleRecognize()}
          >
            {isBusy ? <Loader2 className="spin" aria-hidden /> : <Bot aria-hidden />}
            智能识别
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={isExporting || !questions.length}
            onClick={() => void handleExport()}
          >
            {isExporting ? <Loader2 className="spin" aria-hidden /> : <Download aria-hidden />}
            导出 Word
          </button>
        </div>

        <div className="status-line">
          <span className={error ? "dot error" : "dot"} />
          <span>{error || status}</span>
        </div>

      </section>

      <section className="paper-stage">
        <div className="paper-toolbar">
          <span>{pages.length > 0 && !hasStartedRecognition ? "选择待处理页面" : questions.length ? `${questions.length} 项内容` : "A4 预览"}</span>
          {!(pages.length > 0 && !hasStartedRecognition) && (
            <div className="paper-toolbar-actions">
              {questions.length > 0 && <span>已选 {selectedQuestionIds.length} 项</span>}
              <button type="button" disabled={!questions.length} onClick={toggleSelectAllQuestions}>
                {isAllQuestionsSelected ? <CheckSquare size={16} aria-hidden /> : <Square size={16} aria-hidden />}
                {isAllQuestionsSelected ? "取消全选" : "全选"}
              </button>
            </div>
          )}
          <span>{fileName || "未命名资料"}</span>
        </div>
        {pages.length > 0 && !hasStartedRecognition ? (
          <PageStrip
            pages={pages}
            selectedPageIndexes={selectedPageIndexSet}
            isAllSelected={isAllPagesSelected}
            onToggle={togglePageSelected}
            onToggleAll={toggleSelectAllPages}
          />
        ) : <div className="paper">
          {questions.length ? (
            questions.map((question) => (
              <QuestionPreviewCard
                key={question.id}
                question={question}
                active={activeQuestion?.id === question.id}
                selected={selectedQuestionIdSet.has(question.id)}
                dragging={dragQuestionId === question.id}
                dropPlacement={dropTarget?.id === question.id ? dropTarget.placement : null}
                cropState={cropCardState?.questionId === question.id ? cropCardState : null}
                isCropEditorOpen={Boolean(cropTarget)}
                isBusy={isBusy}
                cropEditorRef={cropEditorRef}
                onActivate={activateQuestion}
                onPointerDown={handleQuestionPointerDown}
                onToggleSelected={toggleQuestionSelected}
                onOpenCropEditor={openCropEditor}
                onApplyCrop={handleApplyManualCrop}
                onCloseCropEditor={closeCropEditor}
              />
            ))
          ) : (
            <div className="empty-paper">
              <ImageIcon aria-hidden />
              <span>上传文件后在这里预览 A4 排版</span>
            </div>
          )}
        </div>}
      </section>

      <aside className="right-panel">
        <div className="section-title">
          <Scissors size={18} aria-hidden />
          <span>资料内容与图形</span>
        </div>

        {activeQuestion ? (
          <div className="editor">
            <label>
              内容类型
              <select
                value={activeQuestion.kind || "question"}
                onChange={(event) => updateQuestion(activeQuestion.id, {
                  kind: event.target.value === "content" ? "content" : "question",
                  number: event.target.value === "content" ? "" : activeQuestion.number,
                })}
              >
                <option value="content">普通资料</option>
                <option value="question">题目</option>
              </select>
            </label>
            <label>
              题号（普通资料留空）
              <input
                value={activeQuestion.number}
                disabled={activeQuestion.kind === "content"}
                onChange={(event) => updateQuestion(activeQuestion.id, { number: event.target.value })}
              />
            </label>
            <label>
              原文内容
              <textarea
                value={activeQuestion.stemMarkdown}
                onChange={(event) => updateQuestion(activeQuestion.id, { stemMarkdown: event.target.value })}
              />
            </label>
            <label>
              题目选项
              <textarea
                value={activeQuestion.options.join("\n")}
                onChange={(event) => updateQuestion(
                  activeQuestion.id,
                  { options: event.target.value.split(/\n+/).map((item) => item.trim()).filter(Boolean) },
                )}
              />
            </label>

            <div className="figure-list">
              {getQuestionFigures(activeQuestion).map((figure) => {
                const figureLabel = getFigureKindLabel(figure.kind);
                const optionLabel = normalizeOptionLabel(figure.optionLabel);
                const figureMetaLabel = optionLabel ? `${optionLabel} 选项` : figureLabel;
                return (
                  <div className="figure-item" key={figure.id}>
                    <img src={figure.dataUrl} alt={figure.caption || `资料${figureMetaLabel}`} loading="lazy" decoding="async" />
                    <div className="figure-meta">
                      <span>{figure.confidence ? `${figureMetaLabel} · 置信度 ${Math.round(figure.confidence * 100)}%` : `${figureMetaLabel} · 原图裁切`}</span>
                      <div>
                        <button type="button" disabled={isBusy || Boolean(cropTarget)} onClick={() => void handleRefineFigure(activeQuestion.id, figure.id)} title="重新精修">
                          <RefreshCcw size={16} aria-hidden />
                        </button>
                        <button type="button" disabled={isBusy || Boolean(cropTarget)} onClick={() => removeFigure(activeQuestion.id, figure.id)} title={`移除${figureMetaLabel}`}>
                          <X size={16} aria-hidden />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="empty-side">识别完成后可在这里校对全部资料内容。</div>
        )}
      </aside>
    </main>
  );
}

type QuestionPreviewCardProps = {
  question: QuestionItem;
  active: boolean;
  selected: boolean;
  dragging: boolean;
  dropPlacement: DropPlacement | null;
  cropState: CropCardState | null;
  isCropEditorOpen: boolean;
  isBusy: boolean;
  cropEditorRef: React.Ref<HTMLDivElement>;
  onActivate: (questionId: string) => void;
  onPointerDown: (questionId: string, event: React.PointerEvent<HTMLElement>) => void;
  onToggleSelected: (questionId: string) => void;
  onOpenCropEditor: (questionId: string, figure: QuestionFigure) => void;
  onApplyCrop: (bbox: BBox) => Promise<void>;
  onCloseCropEditor: () => void;
};

const QuestionPreviewCard = memo(function QuestionPreviewCard({
  question,
  active,
  selected,
  dragging,
  dropPlacement,
  cropState,
  isCropEditorOpen,
  isBusy,
  cropEditorRef,
  onActivate,
  onPointerDown,
  onToggleSelected,
  onOpenCropEditor,
  onApplyCrop,
  onCloseCropEditor,
}: QuestionPreviewCardProps) {
  const className = [
    "question-preview",
    question.kind === "content" ? "content-item" : "question-item",
    active ? "active" : "",
    selected ? "selected" : "",
    dragging ? "dragging" : "",
    dropPlacement ? `drop-${dropPlacement}` : "",
  ].filter(Boolean).join(" ");
  const [draftCrop, setDraftCrop] = useState<CropTarget | null>(() => createCropDraft(cropState));

  useEffect(() => {
    setDraftCrop(createCropDraft(cropState));
  }, [cropState]);

  function updateDraftBbox(bbox: BBox) {
    setDraftCrop((current) => current ? { ...current, bbox: normalizeBbox(bbox) } : current);
  }

  function completeDraftDrag() {
    setDraftCrop((current) => (
      current
        ? { ...current, viewport: keepCropViewportVisible(current.bbox, current.viewport) }
        : current
    ));
  }

  function moveDraftCrop(delta: { x?: number; y?: number }) {
    setDraftCrop((current) => {
      if (!current) return current;
      const bbox = {
        ...current.bbox,
        x: clamp(current.bbox.x + (delta.x ?? 0), 0, 1 - current.bbox.width),
        y: clamp(current.bbox.y + (delta.y ?? 0), 0, 1 - current.bbox.height),
      };
      return {
        ...current,
        bbox,
        viewport: keepCropViewportVisible(bbox, current.viewport),
      };
    });
  }

  function adjustDraftCrop(delta: Partial<{ x: number; y: number; width: number; height: number }>) {
    setDraftCrop((current) => {
      if (!current) return current;
      const bbox = normalizeBbox({
        x: current.bbox.x + (delta.x ?? 0),
        y: current.bbox.y + (delta.y ?? 0),
        width: current.bbox.width + (delta.width ?? 0),
        height: current.bbox.height + (delta.height ?? 0),
      });
      return {
        ...current,
        bbox,
        viewport: keepCropViewportVisible(bbox, current.viewport),
      };
    });
  }

  const figures = getQuestionFigures(question);
  const visualOptionFigures = figures
    .filter((figure) => figure.kind === "option" && normalizeOptionLabel(figure.optionLabel))
    .sort((left, right) => normalizeOptionLabel(left.optionLabel).localeCompare(normalizeOptionLabel(right.optionLabel)));
  const visualOptionLabels = new Set(visualOptionFigures.map((figure) => normalizeOptionLabel(figure.optionLabel)));
  const displayOptions = visualOptionFigures.length
    ? restoreVisualOptionLabels(question.options, [...visualOptionLabels])
    : question.options;
  const textOptions = displayOptions.filter((option) => {
    const label = extractOptionLabel(option);
    return !(label && visualOptionLabels.has(label) && isOptionLabelOnly(option));
  });
  const contentFigures = figures.filter(
    (figure) => figure.kind !== "option" || !normalizeOptionLabel(figure.optionLabel),
  );

  function renderFigure(figure: QuestionFigure, visualOption = false) {
    const isEditing = cropState?.figureId === figure.id;
    const editingPage = isEditing ? cropState.page : null;
    const editingCrop = isEditing && draftCrop?.figureId === figure.id ? draftCrop : cropState;
    const optionLabel = normalizeOptionLabel(figure.optionLabel);
    const figureNoun = visualOption && optionLabel ? `${optionLabel} 选项` : getFigureKindLabel(figure.kind);

    return (
      <figure
        className={[
          "question-figure",
          visualOption ? "visual-option-card" : "",
          editingPage ? "is-crop-editing" : "",
        ].filter(Boolean).join(" ")}
        data-figure-id={figure.id}
        data-figure-kind={figure.kind || "diagram"}
        data-option-label={optionLabel || undefined}
        key={figure.id}
      >
        {visualOption && optionLabel && <span className="visual-option-label">{optionLabel}.</span>}
        {editingPage && editingCrop ? (
          <div
            className="inline-crop-editor"
            data-crop-editor="true"
            ref={cropEditorRef}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="inline-crop-header">
              <Scissors size={17} aria-hidden />
              <span>{figureNoun}裁切微调</span>
            </div>
            <div className="inline-crop-workspace">
              <div className="inline-crop-pane">
                <span className="inline-crop-pane-label">当前资料{figureNoun}局部</span>
                <div className="crop-canvas inline-crop-canvas">
                  <CropPreview
                    page={editingPage}
                    bbox={editingCrop.bbox}
                    viewport={editingCrop.viewport}
                    onChange={updateDraftBbox}
                    onComplete={completeDraftDrag}
                    disabled={isBusy}
                  />
                </div>
              </div>
              <CropResultPreview page={editingPage} bbox={editingCrop.bbox} />
            </div>
            <div className="crop-tools" aria-label="裁切框微调">
              <button type="button" disabled={isBusy} onClick={() => moveDraftCrop({ y: -fineStep(editingPage.height) })} title="上移 1 像素"><ArrowUp size={15} aria-hidden /></button>
              <button type="button" disabled={isBusy} onClick={() => moveDraftCrop({ x: -fineStep(editingPage.width) })} title="左移 1 像素"><ArrowLeft size={15} aria-hidden /></button>
              <button type="button" disabled={isBusy} onClick={() => moveDraftCrop({ x: fineStep(editingPage.width) })} title="右移 1 像素"><ArrowRight size={15} aria-hidden /></button>
              <button type="button" disabled={isBusy} onClick={() => moveDraftCrop({ y: fineStep(editingPage.height) })} title="下移 1 像素"><ArrowDown size={15} aria-hidden /></button>
              <button type="button" disabled={isBusy} onClick={() => adjustDraftCrop(expandDelta(editingPage, 1))} title="四边外扩 1 像素"><Maximize2 size={15} aria-hidden /></button>
              <button type="button" disabled={isBusy} onClick={() => adjustDraftCrop(expandDelta(editingPage, -1))} title="四边内收 1 像素"><Minimize2 size={15} aria-hidden /></button>
              <button type="button" disabled={isBusy} onClick={() => adjustDraftCrop(expandDelta(editingPage, 4))} title="四边外扩 4 像素"><Move size={15} aria-hidden /></button>
            </div>
            <div className="action-row crop-actions inline-crop-actions">
              <button className="primary-button" type="button" data-crop-apply="true" disabled={isBusy} onClick={() => void onApplyCrop(editingCrop.bbox)}>
                <Scissors aria-hidden />
                应用裁切
              </button>
              <button className="secondary-button" type="button" disabled={isBusy} onClick={onCloseCropEditor}>
                <X aria-hidden />
                取消
              </button>
            </div>
          </div>
        ) : figure.bbox ? (
          <button
            className="question-figure-trigger"
            type="button"
            data-figure-id={figure.id}
            data-inline-crop-trigger="true"
            onClick={() => onOpenCropEditor(question.id, figure)}
            disabled={isBusy || isCropEditorOpen}
            aria-label={`裁切微调${question.kind === "content" ? "资料" : `第 ${question.number} 题`}${figureNoun}`}
          >
            <img src={figure.dataUrl} alt={figure.caption || `资料${figureNoun}`} loading="lazy" decoding="async" />
            <span className="figure-edit-badge"><Scissors size={14} aria-hidden />裁切微调</span>
          </button>
        ) : (
          <img src={figure.dataUrl} alt={figure.caption || `资料${figureNoun}`} loading="lazy" decoding="async" />
        )}
        {!visualOption && figure.caption && <figcaption>{figure.caption}</figcaption>}
      </figure>
    );
  }

  return (
    <article
      className={className}
      data-question-id={question.id}
      onClick={() => onActivate(question.id)}
      onPointerDown={(event) => onPointerDown(question.id, event)}
    >
      <label
        className="question-select"
        aria-label={selected ? "取消选中内容" : "选中内容"}
        title={selected ? "取消选中内容" : "选中内容"}
        onClick={(event) => event.stopPropagation()}
      >
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelected(question.id)}
        />
      </label>
      <span className="question-drag-handle" title="拖动排序" aria-hidden>
        <GripVertical size={16} />
      </span>
      {question.kind !== "content" && <div className="question-number">{question.number}</div>}
      <MarkdownText value={question.stemMarkdown} />
      {textOptions.length > 0 && (
        <div className="option-grid">
          {textOptions.map((option) => (
            <MarkdownText key={option} value={option} />
          ))}
        </div>
      )}
      {visualOptionFigures.length > 0 && (
        <div className="visual-option-grid" aria-label="图形选项">
          {visualOptionFigures.map((figure) => renderFigure(figure, true))}
        </div>
      )}
      {contentFigures.map((figure) => renderFigure(figure))}
    </article>
  );
}, areQuestionPreviewCardPropsEqual);

function areQuestionPreviewCardPropsEqual(previous: QuestionPreviewCardProps, next: QuestionPreviewCardProps) {
  return previous.question === next.question
    && previous.active === next.active
    && previous.selected === next.selected
    && previous.dragging === next.dragging
    && previous.dropPlacement === next.dropPlacement
    && previous.cropState === next.cropState
    && previous.isCropEditorOpen === next.isCropEditorOpen
    && previous.isBusy === next.isBusy;
}

function createCropDraft(cropState: CropCardState | null): CropTarget | null {
  if (!cropState) return null;
  return {
    questionId: cropState.questionId,
    figureId: cropState.figureId,
    bbox: cropState.bbox,
    viewport: cropState.viewport,
  };
}

const PageStrip = memo(function PageStrip({
  pages,
  selectedPageIndexes,
  isAllSelected,
  onToggle,
  onToggleAll,
}: {
  pages: UploadedPage[];
  selectedPageIndexes: ReadonlySet<number>;
  isAllSelected: boolean;
  onToggle: (pageIndex: number) => void;
  onToggleAll: () => void;
}) {
  return (
    <section className="page-selection" aria-label="选择需要识别的页面">
      <div className="page-selection-toolbar">
        <span>上传页面预览（已选 {selectedPageIndexes.size}/{pages.length} 页）</span>
        <button type="button" onClick={onToggleAll}>
          {isAllSelected ? <CheckSquare size={15} aria-hidden /> : <Square size={15} aria-hidden />}
          {isAllSelected ? "取消全选" : "一键全选"}
        </button>
      </div>
      <div className="page-strip">
      {pages.map((page) => (
        <button
          key={page.pageIndex}
          type="button"
          className={`page-preview-option${selectedPageIndexes.has(page.pageIndex) ? " is-selected" : ""}`}
          onClick={() => onToggle(page.pageIndex)}
          aria-pressed={selectedPageIndexes.has(page.pageIndex)}
          title={`第 ${page.pageIndex + 1} 页，点击${selectedPageIndexes.has(page.pageIndex) ? "取消选择" : "选择"}`}
        >
          <img
            src={page.imageDataUrl}
            alt={`第 ${page.pageIndex + 1} 页`}
            loading="lazy"
            decoding="async"
          />
          <span className="page-preview-index">{page.pageIndex + 1}</span>
          <span className="page-preview-check" aria-hidden>
            {selectedPageIndexes.has(page.pageIndex) ? <CheckSquare size={17} /> : <Square size={17} />}
          </span>
        </button>
      ))}
      </div>
    </section>
  );
});

function CropResultPreview({
  page,
  bbox,
}: {
  page: UploadedPage;
  bbox: BBox;
}) {
  const safeCropWidth = Math.max(MIN_CROP_SIZE, bbox.width);
  const safeCropHeight = Math.max(MIN_CROP_SIZE, bbox.height);
  const cropWidth = Math.max(1, page.width * safeCropWidth);
  const cropHeight = Math.max(1, page.height * safeCropHeight);
  const cropRatio = cropWidth / cropHeight;
  const sourceImageStyle = {
    left: `${-(bbox.x / safeCropWidth) * 100}%`,
    top: `${-(bbox.y / safeCropHeight) * 100}%`,
    width: `${(1 / safeCropWidth) * 100}%`,
    height: `${(1 / safeCropHeight) * 100}%`,
  };

  return (
    <section className="crop-result-preview" data-crop-live-preview="true" aria-label="实时裁切预览">
      <div className="crop-result-header">
        <span>实时预览</span>
      </div>
      <div
        className="crop-result-stage"
        data-crop-ratio={`${cropWidth} / ${cropHeight}`}
        style={{
          aspectRatio: `${cropWidth} / ${cropHeight}`,
          width: `min(100%, ${260 * cropRatio}px)`,
        }}
      >
        <img
          className="crop-result-source"
          src={page.imageDataUrl}
          alt=""
          aria-hidden="true"
          style={sourceImageStyle}
          decoding="async"
        />
      </div>
    </section>
  );
}

function CropPreview({
  page,
  bbox,
  viewport,
  onChange,
  onComplete,
  disabled,
}: {
  page: UploadedPage;
  bbox: BBox;
  viewport: BBox;
  onChange: (bbox: BBox) => void;
  onComplete: () => void;
  disabled: boolean;
}) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const pendingBboxRef = useRef<BBox | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const cropBoxStyle = {
    left: `${((bbox.x - viewport.x) / viewport.width) * 100}%`,
    top: `${((bbox.y - viewport.y) / viewport.height) * 100}%`,
    width: `${(bbox.width / viewport.width) * 100}%`,
    height: `${(bbox.height / viewport.height) * 100}%`,
  };
  const leftPercent = ((bbox.x - viewport.x) / viewport.width) * 100;
  const topPercent = ((bbox.y - viewport.y) / viewport.height) * 100;
  const rightPercent = leftPercent + (bbox.width / viewport.width) * 100;
  const bottomPercent = topPercent + (bbox.height / viewport.height) * 100;
  const centerXPercent = (leftPercent + rightPercent) / 2;
  const centerYPercent = (topPercent + bottomPercent) / 2;
  const sourceImageStyle = {
    left: `${-(viewport.x / viewport.width) * 100}%`,
    top: `${-(viewport.y / viewport.height) * 100}%`,
    width: `${(1 / viewport.width) * 100}%`,
    height: `${(1 / viewport.height) * 100}%`,
  };

  useEffect(() => () => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
    }
  }, []);

  function queueBboxChange(nextBbox: BBox) {
    pendingBboxRef.current = nextBbox;
    if (animationFrameRef.current !== null) return;

    animationFrameRef.current = window.requestAnimationFrame(() => {
      animationFrameRef.current = null;
      const pending = pendingBboxRef.current;
      pendingBboxRef.current = null;
      if (pending) onChange(pending);
    });
  }

  function flushBboxChange() {
    const pending = pendingBboxRef.current;
    pendingBboxRef.current = null;
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (pending) onChange(pending);
  }

  function beginDrag(mode: CropDragMode, event: React.PointerEvent<HTMLElement>) {
    if (disabled) return;
    event.preventDefault();
    event.stopPropagation();
    const stage = stageRef.current;
    if (!stage) return;

    const rect = stage.getBoundingClientRect();
    const start = pointerToPagePoint(event, rect, viewport);
    const startBbox = bbox;
    const target = event.currentTarget;
    const pointerId = event.pointerId;
    target.setPointerCapture(pointerId);

    function handlePointerMove(moveEvent: PointerEvent) {
      const current = pointerToPagePoint(moveEvent, rect, viewport);
      const dx = current.x - start.x;
      const dy = current.y - start.y;
      queueBboxChange(resizeCropBbox(startBbox, mode, dx, dy));
    }

    function finishDrag() {
      if (target.hasPointerCapture(pointerId)) {
        target.releasePointerCapture(pointerId);
      }
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishDrag);
      window.removeEventListener("pointercancel", finishDrag);
      flushBboxChange();
      onComplete();
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", finishDrag);
    window.addEventListener("pointercancel", finishDrag);
  }

  return (
    <div
      ref={stageRef}
      className="crop-image-stage"
      data-crop-disabled={disabled || undefined}
      style={{ aspectRatio: `${page.width * viewport.width} / ${page.height * viewport.height}` }}
    >
      <img
        src={page.imageDataUrl}
        alt="当前题图局部原图"
        style={sourceImageStyle}
      />
      <span
        className="crop-box"
        style={cropBoxStyle}
        onPointerDown={(event) => beginDrag("move", event)}
      >
        <span className="crop-box-label">
          {Math.round(bbox.width * page.width)}×{Math.round(bbox.height * page.height)}
        </span>
      </span>
      <button
        className="crop-handle crop-handle-left"
        type="button"
        disabled={disabled}
        title="拖动左边界精修"
        style={{ left: `${leftPercent}%`, top: `${centerYPercent}%` }}
        onPointerDown={(event) => beginDrag("left", event)}
      />
      <button
        className="crop-handle crop-handle-right"
        type="button"
        disabled={disabled}
        title="拖动右边界精修"
        style={{ left: `${rightPercent}%`, top: `${centerYPercent}%` }}
        onPointerDown={(event) => beginDrag("right", event)}
      />
      <button
        className="crop-handle crop-handle-top"
        type="button"
        disabled={disabled}
        title="拖动上边界精修"
        style={{ left: `${centerXPercent}%`, top: `${topPercent}%` }}
        onPointerDown={(event) => beginDrag("top", event)}
      />
      <button
        className="crop-handle crop-handle-bottom"
        type="button"
        disabled={disabled}
        title="拖动下边界精修"
        style={{ left: `${centerXPercent}%`, top: `${bottomPercent}%` }}
        onPointerDown={(event) => beginDrag("bottom", event)}
      />
      {(["top-left", "top-right", "bottom-left", "bottom-right"] as const).map((mode) => (
        <button
          key={mode}
          className={`crop-corner crop-corner-${mode}`}
          type="button"
          disabled={disabled}
          title="拖动角点精修裁切框"
          style={cornerStyle(mode, { leftPercent, topPercent, rightPercent, bottomPercent })}
          onPointerDown={(event) => beginDrag(mode, event)}
        />
      ))}
    </div>
  );
}

type CropDragMode =
  | "move"
  | "left"
  | "right"
  | "top"
  | "bottom"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

function cornerStyle(
  mode: Extract<CropDragMode, "top-left" | "top-right" | "bottom-left" | "bottom-right">,
  box: { leftPercent: number; topPercent: number; rightPercent: number; bottomPercent: number },
) {
  const x = mode.includes("left") ? box.leftPercent : box.rightPercent;
  const y = mode.includes("top") ? box.topPercent : box.bottomPercent;
  return { left: `${x}%`, top: `${y}%` };
}

function pointerToPagePoint(
  event: Pick<PointerEvent | React.PointerEvent, "clientX" | "clientY">,
  rect: DOMRect,
  viewport: BBox,
) {
  const stageX = clamp01((event.clientX - rect.left) / rect.width);
  const stageY = clamp01((event.clientY - rect.top) / rect.height);
  return {
    x: viewport.x + stageX * viewport.width,
    y: viewport.y + stageY * viewport.height,
  };
}

function resizeCropBbox(
  bbox: { x: number; y: number; width: number; height: number },
  mode: CropDragMode,
  dx: number,
  dy: number,
) {
  if (mode === "move") {
    const x = clamp(bbox.x + dx, 0, 1 - bbox.width);
    const y = clamp(bbox.y + dy, 0, 1 - bbox.height);
    return normalizeBbox({
      ...bbox,
      x,
      y,
    });
  }

  let left = bbox.x;
  let top = bbox.y;
  let right = bbox.x + bbox.width;
  let bottom = bbox.y + bbox.height;

  if (mode.includes("left")) left += dx;
  if (mode.includes("right")) right += dx;
  if (mode.includes("top")) top += dy;
  if (mode.includes("bottom")) bottom += dy;

  const minSize = MIN_CROP_SIZE;
  left = clamp01(Math.min(left, right - minSize));
  right = clamp01(Math.max(right, left + minSize));
  top = clamp01(Math.min(top, bottom - minSize));
  bottom = clamp01(Math.max(bottom, top + minSize));

  return normalizeBbox({
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  });
}

function createCropViewport(bbox: BBox): BBox {
  const width = getCropViewportSize(bbox.width);
  const height = getCropViewportSize(bbox.height);
  const centerX = bbox.x + bbox.width / 2;
  const centerY = bbox.y + bbox.height / 2;
  return {
    x: clamp(centerX - width / 2, 0, 1 - width),
    y: clamp(centerY - height / 2, 0, 1 - height),
    width,
    height,
  };
}

function getCropViewportSize(cropSize: number) {
  const preferredSize = Math.max(cropSize * CROP_VIEWPORT_SCALE, CROP_VIEWPORT_MIN_SIZE);
  // 只有题图本身接近整页时，局部视窗才会接近整页。
  return Math.max(cropSize, Math.min(CROP_VIEWPORT_MAX_SIZE, preferredSize));
}

function keepCropViewportVisible(bbox: BBox, viewport: BBox): BBox {
  const horizontalPadding = Math.min(
    viewport.width * CROP_VIEWPORT_PADDING_RATIO,
    Math.max(0, (viewport.width - bbox.width) / 2),
  );
  const verticalPadding = Math.min(
    viewport.height * CROP_VIEWPORT_PADDING_RATIO,
    Math.max(0, (viewport.height - bbox.height) / 2),
  );
  const availableWidth = viewport.width - horizontalPadding * 2;
  const availableHeight = viewport.height - verticalPadding * 2;

  // 当裁切框显著变大时，重新围绕当前题图创建局部取景，避免手柄被裁出画布。
  if (bbox.width > availableWidth || bbox.height > availableHeight) {
    return createCropViewport(bbox);
  }

  let x = viewport.x;
  let y = viewport.y;
  if (bbox.x < viewport.x + horizontalPadding) {
    x = bbox.x - horizontalPadding;
  } else if (bbox.x + bbox.width > viewport.x + viewport.width - horizontalPadding) {
    x = bbox.x + bbox.width + horizontalPadding - viewport.width;
  }
  if (bbox.y < viewport.y + verticalPadding) {
    y = bbox.y - verticalPadding;
  } else if (bbox.y + bbox.height > viewport.y + viewport.height - verticalPadding) {
    y = bbox.y + bbox.height + verticalPadding - viewport.height;
  }

  return {
    ...viewport,
    x: clamp(x, 0, 1 - viewport.width),
    y: clamp(y, 0, 1 - viewport.height),
  };
}

function fineStep(size: number) {
  return 1 / Math.max(1, size);
}

function expandDelta(page: UploadedPage, pixels: number) {
  return {
    x: -fineStep(page.width) * pixels,
    y: -fineStep(page.height) * pixels,
    width: fineStep(page.width) * pixels * 2,
    height: fineStep(page.height) * pixels * 2,
  };
}

function normalizeBbox(bbox: { x: number; y: number; width: number; height: number }) {
  const x = clamp(Number.isFinite(bbox.x) ? bbox.x : 0, 0, 1 - MIN_CROP_SIZE);
  const y = clamp(Number.isFinite(bbox.y) ? bbox.y : 0, 0, 1 - MIN_CROP_SIZE);
  let width = clamp(
    Number.isFinite(bbox.width) ? bbox.width : MIN_CROP_SIZE,
    MIN_CROP_SIZE,
    1,
  );
  let height = clamp(
    Number.isFinite(bbox.height) ? bbox.height : MIN_CROP_SIZE,
    MIN_CROP_SIZE,
    1,
  );

  if (x + width > 1) width = Math.max(MIN_CROP_SIZE, 1 - x);
  if (y + height > 1) height = Math.max(MIN_CROP_SIZE, 1 - y);
  return { x, y, width, height };
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function buildUploadStatus(pageCount: number, questionCount: number) {
  if (pageCount && questionCount) {
    return `已解析 ${pageCount} 页图片/PDF 页面和 ${questionCount} 项 Word 内容，可继续完整识别页面资料`;
  }
  if (pageCount) {
    return `已生成 ${pageCount} 页高清页面，等待智能识别`;
  }
  return `已从 Word 中完整整理出 ${questionCount} 项资料内容`;
}

function remapRecognitionResultPageIndexes(
  result: RecognitionResult,
  batchPages: UploadedPage[],
): RecognitionResult {
  const pageMap = new Map(batchPages.map((page, index) => [index, page.pageIndex]));
  const mapPageIndex = (pageIndex: number) => pageMap.get(pageIndex) ?? pageIndex;
  return {
    ...result,
    processedPageIndexes: result.processedPageIndexes.map(mapPageIndex),
    emptyPageIndexes: result.emptyPageIndexes.map(mapPageIndex),
    questions: result.questions.map((question) => ({
      ...question,
      pageIndex: mapPageIndex(question.pageIndex),
      sourcePageIndexes: question.sourcePageIndexes.map(mapPageIndex),
      figures: question.figures.map((figure) => ({
        ...figure,
        pageIndex: mapPageIndex(figure.pageIndex),
      })),
    })),
  };
}

async function buildQuestionsWithCrops(
  result: RecognitionResult,
  pages: UploadedPage[],
  existingCount = 0,
  onFigureProgress?: (current: number, total: number) => void,
  onQuestionReady?: (question: QuestionItem, current: number, total: number) => void,
) {
  const questions: QuestionItem[] = [];
  const pagesByIndex = new Map(pages.map((page) => [page.pageIndex, page]));
  const coveredPageIndexes = collectCoveredRecognitionPageIndexes(result);
  const preservedPageIndexes = result.processedPageIndexes
    .filter((pageIndex) => !coveredPageIndexes.has(pageIndex))
    .sort((left, right) => left - right);
  const totalFigures = result.questions.reduce(
    (total, question) => total + (Array.isArray(question.figures) ? question.figures.length : 0),
    0,
  );
  let completedFigures = 0;
  onFigureProgress?.(0, totalFigures);
  const totalQuestions = result.questions.length;

  for (const [questionIndex, question] of result.questions.entries()) {
    const sequence = existingCount + questionIndex + 1;
    const baseId = `ai-${sequence}`;
    const figures: QuestionFigure[] = [];
    const recognizedFigures = sortQuestionFigures(
      Array.isArray(question.figures) ? question.figures : [],
    );
    for (const [figureIndex, figure] of recognizedFigures.entries()) {
      const page = pagesByIndex.get(figure.pageIndex);
      if (!page) throw new Error("识别结果引用了不存在的原卷页面，本次未采用任何内容。");
      const neighborBboxes = recognizedFigures
        .filter((candidate) => candidate !== figure && candidate.pageIndex === figure.pageIndex)
        .map((candidate) => candidate.bbox);
      let crop: Awaited<ReturnType<typeof cropFigureFromPage>>;
      try {
        crop = await cropFigureFromPage(page, figure.bbox, { neighborBboxes });
      } catch {
        // 浏览器图形裁切失败时保留完整原页，保证文字和原始资料仍能继续输出。
        crop = {
          dataUrl: page.imageDataUrl,
          width: page.width,
          height: page.height,
          bbox: { x: 0, y: 0, width: 1, height: 1 },
        };
      }
      figures.push({
        id: `${baseId}-figure-${figureIndex + 1}`,
        kind: figure.kind || "diagram",
        optionLabel: figure.optionLabel,
        pageIndex: figure.pageIndex,
        bbox: crop.bbox,
        dataUrl: crop.dataUrl,
        width: crop.width,
        height: crop.height,
        caption: figure.caption,
        confidence: figure.confidence,
      });
      completedFigures += 1;
      onFigureProgress?.(completedFigures, totalFigures);
    }

    questions.push(normalizeQuestionMathFields({
      id: baseId,
      kind: question.kind,
      number: question.kind === "content" ? "" : question.number || String(sequence),
      pageIndex: question.pageIndex ?? 0,
      stemMarkdown: question.stemMarkdown,
      options: question.options || [],
      figures,
    }));
    onQuestionReady?.(questions.at(-1)!, questions.length, totalQuestions);
  }

  if (preservedPageIndexes.length) {
    const pageNumbers = preservedPageIndexes.map((pageIndex) => pageIndex + 1).join("、");
    throw new Error(`AI 未返回第 ${pageNumbers} 页的可编辑内容，本批次未采用。`);
  }

  return questions;
}

function sortQuestionFigures<T extends { pageIndex: number; bbox: { x: number; y: number }; kind?: string; optionLabel?: string }>(figures: T[]) {
  return [...figures].sort((left, right) => (
    left.pageIndex - right.pageIndex
    || left.bbox.y - right.bbox.y
    || left.bbox.x - right.bbox.x
    || String(left.kind || "").localeCompare(String(right.kind || ""))
    || String(left.optionLabel || "").localeCompare(String(right.optionLabel || ""))
  ));
}

function getQuestionFigures(question?: Pick<QuestionItem, "figures"> | null) {
  return Array.isArray(question?.figures) ? question.figures : [];
}

function getFigureKindLabel(kind: QuestionFigure["kind"]) {
  if (kind === "table") return "表格";
  if (kind === "option-group" || kind === "option") return "图形选项";
  return "图形";
}

const MarkdownText = memo(function MarkdownText({ value }: { value: string }) {
  const markdown = useMemo(() => mathTextForMarkdown(value), [value]);
  return (
    <ReactMarkdown remarkPlugins={markdownRemarkPlugins} rehypePlugins={markdownRehypePlugins}>
      {markdown}
    </ReactMarkdown>
  );
});
