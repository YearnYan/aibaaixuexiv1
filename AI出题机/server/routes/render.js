const express = require('express');
const figureSpecs = require('../../shared/figure-specs.json');
const {
  analyzeFigureSvg,
  analyzeGeneratedFigure,
  isRenderableFigureSvg
} = require('../../shared/figure-svg-quality');
const { generateContent } = require('../services/ai');

const router = express.Router();
const svgCache = new Map();
const MAX_RETRIES = 2;
const SVG_VIEWBOX = '0 0 400 300';
const DEFAULT_SVG_STYLE = 'max-width:280px;height:auto;display:block;margin:8px auto;overflow:visible';
const FIGURE_TYPE_ALIASES = {
  geometry: 'geometry', math: 'geometry', plane: 'geometry',
  coordinate: 'coordinate', coordinates: 'coordinate',
  function: 'function', graph: 'function',
  chart: 'chart', stats: 'chart', numberline: 'numberline', 'number-line': 'numberline',
  venn: 'venn', set: 'venn', circuit: 'circuit', electric: 'circuit', electricity: 'circuit',
  force: 'force', mechanics: 'force', optics: 'optics', light: 'optics',
  wave: 'wave', molecule: 'molecule', chemistry: 'molecule',
  timeline: 'timeline', history: 'timeline', table: 'table', diagram: 'diagram',
  motion: 'diagram', experiment: 'diagram', reaction: 'diagram', biology: 'diagram', geography: 'diagram',
  flowchart: 'diagram', relation: 'diagram'
};

router.post('/figure', async (req, res) => {
  try {
    const payload = normalizeFigurePayload(req.body || {});
    if (!payload.description) {
      return res.status(400).json({
        error: '缺少图形描述',
        code: 'INVALID_FIGURE_DESCRIPTION',
        retryable: false
      });
    }
    const cachedSvg = readValidCachedSvg(payload);
    if (cachedSvg) return res.json({ svg: cachedSvg, cached: true, attempts: 0 });
    const generated = await generateSVG(payload);
    svgCache.set(payload.cacheKey, generated.svg);
    return res.json({ svg: generated.svg, cached: false, attempts: generated.attempts });
  } catch (error) {
    console.error('图形渲染失败:', error.message);
    return res.status(502).json(serializeFigureError(error));
  }
});

router.post('/figures-batch', async (req, res) => {
  try {
    const figures = Array.isArray(req.body?.figures) ? req.body.figures : [];
    if (!figures.length) return res.status(400).json({ error: 'figures 必须是非空数组' });

    const results = [];
    // 供应商在同一批次高并发时更容易返回截断内容，逐题串行保证每次质量审查独立。
    for (const rawFigure of figures) {
      const payload = normalizeFigurePayload(rawFigure || {});
      if (!payload.description) {
        results.push({
          id: rawFigure?.id,
          svg: null,
          cached: false,
          error: '缺少图形描述',
          code: 'INVALID_FIGURE_DESCRIPTION',
          retryable: false,
          attempts: 0
        });
        continue;
      }
      const cachedSvg = readValidCachedSvg(payload);
      if (cachedSvg) {
        results.push({ id: rawFigure?.id, svg: cachedSvg, cached: true, attempts: 0 });
        continue;
      }
      try {
        const generated = await generateSVG(payload);
        svgCache.set(payload.cacheKey, generated.svg);
        results.push({
          id: rawFigure?.id,
          svg: generated.svg,
          cached: false,
          attempts: generated.attempts
        });
      } catch (error) {
        results.push({ id: rawFigure?.id, svg: null, cached: false, ...serializeFigureError(error) });
      }
    }

    return res.json({ results });
  } catch (error) {
    console.error('批量渲染失败:', error.message);
    return res.status(502).json({ error: `批量渲染失败：${error.message}` });
  }
});

function normalizeFigurePayload(input) {
  const description = cleanText(input.description || input.tikzCode || '');
  const stem = cleanText(input.stem || '');
  const subject = cleanText(input.subject || '');
  const figureType = detectFigureType(input.figureType || input.type || '', description, stem, subject);
  return {
    description,
    stem,
    subject,
    figureType,
    forceRegenerate: input.forceRegenerate === true,
    cacheKey: JSON.stringify({ description, stem, subject, figureType })
  };
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function detectFigureType(explicitType, description, stem, subject) {
  const explicit = String(explicitType || '').trim().toLowerCase();
  if (FIGURE_TYPE_ALIASES[explicit]) return FIGURE_TYPE_ALIASES[explicit];
  const combined = `${subject} ${description} ${stem}`.toLowerCase();
  if (/(电路|电流|电压|电阻|开关|电源|串联|并联|circuit)/.test(combined)) return 'circuit';
  if (/(受力|斜面|摩擦力|弹簧|滑块|力图|矢量|force)/.test(combined)) return 'force';
  if (/(光路|透镜|折射|反射|凸透镜|凹透镜|optics)/.test(combined)) return 'optics';
  if (/(波形|波长|振动|驻波|波谷|波峰|wave)/.test(combined)) return 'wave';
  if (/(分子|原子|键|结构式|化学式|molecule)/.test(combined)) return 'molecule';
  if (/(细胞|器官|组织|生态|生物|biology)/.test(combined)) return 'diagram';
  if (/(地图|经纬|地形|气候|区域|地理|geography)/.test(combined)) return 'diagram';
  if (/(时间轴|年代|朝代|timeline)/.test(combined)) return 'timeline';
  if (/(维恩|集合|交集|并集|venn)/.test(combined)) return 'venn';
  if (/(数轴|区间|number line|numberline)/.test(combined)) return 'numberline';
  if (/(函数|抛物线|直线|坐标|象限|图像|curve|graph|coordinate)/.test(combined)) {
    return /(坐标|象限)/.test(combined) ? 'coordinate' : 'function';
  }
  if (/(统计图|柱状图|折线图|饼图|直方图|chart|graph)/.test(combined)) return 'chart';
  if (/(表格|列表|行|列|table)/.test(combined)) return 'table';
  if (/(三角形|圆|平行四边形|几何|角|线段|geometry|polygon)/.test(combined)) return 'geometry';
  return 'diagram';
}

async function generateSVG(payload) {
  let lastFailure = null;
  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt += 1) {
    try {
      const response = await generateContent(
        buildSystemPrompt(payload.subject, payload.figureType),
        buildUserPrompt(payload),
        { temperature: 0.15, includeMetadata: true }
      );
      const content = typeof response === 'string' ? response : response?.content;
      const diagnosis = analyzeGeneratedFigure(content, {
        finishReason: typeof response === 'object' ? response?.finishReason : null
      });
      logFigureAttempt(payload, attempt, diagnosis);
      if (diagnosis.ok) {
        const svg = finalizeSvg(diagnosis.svg);
        const finalizedDiagnosis = analyzeFigureSvg(svg);
        if (!finalizedDiagnosis.ok) {
          lastFailure = createFigureError(finalizedDiagnosis.code, finalizedDiagnosis.message, attempt);
        } else {
          return { svg, attempts: attempt };
        }
      } else {
        lastFailure = createFigureError(diagnosis.code, diagnosis.message, attempt, diagnosis);
      }
    } catch (error) {
      const code = error?.code || 'AI_REQUEST_FAILED';
      lastFailure = createFigureError(code, error?.message || 'AI 请求失败', attempt);
      logFigureAttempt(payload, attempt, {
        ok: false,
        code,
        message: lastFailure.message,
        responseLength: 0,
        completeSvg: false,
        finishReason: null
      });
    }

    if (attempt <= MAX_RETRIES) await wait(400 * attempt);
  }
  throw lastFailure || createFigureError('FIGURE_GENERATION_FAILED', '图形生成失败', MAX_RETRIES + 1);
}

function buildSystemPrompt(subject, figureType) {
  const commonRules = figureSpecs.common.outputRules.map((item, index) => `${index + 1}. ${item}`).join('\n');
  const subjectRules = (figureSpecs.subjects[subject] || []).map((item, index) => `${index + 1}. ${item}`).join('\n') || '1. 图形必须与题目语义一致，标注清晰。';
  const typeRules = (figureSpecs.types[figureType] || []).map((item, index) => `${index + 1}. ${item}`).join('\n') || '1. 必须绘制出实体元素和关系，不能只有提示文字。';
  return `你是 K12 试卷图形渲染专家，负责输出可直接嵌入网页的 SVG。

【通用输出规范】
${commonRules}

【${subject || '通用'}学科约束】
${subjectRules}

【${figureType} 图形约束】
${typeRules}

【强制技术要求】
1. SVG 根节点必须包含 xmlns="http://www.w3.org/2000/svg" 与 viewBox="${SVG_VIEWBOX}"。
2. 默认白色背景，主线条使用深灰色，文字使用 14px 左右字号。
3. 内容主体必须占据视口的 50% 以上面积，不能只是左上角一小块内容。
4. 至少包含一个真实图元（path/line/polyline/polygon/circle/ellipse/rect）和必要文字标注。
5. 题干中的 LaTeX 仅用于理解，SVG 可见文字严禁出现 LATEXSLASH、LaTeX 源码、公式定界符或美元公式；上下标使用 tspan 的 baseline-shift 或路径正确排版。
6. 严禁输出 markdown、解释语句、注释块、脚本、外链资源。

只输出 SVG 代码。`;
}

function buildUserPrompt(payload) {
  return `请为下面这道题生成试卷配图。

科目：${payload.subject || '未提供'}
图形类型：${payload.figureType}
题干：${payload.stem || '未提供'}
图形描述：${payload.description}

要求：
1. 图形必须能单独成立，不能依赖“如图所示”之外的信息。
2. 题干中提到的关键点、关键线、关键装置、关键方向必须落图。
3. 如果题目是坐标、函数、受力、电路、光路、时间轴等，必须体现该类型的核心结构。
4. 输出前自检：不能是空白图，不能只有标题文字，不能缺失主体。`;
}

function readValidCachedSvg(payload) {
  if (payload.forceRegenerate || !svgCache.has(payload.cacheKey)) return '';
  const cachedSvg = svgCache.get(payload.cacheKey);
  const diagnosis = analyzeFigureSvg(cachedSvg);
  if (diagnosis.ok) return cachedSvg;
  svgCache.delete(payload.cacheKey);
  console.warn('[图形缓存] 删除未通过当前质量门的缓存', {
    figureType: payload.figureType,
    subject: payload.subject,
    code: diagnosis.code
  });
  return '';
}

function createFigureError(code, message, attempts, diagnosis = null) {
  const error = new Error(message || '图形生成失败');
  error.code = code || 'FIGURE_GENERATION_FAILED';
  error.retryable = true;
  error.attempts = attempts || 0;
  error.diagnosis = diagnosis;
  return error;
}

function serializeFigureError(error) {
  return {
    error: error?.message || '图形生成失败',
    code: error?.code || 'FIGURE_GENERATION_FAILED',
    retryable: error?.retryable !== false,
    attempts: Number.isInteger(error?.attempts) ? error.attempts : 0
  };
}

function logFigureAttempt(payload, attempt, diagnosis) {
  const details = {
    subject: payload.subject || '未提供',
    figureType: payload.figureType,
    attempt,
    code: diagnosis.ok ? 'OK' : diagnosis.code,
    responseLength: diagnosis.responseLength || 0,
    completeSvg: diagnosis.completeSvg === true,
    finishReason: diagnosis.finishReason || null
  };
  const method = diagnosis.ok ? 'info' : 'warn';
  console[method]('[图形生成] 单次质量审查', details);
}

function finalizeSvg(svg) {
  let nextSvg = String(svg || '').trim();
  if (!/xmlns=/i.test(nextSvg)) nextSvg = nextSvg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  if (!/viewBox=/i.test(nextSvg)) nextSvg = nextSvg.replace('<svg', `<svg viewBox="${SVG_VIEWBOX}"`);
  if (!/style=/i.test(nextSvg)) nextSvg = nextSvg.replace('<svg', `<svg style="${DEFAULT_SVG_STYLE}"`);
  if (!/preserveAspectRatio=/i.test(nextSvg)) nextSvg = nextSvg.replace('<svg', '<svg preserveAspectRatio="xMidYMid meet"');
  if (!/<rect\b[^>]*fill=["']#?fff/i.test(nextSvg) && !/<rect\b[^>]*fill=["']white/i.test(nextSvg)) {
    nextSvg = nextSvg.replace(/(<svg\b[^>]*>)/i, '$1<rect x="0" y="0" width="400" height="300" fill="#fff"/>');
  }
  return nextSvg;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = router;
module.exports._internals = {
  analyzeFigureSvg,
  analyzeGeneratedFigure,
  isRenderableSvg: isRenderableFigureSvg,
  serializeFigureError
};
