import pino from 'pino';
import { config } from '../config';

export const logger = pino({
  level: config.LOG_LEVEL,
  base: { role: config.ROLE },
  redact: {
    paths: [
      'authorization',
      'cookie',
      '*.authorization',
      '*.cookie',
      '*.signature',
      '*.privateKey',
      '*.cvv',
      '*.number',
      '*.email',
      'req.headers.authorization',
      'req.headers.cookie',
    ],
    censor: '[redacted]',
  },
});
