# Repository Structure

This document maps the codebase for anyone joining the project. For how the pieces fit together at a system level (Clerk, Netlify, Railway, R2), see the diagram in [README.md](README.md). For environment variables and deploy steps, see [docs/deployment.md](docs/deployment.md).

## Top level

```
src/            Next.js app (frontend) - public site + Mentor Portal
backend/        Django REST API (portal data and business rules)
content/        Editable site content (Decap CMS)
public/         Static assets, including public/admin/config.yml (CMS config)
docs/           Deployment, runbook, API reference, calendar setup
```

## Frontend - `src/`

```
src/app/                      Next.js App Router pages
  layout.tsx                  Root layout: Clerk provider, fonts, opening animation
  page.tsx, about/, team/,    Public site pages
  events/, meetups/, etc.
  sign-in/, sign-up/          Main-site auth entry points (Clerk)
  api/                        Route handlers (e.g. Google Calendar proxy)

  portal/                     The Mentor Portal, isolated under one route group
    layout.tsx                 Portal root layout (data provider, toasts, metadata)
    page.tsx                   Pre-auth landing page
    sign-in/, sign-up/         Portal-specific Clerk sign-in/up (branded)
    onboarding/                First-run profile setup
    (app)/                     Everything that requires a signed-in member
      layout.tsx                 Wraps PortalShell (sidebar, chat dock) around every page below
      dashboard/, discover/,     One folder per portal feature
      connections/, messages/,
      requests/, profile/,
      settings/, professionals/
    _components/                Shared portal UI (Avatar, PortalShell, ChatDock, ChatPopup, ...)
    _lib/                       PortalDataProvider.tsx (all API calls + client state),
                                 ChatWidgetProvider.tsx, api.ts, types.ts

src/components/                Shared components for the public site (Nav, Footer, etc.)
src/lib/                       Content loading (content/*.md), Google Calendar client
src/styles/                    One stylesheet per area; src/styles/portal.css is the
                                Mentor Portal's own stylesheet, separate from the public site's
src/middleware.ts              Clerk route protection - which paths require sign-in
```

**Why `portal/` is a route group of its own:** the Mentor Portal is a distinct product living on the same domain. It has its own layout, its own stylesheet, its own data provider, and its own auth pages, deliberately kept separate from the public marketing site's code so the two can evolve independently.

## Backend - `backend/`

```
backend/config/          Django project settings, URL root, WSGI/ASGI entry points
backend/users/           Clerk token verification only (no portal logic here)
  clerk_auth.py            Verifies a Clerk session token, maps it to a local Django user
backend/portal/          Everything the Mentor Portal actually does
  models.py                Profile, ConnectionRequest, Connection, Message, Resume, ProfileReport
  views.py                 API endpoints
  serializers.py            Request/response shapes
  storage.py                Cloudflare R2 (production) vs local disk (development)
  notifications.py          Email notifications for new activity
  throttles.py              Rate limiting
  signals.py                Model-change side effects
  admin.py                  Django admin configuration (moderation, member management)
  tests.py                  Backend test suite
```

**Why Clerk verification is split into its own `users` app:** `clerk_auth.py` only answers "who is this request from," with no knowledge of profiles, connections, or messages. Every other app's models and views assume a verified Django user already exists.

## Data flow in one sentence

A browser calls the Next.js frontend, which calls the Django backend with a Clerk session token attached; Django verifies that token against Clerk's public keys, maps it to a local user, and only then touches Postgres (profiles, connections, messages) or Cloudflare R2 (photos, resumes).

## Conventions worth knowing

- **No admin-approval gates.** Listing as a mentor/professional is self-serve (see `backend/portal/views.py`, `ProfileSerializer.update`); moderation is reactive via member reports, not pre-approval.
- **Lightweight polling, not WebSockets.** The frontend asks "has anything changed?" periodically (`SYNC_INTERVAL_MS` in `PortalDataProvider.tsx`) rather than holding an open connection. See `docs/runbook.md` for the reasoning.
- **Comments explain *why*, not *what*.** Code should be legible from naming and structure alone; a comment earns its place by capturing a non-obvious constraint or design decision, not by restating the line below it.
