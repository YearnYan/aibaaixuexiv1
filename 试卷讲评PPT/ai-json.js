(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.PptAIJson = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    // 单反斜杠 LaTeX 命令若直接出现在 JSON 字符串中，会被误解析为控制字符。
    const LATEX_COMMANDS = new Set([
        'alpha', 'angle', 'approx', 'begin', 'beta', 'cdot', 'ce', 'circ', 'cong',
        'cos', 'delta', 'div', 'end', 'exp', 'frac', 'gamma', 'ge', 'geq', 'infty',
        'int', 'lambda', 'le', 'left', 'leq', 'lim', 'ln', 'log', 'mathrm', 'mathbf',
        'mathit', 'mathsf', 'mathtt', 'mu', 'nabla', 'ne', 'neq', 'omega', 'overline',
        'overrightarrow', 'parallel', 'partial', 'perp', 'pi', 'pm', 'prod', 'pu',
        'rho', 'right', 'sigma', 'sim', 'sin', 'sqrt', 'sum', 'tan', 'text', 'theta',
        'times', 'triangle', 'underline', 'vec'
    ]);

    function readAsciiCommand(text, startIndex) {
        let endIndex = startIndex;
        while (endIndex < text.length && /[A-Za-z]/u.test(text[endIndex])) endIndex += 1;
        return text.slice(startIndex, endIndex);
    }

    function startsLatexEscape(text, slashIndex) {
        const next = text[slashIndex + 1] || '';
        if ('()[]{}'.includes(next)) return true;
        if (!/[A-Za-z]/u.test(next)) return false;
        return LATEX_COMMANDS.has(readAsciiCommand(text, slashIndex + 1));
    }

    function isValidUnicodeEscape(text, slashIndex) {
        return /^[0-9a-fA-F]{4}$/u.test(text.slice(slashIndex + 2, slashIndex + 6));
    }

    function normalizeJsonStrings(value) {
        const text = String(value || '');
        let output = '';
        let inString = false;
        let latexCloseToken = '';

        for (let index = 0; index < text.length; index += 1) {
            const character = text[index];
            if (!inString) {
                output += character;
                if (character === '"') {
                    inString = true;
                    latexCloseToken = '';
                }
                continue;
            }

            if (character === '"') {
                output += character;
                inString = false;
                latexCloseToken = '';
                continue;
            }

            if (character === '\n' || character === '\r') {
                if (character === '\r' && text[index + 1] === '\n') index += 1;
                output += '\\n';
                continue;
            }

            if (character !== '\\') {
                output += character;
                continue;
            }

            const next = text[index + 1];
            if (next === undefined) {
                output += '\\\\';
                continue;
            }

            if (next === '\\' || next === '"' || next === '/') {
                output += `\\${next}`;
                if (next === '\\' && (text[index + 2] === '(' || text[index + 2] === '[')) {
                    latexCloseToken = text[index + 2] === '(' ? ')' : ']';
                } else if (next === '\\' && text[index + 2] === latexCloseToken) {
                    latexCloseToken = '';
                }
                index += 1;
                continue;
            }

            if (next === '(' || next === '[') latexCloseToken = next === '(' ? ')' : ']';
            else if (next === latexCloseToken) latexCloseToken = '';

            if (latexCloseToken || next === ')' || next === ']' || startsLatexEscape(text, index)) {
                output += '\\\\';
                continue;
            }

            if ('bfnrt'.includes(next) || (next === 'u' && isValidUnicodeEscape(text, index))) {
                output += `\\${next}`;
                index += 1;
                continue;
            }

            output += '\\\\';
        }

        return output;
    }

    function removeTrailingCommas(value) {
        const text = String(value || '');
        let output = '';
        let inString = false;
        let escaped = false;

        for (let index = 0; index < text.length; index += 1) {
            const character = text[index];
            if (inString) {
                output += character;
                if (escaped) escaped = false;
                else if (character === '\\') escaped = true;
                else if (character === '"') inString = false;
                continue;
            }

            if (character === '"') {
                inString = true;
                output += character;
                continue;
            }

            if (character === ',') {
                let cursor = index + 1;
                while (cursor < text.length && /\s/u.test(text[cursor])) cursor += 1;
                if (text[cursor] === '}' || text[cursor] === ']') continue;
            }
            output += character;
        }

        return output;
    }

    function extractBalancedJson(text) {
        const results = [];
        let start = -1;
        let depth = 0;
        let inString = false;
        let escaped = false;
        let opening = '';
        let closing = '';

        for (let index = 0; index < text.length; index += 1) {
            const character = text[index];
            if (start === -1) {
                if (character !== '{' && character !== '[') continue;
                start = index;
                depth = 1;
                opening = character;
                closing = character === '{' ? '}' : ']';
                inString = false;
                escaped = false;
                continue;
            }

            if (inString) {
                if (escaped) escaped = false;
                else if (character === '\\') escaped = true;
                else if (character === '"') inString = false;
                continue;
            }

            if (character === '"') {
                inString = true;
                continue;
            }
            if (character === opening) depth += 1;
            if (character === closing) depth -= 1;
            if (depth === 0) {
                results.push(text.slice(start, index + 1));
                start = -1;
            }
        }

        return results;
    }

    function collectCandidates(value) {
        const text = String(value || '').trim();
        const candidates = [];
        const append = (candidate) => {
            const normalized = String(candidate || '').trim();
            if (normalized && !candidates.includes(normalized)) candidates.push(normalized);
        };

        append(text);
        for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/giu)) append(match[1]);
        for (const candidate of extractBalancedJson(text)) append(candidate);
        return candidates;
    }

    function parseCandidate(candidate) {
        return JSON.parse(removeTrailingCommas(normalizeJsonStrings(candidate)));
    }

    function unwrapTextPayload(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
        const direct = [value.content, value.output_text, value.text, value.result];
        const choiceContent = value.choices?.[0]?.message?.content;
        direct.push(choiceContent);

        for (const item of direct) {
            if (typeof item === 'string' && item.trim()) return item;
            if (Array.isArray(item)) {
                const joined = item
                    .map((part) => typeof part === 'string' ? part : part?.text || part?.content || '')
                    .filter(Boolean)
                    .join('\n');
                if (joined.trim()) return joined;
            }
        }
        return '';
    }

    function parseResponse(value, depth = 0) {
        if (depth > 3) throw new Error('AI 响应嵌套层级过深。');
        if (value && typeof value === 'object') {
            const nestedText = unwrapTextPayload(value);
            return nestedText ? parseResponse(nestedText, depth + 1) : value;
        }

        let lastError = null;
        for (const candidate of collectCandidates(value)) {
            try {
                const parsed = parseCandidate(candidate);
                if (typeof parsed === 'string') return parseResponse(parsed, depth + 1);
                const nestedText = unwrapTextPayload(parsed);
                return nestedText ? parseResponse(nestedText, depth + 1) : parsed;
            } catch (error) {
                lastError = error;
            }
        }

        throw lastError || new Error('AI 响应中没有 JSON 内容。');
    }

    return {
        collectCandidates,
        normalizeJsonStrings,
        parseResponse,
        removeTrailingCommas
    };
});
