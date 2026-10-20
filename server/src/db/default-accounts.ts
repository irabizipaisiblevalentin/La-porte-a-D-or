/**
 * The administrator sign-in accounts created by `npm run seed:admins`.
 *
 * Kept in a database-free module so it can be imported by unit tests without
 * opening a SQLite connection. See `seed-admins.ts` for the creation logic.
 *
 * These are the five real administrator accounts for the choir:
 *   - Chairman          (oversees all three groups; heads the founders section)
 *   - Senior Administrator       (scoped to the Senior group)
 *   - Junior Administrator        (scoped to the Junior group)
 *   - Members Administrator       (scoped to the Support Members group)
 *   - Events Coordinator          (runs the events programme across all groups)
 *
 * Every value can be overridden per-deployment with environment variables, so a
 * real launch never has to ship with the sample credentials below. See
 * `defaultAccounts()` and the `*_EMAIL` / `*_PASSWORD` / `*_NAME` keys.
 */

export interface DefaultAccount {
  /** "admin" accounts are plain users; "member" accounts also get a member record. */
  kind: "admin" | "member"
  roleKey: string
  groupId: string | null
  email: string
  displayName: string
  password: string
  /** Optional profile photo served by the web app (e.g. `/assets/avatars/chairman.png`). */
  avatarPath: string | null
}

/**
 * Baseline administrator accounts. Password placeholders satisfy the same strength
 * policy the API enforces (>=10 chars, upper + lower + digit, no predictable words).
 * Replace them via environment variables before a public launch.
 */
export const DEFAULT_ACCOUNTS: DefaultAccount[] = [
  {
    kind: "admin",
    roleKey: "chairman",
    groupId: null,
    email: "chairman@laportedor.local",
    displayName: "Chairman",
    password: "ChairmanLogin!2026",
    avatarPath: "/assets/avatars/chairman.png",
  },
  {
    kind: "admin",
    roleKey: "senior_leader",
    groupId: null,
    email: "senior.admin@laportedor.local",
    displayName: "Senior Administrator",
    password: "SeniorAdminLogin!2026",
    avatarPath: null,
  },
  {
    kind: "admin",
    roleKey: "junior_admin",
    groupId: null,
    email: "junior.admin@laportedor.local",
    displayName: "Junior Administrator",
    password: "JuniorAdminLogin!2026",
    avatarPath: "/assets/avatars/junior-admin.jpg",
  },
  {
    kind: "admin",
    roleKey: "members_admin",
    groupId: null,
    email: "members.admin@laportedor.local",
    displayName: "Members Administrator",
    password: "MembersAdminLogin!2026",
    avatarPath: "/assets/avatars/members-admin.jpg",
  },
  {
    kind: "admin",
    roleKey: "events_coordinator",
    groupId: null,
    email: "events.coordinator@laportedor.local",
    displayName: "Events Coordinator",
    password: "EventsCoordinatorLogin!2026",
    avatarPath: null,
  },
]

/** Environment variable prefix used to override each account's email/name/password. */
export const ACCOUNT_ENV_PREFIX: Record<string, string> = {
  chairman: "CHAIRMAN",
  senior_leader: "SENIOR_ADMIN",
  junior_admin: "JUNIOR_ADMIN",
  members_admin: "MEMBERS_ADMIN",
  events_coordinator: "EVENTS_COORDINATOR",
}

/**
 * Returns the default accounts with any per-deployment environment overrides applied.
 * Recognised variables (one set per role): `<PREFIX>_EMAIL`, `<PREFIX>_NAME`, `<PREFIX>_PASSWORD`.
 * Example: `CHAIRMAN_EMAIL=chair@example.org CHAIRMAN_PASSWORD='...'`.
 */
export function defaultAccounts(env: NodeJS.ProcessEnv = process.env): DefaultAccount[] {
  return DEFAULT_ACCOUNTS.map((account) => {
    const prefix = ACCOUNT_ENV_PREFIX[account.roleKey]
    if (!prefix) return { ...account }
    return {
      ...account,
      email: env[`${prefix}_EMAIL`]?.trim() || account.email,
      displayName: env[`${prefix}_NAME`]?.trim() || account.displayName,
      password: env[`${prefix}_PASSWORD`] || account.password,
    }
  })
}

/** The three official group ids a member account may belong to. */
export const OFFICIAL_GROUP_IDS = ["grp_senior", "grp_junior", "grp_members"]
