import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

// ---------------------------------------------------------------------------
// Security headers + Content Security Policy
//
// The CSP lists every origin the site legitimately loads from, and is built
// from the same env vars the app already uses, so a new Clerk instance or API
// host never needs a hand-edited allow-list:
//   - Clerk's Frontend API host is encoded in NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
//   - the portal API is NEXT_PUBLIC_API_BASE_URL
//   - Sentry's ingest host is in NEXT_PUBLIC_SENTRY_DSN (only if set)
// Set CSP_REPORT_ONLY=true to have browsers report violations without
// blocking anything - the escape hatch if something legitimate is ever missed.
// ---------------------------------------------------------------------------

const isDev = process.env.NODE_ENV !== "production";

function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

// pk_test_/pk_live_ + base64("<frontend-api-host>$")
function clerkFrontendApi(publishableKey: string | undefined): string | null {
  const encoded = publishableKey?.split("_")[2];
  if (!encoded) return null;
  try {
    const host = Buffer.from(encoded, "base64").toString("utf8").replace(/\$$/, "");
    return /^[a-z0-9.-]+$/i.test(host) ? `https://${host}` : null;
  } catch {
    return null;
  }
}

const clerk = clerkFrontendApi(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
const api = originOf(process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000");
const sentry = originOf(process.env.NEXT_PUBLIC_SENTRY_DSN?.replace(/\/\/[^@/]+@/, "//"));

const sources = (...values: (string | null | false | undefined)[]) => values.filter(Boolean).join(" ");

const csp = [
  "default-src 'self'",
  // Next.js inlines its bootstrap scripts, so 'unsafe-inline' is needed
  // without per-request nonces. Clerk loads its UI from its Frontend API and
  // uses Cloudflare Turnstile for bot protection; the Netlify Identity widget
  // powers the CMS invite/login flow. Dev additionally needs eval for HMR.
  `script-src ${sources("'self'", "'unsafe-inline'", isDev && "'unsafe-eval'", clerk, "https://challenges.cloudflare.com", "https://identity.netlify.com")}`,
  `connect-src ${sources("'self'", api, clerk, "https://clerk-telemetry.com", sentry, isDev && "ws:")}`,
  // Member photos come from the photo bucket's public domain, Clerk avatars
  // from img.clerk.com; images can't run code, so any https image is allowed.
  "img-src 'self' data: blob: https:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  `frame-src ${sources("'self'", "https://challenges.cloudflare.com", clerk)}`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  // Nobody may put the site (and the portal especially) inside a frame -
  // that's what stops clickjacking.
  "frame-ancestors 'none'",
  !isDev && "upgrade-insecure-requests",
]
  .filter(Boolean)
  .join("; ");

const cspHeader = process.env.CSP_REPORT_ONLY === "true" ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy";

const baseHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()" },
  // Lets Clerk's Google sign-in popup (if used) talk back to the page.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
];

const nextConfig: NextConfig = {
  reactCompiler: true,
  async headers() {
    return [
      {
        // Everything except the CMS at /admin.
        source: "/((?!admin).*)",
        headers: [
          ...baseHeaders,
          { key: "X-Frame-Options", value: "DENY" },
          { key: cspHeader, value: csp },
        ],
      },
      {
        // Decap CMS builds its whole UI at runtime from a pinned, SRI-checked
        // script (public/admin/index.html), so it gets a narrower policy:
        // no plugins, no <base> hijacking, and only framed by this site.
        source: "/admin/:path*",
        headers: [
          ...baseHeaders,
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: cspHeader, value: "object-src 'none'; base-uri 'self'; frame-ancestors 'self'" },
        ],
      },
      {
        source: "/admin",
        headers: [
          ...baseHeaders,
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: cspHeader, value: "object-src 'none'; base-uri 'self'; frame-ancestors 'self'" },
        ],
      },
    ];
  },
};

// withSentryConfig only does real work (uploading source maps, etc.) when
// SENTRY_AUTH_TOKEN is set - harmless to wrap even with no Sentry account yet.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  widenClientFileUpload: true,
});
