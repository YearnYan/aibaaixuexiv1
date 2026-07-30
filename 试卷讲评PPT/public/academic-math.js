(function initAcademicMath(globalScope, factory) {
    const api = factory(globalScope);
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }
    globalScope.AcademicMath = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, (globalScope) => {
    'use strict';

    const EXPLICIT_MATH_PATTERN = /(\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\])/g;
    const MATH_RUN_PATTERN = /[A-Za-zΑ-Ωα-ω0-9()[\]{}|,+\-−–*/^_=<>≤≥≠≈∝→⇌↔°·×÷√∠∑∫∞′″:_.\s]{2,}/g;
    const LEGACY_PATTERN = /\b(?:Math\.[A-Za-z]+|(?:sqrt|pow|sin|cos|tan|cot|log|ln|exp|abs|vec|overline)\s*\()|\*\*|\^[+\-]?[A-Za-z0-9(]|[A-Za-z0-9)}\]]\s*\*\s*[A-Za-z0-9({[]|\b(?:theta|alpha|beta|gamma|delta|lambda|mu|sigma|phi|omega)\b|(?:->|<=>)|\\(?:frac|sqrt|ce|vec|overrightarrow|mathrm|sin|cos|tan|lim|sum|int)\b/gi;
    const PROGRAMMATIC_MATH_PATTERN = /\b(?:Math\.[A-Za-z]+|(?:sqrt|pow|sin|cos|tan|cot|log|ln|exp|abs|vec|overline)\s*\()|\*\*|[A-Za-z0-9)}\]]\s*\*\s*[A-Za-z0-9({[]|(?:->|<=>)/gi;
    const REQUIRED_GROUP_COMMANDS = Object.freeze({
        frac: 2,
        dfrac: 2,
        tfrac: 2,
        sqrt: 1,
        ce: 1,
        vec: 1,
        overrightarrow: 1,
        overline: 1,
       mathrm: 1,
        mathbf: 1,
        text: 1,
        hat: 1,
        bar: 1
    });
    const CHEMISTRY_SUBJECT_PATTERN = /化学|chemistry/i;
    const GEOGRAPHY_SUBJECT_PATTERN = /地理|geography/i;

    const GREEK_NAMES = Object.freeze({
        alpha: '\\alpha',
        beta: '\\beta',
        gamma: '\\gamma',
        delta: '\\delta',
        epsilon: '\\varepsilon',
        theta: '\\theta',
        lambda: '\\lambda',
        mu: '\\mu',
        nu: '\\nu',
        pi: '\\pi',
        rho: '\\rho',
        sigma: '\\sigma',
        tau: '\\tau',
        phi: '\\varphi',
        psi: '\\psi',
        omega: '\\omega'
    });

    const GREEK_CHARACTERS = Object.freeze({
        α: '\\alpha', β: '\\beta', γ: '\\gamma', δ: '\\delta', ε: '\\varepsilon',
        θ: '\\theta', λ: '\\lambda', μ: '\\mu', ν: '\\nu', π: '\\pi',
        ρ: '\\rho', σ: '\\sigma', τ: '\\tau', φ: '\\varphi', ψ: '\\psi', ω: '\\omega',
        Δ: '\\Delta', Σ: '\\Sigma', Ω: '\\Omega'
    });

    const ELEMENTS = new Set((
        'H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn ' +
        'Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce ' +
        'Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn ' +
        'Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og'
    ).split(/\s+/));

    function normalizeText(rawText, subject = '') {
        const text = normalizeDollarDelimiters(String(rawText || ''), subject);
        if (!text) return '';

        return splitExplicitMath(text)
            .map((token) => (token.type === 'math' ? token.raw : normalizePlainText(token.raw, subject)))
            .join('');
    }

    function normalizeDollarDelimiters(rawText, subject) {
        const displayNormalized = String(rawText || '').replace(/\$\$([\s\S]+?)\$\$/g, (_match, inner) => {
            const content = inner.trim();
            return content ? `\\[${content}\\]` : _match;
        });

        return displayNormalized.replace(/(^|[^\\$])\$([^$\n]+?)\$(?!\$)/g, (match, prefix, inner) => {
            const content = inner.trim();
            const hasFormulaSignal = /\\[A-Za-z]+|[_^{}=<>+*/]|[A-Za-z]\s*\(|[√∑∫≤≥≠≈]/.test(content);
            if (!content || (!hasFormulaSignal && !shouldNormalizeCandidate(content, subject))) {
                return match;
            }
            return `${prefix}\\(${content}\\)`;
        });
    }

    function normalizePlainText(text, subject) {
        return String(text || '').replace(MATH_RUN_PATTERN, (candidate) => {
            const leading = candidate.match(/^\s*/)?.[0] || '';
            const trailing = candidate.match(/\s*$/)?.[0] || '';
            const core = candidate.slice(leading.length, candidate.length - trailing.length);

            if (!core || !shouldNormalizeCandidate(core, subject)) {
                return candidate;
            }

            const latex = legacyExpressionToLatex(core, subject);
            return latex ? `${leading}\\(${latex}\\)${trailing}` : candidate;
        });
    }

    function shouldNormalizeCandidate(candidate, subject) {
        const value = String(candidate || '').trim();
        if (!value) return false;
        if (/<\/?[A-Za-z][^>]*>/.test(value)) return false;
        if (/\b(?:sqrt|sin|cos|tan|cot|log|ln|exp|abs|vec|overline)\s*\(/i.test(value)) return true;
        if (/\^[+\-]?[A-Za-z0-9(]/.test(value)) return true;
        if (/[=<>≤≥≠≈∝→⇌↔]/.test(value) && /[A-Za-zΑ-Ωα-ω0-9]/.test(value)) return true;
        if (/[A-Za-z0-9)}\]]\s*[*×÷/]\s*[A-Za-z0-9({[]/.test(value)) return true;
        if (/[A-Za-z]\s*\(\s*[+\-]?\d+(?:\.\d+)?\s*,/.test(value)) return true;
        if (/\d\s*°|[√∠∑∫∞]/.test(value)) return true;
        if (/\b\d+(?:\.\d+)?e[+\-]?\d+\b/i.test(value)) return true;
        if (Object.keys(GREEK_NAMES).some((name) => new RegExp(`\\b${name}\\b`, 'i').test(value))) return true;
        return CHEMISTRY_SUBJECT_PATTERN.test(subject) && looksLikeChemicalExpression(value);
    }

    function legacyExpressionToLatex(rawExpression, subject = '', options = {}) {
        let expression = String(rawExpression || '').trim();
        if (!expression) return '';

        if (!options.skipChemistry && CHEMISTRY_SUBJECT_PATTERN.test(subject) && looksLikeChemicalExpression(expression)) {
            const chemistry = expression
                .replace(/⇌|↔/g, '<=>')
                .replace(/→/g, '->')
                .replace(/−|–/g, '-');
            return `\\ce{${chemistry}}`;
        }

        expression = expression
            .replace(/[−–]/g, '-')
            .replace(/\b(\d+(?:\.\d+)?)e([+\-]?\d+)\b/gi, '$1 \\times 10^{$2}');

        expression = replaceFunctionCalls(expression, subject);
        expression = normalizeGreek(expression);
        expression = normalizePowers(expression);
        expression = normalizeSubscripts(expression);
        expression = normalizeFractions(expression);
        expression = normalizeUnits(expression, subject);
        expression = expression
            .replace(/(\d|[A-Za-z}\)])\s*\*\s*(?=\\sqrt\b)/g, '$1')
            .replace(/\s*\*\s*/g, ' \\cdot ')
            .replace(/×/g, ' \\times ')
            .replace(/÷/g, ' \\div ')
            .replace(/·/g, ' \\cdot ')
            .replace(/≤/g, ' \\le ')
            .replace(/≥/g, ' \\ge ')
            .replace(/≠/g, ' \\ne ')
            .replace(/≈/g, ' \\approx ')
            .replace(/∝/g, ' \\propto ')
            .replace(/⇌|↔/g, ' \\rightleftharpoons ')
            .replace(/→/g, ' \\to ')
            .replace(/∠/g, '\\angle ')
            .replace(/∞/g, '\\infty ')
            .replace(/∑/g, '\\sum ')
            .replace(/∫/g, '\\int ')
            .replace(/(\d+(?:\.\d+)?)\s*°/g, '$1^{\\circ}');

        if (GEOGRAPHY_SUBJECT_PATTERN.test(subject)) {
            expression = expression.replace(/\^\{\\circ\}\s*([NSEW])\b/g, '^{\\circ}\\mathrm{$1}');
        }

        return expression
            .replace(/\s*([=+\-<>])\s*/g, ' $1 ')
            .replace(/\s{2,}/g, ' ')
            .trim();
    }

    function replaceFunctionCalls(input, subject) {
        let output = String(input || '');
        const functionPattern = /\b(sqrt|sin|cos|tan|cot|log|ln|exp|abs|vec|overline)\s*\(/i;
        let guard = 0;

        while (guard < 40) {
            const match = functionPattern.exec(output);
            if (!match) break;

            const openIndex = match.index + match[0].lastIndexOf('(');
            const closeIndex = findClosingParenthesis(output, openIndex);
            if (closeIndex < 0) break;

            const name = match[1].toLowerCase();
            const inner = output.slice(openIndex + 1, closeIndex);
            const innerLatex = legacyExpressionToLatex(inner, subject, { skipChemistry: true });
            const replacement = formatFunction(name, innerLatex);
            output = `${output.slice(0, match.index)}${replacement}${output.slice(closeIndex + 1)}`;
            guard += 1;
        }

        return output;
    }

    function findClosingParenthesis(text, openIndex) {
        let depth = 0;
        for (let index = openIndex; index < text.length; index += 1) {
            if (text[index] === '(') depth += 1;
            if (text[index] === ')') {
                depth -= 1;
                if (depth === 0) return index;
            }
        }
        return -1;
    }

    function formatFunction(name, inner) {
        if (name === 'sqrt') return `\\sqrt{${inner}}`;
        if (name === 'abs') return `\\left|${inner}\\right|`;
        if (name === 'vec') return `\\vec{${inner}}`;
        if (name === 'overline') return `\\overline{${inner}}`;
        return `\\${name}\\left(${inner}\\right)`;
    }

    function normalizeGreek(input) {
        let output = String(input || '');

        Object.entries(GREEK_NAMES).forEach(([name, command]) => {
            const pattern = new RegExp(`(^|[^\\\\A-Za-z])${name}(?=$|[^A-Za-z])`, 'gi');
            output = output.replace(pattern, (_match, prefix) => `${prefix}${command}`);
        });

        Object.entries(GREEK_CHARACTERS).forEach(([character, command]) => {
            output = output.split(character).join(command);
        });

        return output;
    }

    function normalizePowers(input) {
        const base = '(?:\\\\(?:sqrt|vec|overline)\\{[^{}]+\\}|\\([^()]+\\)|\\|[^|]+\\||[A-Za-z][A-Za-z0-9_]*|\\d+(?:\\.\\d+)?)';
        const pattern = new RegExp(`(${base})\\s*\\^\\s*\\(?([+\\-]?[A-Za-z0-9]+)\\)?`, 'g');
        return String(input || '').replace(pattern, '$1^{$2}');
    }

    function normalizeSubscripts(input) {
        return String(input || '').replace(/\b([A-Za-z])(\d+)\b/g, '$1_{$2}');
    }

    function normalizeFractions(input) {
        const atom = '(?:\\\\(?:sqrt|vec|overline)\\{[^{}]+\\}|\\([^()]+\\)|\\|[^|]+\\||[A-Za-z0-9.]+(?:_\\{[^{}]+\\})?(?:\\^\\{[^{}]+\\})?)';
        const pattern = new RegExp(`(${atom})\\s*\\/\\s*(${atom})`, 'g');
        let output = String(input || '');
        let previous = '';
        let guard = 0;
        while (output !== previous && guard < 8) {
            previous = output;
            output = output.replace(pattern, '\\frac{$1}{$2}');
            guard += 1;
        }
        return output;
    }

    function normalizeUnits(input, subject) {
        if (!/物理|化学|生物|地理|physics|chemistry|biology|geography/i.test(subject)) {
            return String(input || '');
        }

        const unit = '(?:km|cm|mm|kg|mol|Pa|kPa|MPa|Hz|kHz|MHz|N|J|W|V|A|C|T|m|g|s|h|L)(?:\\^\\{[+\\-]?\\d+\\})?';
        const fractionPattern = new RegExp(`\\\\frac\\{(${unit})\\}\\{(${unit})\\}`, 'g');
        const valueUnitPattern = new RegExp(`(\\d(?:\\.\\d+)?\\s*)(${unit})(?![A-Za-z])`, 'g');

        return String(input || '')
            .replace(fractionPattern, (_match, numerator, denominator) => `\\frac{\\mathrm{${numerator}}}{\\mathrm{${denominator}}}`)
            .replace(valueUnitPattern, (_match, value, matchedUnit) => `${value}\\mathrm{${matchedUnit}}`);
    }

    function looksLikeChemicalExpression(value) {
        const text = String(value || '').trim();
        if (!text) return false;

        if (/(?:->|→|⇌|<=>|↔)/.test(text)) {
            const sides = text.split(/(?:->|→|⇌|<=>|↔)/);
            const terms = sides.flatMap((side) => side.split(/\s+\+\s+/));
            return terms.filter(isChemicalTerm).length >= 2;
        }

        return isChemicalTerm(text);
    }

    function isChemicalTerm(rawTerm) {
        let term = String(rawTerm || '')
            .trim()
            .replace(/^\d+(?:\.\d+)?\s*/, '')
            .replace(/\((?:s|l|g|aq)\)$/i, '')
            .replace(/[+\-]\d*$/, '')
            .replace(/[·.]/g, '')
            .replace(/[()[\]{}\d\s]/g, '');

        if (!term) return false;
        const symbols = term.match(/[A-Z][a-z]?/g) || [];
        if (symbols.length === 0 || symbols.some((symbol) => !ELEMENTS.has(symbol))) return false;
        return symbols.join('') === term;
    }

    function splitExplicitMath(rawText) {
        const text = String(rawText || '');
        const tokens = [];
        let cursor = 0;
        let match;
        EXPLICIT_MATH_PATTERN.lastIndex = 0;

        while ((match = EXPLICIT_MATH_PATTERN.exec(text))) {
            if (match.index > cursor) {
                tokens.push({ type: 'text', raw: text.slice(cursor, match.index) });
            }
            const raw = match[0];
            const display = raw.startsWith('\\[');
            tokens.push({
                type: 'math',
                raw,
                display,
                latex: raw.slice(2, -2)
            });
            cursor = match.index + raw.length;
        }

        if (cursor < text.length) {
            tokens.push({ type: 'text', raw: text.slice(cursor) });
        }
        return tokens.length > 0 ? tokens : [{ type: 'text', raw: text }];
    }

    function render(rawText, subject = '') {
        const normalized = normalizeText(rawText, subject);
        return splitExplicitMath(normalized)
            .map((token) => {
                if (token.type === 'text') {
                    return escapeHTML(token.raw).replace(/\n/g, '<br>');
                }

                const fallback = latexToReadable(token.latex);
                const delimiterStart = token.display ? '\\[' : '\\(';
                const delimiterEnd = token.display ? '\\]' : '\\)';
                const kind = token.display ? 'display' : 'inline';
                return (
                    `<span class="academic-math academic-math-${kind}" aria-label="${escapeHTML(fallback)}">` +
                    `<span class="academic-math-fallback">${escapeHTML(fallback)}</span>` +
                    `<span class="academic-math-source" aria-hidden="true">${escapeHTML(`${delimiterStart}${token.latex}${delimiterEnd}`)}</span>` +
                    '</span>'
                );
            })
            .join('');
    }

    async function typeset(rootElement) {
        if (!rootElement) return false;
        const mathJax = globalScope.MathJax;

        if (!mathJax?.typesetPromise) {
            rootElement.classList.remove('academic-math-ready');
            rootElement.classList.add('academic-math-fallback-mode');
            return false;
        }

        try {
            if (mathJax.startup?.promise) {
                await mathJax.startup.promise;
            }
            if (typeof mathJax.typesetClear === 'function') {
                mathJax.typesetClear([rootElement]);
            }
            await mathJax.typesetPromise([rootElement]);
            rootElement.classList.remove('academic-math-fallback-mode');
            rootElement.classList.add('academic-math-ready');
            return true;
        } catch (error) {
            rootElement.classList.remove('academic-math-ready');
            rootElement.classList.add('academic-math-fallback-mode');
            console.warn('公式渲染失败，已保留可读符号。', error);
            return false;
        }
    }

    function findUnresolvedLegacy(rawText) {
        return findFormulaIssues(rawText).map((issue) => issue.fragment);
    }

    function findFormulaIssues(rawText) {
        const text = String(rawText || '');
        if (!text) return [];

        const issues = [];
        validateMathDelimiters(text, issues);

        splitExplicitMath(text).forEach((token) => {
            if (token.type === 'text') {
                const matches = token.raw.match(LEGACY_PATTERN) || [];
                matches.forEach((fragment) => {
                    issues.push(createFormulaIssue(
                        'BARE_OR_LEGACY_EXPRESSION',
                        fragment,
                        '公式命令或程序式表达未放入完整的 LaTeX 公式标记中'
                    ));
                });
                return;
            }
            validateExplicitLatex(token.latex, issues);
        });

        return dedupeFormulaIssues(issues);
    }

    function validateMathDelimiters(text, issues) {
        const delimiterPattern = /\\([()[\]])/g;
        const stack = [];
        let match;

        while ((match = delimiterPattern.exec(text))) {
            const marker = match[1];
            if (marker === '(' || marker === '[') {
                stack.push({ marker, fragment: match[0] });
                continue;
            }

            const expected = marker === ')' ? '(' : '[';
            const current = stack.pop();
            if (!current || current.marker !== expected) {
                issues.push(createFormulaIssue(
                    'UNBALANCED_MATH_DELIMITER',
                    match[0],
                    '公式起止分隔符不匹配'
                ));
                if (current) stack.push(current);
            }
        }

        stack.forEach((item) => {
            issues.push(createFormulaIssue(
                'UNCLOSED_MATH_DELIMITER',
                item.fragment,
                '公式缺少结束分隔符'
            ));
        });
    }

    function validateExplicitLatex(latex, issues) {
        const source = String(latex || '');
        if (!source.trim()) {
            issues.push(createFormulaIssue('EMPTY_FORMULA', source, '公式内容为空'));
            return;
        }

        const braceIssue = findBraceIssue(source);
        if (braceIssue) issues.push(braceIssue);

        const commandPattern = /\\([A-Za-z]+)\b/g;
        let commandMatch;
        while ((commandMatch = commandPattern.exec(source))) {
            const command = commandMatch[1];
            const requiredGroups = REQUIRED_GROUP_COMMANDS[command];
            if (!requiredGroups) continue;

            const result = consumeRequiredCommandGroups(
                source,
                commandPattern.lastIndex,
                requiredGroups,
                command === 'sqrt'
            );
            if (!result.valid) {
                issues.push(createFormulaIssue(
                    'MISSING_COMMAND_ARGUMENT',
                    `\\${command}`,
                    `LaTeX 命令 \\${command} 缺少 ${requiredGroups} 个完整花括号参数`
                ));
            }
        }

        const sourceWithoutChemistry = stripCommandGroups(source, 'ce');
        const legacyMatches = sourceWithoutChemistry.match(PROGRAMMATIC_MATH_PATTERN) || [];
        legacyMatches.forEach((fragment) => {
            issues.push(createFormulaIssue(
                'PROGRAMMATIC_EXPRESSION_IN_MATH',
                fragment,
                '公式内部仍含程序式表达，必须改为规范 LaTeX'
            ));
        });

        const leftCount = (source.match(/\\left\b/g) || []).length;
        const rightCount = (source.match(/\\right\b/g) || []).length;
        if (leftCount !== rightCount) {
            issues.push(createFormulaIssue(
                'UNBALANCED_LEFT_RIGHT',
                leftCount > rightCount ? '\\left' : '\\right',
                '\\left 与 \\right 必须成对出现'
            ));
        }
    }

    function findBraceIssue(source) {
        const stack = [];
        for (let index = 0; index < source.length; index += 1) {
            const character = source[index];
            if ((character === '{' || character === '}') && isEscapedCharacter(source, index)) {
                continue;
            }
            if (character === '{') {
                stack.push(index);
            } else if (character === '}') {
                if (stack.length === 0) {
                    return createFormulaIssue('UNBALANCED_BRACE', '}', '公式中存在多余的右花括号');
                }
                stack.pop();
            }
        }
        return stack.length > 0
            ? createFormulaIssue('UNCLOSED_BRACE', '{', '公式中存在未闭合的左花括号')
            : null;
    }

    function isEscapedCharacter(source, index) {
        let slashCount = 0;
        for (let cursor = index - 1; cursor >= 0 && source[cursor] === '\\'; cursor -= 1) {
            slashCount += 1;
        }
        return slashCount % 2 === 1;
    }

    function consumeRequiredCommandGroups(source, startIndex, requiredGroups, allowOptionalGroup) {
        let cursor = skipWhitespace(source, startIndex);
        if (allowOptionalGroup && source[cursor] === '[') {
            const optionalEnd = findMatchingPair(source, cursor, '[', ']');
            if (optionalEnd < 0) return { valid: false };
            cursor = skipWhitespace(source, optionalEnd + 1);
        }

        for (let groupIndex = 0; groupIndex < requiredGroups; groupIndex += 1) {
            if (source[cursor] !== '{') return { valid: false };
            const endIndex = findMatchingPair(source, cursor, '{', '}');
            if (endIndex < 0 || endIndex === cursor + 1) return { valid: false };
            cursor = skipWhitespace(source, endIndex + 1);
        }
        return { valid: true, endIndex: cursor };
    }

    function stripCommandGroups(source, command) {
        const pattern = new RegExp(`\\\\${command}\\b`, 'g');
        let output = '';
        let cursor = 0;
        let match;
        while ((match = pattern.exec(source))) {
            const groupStart = skipWhitespace(source, pattern.lastIndex);
            if (source[groupStart] !== '{') continue;
            const groupEnd = findMatchingPair(source, groupStart, '{', '}');
            if (groupEnd < 0) continue;
            output += source.slice(cursor, match.index);
            cursor = groupEnd + 1;
            pattern.lastIndex = cursor;
        }
        return `${output}${source.slice(cursor)}`;
    }

    function skipWhitespace(source, startIndex) {
        let cursor = startIndex;
        while (cursor < source.length && /\s/.test(source[cursor])) cursor += 1;
        return cursor;
    }

    function findMatchingPair(source, openIndex, openCharacter, closeCharacter) {
        let depth = 0;
        for (let index = openIndex; index < source.length; index += 1) {
            const character = source[index];
            if (isEscapedCharacter(source, index)) continue;
            if (character === openCharacter) depth += 1;
            if (character === closeCharacter) {
                depth -= 1;
                if (depth === 0) return index;
            }
        }
        return -1;
    }

    function createFormulaIssue(code, fragment, message) {
        return {
            code,
            fragment: String(fragment || '').slice(0, 80),
            message
        };
    }

    function dedupeFormulaIssues(issues) {
        const seen = new Set();
        return issues.filter((issue) => {
            const key = `${issue.code}::${issue.fragment}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    function latexToReadable(rawLatex) {
        let text = String(rawLatex || '');
        text = text
            .replace(/\\ce\{([^{}]*)\}/g, (_match, chemistry) => chemistryToReadable(chemistry))
            .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '($1)/($2)')
            .replace(/\\sqrt\{([^{}]+)\}/g, '√($1)')
            .replace(/\\(?:vec|overrightarrow)\{([^{}]+)\}/g, '⃗$1')
            .replace(/\\overline\{([^{}]+)\}/g, '$1̅')
            .replace(/\\mathrm\{([^{}]+)\}/g, '$1')
            .replace(/\^\{([^{}]+)\}/g, (_match, value) => toScript(value, true))
            .replace(/_\{([^{}]+)\}/g, (_match, value) => toScript(value, false))
            .replace(/\\(?:left|right)/g, '')
            .replace(/\\(?:,|;|!|quad|qquad)/g, ' ');

        const commands = {
            '\\alpha': 'α', '\\beta': 'β', '\\gamma': 'γ', '\\delta': 'δ',
            '\\varepsilon': 'ε', '\\theta': 'θ', '\\lambda': 'λ', '\\mu': 'μ',
            '\\nu': 'ν', '\\pi': 'π', '\\rho': 'ρ', '\\sigma': 'σ',
            '\\tau': 'τ', '\\varphi': 'φ', '\\psi': 'ψ', '\\omega': 'ω',
            '\\Delta': 'Δ', '\\Sigma': 'Σ', '\\Omega': 'Ω',
            '\\times': '×', '\\cdot': '·', '\\div': '÷', '\\le': '≤',
            '\\ge': '≥', '\\ne': '≠', '\\approx': '≈', '\\propto': '∝',
            '\\to': '→', '\\rightleftharpoons': '⇌', '\\angle': '∠',
            '\\infty': '∞', '\\sum': 'Σ', '\\int': '∫'
        };
        Object.entries(commands).forEach(([command, symbol]) => {
            text = text.split(command).join(symbol);
        });

        return text
            .replace(/\\(sin|cos|tan|cot|log|ln|exp)/g, '$1')
            .replace(/[{}]/g, '')
            .replace(/\s{2,}/g, ' ')
            .trim();
    }

    function chemistryToReadable(rawChemistry) {
        const normalized = String(rawChemistry || '')
            .replace(/<=>/g, '⇌')
            .replace(/->/g, '→');
        return normalized.replace(/([A-Za-z)\]])(\d+)/g, (_match, base, digits) => `${base}${toScript(digits, false)}`);
    }

    function toScript(value, superscript) {
        const superscripts = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '+': '⁺', '-': '⁻', n: 'ⁿ' };
        const subscripts = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉', '+': '₊', '-': '₋' };
        const map = superscript ? superscripts : subscripts;
        return String(value || '')
            .split('')
            .map((character) => map[character] || character)
            .join('');
    }

    function escapeHTML(rawValue) {
        const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
        return String(rawValue || '').replace(/[&<>"']/g, (character) => entities[character]);
    }

    return Object.freeze({
        normalizeText,
        legacyExpressionToLatex,
        render,
        typeset,
        findFormulaIssues,
        findUnresolvedLegacy,
        latexToReadable,
        splitExplicitMath
    });
});
