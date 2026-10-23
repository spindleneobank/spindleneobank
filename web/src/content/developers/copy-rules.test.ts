import { describe, expect, it } from 'vitest';
import * as content from './index';

const BANNED = [
  /passkey/i,
  /smart[- ]account/i,
  /paymaster/i,
  /prepaid/i,
  /reloadable/i,
  /\bpartner/i,
  /passive income/i,
  /\bAPY\b/,
  /no account/i,
  /no email/i,
];
const { EXAMPLES, ...prose } = content;
const corpus = JSON.stringify(prose);

describe('developers copy rules', () => {
  for (const re of BANNED) it(`does not contain ${re}`, () => expect(corpus).not.toMatch(re));
  it('labels the sealed lane as in testing', () => expect(corpus).toMatch(/in testing/i));
  it('has no secrets in the example files', () => {
    for (const e of Object.values(EXAMPLES)) {
      expect(e.code).not.toMatch(/0x[0-9a-f]{64}(?![0-9a-f])/i);
      expect(e.code).not.toMatch(/sk-spdl-[A-Za-z0-9]{8,}/);
    }
  });
  it('imports every example file', () => {
    for (const e of Object.values(EXAMPLES)) expect(e.code.length).toBeGreaterThan(200);
  });
});
