export const CONTENT_SCHEMA_VERSION = 3;

export function isCurrentContentSession(session) {
  return session?.contentSchemaVersion === CONTENT_SCHEMA_VERSION
    && typeof session.finalAnswer === 'string'
    && session.finalAnswer.trim().length >= 20;
}
