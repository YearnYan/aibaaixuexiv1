(() => {
  const STYLE_ID = "postExamPdfExportFixStyles";

  document.addEventListener(
    "click",
    (event) => {
      const button = event.target?.closest?.("#downloadPdfBtn");
      if (!button) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      exportPostExamPdf(button);
    },
    true
  );

  async function exportPostExamPdf(button) {
    if (button.dataset.pdfExporting === "1") return;

    const source = document.getElementById("reportReady");
    if (!source) {
      setStatus("报告区域未找到。", "error");
      return;
    }

    if (!window.jspdf?.jsPDF || typeof window.html2canvas !== "function") {
      setStatus("PDF 导出组件未加载完成，请刷新页面后重试。", "error");
      return;
    }

    const originalHtml = button.innerHTML;
    button.dataset.pdfExporting = "1";
    button.disabled = true;
    button.innerHTML = '<span class="material-symbols-outlined">hourglass_top</span><span>正在生成 PDF...</span>';
    setStatus("正在生成 PDF，请稍候...");

    const surface = buildPdfSurface(source);
    document.body.appendChild(surface);

    try {
      await waitForRenderFrame();
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const blocks = Array.from(surface.querySelectorAll("[data-pdf-block]"));
      await renderBlocksToPdf(blocks, pdf);
      const subject = getText("#subjectChips .subject-btn.active span:first-child") || "未知学科";
      const date = new Date().toLocaleDateString("zh-CN").replace(/\//g, "-");
      pdf.save(`卷后提分报告_${subject}_${date}.pdf`);
      setStatus("PDF 已下载。", "success");
    } catch (error) {
      console.error("PDF 生成失败", error);
      setStatus(`PDF 生成失败：${error.message || "请稍后重试。"}`, "error");
    } finally {
      surface.remove();
      button.dataset.pdfExporting = "";
      button.disabled = false;
      button.innerHTML = originalHtml;
    }
  }

  function buildPdfSurface(source) {
    ensurePdfStyles();

    const root = document.createElement("div");
    root.className = "post-exam-pdf-surface";
    root.appendChild(createCoverBlock());

    Array.from(source.children).forEach((child) => appendNodeBlocks(child, root));
    return root;
  }

  function createCoverBlock() {
    const block = document.createElement("section");
    block.className = "post-exam-pdf-cover";
    block.dataset.pdfBlock = "";
    block.innerHTML = `
      <div class="pdf-kicker">EXAM REVIEW / SCORE BOOST</div>
      <h1>卷后提分报告</h1>
      <p>生成时间：${escapeHtml(new Date().toLocaleString())}</p>
      <div class="pdf-cover-grid">
        <div><span>得分率 / 分差</span><strong>${escapeHtml(getText("#scoreRate") || "--")}</strong><p>${escapeHtml(getText("#scoreGapText") || "--")}</p></div>
        <div><span>可追回分</span><strong>${escapeHtml(getText("#recoverableScore") || "--")}</strong><p>${escapeHtml(getText("#recoverableReason") || "--")}</p></div>
        <div><span>第一优先动作</span><strong>${escapeHtml(getText("#firstAction") || "--")}</strong><p>${escapeHtml(getText("#firstActionReason") || "--")}</p></div>
      </div>
    `;
    return block;
  }

  function appendNodeBlocks(node, root) {
    if (!node || node.matches?.(".pdf-download-area")) return;

    if (node.matches?.(".audit-grid")) {
      Array.from(node.children).forEach((child) => appendNodeBlocks(child, root));
      return;
    }

    if (node.matches?.(".report-box")) {
      appendReportBoxBlocks(node, root);
      return;
    }

    root.appendChild(wrapClone(node));
  }

  function appendReportBoxBlocks(box, root) {
    const containers = Array.from(
      box.querySelectorAll(
        ":scope > .list, :scope > .score-breakdown-grid, :scope > .checklist-grid, :scope > .logic-grid, :scope > .metric-grid, :scope > .info-grid"
      )
    );

    if (containers.length === 0) {
      if (box.classList.contains("dark")) {
        root.appendChild(createReadableSummaryBlock(box));
        return;
      }
      root.appendChild(wrapClone(box));
      return;
    }

    const intro = createReportShell(box);
    let hasIntroBody = false;
    let sectionStarted = false;

    Array.from(box.children).forEach((child) => {
      if (containers.includes(child) || child.matches?.(".pdf-download-area")) return;
      if (child.matches?.(".report-head")) return;
      if (!child.textContent.trim()) return;
      intro.appendChild(cleanClone(child));
      hasIntroBody = true;
    });

    containers.forEach((container) => {
      const items = Array.from(container.children).filter((item) => item.textContent.trim());
      if (items.length === 0) return;

      chunkContainerItems(container, items).forEach((chunk) => {
        const block = sectionStarted ? createContinuationShell(box) : intro;
        const itemContainer = container.cloneNode(false);
        chunk.forEach((item) => itemContainer.appendChild(cleanClone(item)));
        block.appendChild(itemContainer);
        root.appendChild(block);
        sectionStarted = true;
      });
    });

    if (!sectionStarted && hasIntroBody) {
      root.appendChild(intro);
    }
  }

  function createReadableSummaryBlock(box) {
    const block = document.createElement("section");
    block.className = "post-exam-pdf-summary";
    block.dataset.pdfBlock = "";

    const title = box.querySelector(":scope > .report-head strong")?.textContent?.trim() || "结论总控台";
    const sub = box.querySelector(":scope > .report-head .report-sub")?.textContent?.trim() || "";
    const paragraphs = Array.from(box.children)
      .filter((child) => !child.matches?.(".report-head"))
      .map((child) => child.textContent.trim())
      .filter(Boolean);

    block.innerHTML = `
      <div class="summary-head">
        <h2>${escapeHtml(title)}</h2>
        ${sub ? `<span>${escapeHtml(sub)}</span>` : ""}
      </div>
      ${paragraphs.map((text) => `<p>${escapeHtml(text)}</p>`).join("")}
    `;
    return block;
  }

  function chunkContainerItems(container, items) {
    const maxItems = getContainerChunkLimit(container);
    const maxWeight = container.matches(".list") ? 8 : 7;
    const chunks = [];
    let current = [];
    let currentWeight = 0;

    items.forEach((item) => {
      const weight = estimateItemWeight(item);
      const shouldStartNewChunk =
        current.length > 0 &&
        (current.length >= maxItems || currentWeight + weight > maxWeight);

      if (shouldStartNewChunk) {
        chunks.push(current);
        current = [];
        currentWeight = 0;
      }

      current.push(item);
      currentWeight += weight;
    });

    if (current.length > 0) {
      chunks.push(current);
    }

    return chunks;
  }

  function getContainerChunkLimit(container) {
    if (container.matches(".metric-grid, .info-grid, .logic-grid")) return 3;
    if (container.matches(".score-breakdown-grid, .checklist-grid")) return 2;
    if (container.matches(".list")) return 1;
    return 2;
  }

  function estimateItemWeight(item) {
    const textLength = String(item?.textContent || "").replace(/\s+/g, "").length;
    return Math.max(1, Math.ceil(textLength / 130));
  }

  function createReportShell(sourceBox) {
    const block = document.createElement("section");
    block.className = `${sourceBox.className} post-exam-pdf-fragment`;
    block.dataset.pdfBlock = "";

    const head = sourceBox.querySelector(":scope > .report-head")?.cloneNode(true);
    if (head) {
      block.appendChild(cleanClone(head));
    }

    return block;
  }

  function createContinuationShell(sourceBox) {
    const block = document.createElement("section");
    block.className = `${sourceBox.className} post-exam-pdf-fragment post-exam-pdf-continuation`;
    block.dataset.pdfBlock = "";
    return block;
  }

  function wrapClone(node) {
    const block = document.createElement("section");
    block.className = "post-exam-pdf-block";
    block.dataset.pdfBlock = "";
    block.appendChild(cleanClone(node));
    return block;
  }

  function cleanClone(node) {
    const clone = node.cloneNode(true);
    clone.querySelectorAll("[id]").forEach((element) => element.removeAttribute("id"));
    clone.querySelectorAll("button, input, textarea").forEach((element) => {
      if (element.closest(".pdf-download-area")) {
        element.remove();
      }
    });
    return clone;
  }

  function ensurePdfStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .post-exam-pdf-surface {
        position: fixed;
        left: -10000px;
        top: 0;
        width: 794px;
        padding: 28px;
        background: #ffffff;
        color: #111111;
        font-family: "Inter", "Microsoft YaHei", "PingFang SC", Arial, sans-serif;
        line-height: 1.7;
        z-index: -1;
        user-select: text;
      }
      .post-exam-pdf-surface [data-pdf-block] {
        margin: 0 0 14px;
        break-inside: avoid;
        page-break-inside: avoid;
      }
      .post-exam-pdf-cover {
        padding: 22px;
        border: 4px solid #111111;
        background: linear-gradient(135deg, #fff7ed 0%, #ffffff 58%, #fff1f2 100%);
      }
      .post-exam-pdf-cover .pdf-kicker {
        color: #c5161d;
        font-size: 12px;
        font-weight: 900;
        letter-spacing: 0.14em;
      }
      .post-exam-pdf-cover h1 {
        margin: 8px 0 6px;
        color: #111111;
        font-size: 30px;
        letter-spacing: 0;
      }
      .post-exam-pdf-cover p {
        margin: 0 0 14px;
        color: #555555;
      }
      .pdf-cover-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 10px;
      }
      .pdf-cover-grid div {
        padding: 14px;
        border: 3px solid #111111;
        background: #ffffff;
      }
      .pdf-cover-grid span {
        display: block;
        margin-bottom: 8px;
        color: #6b6b6b;
        font-size: 12px;
        font-weight: 800;
      }
      .pdf-cover-grid strong {
        display: block;
        color: #c5161d;
        font-size: 24px;
        line-height: 1.15;
      }
      .pdf-cover-grid p {
        margin: 8px 0 0;
        color: #333333;
        font-size: 12px;
      }
      .post-exam-pdf-summary {
        padding: 20px 22px;
        border: 4px solid #2a0509;
        background: #fff7ed;
        color: #1f1f1f;
      }
      .post-exam-pdf-summary .summary-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 12px;
        padding-bottom: 10px;
        border-bottom: 2px solid rgba(197, 22, 29, 0.22);
      }
      .post-exam-pdf-summary h2 {
        margin: 0;
        color: #2a0509;
        font-size: 22px;
      }
      .post-exam-pdf-summary span {
        color: #8b5a2b;
        font-size: 12px;
        font-weight: 800;
      }
      .post-exam-pdf-summary p {
        margin: 8px 0 0;
        color: #333333;
        font-size: 14px;
        line-height: 1.85;
        white-space: pre-wrap;
      }
      .post-exam-pdf-surface .post-exam-pdf-block > :first-child {
        width: 100%;
      }
      .post-exam-pdf-surface .report-box,
      .post-exam-pdf-surface .metric-card,
      .post-exam-pdf-surface .logic-node,
      .post-exam-pdf-surface .breakdown-card,
      .post-exam-pdf-surface .list-item,
      .post-exam-pdf-surface .info-item {
        box-shadow: none !important;
      }
      .post-exam-pdf-surface .report-box.dark,
      .post-exam-pdf-surface .logic-node.dark-node {
        background: #2a0509 !important;
        background-image: none !important;
        border-color: rgba(197, 22, 29, 0.32) !important;
        color: #fff7ed !important;
        -webkit-text-fill-color: #fff7ed !important;
      }
      .post-exam-pdf-surface .report-box.dark :where(.summary, .summary-note, .report-sub, p, span, strong, small, div, label),
      .post-exam-pdf-surface .logic-node.dark-node :where(.logic-step, .logic-body, strong, span, div) {
        color: rgba(255, 247, 237, 0.95) !important;
        -webkit-text-fill-color: rgba(255, 247, 237, 0.95) !important;
      }
      .post-exam-pdf-surface .report-box.dark::before {
        background: #ffbd58 !important;
      }
      .post-exam-pdf-surface .audit-grid,
      .post-exam-pdf-surface .score-breakdown-grid,
      .post-exam-pdf-surface .checklist-grid,
      .post-exam-pdf-surface .logic-grid {
        grid-template-columns: 1fr !important;
      }
      .post-exam-pdf-surface .metric-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
      }
      .post-exam-pdf-surface .info-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
      }
      .post-exam-pdf-surface .post-exam-pdf-fragment .report-head {
        margin-bottom: 12px;
      }
      .post-exam-pdf-surface .post-exam-pdf-continuation {
        padding-top: 14px !important;
      }
      .post-exam-pdf-surface .post-exam-pdf-continuation::before {
        display: none !important;
      }
      .post-exam-pdf-surface .post-exam-pdf-fragment .list,
      .post-exam-pdf-surface .post-exam-pdf-fragment .score-breakdown-grid,
      .post-exam-pdf-surface .post-exam-pdf-fragment .checklist-grid,
      .post-exam-pdf-surface .post-exam-pdf-fragment .logic-grid,
      .post-exam-pdf-surface .post-exam-pdf-fragment .metric-grid,
      .post-exam-pdf-surface .post-exam-pdf-fragment .info-grid {
        display: grid;
        gap: 10px;
      }
      .post-exam-pdf-surface .pdf-download-area {
        display: none !important;
      }
    `;
    document.head.appendChild(style);
  }

  async function renderBlocksToPdf(blocks, pdf) {
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 12;
    const pageBottom = pageHeight - margin;
    const contentWidth = pageWidth - margin * 2;
    const maxBlockHeight = pageHeight - margin * 2;
    let cursorY = margin;

    for (const block of blocks) {
      const canvas = await window.html2canvas(block, {
        scale: 2,
        backgroundColor: "#ffffff",
        useCORS: true,
        logging: false
      });

      if (!canvas.width || !canvas.height) continue;

      const image = canvas.toDataURL("image/jpeg", 0.96);
      let imageHeight = (canvas.height * contentWidth) / canvas.width;
      let imageWidth = contentWidth;

      if (imageHeight > maxBlockHeight) {
        const scale = maxBlockHeight / imageHeight;
        imageHeight = maxBlockHeight;
        imageWidth = contentWidth * scale;
      }

      if (cursorY + imageHeight > pageBottom && cursorY > margin) {
        pdf.addPage();
        cursorY = margin;
      }

      const imageX = margin + (contentWidth - imageWidth) / 2;
      pdf.addImage(image, "JPEG", imageX, cursorY, imageWidth, imageHeight);
      cursorY += imageHeight + 4;
    }
  }

  function setStatus(message, type = "") {
    const status = document.getElementById("statusText");
    if (!status) return;
    status.textContent = message;
    status.className = `status ${type}`.trim();
    status.dataset.type = type;
    status.setAttribute("role", type === "error" ? "alert" : "status");
  }

  function getText(selector) {
    return String(document.querySelector(selector)?.textContent || "").trim();
  }

  function waitForRenderFrame() {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }
})();
