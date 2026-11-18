import { SOCIAL_HANDLE, SOCIALS } from '../../../components/marketing/shell/nav-data';

/** Text exceptions for this route (docs/plan/parity-text-exceptions.md). */
export const EXCEPTIONS: Array<[string, string]> = [
  // Sealed lane is in testing; the step title must say so (copy-rules: sealed-lane pages are labelled "in testing").
  ['>Attest the sealed lane<', '>Attest the sealed lane (in testing)<'],
  // The community channels are live: the old "coming soon" buttons become links to them.
  ...SOCIALS.map((s): [string, string] => [
    `<button type="button" data-sp-social="${s.key}">`,
    `<a href="${s.href}" target="_blank" rel="noopener noreferrer" data-sp-social="${s.key}" aria-label="Spindle on ${s.label}">`,
  ]),
  ['<small>COMING SOON</small></button>', `<small>${SOCIAL_HANDLE.toUpperCase()}</small></a>`],
];

export function applyExceptions(html: string) {
  return EXCEPTIONS.reduce((s, [a, b]) => s.split(a).join(b), html);
}
