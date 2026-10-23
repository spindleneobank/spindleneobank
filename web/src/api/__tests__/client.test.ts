import { describe, expect, it, vi } from 'vitest';
import { withReauth } from '../client';
import { ApiError } from '../errors';

describe('withReauth', () => {
  it('re-signs once on REAUTH_REQUIRED and retries', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new ApiError('REAUTH_REQUIRED', 'x', 403))
      .mockResolvedValueOnce('ok');
    const reauth = vi.fn().mockResolvedValue(undefined);
    await expect(withReauth(fn, reauth)).resolves.toBe('ok');
    expect(reauth).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledTimes(2);
  });
  it('does not retry other errors or loop on a second REAUTH_REQUIRED', async () => {
    const reauth = vi.fn().mockResolvedValue(undefined);
    await expect(
      withReauth(() => Promise.reject(new ApiError('FORBIDDEN', 'x', 403)), reauth),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(reauth).not.toHaveBeenCalled();
    const always = vi.fn().mockRejectedValue(new ApiError('REAUTH_REQUIRED', 'x', 403));
    await expect(withReauth(always, reauth)).rejects.toMatchObject({ code: 'REAUTH_REQUIRED' });
    expect(always).toHaveBeenCalledTimes(2);
  });
});
