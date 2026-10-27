import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../api/errors';
import { classifyError } from '../useChat';

describe('classifyError', () => {
  it.each([
    ['NO_CAPACITY', 503, 'no_capacity'],
    ['INSUFFICIENT_BALANCE', 402, 'insufficient_balance'],
    ['SESSION_EXHAUSTED', 402, 'session_exhausted'],
    ['X402_DISABLED', 402, 'disabled'],
    ['context_length_exceeded', 400, 'context_length'],
    ['INTERNAL', 500, 'other'],
  ])('%s -> %s', (code, status, kind) => {
    expect(classifyError(new ApiError(code, 'm', status)).kind).toBe(kind);
  });
  it('handles non-API errors', () => {
    expect(classifyError(new Error('boom')).message).toBe('boom');
  });
});
