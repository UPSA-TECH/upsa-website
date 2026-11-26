import { redirect } from 'next/navigation';
import { portalAuthUrl } from '../../_lib/auth-redirect';

// Sign-in now lives on /portal itself. Kept as a route so old links,
// bookmarks, and anything still pointing at /portal/sign-in keep working.
export default async function PortalSignInRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  redirect(portalAuthUrl('sign-in', await searchParams));
}
