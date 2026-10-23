/** Text exceptions for this route (docs/plan/parity-text-exceptions.md). */
export const EXCEPTIONS: Array<[string, string]> = [
  // Sealed lane is in testing; the step title must say so (copy-rules: sealed-lane pages are labelled "in testing").
  ['>Attest the sealed lane<', '>Attest the sealed lane (in testing)<'],
];

export function applyExceptions(html: string) {
  return EXCEPTIONS.reduce((s, [a, b]) => s.split(a).join(b), html);
}
