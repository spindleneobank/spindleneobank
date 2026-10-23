import type { NodeToServer } from '@spindle/shared/node-protocol';

/** Validates against the shared schema and sends; returns false if dropped. */
export type SendFn = (msg: NodeToServer) => boolean;
