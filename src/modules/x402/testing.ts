import type { KvStore } from '../chain/service';

/** In-memory kv for unit tests. */
export const memKv = (): KvStore & { data: Map<string, unknown> } => {
  const data = new Map<string, unknown>();
  return { data, get: async (k) => data.get(k), set: async (k, v) => void data.set(k, v) };
};
