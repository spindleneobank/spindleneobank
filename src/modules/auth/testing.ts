import { SESSION_COOKIE } from './constants';
import { createSession } from './service';

/** Inserts a session for `address` and returns a `cookie` header value plus CSRF-ready headers. */
export async function createTestSession(
  address: string,
): Promise<{ cookie: string; token: string; headers: Record<string, string> }> {
  const { token } = await createSession(address.toLowerCase());
  const cookie = `${SESSION_COOKIE}=${token}`;
  return { cookie, token, headers: { cookie, 'x-spindle': '1' } };
}
