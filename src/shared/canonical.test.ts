import { expect, test } from 'bun:test';
import { canonicalJson, sha256Hex } from './canonical';

test('canonicalJson sorts keys, no whitespace', () => {
  expect(canonicalJson({ b: 1, a: [{ d: 2, c: 'x' }], z: null })).toBe(
    '{"a":[{"c":"x","d":2}],"b":1,"z":null}',
  );
  expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
});
test('sha256Hex', () => {
  expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  expect(sha256Hex(new TextEncoder().encode('abc'))).toBe(sha256Hex('abc'));
});
