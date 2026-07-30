import { Hono } from 'hono';
import figureSpecs from '../../shared/figure-specs.json';
import figureSvgQuality from '../../shared/figure-svg-quality.js';
import { generateContent } from '../services/ai.js';

const {
  analyzeFigureSvg,
  analyzeGeneratedFigure
} = figureSvgQuality;

const app = new Hono();
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
  timeline: 'timeline', table: 'table', flowchart: 'diagram', diagram: 'diagram'
};

app.post('/figure', async (c) => {
  try {
    const payload = normalizeFigurePayload(await c.req.json());
    if (!payload.description) {
      return c.json({
        error: '缺少图形描述',
        code: 'INVALID_FIGURE_DESCRIPTION',
        retryable: false
      }, 400);
    }
    const cachedSvg = readValidCachedSvg(payload);
    if (cachedSvg) return c.json({ svg: cachedSvg, cached: true, attempts: 0 });
    const generated = await generateSVG(c.env, payload);
    svgCache.set(payload.cacheKey, generated.svg);
    return c.json({ svg: generated.svg, cached: false, attempts: generated.attempts });
  } catch (error) {
    console.error('图形渲染失败:', error.message);
    return c.json(serializeFigureError(error), 502);
  }
});

app.post('/figures-batch', async (c) => {
  try {
    const body = await c.req.json();
    const figures = Array.isArray(body?.figures) ? body.figures : [];
    if (!figures.length) return c.json({ error: 'figures 必须是非空数组' }, 400);

    const results = [];
    // 批量请求逐题串行，避免供应商并发响应相互挤压后产生截断 SVG。
    for (const rawFigure of figures) {
      const id = rawFigure?.id;
      const payload = normalizeFigurePayload(rawFigure || {});
      if (!payload.description) {
        results.push({
          id,
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
        results.push({ id, svg: cachedSvg, cached: true, attempts: 0 });
        continue;
      }
      try {
        const generated = await generateSVG(c.env, payload);
        svgCache.set(payload.cacheKey, generated.svg);
        results.push({ id, svg: generated.svg, cached: false, attempts: generated.attempts });
      } catch (error) {
        results.push({ id, svg: null, cached: false, ...serializeFigureError(error) });
      }
    }
    return c.json({ results });
  } catch (error) {
    console.error('批量渲染失败:', error.message);
    return c.json({ error: `批量渲染失败：${error.message}`, code: 'FIGURE_BATCH_FAILED' }, 500);
  }
});

function normalizeFigurePayload(input = {}) {
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

async function generateSVG(env, payload) {
  let lastFailure = null;
  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt += 1) {
    try {
      const response = await generateContent(
        env,
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
  const subjectRules = (figureSpecs.subjects[subject] || [])
    .map((item, index) => `${index + 1}. ${item}`).join('\n') || '1. 图形必须与题目语义一致，标注清晰。';
  const typeRules = (figureSpecs.types[figureType] || [])
    .map((item, index) => `${index + 1}. ${item}`).join('\n') || '1. 必须绘制实体元素和关系，不能只有提示文字。';
  return `你是 K12 试卷图形渲染专家，负责输出可直接嵌入网页的高质量 SVG。\n\n【通用输出规范】\n${commonRules}\n\n【${subject || '通用'}学科约束】\n${subjectRules}\n\n【${figureType} 图形约束】\n${typeRules}\n\n【强制技术要求】\n1. 根节点必须包含 xmlns="http://www.w3.org/2000/svg" 与 viewBox="${SVG_VIEWBOX}"。\n2. 默认白色背景，主线条深灰，文字清晰，主体占视口 50% 以上。\n3. 至少包含一个真实图元和题目所需的全部标注、方向与数值。\n4. 题干中的 LaTeX 仅用于理解，SVG 可见文字严禁出现 LATEXSLASH、LaTeX 源码、公式定界符或美元公式；上下标使用 tspan 的 baseline-shift 或路径正确排版。\n5. 严禁空白图、占位图、通用模板图、脚本、外链、Markdown、解释或注释。\n6. 输出前逐项比对题干和图形描述；任何关系无法准确落图时必须重新绘制。\n\n只输出 SVG 代码。`;
}

function buildUserPrompt(payload) {
  return `请为下面的题目生成准确配图。\n\n科目：${payload.subject || '未提供'}\n图形类型：${payload.figureType}\n题干：${payload.stem || '未提供'}\n图形描述：${payload.description}\n\n图形必须独立成立；题干中的关键点、线、装置、方向、数值和关系必须全部落图。输出前检查非空白、非占位、主体完整、标注无矛盾。`;
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

export { app as renderRoutes };
