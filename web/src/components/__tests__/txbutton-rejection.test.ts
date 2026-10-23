import { describe, expect, it } from 'vitest';
import { isUserRejection } from '../TxButton';

describe('isUserRejection', () => {
  it('detects a rejection nested several causes deep (viem writeContract)', () => {
    const err = {
      name: 'ContractFunctionExecutionError',
      cause: { name: 'TransactionExecutionError', cause: { name: 'UserRejectedRequestError', code: 4001 } },
    };
    expect(isUserRejection(err)).toBe(true);
  });
  it('detects a top-level EIP-1193 4001', () => {
    expect(isUserRejection({ code: 4001 })).toBe(true);
  });
  it('is false for other errors and nullish', () => {
    expect(isUserRejection({ name: 'ContractFunctionRevertedError', cause: { code: -32000 } })).toBe(false);
    expect(isUserRejection(null)).toBe(false);
  });
});
