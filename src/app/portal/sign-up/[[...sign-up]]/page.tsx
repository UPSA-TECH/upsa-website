import { redirect } from 'next/navigation';
import { portalAuthUrl } from '../../_lib/auth-redirect';

// Sign-up now lives on /portal itself (?mode=sign-up opens it on the
// "Create account" tab). Kept as a route so old links keep working.
export default async function PortalSignUpRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  redirect(portalAuthUrl('sign-up', await searchParams));
}
