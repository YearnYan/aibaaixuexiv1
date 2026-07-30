import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateSolutionPlan, parseJsonResponse } from './ai-client.js';

const config = {
  baseUrl: 'https://example.test/v1',
  apiKey: 'test-key',
  model: 'test-model',
  temperature: 0.4,
  timeoutMs: 5000,
};

const input = {
  subject: '自动识别',
  grade: '自动识别',
  source: { kind: 'text', fileName: '题目.txt', text: '用于测试的完整题目材料。' },
};

function createPlan(overrides = {}) {
  return {
    problemSummary: '分析题目条件并建立完整解题路径。',
    knowledgePoints: ['规范学科表达'],
    steps: [
      {
        title: '读懂已知',
        description: '梳理题目中的已知条件',
        task: '明确需要使用的条件和目标',
        guidance: '先读取材料，再整理条件之间的关系。',
        hints: ['识别条件', '定位目标', '核对题意'],
      },
      {
        title: '确定方法',
        description: '选择适合当前题目的方法',
        task: '建立条件与结论之间的联系',
        guidance: '依据知识点确定解题方法并说明理由。',
        hints: ['回忆知识', '选择方法', '建立联系'],
      },
      {
        title: '列式求解',
        description: '按顺序完成推导和计算',
        task: '写出规范过程并得到结果',
        guidance: '逐步推导，保留必要过程并检查表达。',
        hints: ['逐步推导', '规范表达', '得到结果'],
      },
      {
        title: '检验作答',
        description: '复核结果与题目条件',
        task: '确认结论完整且符合题意',
        guidance: '回代检查条件，最后写出完整结论。',
        hints: ['回代检查', '核对条件', '完整作答'],
      },
    ],
    finalAnswer: '根据题目条件完成逐步分析，可以得到符合题意的最终结论。',
    ...overrides,
  };
}

function aiResponse(plan) {
  return new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(plan) } }],
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseJsonResponse', () => {
  it('解析纯 JSON', () => {
    expect(parseJsonResponse('{"guidance":"直接指导"}')).toEqual({ guidance: '直接指导' });
  });

  it('解析带代码围栏和前后说明的 JSON', () => {
    const content = '```json\n说明文字 {"title":"读懂已知"} 结束\n```';
    expect(parseJsonResponse(content)).toEqual({ title: '读懂已知' });
  });

  it('保守修复 JSON 字符串中的单反斜杠 LaTeX', () => {
    const content = String.raw`{"guidance":"使用 \frac{1}{2} 计算"}`;
    expect(parseJsonResponse(content)).toEqual({ guidance: String.raw`使用 \frac{1}{2} 计算` });
  });

  it('修复任意长 LaTeX 控制词，不依赖有限命令白名单', () => {
    const content = String.raw`{"guidance":"数学 $\sum_{i=1}^{n} i$、物理 $\Delta t$、化学 $\ce{NaOH}$、生物 $5^\prime\to3^\prime$、地理 $30^\circ\mathrm{N}$"}`;
    expect(parseJsonResponse(content)).toEqual({
      guidance: String.raw`数学 $\sum_{i=1}^{n} i$、物理 $\Delta t$、化学 $\ce{NaOH}$、生物 $5^\prime\to3^\prime$、地理 $30^\circ\mathrm{N}$`,
    });
  });

  it('拒绝缺少 JSON 对象的内容', () => {
    expect(() => parseJsonResponse('连接成功')).toThrow('AI 返回的结果格式不完整');
  });
});

describe('generateSolutionPlan', () => {
  it('在进入修复调用前清除中文中的误插英文冠词', async () => {
    const noisyPlan = createPlan();
    noisyPlan.steps[0].guidance = '乙地位于山顶 the 上方，因此乙地位于南坡。';
    const fetchMock = vi.fn().mockResolvedValue(aiResponse(noisyPlan));
    vi.stubGlobal('fetch', fetchMock);

    const plan = await generateSolutionPlan(config, input);

    expect(plan.steps[0].guidance).toBe('乙地位于山顶上方，因此乙地位于南坡。');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('携带违规片段进行多轮增量修复，并把修复温度固定为零', async () => {
    const firstPlan = createPlan({ problemSummary: '使用 GPS 信息分析题目并确定位置关系。' });
    const partialPlan = createPlan({ problemSummary: '使用 GIS 信息分析题目并确定位置关系。' });
    const validPlan = createPlan({
      problemSummary: '使用 $\\mathrm{GPS}$ 信息分析题目并确定位置关系。',
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(aiResponse(firstPlan))
      .mockResolvedValueOnce(aiResponse(partialPlan))
      .mockResolvedValueOnce(aiResponse(validPlan));
    vi.stubGlobal('fetch', fetchMock);

    const plan = await generateSolutionPlan(config, input);

    expect(plan.problemSummary).toContain('$\\mathrm{GPS}$');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const firstRepairBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    const secondRepairBody = JSON.parse(fetchMock.mock.calls[2][1].body);
    expect(firstRepairBody.temperature).toBe(0);
    expect(firstRepairBody.messages[1].content).toContain('违规片段');
    expect(firstRepairBody.messages[1].content).toContain('GPS');
    expect(secondRepairBody.messages[1].content).toContain('GIS');
  });

  it('连续返回完全相同的违规结果时升级为整字段等义重写', async () => {
    const invalidPlan = createPlan({ problemSummary: '使用 GPS 信息分析题目并确定位置关系。' });
    const validPlan = createPlan({
      problemSummary: '使用 $\\mathrm{GPS}$ 信息分析题目并确定位置关系。',
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(aiResponse(invalidPlan))
      .mockResolvedValueOnce(aiResponse(invalidPlan))
      .mockResolvedValueOnce(aiResponse(validPlan));
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateSolutionPlan(config, input)).resolves.toMatchObject(validPlan);

    const escalatedBody = JSON.parse(fetchMock.mock.calls[2][1].body);
    expect(escalatedBody.messages[1].content).toContain('上一轮没有实质进展');
  });

  it('最多执行三轮格式修复，避免无效模型响应造成无限调用', async () => {
    const invalidPlan = createPlan({ problemSummary: '使用 GPS 信息分析题目并确定位置关系。' });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(aiResponse(invalidPlan))
      .mockResolvedValueOnce(aiResponse(invalidPlan))
      .mockResolvedValueOnce(aiResponse(invalidPlan))
      .mockResolvedValueOnce(aiResponse(invalidPlan));
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateSolutionPlan(config, input)).rejects.toMatchObject({
      status: 422,
      code: 'AI_SCIENTIFIC_NOTATION_INVALID',
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
