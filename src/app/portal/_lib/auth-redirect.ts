import type { AuthMode } from '../_components/AuthPanel';

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Where the old /portal/sign-in and /portal/sign-up routes send people now:
 * the combined /portal page. Any query string (e.g. a Clerk invitation
 * ticket) is carried over so a link someone was emailed still works.
 */
export function portalAuthUrl(mode: AuthMode, searchParams: SearchParams): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (key === 'mode' || value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) params.append(key, v);
  }
  if (mode === 'sign-up') params.set('mode', 'sign-up');
  const query = params.toString();
  return query ? `/portal?${query}` : '/portal';
}
