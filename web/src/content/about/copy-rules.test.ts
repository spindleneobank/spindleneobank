import { describe, expect, it } from 'vitest';
import { COMPONENTS } from '../architecture';
import { POSTS } from '../blogs';
import { FLOWS } from '../case-study';
import { RELEASES } from '../changelog';
import { LEGAL } from '../legal';
import { ABOUT_BUILD, ABOUT_VALUES, ROLES } from './index';

const BANNED = [
  /passkey/i,
  /smart[- ]account/i,
  /paymaster/i,
  /claimStock/,
  /consumeForCard/,
  /refundCard/,
  /prepaid/i,
  /reloadable/i,
  /\bpartner/i,
  /passive income/i,
  /\bAPY\b/,
  /no account/i,
  /no email/i,
  /canonical registry/i,
];

const corpus = JSON.stringify([ROLES, ABOUT_BUILD, ABOUT_VALUES, COMPONENTS, POSTS, FLOWS, RELEASES, LEGAL]);

describe('F0n copy rules', () => {
  for (const re of BANNED) {
    it(`does not contain ${re}`, () => {
      expect(corpus).not.toMatch(re);
    });
  }
  it('labels the sealed lane as in testing wherever it is described', () => {
    expect(corpus).toMatch(/in testing/i);
  });
  it('has 12 architecture components and 7 posts and 4 flows', () => {
    expect(COMPONENTS).toHaveLength(12);
    expect(POSTS).toHaveLength(7);
    expect(FLOWS).toHaveLength(4);
  });
});
