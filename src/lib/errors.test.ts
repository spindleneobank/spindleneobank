import { expect, test } from 'bun:test';
import { AppError, toHttp } from './errors';

test('toHttp', () => {
  expect(toHttp(new AppError('NOT_FOUND', 'nope')).status).toBe(404);
  const r = toHttp(new Error('db password leaked'));
  expect(r.status).toBe(500);
  expect(JSON.stringify(r.body)).not.toContain('leaked');
});
