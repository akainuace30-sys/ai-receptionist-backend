export const classifySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['case_type', 'confidence', 'rationale_short'],
  properties: {
    case_type: { type: 'string', enum: ['traffic', 'employment', 'family', 'other'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    rationale_short: { type: 'string', minLength: 1 }
  }
};

export const nextQuestionSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['question'],
  properties: {
    question: { type: 'string', minLength: 1 }
  }
};

export const summarySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['summary'],
  properties: {
    summary: { type: 'string', minLength: 1 }
  }
};
