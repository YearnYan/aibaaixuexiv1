(function initAcademicRendering(global) {
  const DELIMITERS = [
    { left: "\\[", right: "\\]", display: true },
    { left: "\\(", right: "\\)", display: false },
  ];

  function normalize(value) {
    return String(value || "")
      .normalize("NFC")
      .replace(/\$\$([\s\S]*?)\$\$/g, (_match, formula) => `\\[${formula.trim()}\\]`)
      .replace(/(^|[^\\$])\$([^$\n]+?)\$/g, (_match, prefix, formula) => `${prefix}\\(${formula.trim()}\\)`)
      .trim();
  }

  function nextDelimiter(text, cursor) {
    let next;
    DELIMITERS.forEach((delimiter) => {
      const index = text.indexOf(delimiter.left, cursor);
      if (index >= 0 && (!next || index < next.index)) next = { ...delimiter, index };
    });
    return next;
  }

  function tokenize(value) {
    const text = normalize(value);
    const tokens = [];
    let cursor = 0;
    while (cursor < text.length) {
      const opening = nextDelimiter(text, cursor);
      if (!opening) {
        if (cursor < text.length) tokens.push({ type: "text", value: text.slice(cursor) });
        break;
      }
      if (opening.index > cursor) tokens.push({ type: "text", value: text.slice(cursor, opening.index) });
      const formulaStart = opening.index + opening.left.length;
      const formulaEnd = text.indexOf(opening.right, formulaStart);
      if (formulaEnd < 0) {
        tokens.push({ type: "text", value: text.slice(opening.index) });
        break;
      }
      tokens.push({
        type: "math",
        value: text.slice(formulaStart, formulaEnd).trim(),
        display: opening.display,
      });
      cursor = formulaEnd + opening.right.length;
    }
    return tokens;
  }

  function renderElement(element) {
    if (!element || typeof global.renderMathInElement !== "function") return;
    global.renderMathInElement(element, {
      delimiters: DELIMITERS,
      throwOnError: false,
      trust: false,
      strict: "ignore",
      ignoredClasses: ["katex", "katex-display", "formula-capture"],
      errorCallback(message) {
        element.dataset.mathRenderError = message;
      },
    });
  }

  function setText(element, value) {
    element.textContent = normalize(value);
    element.classList.add("academic-text");
    renderElement(element);
  }

  global.AcademicRendering = {
    delimiters: DELIMITERS,
    normalize,
    renderElement,
    setText,
    tokenize,
  };
}(window));
