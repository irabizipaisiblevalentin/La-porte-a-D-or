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
  /**
   * True when `password` came from the environment rather than the repository.
   *
   * This decides whether the account is forced to choose its own password at
   * first sign-in in production. A password published in the repository is not
   * secret, so an account created with it must change it; a password supplied by
   * the deployment is the operator's own choice and is trusted as-is. It matters
   * whenever the two happen to be equal, which is exactly the case when an
   * operator deliberately sets the environment to the same value as the code.
   */
  passwordFromEnv?: boolean
}

/**
 * Baseline administrator accounts.
 *
 * All five share one password by choice: the choir's administrators sign in from
 * a phone at a rehearsal, and one password they all know is worth more to them
 * than five they have to look up. The environment variables in
 * `RENDER-ENV.txt` set the same value on the live service.
 *
 * Because this value is published in the repository, an account created with it
 * in production is normally forced to choose its own at first sign-in. The live
 * deployment avoids that by supplying the password through
 * `<ROLE>_PASSWORD`, and environment passwords are trusted and never force a
 * change.
 */
export const DEFAULT_ACCOUNTS: DefaultAccount[] = [
  {
    kind: "admin",
    roleKey: "chairman",
    groupId: null,
    email: "chairman@laportedor.local",
    displayName: "Chairman",
    password: "Jeanluc22!",
    avatarPath: "/assets/avatars/chairman.png",
  },
  {
    kind: "admin",
    roleKey: "senior_leader",
    groupId: null,
    email: "senior.admin@laportedor.local",
    displayName: "Senior Administrator",
    password: "Jeanluc22!",
    avatarPath: null,
  },
  {
    kind: "admin",
    roleKey: "junior_admin",
    groupId: null,
    email: "junior.admin@laportedor.local",
    displayName: "Junior Administrator",
    password: "Jeanluc22!",
    avatarPath: "/assets/avatars/junior-admin.jpg",
  },
  {
    kind: "admin",
    roleKey: "members_admin",
    groupId: null,
    email: "members.admin@laportedor.local",
    displayName: "Members Administrator",
    password: "Jeanluc22!",
    avatarPath: "/assets/avatars/members-admin.jpg",
  },
  {
    kind: "admin",
    roleKey: "events_coordinator",
    groupId: null,
    email: "events.coordinator@laportedor.local",
    displayName: "Events Coordinator",
    password: "Jeanluc22!",
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
    const envPassword = env[`${prefix}_PASSWORD`]
    return {
      ...account,
      email: env[`${prefix}_EMAIL`]?.trim() || account.email,
      displayName: env[`${prefix}_NAME`]?.trim() || account.displayName,
      password: envPassword || account.password,
      passwordFromEnv: Boolean(envPassword),
    }
  })
}

/** The three official group ids a member account may belong to. */
export const OFFICIAL_GROUP_IDS = ["grp_senior", "grp_junior", "grp_members"]
