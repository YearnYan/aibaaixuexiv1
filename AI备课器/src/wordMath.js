import { normalizeLatexMath } from './scientificText.js';

const SYMBOL_COMMANDS = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', theta: 'θ', lambda: 'λ', mu: 'μ',
  pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', phi: 'φ', omega: 'ω', Delta: 'Δ', Gamma: 'Γ',
  Lambda: 'Λ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Omega: 'Ω',
  times: '×', cdot: '·', div: '÷', pm: '±', mp: '∓', in: '∈', notin: '∉', subset: '⊂',
  subseteq: '⊆', supset: '⊃', supseteq: '⊇', cup: '∪', cap: '∩', neq: '≠', ne: '≠',
  le: '≤', leq: '≤', ge: '≥', geq: '≥', approx: '≈', equiv: '≡', propto: '∝', infinity: '∞',
  infty: '∞', to: '→', rightarrow: '→', Rightarrow: '⇒', implies: '⇒', leftarrow: '←', Leftrightarrow: '⇔',
  leftrightarrow: '↔', degree: '°', circ: '°', angle: '∠', parallel: '∥', perp: '⊥',
  partial: '∂', nabla: '∇', ldots: '…', cdots: '⋯', dots: '…', because: '∵', therefore: '∴',
  sim: '∼', simeq: '≃', cong: '≅', asymp: '≍', models: '⊨', forall: '∀', exists: '∃',
  emptyset: '∅', varnothing: '∅', ell: 'ℓ', hbar: 'ℏ', prime: '′', Re: 'Re', Im: 'Im'
};

const BLACKBOARD_CHARS = {
  R: 'ℝ', N: 'ℕ', Z: 'ℤ', Q: 'ℚ', C: 'ℂ', P: 'ℙ', H: 'ℍ'
};

const SUBSCRIPT_CHARS = {
  0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉',
  '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎'
};

const SUPERSCRIPT_CHARS = {
  0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹',
  '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', i: 'ⁱ'
};

function mapCharacters(value, characterMap) {
  return [...String(value || '')].map((character) => characterMap[character] || character).join('');
}

function mergeTextNodes(nodes) {
  const merged = [];
  for (const node of nodes.filter(Boolean)) {
    if (node.type === 'text' && merged.at(-1)?.type === 'text') merged.at(-1).value += node.value;
    else merged.push(node);
  }
  return merged;
}

function formatChemistry(value) {
  const text = String(value || '')
    .replace(/<=>|<->/g, '⇌')
    .replace(/->/g, '→')
    .replace(/<-/g, '←');
  let result = '';
  let tokenStart = true;

  for (let index = 0; index < text.length;) {
    const character = text[index];
    if (/\s/.test(character)) {
      result += character;
      tokenStart = true;
      index += 1;
      continue;
    }
    if ('+→←⇌='.includes(character)) {
      result += character;
      tokenStart = true;
      index += 1;
      continue;
    }
    if (character === '^') {
      index += 1;
      let charge = '';
      if (text[index] === '{') {
        index += 1;
        while (index < text.length && text[index] !== '}') charge += text[index++];
        if (text[index] === '}') index += 1;
      } else {
        while (index < text.length && /[0-9+\-]/.test(text[index])) charge += text[index++];
      }
      result += mapCharacters(charge, SUPERSCRIPT_CHARS);
      tokenStart = false;
      continue;
    }
    if (/\d/.test(character)) {
      let digits = '';
      while (index < text.length && /\d/.test(text[index])) digits += text[index++];
      const previous = result.at(-1) || '';
      result += !tokenStart && /[A-Za-z)\]]/.test(previous) ? mapCharacters(digits, SUBSCRIPT_CHARS) : digits;
      tokenStart = false;
      continue;
    }
    result += character;
    tokenStart = false;
    index += 1;
  }
  return result;
}

function plainText(nodes) {
  return nodes.map((node) => {
    const children = node.children ? plainText(node.children) : '';
    if (node.type === 'text') return node.value;
    if (node.type === 'group') return children;
    if (node.type === 'round') return `(${children})`;
    if (node.type === 'square') return `[${children}]`;
    if (node.type === 'curly') return `{${children}}`;
    if (node.type === 'fraction') return `(${plainText(node.numerator)})/(${plainText(node.denominator)})`;
    if (node.type === 'radical') return `${node.degree?.length ? `${plainText(node.degree)}√` : '√'}(${children})`;
    if (node.type === 'superscript') return `${children}^(${plainText(node.superScript)})`;
    if (node.type === 'subscript') return `${children}_(${plainText(node.subScript)})`;
    if (node.type === 'subsup') return `${children}_(${plainText(node.subScript)})^(${plainText(node.superScript)})`;
    if (node.type === 'vector') return `${children}⃗`;
    return children;
  }).join('');
}

function createParser(source) {
  const input = normalizeLatexMath(source)
    .replace(/\\(?:displaystyle|textstyle|scriptstyle|limits|nolimits)\b/g, '')
    .replace(/&/g, ' ');
  let index = 0;

  const skipSpaces = () => {
    while (index < input.length && /\s/.test(input[index])) index += 1;
  };

  const readRawGroup = (open = '{', close = '}') => {
    skipSpaces();
    if (input[index] !== open) return '';
    index += 1;
    let depth = 1;
    let value = '';
    while (index < input.length && depth > 0) {
      const character = input[index++];
      if (character === open) depth += 1;
      else if (character === close) depth -= 1;
      if (depth > 0) value += character;
    }
    return value;
  };

  const attachScript = (nodes, kind, script) => {
    const trailingSpaces = [];
    while (nodes.at(-1)?.type === 'text' && /^\s+$/.test(nodes.at(-1).value)) trailingSpaces.unshift(nodes.pop());
    const base = nodes.pop() || { type: 'text', value: '' };
    if (base.type === 'subscript' && kind === 'superScript') {
      nodes.push({ type: 'subsup', children: base.children, subScript: base.subScript, superScript: script });
    } else if (base.type === 'superscript' && kind === 'subScript') {
      nodes.push({ type: 'subsup', children: base.children, subScript: script, superScript: base.superScript });
    } else {
      nodes.push({ type: kind === 'superScript' ? 'superscript' : 'subscript', children: [base], [kind]: script });
    }
    nodes.push(...trailingSpaces);
  };

  const parseArgument = () => {
    skipSpaces();
    if (input[index] === '{') {
      index += 1;
      return parseSequence('}');
    }
    if (input[index] === '\\') {
      const commandNode = parseCommand();
      return Array.isArray(commandNode) ? commandNode : [commandNode];
    }
    if (index >= input.length) return [];
    return [{ type: 'text', value: input[index++] }];
  };

  const parseCommand = () => {
    index += 1;
    if (input[index] === '\\') {
      index += 1;
      return { type: 'text', value: ' ' };
    }
    if (index >= input.length) return { type: 'text', value: '\\' };
    if (!/[A-Za-z]/.test(input[index])) {
      const escaped = input[index++];
      if (['!', ',', ';', ':'].includes(escaped)) return { type: 'text', value: '' };
      if (/\s/.test(escaped)) return { type: 'text', value: ' ' };
      return { type: 'text', value: escaped };
    }

    let name = '';
    while (index < input.length && /[A-Za-z]/.test(input[index])) name += input[index++];
    if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
      return { type: 'fraction', numerator: parseArgument(), denominator: parseArgument() };
    }
    if (name === 'sqrt') {
      skipSpaces();
      const degree = input[index] === '[' ? parseLatexMath(readRawGroup('[', ']')) : [];
      return { type: 'radical', children: parseArgument(), degree };
    }
    if (name === 'ce') return { type: 'text', value: formatChemistry(readRawGroup()) };
    if (name === 'vec' || name === 'overrightarrow') return { type: 'vector', children: parseArgument() };
    if (name === 'mathbb') {
      const value = plainText(parseArgument());
      return { type: 'text', value: mapCharacters(value, BLACKBOARD_CHARS) };
    }
    if (['mathrm', 'mathbf', 'mathit', 'text', 'operatorname', 'overline', 'underline'].includes(name)) {
      return { type: 'group', children: parseArgument() };
    }
    if (name === 'left' || name === 'right' || name === 'begin' || name === 'end') {
      if (name === 'begin' || name === 'end') readRawGroup();
      return { type: 'text', value: '' };
    }
    if (['quad', 'qquad', 'enspace'].includes(name)) return { type: 'text', value: ' ' };
    if (name === 'sum') return { type: 'text', value: '∑' };
    if (name === 'prod') return { type: 'text', value: '∏' };
    if (name === 'int') return { type: 'text', value: '∫' };
    if (name === 'lim') return { type: 'text', value: 'lim' };
    return { type: 'text', value: SYMBOL_COMMANDS[name] ?? name };
  };

  const parseSequence = (stopCharacter = '') => {
    const nodes = [];
    while (index < input.length) {
      const character = input[index];
      if (stopCharacter && character === stopCharacter) {
        index += 1;
        break;
      }
      if (character === '{') {
        index += 1;
        nodes.push({ type: 'group', children: parseSequence('}') });
      } else if (character === '(') {
        index += 1;
        nodes.push({ type: 'round', children: parseSequence(')') });
      } else if (character === '[') {
        index += 1;
        nodes.push({ type: 'square', children: parseSequence(']') });
      } else if (character === '\\') {
        const node = parseCommand();
        if (Array.isArray(node)) nodes.push(...node);
        else nodes.push(node);
      } else if (character === '^' || character === '_') {
        index += 1;
        attachScript(nodes, character === '^' ? 'superScript' : 'subScript', parseArgument());
      } else if (character === '~') {
        index += 1;
        nodes.push({ type: 'text', value: ' ' });
      } else {
        index += 1;
        nodes.push({ type: 'text', value: character });
      }
    }
    return mergeTextNodes(nodes);
  };

  return { parse: () => parseSequence() };
}

export function parseLatexMath(value) {
  return createParser(value).parse();
}

export function latexMathToPlainText(value) {
  return plainText(parseLatexMath(value));
}

export function createEditableWordMath(value, constructors) {
  const {
    Math: WordMath,
    MathFraction,
    MathRadical,
    MathRoundBrackets,
    MathRun,
    MathSquareBrackets,
    MathSubScript,
    MathSubSuperScript,
    MathSuperScript
  } = constructors;

  const toComponents = (nodes) => {
    const components = [];
    for (const node of nodes) {
      if (node.type === 'text') {
        if (node.value) components.push(new MathRun(node.value));
      } else if (node.type === 'group') {
        components.push(...toComponents(node.children));
      } else if (node.type === 'round') {
        components.push(new MathRoundBrackets({ children: toComponents(node.children) }));
      } else if (node.type === 'square') {
        components.push(new MathSquareBrackets({ children: toComponents(node.children) }));
      } else if (node.type === 'fraction') {
        components.push(new MathFraction({ numerator: toComponents(node.numerator), denominator: toComponents(node.denominator) }));
      } else if (node.type === 'radical') {
        components.push(new MathRadical({ children: toComponents(node.children), degree: node.degree?.length ? toComponents(node.degree) : undefined }));
      } else if (node.type === 'superscript') {
        components.push(new MathSuperScript({ children: toComponents(node.children), superScript: toComponents(node.superScript) }));
      } else if (node.type === 'subscript') {
        components.push(new MathSubScript({ children: toComponents(node.children), subScript: toComponents(node.subScript) }));
      } else if (node.type === 'subsup') {
        components.push(new MathSubSuperScript({ children: toComponents(node.children), subScript: toComponents(node.subScript), superScript: toComponents(node.superScript) }));
      } else if (node.type === 'vector') {
        components.push(new MathRun(`${plainText(node.children)}⃗`));
      }
    }
    return components.length ? components : [new MathRun('')];
  };

  return new WordMath({ children: toComponents(parseLatexMath(value)) });
}
