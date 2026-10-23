/** Approved text exceptions for this route (docs/plan/parity-text-exceptions.md). */
export const EXCEPTIONS: Array<[string, string]> = [
  ['serve AI jobs in a sealed or open lane', 'serve AI jobs in the open lane; sealed is in testing'],
];

export function applyExceptions(html: string) {
  return EXCEPTIONS.reduce((s, [a, b]) => s.split(a).join(b), html);
}
