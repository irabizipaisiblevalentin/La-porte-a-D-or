# API reference

All endpoints are prefixed with `/api`. Authentication uses an httpOnly session cookie.
Errors: `{ error: { code, message, details } }`. Lists: `{ items, total, page, pageSize, pageCount }`.

`[auth]` = requires a session. `[perm: key/scopes]` = requires the permission at those scopes.
`[own]` = own-record access is accepted via `canActOnMember`.

## Setup
- `GET /setup/status` -> `{ needsSetup, setupTokenFile, appName }`
- `POST /setup` `{ token, fullName, email, password }` -> `{ user }` (only when `needsSetup`)

## Auth
- `POST /auth/login` `{ email, password }` -> `{ user }`
- `POST /auth/logout` -> `{ ok }`
- `GET /auth/me` -> `{ user | null }`
- `POST /auth/password` `{ currentPassword, newPassword }` -> `{ ok }`. This is also the way out of a temporary password: while `mustChangePassword` is set, every other authenticated route answers 403, and the whole `/auth` router stays open (change, reset, invitation, logout).
- `POST /auth/password/request` `{ email }` -> `{ ok, message, emailDeliveryConfigured }`
- `POST /auth/password/reset` `{ token, password }` -> `{ ok }`
- `GET /auth/invitation/:token` -> `{ invitation: { email, fullName } }`
- `POST /auth/invitation/:token` `{ password }` -> `{ user }`

## Public (no auth)
- `GET /health` -> `{ status, app, time }`. When the last boot could not restore the database from durable storage, `warning: "database_restore_failed"` and `restoreAlert: { reason: "restore_failed" | "replication_disabled" | "litestream_unavailable", at, detail }` are added; the web app shows a red banner for group administrators and the Chairman (see `docs/DEPLOYMENT.md`, Troubleshooting).
- `GET /public/landing` -> `{ about, contact: { email, phone }, applicationFormUrl, logoUrl, heroImageUrl, galleryUrls: string[], upcomingEvents: [...], featuredSongs: [...], counts: { senior, junior, members, total } }`. Each `featuredSongs` entry carries `youtubeVideoId` (the best **approved** video) and `thumbnailUrl`, so a visitor's click can start playback on the site; only approved videos are ever exposed here.
- `GET /public/health` (alias of `/health`)

## Dashboard
- `GET /dashboard` `[auth]` -> a role-appropriate payload. Shape:
  ```
  {
    role: "chairman" | "junior_admin" | "members_admin" | "member",
    viewer: { displayName, memberNo, groupKey },
    stats: [{ key, label, value, hint }],
    attendance?: { sessions, present, late, absent, excused, rate },
    goalProgress?: [{ id, name, target, unit, current, percent, deadline, status }],
    upcomingEvents?: Event[],
    recentAnnouncements?: Announcement[],
    recentSongs?: Song[],
    recentAudit?: AuditEntry[],
    myAttendance?: { sessions, present, rate },
    myProgress?: { songsLearning, trainingsCompleted, eventsAttended },
    disciplineAlerts?: number,
    training?: { upcoming, completed }
    chairman:? 0736894204"'
  }
  ```
  Only include sections the viewer's permissions allow. Never hardcode numbers.

## Members
- `GET /members/meta` -> `{ groups, voiceSections }`
- `GET /members` `[perm: member.read/*]` query `groupId,status,voiceSectionId,search,page,pageSize`
- `POST /members` `[perm: member.write/{group}]`
- `GET /members/me` `[own]`
- `PATCH /members/me` `[perm: member.write/own]` `{ contact?, senior?, junior?, support? }`
- `GET /members/:id` `[perm: member.read/{group}|own]` — includes `member.sign_in_password` only when the caller may write that member (their group's administrator, or the member themselves)
- `PATCH /members/:id` `[perm: member.write/{group}]`
- `DELETE /members/:id` `[perm: member.delete/global]` — Chairman only. Removes a **withdrawn** member, the account approval created and its photograph. The application is kept (its member link is cleared) and the removal is audited. An active member is refused: withdraw first.
- `POST /members/:id/send-credentials` `[perm: member.write/{group}|own]` — re-emails the member their sign-in name and password; returns `{ delivery: { sent, to, reason } }` where `reason` is `sent`, `no_email`, `not_configured` or `send_failed`
- `POST /members/:id/reset-password` `[perm: member.reset_password/{group}]` — generates a fresh password and returns `{ credentials: { username, password }, delivery }`. The old password stops working, pending reset links are voided and the member's signed-in sessions are closed; they choose their own password at the next sign-in.
- `POST /members/:id/photo` `[perm: member.write/{group}|own]` multipart `file`

## Applications
- `GET /applications` `[perm: application.read/{group}]` query `status,groupId,search,page`
- `GET /applications/:id` `[perm: application.read/{group}]`
- `POST /applications` `[perm: application.review/{group}]` manual entry `{ fullName, email, phone?, groupId, answers? }`
- `PATCH /applications/:id` `[perm: application.review/{group}]` `{ status?, assignedGroupId?, note? }` (records a review row)
- `POST /applications/:id/decision` `[perm: application.decide/{group}]` `{ decision: "approve"|"reject", note?, assignedGroupId? }`
  - approve -> creates exactly one member + sign-in account and returns `{ member, user, credentials: { username, password }, delivery }`; the generated username comes from the full name and both the username and password remain readable on the member record; `delivery` reports the automatic email (`sent` / `no_email` / `not_configured` / `send_failed`). The applicant's date of birth, gender, voice section, address (region/city/address) and group-specific answers (occupation, class, emergency contact, skills, …) are copied onto the member record from the application answers
  - reject -> preserves application, sets status rejected
- `POST /applications/:id/documents` `[perm: application.review/{group}]` multipart `file`
- `POST /applications/webhook` (integration; when `google_webhook_secret` is set, sign with `x-chorale-signature: <hex HMAC-SHA256 of the raw body>`, or the raw secret) — idempotent on `externalId`; infers name/email/phone/group from the answers and notifies the Chairman + that group's admin

## Users & roles
- `GET /users` `[perm: users.manage]` query `status,role,search,page`
- `POST /users/invite` `[perm: users.manage]` `{ email, displayName, roles: string[], memberId? }` -> `{ user, invitation: { url } }`
- `POST /users/:id/roles` `[perm: roles.manage]` `{ roles: string[] }`
- `POST /users/:id/deactivate` `[perm: users.manage]`
- `POST /users/:id/activate` `[perm: users.manage]`
- `POST /users/:id/reset` `[perm: users.manage]` -> `{ resetUrl }` (surfaced to admin because email may be unconfigured)
- `GET /roles` `[auth]` -> `{ roles: [{ key, name, description, grants: [{ key, scope }] }], permissions: [{ key, name, description, scopes }] }`

## Songs / music library
- `GET /songs/taxonomy` -> `{ categories, stages, groups }`
- `GET /songs` `[perm: music.read]` query `search,categoryId,stageId,groupId,status,page` — every row also
  carries `primary_video_id`, `thumbnail_url` and `video_count` (the best **approved** video: primary
  first, then newest), so the list can start playback on click without a request per row. A song with
  no approved video reports `null` rather than pointing at something that cannot play.
- `POST /songs` `[perm: music.write]`
- `GET /songs/:id` `[perm: music.read]` -> `{ song, videos, lyrics, audio, progress, assignments, events }`
- `PATCH /songs/:id` `[perm: music.write]`
- `DELETE /songs/:id` `[perm: music.write]` (archive unless `?hard=true` and no references)
- `POST /songs/:id/lyrics` `[perm: music.lyrics.write]`
- `PATCH /songs/:id/lyrics/:lyricId` / `DELETE`
- `POST /songs/:id/audio` `[perm: music.audio.write]` multipart `file` + `label,trackType,rightsNote`
- `DELETE /songs/:id/audio/:audioId`
- `POST /songs/:id/progress` `[perm: music.progress.write]` `{ stageId, groupId?, progressPercent?, notes? }`
- `POST /songs/:id/groups` `[perm: music.write]` `{ groupIds: string[] }`
- `POST /songs/:id/videos/:videoId/link` `[perm: music.write]` (attach an approved video)

## Discovery (YouTube)
- `GET /discovery/status` `[perm: music.discovery]` -> `{ apiConfigured, channel: { id, title, verifiedAt } | null, lastRun }`
- `GET /discovery/channels?q=` `[perm: music.discovery]` -> `{ configured, candidates: [{ id, title, description, customUrl, thumbnail }] }` (returns `configured:false` and empty list when no API key — never fabricated)
- `POST /discovery/verify-channel` `[perm: music.discovery]` `{ channelId, title }` -> `{ channel }`
- `POST /discovery/run` `[perm: music.discovery]` `{ maxResults?, includePlaylists? }` -> integration run summary; inserts candidate videos with `status='discovered'`
- `GET /discovery/queue` `[perm: music.discovery]` query `status,category,search,page`
- `POST /discovery/import` `[perm: music.discovery]` `{ youtubeUrl | videoId, title?, songId?, category? }` manual import (works without API key)
- `PATCH /discovery/videos/:id` `[perm: music.write]` `{ status?, songId?, isPrimary?, notes?, category? }`
- `POST /discovery/videos/:id/reject` `[perm: music.write]`

## Attendance
- `GET /attendance/activity-types` -> `{ activityTypes }`
- `GET /attendance/sessions` `[perm: attendance.read/{group}]` query `activityType,groupId,from,to,page`
- `POST /attendance/sessions` `[perm: attendance.write/{group}]`
- `GET /attendance/sessions/:id` `[perm: attendance.read/{group}]` -> `{ session, participants: [{ memberId, fullName, memberNo, status, notes }] }`
- `PATCH /attendance/sessions/:id` `[perm: attendance.write/{group}]`
- `DELETE /attendance/sessions/:id` `[perm: attendance.write/{group}]`
- `PUT /attendance/sessions/:id/records` `[perm: attendance.write/{group}]` `{ records: [{ memberId, status, notes? }] }` (upsert; audited)
- `GET /attendance/summary` `[perm: attendance.read/{group}]` query `groupId,from,to,memberId` -> rates using the configured policy

## Discipline
- `GET /discipline/categories` -> `{ categories: [{ id, label, kind }] }`
- `GET /discipline` `[perm: discipline.read/{group}|own]` query `memberId,groupId,kind,status,from,to,page`
- `POST /discipline` `[perm: discipline.write/{group}]`
- `PATCH /discipline/:id` `[perm: discipline.write/{group}]` (writes `discipline_history`)
- `GET /discipline/member/:memberId` `[perm: discipline.read/{group}|own]`

## Goals
- `GET /goals` `[perm: goals.read]` query `groupId,status,period,page`
- `POST /goals` `[perm: goals.write]`
- `PATCH /goals/:id` `[perm: goals.write]`
- `POST /goals/:id/progress` `[perm: goals.write]` `{ periodDate, value, notes? }`

## Events
- `GET /events` `[perm: events.read]` query `type,groupId,from,to,status,page`
- `POST /events` `[perm: events.write]`
- `GET /events/:id` -> `{ event, participants, songs }`
- `PATCH /events/:id` `[perm: events.write]`
- `PUT /events/:id/participants` `[perm: events.write]` `{ memberIds: string[] }`

## Training
- `GET /training` `[perm: training.read]` query `groupId,status,from,to,page`
- `POST /training` `[perm: training.write]`
- `GET /training/:id` -> `{ training, participants }`
- `PATCH /training/:id` `[perm: training.write]`
- `PUT /training/:id/participants` `[perm: training.write]` `{ participants: [{ memberId, attendance, completed }] }`

## Announcements
- `GET /announcements` `[perm: announcements.read]` query `audience,priority,status,page` (non-admins see only published announcements addressed to them)
- `POST /announcements` `[perm: announcements.write]` `{ title, message, audience, priority, scheduledAt?, recipientIds? }`
- `GET /announcements/:id`
- `PATCH /announcements/:id` `[perm: announcements.write]`
- `POST /announcements/:id/publish` `[perm: announcements.write]`
- `POST /announcements/:id/read` -> `{ ok }`
- `GET /announcements/templates` -> starter templates (vacation, rehearsal reminder, event notice, new song, training, goal update)

## Notifications
- `GET /notifications` `[auth]` query `unread,page`
- `GET /notifications/unread-count` -> `{ count }`
- `POST /notifications/:id/read`
- `POST /notifications/read-all`

### Device notifications (Web Push)
A notification row is only seen by somebody already looking at the site. These endpoints put the same
message on a phone or laptop — delivered by the browser's own push service while the platform is
closed — so the group's administrator hears about a new application without having the site open.
- `GET /push/config` `[auth]` -> `{ enabled, publicKey, deviceCount, devices: [{ id, userAgent, createdAt, lastSuccessAt, lastFailureAt, failureReason }] }` — the **public** VAPID key the browser subscribes with; the private half never leaves the server.
- `POST /push/subscribe` `[auth]` `{ endpoint, keys: { p256dh, auth } }` -> `{ ok, deviceCount }` — one row per device. Subscribing again on the same device re-points it to the account now signed in, so a shared phone does not keep notifying the previous user.
- `POST /push/unsubscribe` `[auth]` `{ endpoint }` -> `{ ok, deviceCount }`
- `POST /push/test` `[auth]` -> `{ ok, sent, failed, removed }` — a test notification to the caller's own devices.

Subscriptions the push service reports as `404`/`410` are deleted (the browser threw them away); any
other failure is recorded on the device (`lastFailureAt`, `failureReason`) so a phone that has gone
quiet is visible on the account page. Delivery runs in the background and never delays the request
that caused it — a new application is filed even if every push fails.

## Messages (talk to the Chairman)
Any signed-in member may message the Chairman (`messages.send`). Only the Chairman may read the
inbox or reply (`messages.read` / `messages.reply`).
- `POST /messages` `[perm: messages.send]` body `{ subject?, body }` -> the created message
- `GET /messages` `[auth]` query `box=inbox|sent,unread,page` — Chairman sees the inbox, everyone else
  sees the messages they have sent (with any reply). Non-Chairmen requesting `box=inbox` get `403`.
- `GET /messages/unread-count` -> `{ count }` (0 for non-Chairmen)
- `POST /messages/:id/read` `[perm: messages.read]` — mark a received message read
- `POST /messages/:id/reply` `[perm: messages.reply]` body `{ body }` — reply as the Chairman

## Reports
All `[perm: reports.read/{scope}]`; every number comes from the database.
- `GET /reports/membership` -> counts by group, status, new admissions by month
- `GET /reports/attendance` query `groupId,from,to`
- `GET /reports/discipline` query `groupId,from,to`
- `GET /reports/music` -> catalogue, by stage, ready for performance, performances
- `GET /reports/goals` -> annual, monthly progress, completed, remaining, overdue
- `GET /reports/events` -> events held, participants, training completed, performance history
- `GET /reports/me` -> the viewer's own attendance/progress

## Audit
- `GET /audit` `[perm: audit.read]` query `entityType,action,actorId,from,to,page`
- `GET /audit/entity/:type/:id` `[perm: audit.read]`

## Search
- `GET /search?q=` `[perm: search.global]` -> `{ results: [{ type, id, title, subtitle, link }] }` filtered by the caller's permissions and group scopes. Junior Admin must never receive senior or support-member private records.

## Settings
- `GET /settings` `[perm: settings.read]` -> `{ settings: [{ key, label, description, value }], integrations: [{ key, label, hint, isSecret, status, valuePlain, updatedAt }] }`
- `PATCH /settings` `[perm: settings.write]` `{ settings: { key: value } }`
- `PATCH /settings/integrations` `[perm: settings.write]` `{ values: { key: value | null } }` (secrets encrypted server-side). E-mail can be delivered either through SMTP (`smtp_host` + `smtp_from`, optional `smtp_port`/`smtp_user`/`smtp_password`) or through an Apps Script mail web app (`mail_webhook_url`, signed with `google_webhook_secret`); either one makes `emailDeliveryConfigured` true, and every attempt is recorded in `integration_runs` under `smtp` or `apps_script_mail`.

## Uploads / files
- `POST /uploads/brand/logo` `[perm: settings.write]` multipart `file`
- `POST /uploads/gallery` `[perm: settings.write]` multipart `file`
- `GET /uploads` `[perm: settings.read]` query `entityType`
- `DELETE /uploads/:id` `[perm: settings.write]` — deletes the local file **and** the mirrored object
- `GET /files/:id` `[auth]` -> streams a private file after an authorization check
- `GET /media/...` — public uploads. Served from local disk; when the disk has been wiped
  (Render restart / idle spin-down) the file is streamed back out of the object bucket and
  re-cached. Paths with no `file_uploads` record are never fetched, and `..` is refused.
