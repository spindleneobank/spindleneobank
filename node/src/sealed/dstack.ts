/**
 * Client for the dstack guest agent (`/var/run/dstack.sock`, HTTP over a unix socket).
 * UNVERIFIED ON HARDWARE: the request/response shape follows the dstack SDK (`POST /GetQuote`,
 * body `{ report_data: <hex> }`, answer `{ quote: <hex>, event_log: <json string>, ... }`).
 */
export const DSTACK_SOCKET = process.env.DSTACK_SOCKET ?? '/var/run/dstack.sock';

export interface DstackQuote {
  quote: Uint8Array;
  eventLog: unknown;
}

export type DstackFetch = (
  reportData: Uint8Array,
) => Promise<{ quote: string; event_log: string | unknown[] }>;

export const dstackGetQuote: DstackFetch = async (reportData) => {
  // nosemgrep: react-insecure-request -- this fetch goes over the local dstack unix socket, not a network
  const res = await fetch('http://dstack/GetQuote', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ report_data: Buffer.from(reportData).toString('hex') }),
    // Bun-specific: talk HTTP over a unix domain socket
    unix: DSTACK_SOCKET,
    signal: AbortSignal.timeout(30_000),
  } as RequestInit);
  if (!res.ok) throw new Error(`dstack GetQuote HTTP ${res.status}`);
  return (await res.json()) as { quote: string; event_log: string | unknown[] };
};

export function parseDstackQuote(r: { quote: string; event_log: string | unknown[] }): DstackQuote {
  const hex = r.quote.startsWith('0x') ? r.quote.slice(2) : r.quote;
  return {
    quote: new Uint8Array(Buffer.from(hex, 'hex')),
    eventLog: typeof r.event_log === 'string' ? JSON.parse(r.event_log) : r.event_log,
  };
}
