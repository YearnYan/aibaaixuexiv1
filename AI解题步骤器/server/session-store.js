import crypto from 'node:crypto';
import { AppError } from './errors.js';
import { assertScientificPlan } from './scientific-content.js';
import { CONTENT_SCHEMA_VERSION, solutionPlanSchema } from './schemas.js';

const DEFAULT_TTL_MS = 4 * 60 * 60 * 1000;

export class SessionStore {
  constructor({ ttlMs = DEFAULT_TTL_MS, maxSessions = 500 } = {}) {
    this.ttlMs = ttlMs;
    this.maxSessions = maxSessions;
    this.sessions = new Map();
  }

  cleanup() {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (session.expiresAt <= now) this.sessions.delete(id);
    }
  }

  create({ plan }) {
    const validatedPlan = assertScientificPlan(solutionPlanSchema.parse(plan));
    this.cleanup();
    if (this.sessions.size >= this.maxSessions) {
      const oldestId = this.sessions.keys().next().value;
      this.sessions.delete(oldestId);
    }
    const id = crypto.randomUUID();
    const now = Date.now();
    const session = {
      id,
      plan: validatedPlan,
      createdAt: now,
      expiresAt: now + this.ttlMs,
    };
    this.sessions.set(id, session);
    return this.toPublic(session);
  }

  getInternal(id) {
    const session = this.sessions.get(id);
    if (!session || session.expiresAt <= Date.now()) {
      this.sessions.delete(id);
      throw new AppError(404, 'SESSION_NOT_FOUND', '本次分析结果已失效，请重新生成分步路径。');
    }
    session.expiresAt = Date.now() + this.ttlMs;
    return session;
  }

  toPublic(session) {
    return {
      sessionId: session.id,
      contentSchemaVersion: CONTENT_SCHEMA_VERSION,
      problemSummary: session.plan.problemSummary,
      knowledgePoints: session.plan.knowledgePoints,
      steps: session.plan.steps.map((step, index) => ({
        index,
        title: step.title,
        description: step.description,
        task: step.task,
        guidance: step.guidance,
        hints: step.hints,
      })),
      finalAnswer: session.plan.finalAnswer,
      generatedAt: new Date(session.createdAt).toISOString(),
    };
  }

  getPublic(id) {
    return this.toPublic(this.getInternal(id));
  }
}
