# Security Policy

## Reporting a vulnerability

If you find a security issue in this repository or in the live site/portal, please report it privately rather than opening a public GitHub issue.

Email: **tech@unitedpsa.org**

Include what you found, the steps to reproduce it, and its potential impact. We'll acknowledge reports within a few days and let you know once it's addressed.

Please don't test against the production site in ways that could affect other members' data or availability (e.g. automated scanning, load testing, attempting to access another member's account). Use a local development setup for anything beyond manual verification of a specific issue.

## How identity and auth work here

- **Clerk owns authentication.** The backend never sees or stores a password. Every API request carries a Clerk session token, which the backend verifies against Clerk's public signing keys (`backend/users/clerk_auth.py`) before mapping it to a local user.
- **Member email addresses are never stored** in this project's own database; they live only in Clerk.
- Admin/moderation actions (viewing reports, deactivating a profile) go through Django's own admin panel, which is separate from member-facing auth.

## Data handling

- **Resumes** are stored in a private Cloudflare R2 bucket with no public access. They're only ever served through the API after an ownership or explicit-sharing check (a member shares their resume with a specific connection; nobody else can fetch it).
- **Profile photos** are stored in a public R2 bucket, since they're meant to be visible to other members by design.
- Uploaded images are re-encoded server-side (not served as-uploaded) and checked against a maximum decoded pixel count, to guard against decompression-bomb-style files.

## Reporting and moderation

Listing yourself as a mentor/professional is self-serve (no admin pre-approval), since there's no reliable way to verify a claimed employer regardless of a review step. Moderation is reactive instead: any member can report another profile as fake or suspicious, and three distinct reports auto-flags it for an admin to review. See `docs/runbook.md` for the operational side of this.

## Dependencies

This project uses standard `npm audit` (frontend) and `pip` (backend) dependency management. Contributors opening a PR that adds a new dependency should have a clear reason for it; prefer the standard library or an existing dependency where reasonable.

## Scope

This policy covers the code in this repository and the production deployment it builds. It does not cover Clerk, Railway, Netlify, or Cloudflare's own infrastructure; report issues with those platforms directly to them.
