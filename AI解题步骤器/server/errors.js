export class AppError extends Error {
  constructor(status, code, message, cause) {
    super(message, { cause });
    this.name = 'AppError';
    this.status = status;
    this.code = code;
  }
}

export function assertOrThrow(condition, status, code, message) {
  if (!condition) {
    throw new AppError(status, code, message);
  }
}
