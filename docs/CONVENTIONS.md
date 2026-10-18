# Chorale La Porte d'Or — build conventions

This document is the contract every server route and web page follows. It is
also the reference for contributors.

## Stack

- **Server**: Node 24, Express 5, better-sqlite3, TypeScript (ESM, `.js` import extensions), zod validation.
- **Web**: React 19, TypeScript, Vite, Tailwind CSS v4, react-router v7, recharts, lucide-react.
- **Database**: SQLite at `server/data/chorale.db` (WAL). Relational schema in `server/src/db/schema.sql`.
- **Storage**: `server/data/storage/public` (served at `/media/...`) and `server/data/storage/private` (served through `GET /api/files/:id` with an authorization check).

## Server conventions

### Imports
Always use the `.js` extension for local ESM imports. Never use `require`.

```ts
import { Router } from "express"
import { z } from "zod"
import { one, all, run, transaction } from "../db/index.js"
import { recordAudit } from "../lib/audit.js"
import { badRequest, forbidden, notFound, conflict } from "../lib/errors.js"
import { parse, pagination, makePage, queryString, queryBool } from "../lib/http.js"
import { requireAuth, requirePermission, assertGroupAccess, permittedGroupIds } from "../middleware/auth.js"
import { can, canActOnMember, groupScope } from "../auth/access.js"
```

Helpers available:
- `one<T>(sql, ...params)`, `all<T>(sql, ...params)`, `run(sql, ...params)`, `transaction(fn)` from `../db/index.js`.
- `parse(zodSchema, req.body)` throws a 400 with `{ details: { fields } }`.
- `pagination(req)` -> `{ page, pageSize, limit, offset }`; `makePage(items, total, p)` -> `Page<T>`.
- `recordAudit({ actorId, actorName, action, entityType, entityId, summary, detail, ip })`.
- `id()` from `../lib/security.js`, `nowIso()`/`today()` from `../lib/time.js`.

### Response shapes
- Errors: `{ error: { code, message, details } }` (handled centrally — just `throw notFound(...)`).
- List: `{ items: T[], total, page, pageSize, pageCount }`.
- Single resource: `{ product: {...} }` keyed by the resource name (e.g. `{ song }`, `{ member }`, `{ event }`).
- Mutations return the created/updated resource or `{ ok: true }`.

### Authorization
- `requireAuth` on every private route.
- `requirePermission(key, scope?)` for fixed-scope checks.
- For resources in a group, resolve the group then `assertGroupAccess(user, key, groupId)`.
- For list queries, use `permittedGroupIds(user, key)` -> `"all" | string[]` and apply it to the SQL `WHERE`.
- Use `canActOnMember(user, key, member)` for single member records (honours `own`).
- Never trust IDs from the client for authorization; always look the record up and check.
- Sensitive junior fields (guardian, emergency contact) require `member.sensitive.read` for the junior group.

### Permission scopes
`global | senior | junior | members | own`. A `global` grant satisfies every scope. `own` only satisfies own-record checks.

### Roles
`chairman` (all global except `application.decide` — the founder and supreme administrator, who sees all three groups but leaves applications to each group's own administrator), `junior_admin` (junior-scoped records + shared music/goals/events/training/announcements), `members_admin` (members-scoped), `senior_singer`, `junior_singer`, `support_member` (own + shared read). Every signed-in member also has `messages.send`; only the Chairman has `messages.read`/`messages.reply`.

### Audit
Call `recordAudit` for every administrative mutation: approvals, group changes, account creation/deactivation, role changes, attendance changes, discipline changes, song changes, announcement creation, event changes, settings changes. Never log passwords, tokens or guardian/emergency data.

### Integrations
Secrets live in `integration_settings` and are encrypted with `encryptSecret`/`decryptSecret` from `../lib/secrets-box.js`. Never send secrets to the browser. Report `status: 'not_configured' | 'configured' | 'error'` honestly; never claim an integration works before it is configured. Use `refreshIntegrationStatuses()` after changing a value.

## Web conventions

- `src/api/client.ts` exposes a typed `api` object and hooks. Errors surface as `ApiError` with `fields` for form validation.
- Design tokens and Tailwind theme live in `src/styles.css` (`@theme`). Use the palette classes: `bg-charcoal`, `text-ivory`, `text-gold`, `border-gold/20`, etc.
- Shared components in `src/components/ui/*`: `Button`, `Card`, `Input`, `Select`, `Textarea`, `Badge`, `Table`, `Modal`, `Toast`, `EmptyState`, `Spinner`, `PageHeader`, `StatCard`, `Tabs`, `ProgressBar`, `Pagination`, `ConfirmDialog`, `ThemeToggle`.
- Layout: `src/components/layout/AppShell.tsx` (sidebar + topbar), `PublicLayout.tsx`.
- Auth: `src/auth/AuthProvider.tsx` exposes `useAuth()` -> `{ user, loading, login, logout, refresh, can(permission, scope?) }`. `RequireAuth` and `RequirePermission` guards wrap routes.
- Every list page: filters, pagination, loading state, empty state, error state.
- Every form: inline validation errors from `ApiError.fields`, disabled submit while saving, success toast.
- Never display invented statistics. Empty states say so.
- Accessibility: semantic elements, labels on inputs, visible focus, `prefers-reduced-motion` respected.

## API surface

Prefix every route with `/api`. Modules and their routers:

| Router | Mount | Purpose |
| --- | --- | --- |
| setup | `/api/setup` | first-run status + create first Chairman |
| auth | `/api/auth` | login, logout, me, password change/reset, invitations |
| public | `/api/public` | landing data: about, contact, gallery, public events, form URL, stats (counts only) |
| dashboard | `/api/dashboard` | role-appropriate dashboard payload |
| members | `/api/members` | member records, own profile, photos, meta |
| applications | `/api/applications` | intake list, review, decide, manual entry, webhook |
| users | `/api/users` | accounts: invite, activate, deactivate, roles |
| roles | `/api/roles` | roles + permissions catalogue, grants |
| songs | `/api/songs` | catalogue, videos, lyrics, audio, progress, assignments, taxonomy |
| discovery | `/api/discovery` | YouTube channel search/verify, video discovery, review queue |
| attendance | `/api/attendance` | sessions, records, summaries |
| discipline | `/api/discipline` | records, categories, history |
| goals | `/api/goals` | goals + progress |
| events | `/api/events` | events, participants, songs |
| training | `/api/training` | sessions, participants |
| announcements | `/api/announcements` | draft/schedule/publish, reads |
| notifications | `/api/notifications` | list, unread count, mark read |
| messages | `/api/messages` | message the Chairman, inbox, reply |
| reports | `/api/reports` | membership, attendance, discipline, music, goals, events/training |
| audit | `/api/audit` | append-only audit log |
| search | `/api/search` | permission-filtered global search |
| settings | `/api/settings` | app settings + integration status/configuration |
| uploads | `/api/uploads`, `/api/files` | public brand/gallery uploads + authorized private file streaming |

Detailed endpoints are documented per module in `docs/API.md`.
