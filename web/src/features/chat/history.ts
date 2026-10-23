import { z } from 'zod';

const Message = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  /** server-reported only (spindle.chargeMicros); never estimated */
  chargeMicros: z.string().optional(),
  tokens: z.number().optional(),
  jobId: z.string().optional(),
  receiptUrl: z.string().optional(),
  model: z.string().optional(),
  error: z.string().optional(),
  partial: z.boolean().optional(),
});
export type ChatMsg = z.infer<typeof Message>;

const Conversation = z.object({
  id: z.string(),
  title: z.string(),
  model: z.string().optional(),
  updatedAt: z.number(),
  messages: z.array(Message),
});
export type Conversation = z.infer<typeof Conversation>;

const MAX_CONVERSATIONS = 30;
const key = (address: string) => `spindle.chat.history.v1:${address.toLowerCase()}`;

/** Browser-local only (UI convenience). Storage failures degrade to in-memory. */
export function loadHistory(address: string): Conversation[] {
  try {
    const raw = localStorage.getItem(key(address));
    if (!raw) return [];
    const parsed = z.array(Conversation).safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export function saveHistory(address: string, list: Conversation[]): void {
  try {
    // never persist an in-flight (partial) assistant message
    const clean = list
      .slice(0, MAX_CONVERSATIONS)
      .map((c) => ({ ...c, messages: c.messages.filter((m) => !m.partial) }));
    localStorage.setItem(key(address), JSON.stringify(clean));
  } catch {
    // quota or blocked storage: keep going without persistence
  }
}

export function clearHistory(address: string): void {
  try {
    localStorage.removeItem(key(address));
  } catch {
    // ignore
  }
}

export const newConversation = (): Conversation => ({
  id: crypto.randomUUID(),
  title: 'New chat',
  updatedAt: Date.now(),
  messages: [],
});

export const titleFrom = (text: string) => {
  const t = text.trim().replace(/\s+/g, ' ');
  return t.length > 48 ? `${t.slice(0, 47)}…` : t || 'New chat';
};
