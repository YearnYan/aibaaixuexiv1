import { describe, expect, it } from 'vitest';
import {
  assertScientificPlan,
  normalizeScientificPlan,
  normalizeScientificText,
  validateScientificPlan,
  validateScientificText,
} from './scientific-content.js';

function createPlan(overrides = {}) {
  return {
    problemSummary: '综合检查规范学科表达与完整推导过程。',
    knowledgePoints: ['跨学科规范表达'],
    steps: [
      {
        title: '读懂已知',
        description: '识别数学与几何条件',
        task: '明确 $AB=AC$ 与 $\\angle B=70^\\circ$',
        guidance: '由三角形内角关系整理已知量，保留规范角度表达。',
        hints: ['关注等量关系', '使用角度关系', '写成 $\\angle A+\\angle B+\\angle C=180^\\circ$'],
      },
      {
        title: '确定方法',
        description: '选择物理关系并统一单位',
        task: '使用 $F=ma$ 建立关系',
        guidance: '重力加速度取 $9.8\\,\\mathrm{m\\,s^{-2}}$，代入前先统一量纲。',
        hints: ['识别受力', '确定正方向', '检查 $\\mathrm{N}$ 与基本单位的一致性'],
      },
      {
        title: '列式求解',
        description: '规范表示化学与生物符号',
        task: '配平 $\\ce{2H2 + O2 -> 2H2O}$',
        guidance: '遗传组合可写为 $X^\\mathrm{A}X^\\mathrm{a}$，方向表示为 $5^\\prime\\to3^\\prime$。',
        hints: ['守恒配平', '区分上下标含义', '逐项核对 $\\ce{Fe^{3+}}$ 的电荷'],
      },
      {
        title: '检验作答',
        description: '核对地理量与比例尺',
        task: '检查 $30^\\circ\\mathrm{N}$ 与 $1:50\\,000$',
        guidance: '经纬度方向和比例尺均已使用规范公式表达。',
        hints: ['核对方向', '核对数量级', '确认最终单位书写完整'],
      },
    ],
    finalAnswer: '完整推导得到 $\\angle B=70^\\circ$，并已检查 $\\angle A+\\angle B+\\angle C=180^\\circ$。',
    ...overrides,
  };
}

describe('科学内容校验', () => {
  it('接受数学、物理、化学、生物和地理的规范 LaTeX', () => {
    const plan = createPlan();
    expect(validateScientificPlan(plan)).toEqual([]);
    expect(assertScientificPlan(plan)).toBe(plan);
  });

  it.each([
    ['数学', '函数为 $y=ax^2+bx+c$，求根使用 $x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}$。'],
    ['数学综合', '数列为 $\\sum_{i=1}^{n}i=\\frac{n(n+1)}{2}$，矩阵为 $\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}$，积分为 $\\int_a^b f(x)\\,\\mathrm{d}x$。'],
    ['物理', '由 $\\vec{F}=m\\vec{a}$ 得加速度，单位为 $\\mathrm{m\\,s^{-2}}$。'],
    ['物理综合', '压强为 $2.0\\times10^3\\,\\mathrm{Pa}$，初速度为 $v_0$，时间变化为 $\\Delta t$。'],
    ['化学', '反应式为 $\\ce{2H2(g) + O2(g) -> 2H2O(l)}$，离子为 $\\ce{Fe^{3+}}$。'],
    ['化学平衡', '可逆反应写为 $\\ce{N2(g) + 3H2(g) <=> 2NH3(g)}$。'],
    ['生物', '核酸写作 $\\mathrm{DNA}$，遗传组合为 $X^\\mathrm{A}X^\\mathrm{a}$。'],
    ['生物综合', '复制方向为 $5^\\prime\\to3^\\prime$，概率为 $P=\\frac{3}{4}$。'],
    ['地理', '位置为 $30^\\circ\\mathrm{N}$、$120^\\circ\\mathrm{E}$，比例尺为 $1:50\\,000$。'],
    ['地理综合', '流量为 $Q=Av$，坡度为 $i=\\frac{h}{l}\\times100\\%$。'],
  ])('接受%s常见规范公式', (_subject, content) => {
    expect(validateScientificText(content)).toEqual([]);
  });

  it.each([
    ['裸几何符号', '已知 ∠B=70°'],
    ['裸物理单位', '加速度取 9.8 m/s'],
    ['裸化学式', '反应物包含 H2 和 O2'],
    ['裸生物方向符号', '方向为 5′→3′'],
    ['裸地理比例尺', '比例尺为 1:50000'],
    ['Unicode 上下标', '二氧化碳写作 CO₂'],
    ['乱码', '结果包含 � 字符'],
    ['裸点名和坐标', '代入点P(4,0)继续计算'],
    ['裸函数表达', '设 y=ax^2+bx+c'],
    ['裸生物缩写', 'DNA复制方向需要核对'],
    ['裸线段名', '直线AB与抛物线相交'],
    ['截图中的复合裸公式', 'S1/S2 + S2/S3 = 2 * (CP/CO) = -1/2 t^2 + 5/2 t - 2'],
  ])('拒绝%s', (_name, content) => {
    expect(validateScientificText(content)).not.toEqual([]);
  });

  it('清除中文句子中误插入的无语义英文冠词', () => {
    expect(normalizeScientificText('乙地位于山顶 the 上方，因此位于南坡。'))
      .toBe('乙地位于山顶上方，因此位于南坡。');
    const plan = normalizeScientificPlan(createPlan({
      problemSummary: '分析山顶 an 上方的地理位置与坡向关系。',
    }));
    expect(plan.problemSummary).toBe('分析山顶上方的地理位置与坡向关系。');
    expect(validateScientificPlan(plan)).toEqual([]);
  });

  it('统一标准 LaTeX 圆括号、方括号定界符并清除不可见字符', () => {
    expect(normalizeScientificText('速度为 \\(v_0=2\\,\\mathrm{m\\,s^{-1}}\\)。\u200B'))
      .toBe('速度为 $v_0=2\\,\\mathrm{m\\,s^{-1}}$。');
    expect(normalizeScientificText('推导如下：\\[x=\\frac{-b}{2a}\\]'))
      .toBe('推导如下：$$\nx=\\frac{-b}{2a}\n$$');
  });

  it('不会把真实学科缩写当作英文噪声删除', () => {
    const source = '使用 GPS 判断位置，结合 DNA 信息完成分析。';
    expect(normalizeScientificText(source)).toBe(source);
    expect(validateScientificText(normalizeScientificText(source))).not.toEqual([]);
  });

  it('拒绝无法编译的 LaTeX', () => {
    const issues = validateScientificText('错误公式 $\\frac{1}{$');
    expect(issues.some((issue) => issue.reason.includes('LaTeX 编译失败'))).toBe(true);
  });

  it('拒绝截图中出现的无参数 mhchem 命令', () => {
    const issues = validateScientificText('错误化学式 $\\ceNaOH$');
    expect(issues.some((issue) => issue.reason.includes('LaTeX 编译失败'))).toBe(true);
  });

  it('返回稳定的科学符号错误码', () => {
    const plan = createPlan({ problemSummary: '错误表达 ∠B=70° 无法进入会话。' });
    let caught;
    try {
      assertScientificPlan(plan);
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      status: 422,
      code: 'AI_SCIENTIFIC_NOTATION_INVALID',
    });
  });
});
