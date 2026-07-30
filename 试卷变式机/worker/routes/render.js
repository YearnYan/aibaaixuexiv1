import { Hono } from 'hono';
import figureSpecs from '../../shared/figure-specs.json';
import { generateContent } from '../services/ai.js';

const app = new Hono();

const svgCache = new Map();
const MAX_RETRIES = 2;
const SVG_VIEWBOX = '0 0 400 300';
const DEFAULT_SVG_STYLE = 'max-width:280px;height:auto;display:block;margin:8px auto;overflow:visible';
const SVG_ELEMENT_PATTERN = /<(path|line|polyline|polygon|circle|ellipse|rect|text|g|marker)\b/i;
const DANGEROUS_SVG_PATTERN = /<(script|foreignObject)\b|on[a-z]+\s*=|<image\b[^>]+(?:href|xlink:href)\s*=\s*["']https?:/i;
const FIGURE_TYPE_ALIASES = {
  geometry: 'geometry',
  math: 'geometry',
  coordinate: 'coordinate',
  coordinates: 'coordinate',
  function: 'function',
  graph: 'function',
  chart: 'chart',
  numberline: 'numberline',
  venn: 'venn',
  circuit: 'circuit',
  force: 'force',
  optics: 'optics',
  wave: 'wave',
  molecule: 'molecule',
  timeline: 'timeline',
  table: 'table',
  diagram: 'diagram'
};

app.post('/figure', async (c) => {
  try {
    const payload = normalizeFigurePayload(await c.req.json());
    if (!payload.description) {
      return c.json({ error: '缺少图形描述' }, 400);
    }

    if (svgCache.has(payload.cacheKey)) {
      return c.json({ svg: svgCache.get(payload.cacheKey), cached: true });
    }

    const svg = await generateSVG(c.env, payload);
    if (!svg) {
      return c.json({ svg: null, cached: false });
    }

    svgCache.set(payload.cacheKey, svg);
    return c.json({ svg, cached: false });
  } catch (error) {
    console.error('图形渲染失败:', error.message);
    return c.json({ error: '渲染失败' }, 500);
  }
});

app.post('/figures-batch', async (c) => {
  try {
    const body = await c.req.json();
    const figures = Array.isArray(body?.figures) ? body.figures : [];
    if (figures.length === 0) {
      return c.json({ error: 'figures必须是非空数组' }, 400);
    }

    const cached = [];
    const uncached = [];

    for (const rawFigure of figures) {
      const payload = normalizeFigurePayload(rawFigure || {});
      if (!payload.description) {
        cached.push({ id: rawFigure?.id, svg: null, cached: false });
        continue;
      }
      if (svgCache.has(payload.cacheKey)) {
        cached.push({ id: rawFigure?.id, svg: svgCache.get(payload.cacheKey), cached: true });
      } else {
        uncached.push({ id: rawFigure?.id, payload });
      }
    }

    const uncachedResults = await Promise.all(
      uncached.map(async ({ id, payload }) => {
        const svg = await generateSVG(c.env, payload).catch(() => null);
        if (svg) {
          svgCache.set(payload.cacheKey, svg);
        }
        return { id, svg, cached: false };
      })
    );

    return c.json({ results: [...cached, ...uncachedResults] });
  } catch (error) {
    console.error('批量渲染失败:', error.message);
    return c.json({ error: '批量渲染失败' }, 500);
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
    cacheKey: JSON.stringify({ description, stem, subject, figureType })
  };
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function detectFigureType(explicitType, description, stem, subject) {
  const explicit = String(explicitType || '').trim().toLowerCase();
  if (FIGURE_TYPE_ALIASES[explicit]) {
    return FIGURE_TYPE_ALIASES[explicit];
  }

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

async function generateSVG(env, payload, retryCount = 0) {
  const systemPrompt = buildSystemPrompt(payload.subject, payload.figureType);
  const userPrompt = buildUserPrompt(payload);

  try {
    const content = await generateContent(env, systemPrompt, userPrompt, {
      maxTokens: 2500,
      temperature: 0.15
    });

    const extractedSvg = extractSvg(content);
    if (isRenderableSvg(extractedSvg)) {
      return finalizeSvg(extractedSvg);
    }

    if (retryCount < MAX_RETRIES) {
      await wait(350 * (retryCount + 1));
      return generateSVG(env, payload, retryCount + 1);
    }
  } catch (error) {
    const maybeRetriable = /timeout|network|429|500|502|503|504/i.test(error.message || '');
    if (retryCount < MAX_RETRIES && maybeRetriable) {
      await wait(500 * (retryCount + 1));
      return generateSVG(env, payload, retryCount + 1);
    }
    console.error(`[SVG] 生成失败: ${error.message}`);
  }

  console.warn(`[SVG] 未生成可精准匹配题干的图形，已拒绝兜底：${payload.figureType}`);
  return null;
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
5. 严禁输出 markdown、解释语句、注释块、脚本、外链资源。
6. 严禁为了“有图”而输出通用模板图；无法逐项匹配题干时不要输出 SVG。

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
4. 题干和图形描述中的数值、点名、标签、方向、连接关系、选项图案必须逐项匹配，不能替换成类似图形。
5. 如果信息不足以精准绘制，宁可不输出 SVG，也不能猜测、简化成通用示意图或兜底图。
6. 输出前自检：不能是空白图，不能只有标题文字，不能缺失主体，不能与题干不一致。`;
}

function extractSvg(content) {
  const text = String(content || '');
  const match = text.match(/<svg[\s\S]*?<\/svg>/i);
  return match ? match[0] : '';
}

function isRenderableSvg(svg) {
  if (!svg) return false;
  if (!/<svg[\s\S]*<\/svg>/i.test(svg)) return false;
  if (DANGEROUS_SVG_PATTERN.test(svg)) return false;
  if (!SVG_ELEMENT_PATTERN.test(svg)) return false;
  const visibleGeometryCount = (svg.match(/<(path|line|polyline|polygon|circle|ellipse|rect)\b/gi) || []).length;
  if (visibleGeometryCount === 0) return false;
  if (/stroke\s*=\s*["']none["']/i.test(svg) && !/fill\s*=\s*["'](?!none)/i.test(svg)) {
    return false;
  }
  return true;
}

function finalizeSvg(svg) {
  let nextSvg = String(svg || '').trim();
  if (!/xmlns=/i.test(nextSvg)) {
    nextSvg = nextSvg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  if (!/viewBox=/i.test(nextSvg)) {
    nextSvg = nextSvg.replace('<svg', `<svg viewBox="${SVG_VIEWBOX}"`);
  }
  if (!/style=/i.test(nextSvg)) {
    nextSvg = nextSvg.replace('<svg', `<svg style="${DEFAULT_SVG_STYLE}"`);
  }
  if (!/preserveAspectRatio=/i.test(nextSvg)) {
    nextSvg = nextSvg.replace('<svg', '<svg preserveAspectRatio="xMidYMid meet"');
  }
  if (!/<rect\b[^>]*fill=["']#?fff/i.test(nextSvg) && !/<rect\b[^>]*fill=["']white/i.test(nextSvg)) {
    nextSvg = nextSvg.replace(/(<svg\b[^>]*>)/i, `$1<rect x="0" y="0" width="400" height="300" fill="#fff"/>`);
  }
  return nextSvg;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { app as renderRoutes };
