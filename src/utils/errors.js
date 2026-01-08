export class UserError extends Error {
  constructor(message, status = 400, details = {}, code = 'USER_ERROR') {
    super(message);
    this.name = 'UserError';
    this.status = status;
    this.details = details;
    this.code = code;
  }
}

export class LLMError extends Error {
  constructor(message, details = {}, code = 'LLM_ERROR') {
    super(message);
    this.name = 'LLMError';
    this.status = 502;
    this.details = details;
    this.code = code;
  }
}

export class SystemError extends Error {
  constructor(message, details = {}, code = 'SYSTEM_ERROR') {
    super(message);
    this.name = 'SystemError';
    this.status = 500;
    this.details = details;
    this.code = code;
  }
}
