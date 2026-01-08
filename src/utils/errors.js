export class UserError extends Error {
  constructor(message, status = 400, details = {}) {
    super(message);
    this.name = 'UserError';
    this.status = status;
    this.details = details;
  }
}

export class LLMError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'LLMError';
    this.status = 502;
    this.details = details;
  }
}

export class SystemError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'SystemError';
    this.status = 500;
    this.details = details;
  }
}
