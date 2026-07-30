import { describe, expect, it } from 'vitest';
import { SessionStore } from './session-store.js';

const plan = {
  problemSummary: '已知 $AB=AC$，$\\angle A=40^\\circ$，求 $\\angle B$ 的度数。',
  knowledgePoints: ['等腰三角形'],
  steps: ['读懂已知', '确定方法', '列式求解', '检验作答'].map((title) => ({
    title,
    description: '明确当前步骤目标',
    task: '完成当前步骤的推导',
    guidance: '这是当前步骤的具体指导。',
    hints: ['方向指导', '方法指导', '操作指导'],
  })),
  finalAnswer: '由 $AB=AC$ 得 $\\angle B=\\angle C$，结合内角和可得 $\\angle B=70^\\circ$。',
};

describe('SessionStore', () => {
  it('创建后直接公开四步完整指导', () => {
    const store = new SessionStore();
    const session = store.create({ plan });

    expect(session.steps).toHaveLength(4);
    expect(session.steps[0]).toMatchObject({
      guidance: '这是当前步骤的具体指导。',
      hints: ['方向指导', '方法指导', '操作指导'],
    });
    expect(session).toMatchObject({ contentSchemaVersion: 3, finalAnswer: plan.finalAnswer });
    expect(session).not.toHaveProperty('currentStep');
    expect(session).not.toHaveProperty('unlocked');
  });

  it('刷新读取时返回同一份只读结果', () => {
    const store = new SessionStore();
    const session = store.create({ plan });
    const restored = store.getPublic(session.sessionId);

    expect(restored).toEqual(session);
    expect(JSON.stringify(restored)).not.toContain('passed');
    expect(JSON.stringify(restored)).not.toContain('score');
  });

  it('拒绝把裸公式写入会话', () => {
    const store = new SessionStore();
    expect(() => store.create({
      plan: { ...plan, finalAnswer: '错误写法 y=ax^2 不能进入规范会话，必须在写入前被拒绝。' },
    })).toThrow('学科符号或公式不规范');
  });
});
