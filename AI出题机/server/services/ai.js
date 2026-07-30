// AI 服务模块：模型调用与严格试卷生成入口。
const { AI_CONFIG } = require('../config/ai');
const { withClient } = require('./ai-key-pool');
const { createExamGenerator } = require('../../shared/exam-generation-core');
const {
  buildStructuredOutputRequest,
  extractStructuredToolArguments
} = require('../../shared/ai-structured-output');

function extractTextContent(content) {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (!part || part.type !== 'text') return '';
      if (typeof part.text === 'string') return part.text;
      return part.text?.value || '';
    })
    .join('')
    .trim();
}

function buildUserMessageContent(userPrompt, options = {}) {
  const text = String(userPrompt || '').trim();
  const imageUrls = Array.isArray(options.imageUrls) ? options.imageUrls : [];
  if (!imageUrls.length) return text;

  const content = [];
  if (text) content.push({ type: 'text', text });
  for (const imageUrl of imageUrls) {
    if (typeof imageUrl !== 'string' || !imageUrl.trim()) continue;
    content.push({ type: 'image_url', image_url: { url: imageUrl } });
  }
  return content.length ? content : text;
}

async function generateContent(systemPrompt, userPrompt, options = {}) {
  try {
    const request = {
      model: options.model || AI_CONFIG.model,
      temperature: options.temperature ?? AI_CONFIG.temperature,
      max_tokens: normalizeMaxTokens(options.maxTokens),
      messages: [
        { role: 'system', content: String(systemPrompt || '') },
        { role: 'user', content: buildUserMessageContent(userPrompt, options) }
      ]
    };
    if (options.structuredOutput) {
      Object.assign(request, buildStructuredOutputRequest(options.structuredOutput));
    }
    const completion = await withClient((aiClient) => aiClient.chat.completions.create(request));

    const choice = completion?.choices?.[0];
    const message = choice?.message;
    if (options.structuredOutput) {
      return extractStructuredToolArguments(message, options.structuredOutput);
    }
    const text = extractTextContent(message?.content);
    if (!text) throw new Error('API 返回空内容');
    if (options.includeMetadata) {
      return {
        content: text,
        finishReason: choice?.finish_reason || null,
        responseId: completion?.id || null,
        usage: completion?.usage || null
      };
    }
    return text;
  } catch (error) {
    const status = error?.status || error?.response?.status;
    const reason = error?.error?.message || error?.message || '未知错误';
    if (status) {
      console.error(`AI API 调用失败: ${status} ${reason}`);
      const wrapped = new Error(`AI 生成失败: API 返回 ${status} - ${reason}`);
      wrapped.status = status;
      wrapped.code = error?.code;
      throw wrapped;
    }
    console.error('AI API 调用失败:', reason);
    const wrapped = new Error(`AI 生成失败: ${reason}`);
    wrapped.code = error?.code;
    throw wrapped;
  }
}

function normalizeMaxTokens(value) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isInteger(parsed) && parsed >= 256) return Math.min(parsed, AI_CONFIG.maxTokens);
  return AI_CONFIG.maxTokens;
}

async function generateTopicSuggestions({
  version = '全版本融合课程体系',
  grade,
  subject,
  keyword,
  imageUrls = []
}) {
  const systemPrompt = `你是一位资深的${subject}教师，精通新课标与主流教材共性体系（当前采用：${version}）。
根据用户关键词生成 4-6 个符合${grade}认知水平、具体且可操作的知识点，按重要性排序。每行一个，不要编号或补充说明。`;
  const userPrompt = `课程体系：${version}\n年级：${grade}\n科目：${subject}\n关键词：${keyword}\n\n请生成知识点建议。`;
  const content = await generateContent(systemPrompt, userPrompt, { imageUrls });
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/^[\d\-*.、]+/.test(line))
    .slice(0, 6);
}

const strictExamGenerator = createExamGenerator({
  invokeAI: generateContent,
  getMaxTokens: () => AI_CONFIG.maxTokens,
  logger: console,
  // 同一命题任务内批次串行，避免供应商在并发压力下偏离工具调用契约。
  batchConcurrency: 1
});

module.exports = {
  generateContent,
  generateTopicSuggestions,
  generateExam: strictExamGenerator.generateExam
};
