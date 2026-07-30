(function initAcademicRepair(globalScope, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }
    globalScope.AcademicRepair = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, () => {
    'use strict';

    const DIRECT_FIELDS = Object.freeze([
        ['question', '题干'],
        ['answer', '答案'],
        ['analysis', '解析']
    ]);

    function collectViolations(slides, academicMath) {
        if (!academicMath || typeof academicMath.findFormulaIssues !== 'function') {
            throw createRepairContractError('公式诊断模块不可用，无法执行质量校验。');
        }

        const violations = [];
        (Array.isArray(slides) ? slides : []).forEach((slide, slideIndex) => {
            listFormulaFields(slide).forEach((field) => {
                const issues = academicMath.findFormulaIssues(field.value);
                if (issues.length === 0) return;
                violations.push({
                    slideIndex,
                    slideId: slide?.id ?? slideIndex + 1,
                    subject: String(slide?.subject || '综合'),
                    fieldPath: field.path,
                    fieldLabel: field.label,
                    value: String(field.value || ''),
                    issues
                });
            });
        });
        return violations;
    }

    function listFormulaFields(slide) {
        const fields = DIRECT_FIELDS.map(([path, label]) => ({
            path,
            label,
            value: slide?.[path]
        }));

        (Array.isArray(slide?.options) ? slide.options : []).forEach((option, optionIndex) => {
            fields.push({
                path: `options.${optionIndex}.text`,
                label: `选项 ${option?.letter || optionIndex + 1}`,
                value: option?.text
            });
        });

        (Array.isArray(slide?.knowledge) ? slide.knowledge : []).forEach((item, knowledgeIndex) => {
            fields.push({
                path: `knowledge.${knowledgeIndex}`,
                label: `考点 ${knowledgeIndex + 1}`,
                value: item
            });
        });

        return fields;
    }

    function buildRepairPrompt({ slides, violations, attempt = 1, maxAttempts = 4 }) {
        const grouped = groupViolationsBySlide(slides, violations);
        const input = {
            repairRound: `${attempt}/${maxAttempts}`,
            questions: grouped.map(({ slide, slideIndex, fields }) => ({
                slideIndex,
                slideId: slide?.id ?? slideIndex + 1,
                subject: slide?.subject || '综合',
                context: createSlideContext(slide),
                invalidFields: fields.map((violation) => ({
                    fieldPath: violation.fieldPath,
                    fieldLabel: violation.fieldLabel,
                    currentValue: violation.value,
                    diagnostics: violation.issues.map((issue) => ({
                        code: issue.code,
                        fragment: issue.fragment,
                        message: issue.message
                    }))
                }))
            }))
        };

        return `你是学科公式校对器，任务是修复结构化题目中被明确诊断的字段，不是重新识别整批试卷。

必须遵守：
1. 结合当前题目上下文和随消息提供的原试卷页面，只重写 invalidFields 中列出的字段。
2. 保持题目事实、题序、选项结论、答案含义、解析逻辑、考点含义和题图定位不变。
3. 行内公式必须使用 \\(...\\)，独立公式必须使用 \\[...\\]；化学式和反应式必须在公式标记内使用 \\ce{...}。
4. 所有 LaTeX 命令必须参数完整，例如 \\frac{分子}{分母}、\\sqrt{被开方数}；禁止裸命令、程序式表达、缺失分隔符或花括号。
5. 只返回合法 JSON，不要 Markdown，不要解释。fields 的键必须原样使用 fieldPath；每个 invalidFields 都必须返回，禁止增加任何未请求字段。
6. 如果当前字段被截断，必须从原试卷页面和同题上下文恢复准确内容，禁止猜测或用占位文本代替。

响应格式：
{
  "repairs": [
    {
      "slideIndex": 0,
      "slideId": 10,
      "fields": {
        "answer": "\\\\(\\\\frac{1}{2}\\\\)"
      }
    }
  ]
}

待修复数据：
${JSON.stringify(input, null, 2)}`;
    }

    function applyRepairResponse(slides, violations, rawResponse, normalizer) {
        const parsed = parseRepairResponse(rawResponse);
        const repairs = Array.isArray(parsed?.repairs) ? parsed.repairs : null;
        if (!repairs) {
            throw createRepairContractError('公式修复响应缺少 repairs 数组。');
        }

        const safeSlides = clonePlainData(Array.isArray(slides) ? slides : []);
        const expected = new Map();
        (Array.isArray(violations) ? violations : []).forEach((violation) => {
            expected.set(createFieldKey(violation.slideIndex, violation.fieldPath), violation);
        });
        if (expected.size === 0) return safeSlides;

        const applied = new Set();
        repairs.forEach((repair) => {
            const slideIndex = Number(repair?.slideIndex);
            if (!Number.isInteger(slideIndex) || !safeSlides[slideIndex]) {
                throw createRepairContractError('公式修复响应包含无效的 slideIndex。');
            }

            const slide = safeSlides[slideIndex];
            if (String(repair?.slideId) !== String(slide.id)) {
                throw createRepairContractError(`第 ${slideIndex + 1} 个补丁的题号与原题不匹配。`);
            }
            if (!repair.fields || typeof repair.fields !== 'object' || Array.isArray(repair.fields)) {
                throw createRepairContractError(`第 ${slide.id} 题补丁缺少 fields 对象。`);
            }

            Object.entries(repair.fields).forEach(([fieldPath, rawValue]) => {
                const key = createFieldKey(slideIndex, fieldPath);
                if (!expected.has(key)) {
                    throw createRepairContractError(`第 ${slide.id} 题补丁越权修改了 ${fieldPath}。`);
                }
                if (applied.has(key)) {
                    throw createRepairContractError(`第 ${slide.id} 题字段 ${fieldPath} 被重复修复。`);
                }
                if (typeof rawValue !== 'string' || !rawValue.trim()) {
                    throw createRepairContractError(`第 ${slide.id} 题字段 ${fieldPath} 的修复内容为空。`);
                }

                const normalizedValue = typeof normalizer === 'function'
                    ? normalizer(rawValue, slide.subject || '综合')
                    : rawValue.trim();
                setFieldValue(slide, fieldPath, normalizedValue);
                applied.add(key);
            });
        });

        const missing = [...expected.keys()].filter((key) => !applied.has(key));
        if (missing.length > 0) {
            const violation = expected.get(missing[0]);
            throw createRepairContractError(
                `公式修复响应漏掉了第 ${violation.slideId} 题${violation.fieldLabel}。`
            );
        }

        return safeSlides;
    }

    function parseRepairResponse(rawResponse) {
        if (rawResponse && typeof rawResponse === 'object') return rawResponse;
        let jsonText = String(rawResponse || '').trim();
        const codeBlockMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/i);
        if (codeBlockMatch) jsonText = codeBlockMatch[1].trim();
        try {
            return JSON.parse(jsonText);
        } catch (_error) {
            throw createRepairContractError('公式修复响应不是合法 JSON。');
        }
    }

    function groupViolationsBySlide(slides, violations) {
        const groups = new Map();
        (Array.isArray(violations) ? violations : []).forEach((violation) => {
            const slideIndex = Number(violation.slideIndex);
            if (!groups.has(slideIndex)) {
                groups.set(slideIndex, {
                    slideIndex,
                    slide: slides?.[slideIndex] || {},
                    fields: []
                });
            }
            groups.get(slideIndex).fields.push(violation);
        });
        return [...groups.values()].sort((a, b) => a.slideIndex - b.slideIndex);
    }

    function createSlideContext(slide) {
        return {
            type: slide?.type || '',
            question: slide?.question || '',
            options: (Array.isArray(slide?.options) ? slide.options : []).map((option) => ({
                letter: option?.letter || '',
                text: option?.text || '',
                correct: Boolean(option?.correct)
            })),
            answer: slide?.answer || '',
            analysis: slide?.analysis || '',
            knowledge: Array.isArray(slide?.knowledge) ? slide.knowledge : [],
            figure: {
                exists: Boolean(slide?.figure?.exists),
                description: slide?.figure?.description || '',
                sourcePageId: slide?.figure?.sourcePageId || '',
                sourcePage: slide?.figure?.sourcePage || null
            }
        };
    }

    function setFieldValue(slide, fieldPath, value) {
        if (fieldPath === 'question' || fieldPath === 'answer' || fieldPath === 'analysis') {
            slide[fieldPath] = value;
            return;
        }

        let match = fieldPath.match(/^options\.(\d+)\.text$/);
        if (match) {
            const index = Number(match[1]);
            if (!Array.isArray(slide.options) || !slide.options[index]) {
                throw createRepairContractError(`字段路径 ${fieldPath} 不存在。`);
            }
            slide.options[index].text = value;
            return;
        }

        match = fieldPath.match(/^knowledge\.(\d+)$/);
        if (match) {
            const index = Number(match[1]);
            if (!Array.isArray(slide.knowledge) || slide.knowledge[index] === undefined) {
                throw createRepairContractError(`字段路径 ${fieldPath} 不存在。`);
            }
            slide.knowledge[index] = value;
            return;
        }

        throw createRepairContractError(`不支持修复字段 ${fieldPath}。`);
    }

    function createFieldKey(slideIndex, fieldPath) {
        return `${slideIndex}::${fieldPath}`;
    }

    function clonePlainData(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function createRepairContractError(message) {
        const error = new Error(message);
        error.code = 'ACADEMIC_REPAIR_RESPONSE_INVALID';
        return error;
    }

    function summarizeViolations(violations, limit = 2) {
        const labels = [];
        const seen = new Set();
        (Array.isArray(violations) ? violations : []).forEach((violation) => {
            const label = `第 ${violation.slideId} 题${violation.fieldLabel}`;
            if (!seen.has(label)) {
                seen.add(label);
                labels.push(label);
            }
        });
        const visible = labels.slice(0, limit);
        return labels.length > limit ? `${visible.join('、')}等 ${labels.length} 处` : visible.join('、');
    }

    return Object.freeze({
        collectViolations,
        buildRepairPrompt,
        applyRepairResponse,
        parseRepairResponse,
        summarizeViolations
    });
});
