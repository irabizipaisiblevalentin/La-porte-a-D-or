export type PermissionScope = "global" | "senior" | "junior" | "members" | "own"

export interface PermissionDef {
  key: string
  name: string
  description: string
  /** Scopes this permission may be granted with. `own` means "only records that belong to the user". */
  scopes: PermissionScope[]
}

const GROUP_SCOPED: PermissionScope[] = ["global", "senior", "junior", "members", "own"]

export const PERMISSIONS: PermissionDef[] = [
  { key: "dashboard.view", name: "View dashboards", description: "Open the role-appropriate dashboard.", scopes: ["global"] },

  { key: "application.read", name: "View applications", description: "Read submitted membership applications.", scopes: ["senior", "junior", "members"] },
  { key: "application.review", name: "Review applications", description: "Add review notes and change application status.", scopes: ["senior", "junior", "members"] },
  { key: "application.decide", name: "Approve or reject applications", description: "Approve or reject applications and create member accounts.", scopes: ["senior", "junior", "members"] },

  { key: "member.read", name: "View member records", description: "Read member profiles in the permitted group.", scopes: GROUP_SCOPED },
  { key: "member.write", name: "Manage member records", description: "Create and edit member profiles in the permitted group.", scopes: GROUP_SCOPED },
  { key: "member.reset_password", name: "Reset member passwords", description: "Issue a fresh sign-in password for a member in the permitted group and hand it over. The old one stops working.", scopes: GROUP_SCOPED },
  { key: "member.sensitive.read", name: "View sensitive minor records", description: "Read guardian, emergency contact and detailed address data for juniors.", scopes: ["global", "junior"] },
  { key: "member.delete", name: "Remove member records", description: "Permanently remove a withdrawn member record and its sign-in from the register. Kept in the audit trail; the application history stays.", scopes: ["global"] },

  { key: "music.read", name: "View music library", description: "Browse the song catalogue and video metadata.", scopes: ["global"] },
  { key: "music.write", name: "Manage song catalogue", description: "Create and edit songs, videos, categories and assignments.", scopes: ["global"] },
  { key: "music.discovery", name: "Run YouTube discovery", description: "Verify the official channel and import discovered videos.", scopes: ["global"] },
  { key: "music.lyrics.write", name: "Manage lyrics", description: "Enter or edit authorised lyrics for songs.", scopes: ["global"] },
  { key: "music.audio.write", name: "Manage practice tracks", description: "Upload and manage authorised practice audio resources.", scopes: ["global"] },
  { key: "music.progress.write", name: "Record song progress", description: "Record learning-stage and progress history for songs.", scopes: ["global"] },

  { key: "attendance.read", name: "View attendance", description: "Read attendance sessions and records.", scopes: GROUP_SCOPED },
  { key: "attendance.write", name: "Manage attendance", description: "Create sessions and record attendance.", scopes: ["global", "senior", "junior", "members"] },

  { key: "discipline.read", name: "View discipline records", description: "Read discipline and recognition records.", scopes: ["global", "senior", "junior", "own"] },
  { key: "discipline.write", name: "Manage discipline records", description: "Create and update discipline records.", scopes: ["global", "senior", "junior"] },
  { key: "recognition.write", name: "Manage positive recognition", description: "Record positive recognition for members.", scopes: ["global", "senior", "junior"] },

  { key: "goals.read", name: "View goals", description: "View choir goals and progress history.", scopes: ["global"] },
  { key: "goals.write", name: "Manage goals", description: "Create goals and record progress.", scopes: ["global"] },

  { key: "events.read", name: "View events", description: "View the events addressed to your group. An event is only visible to the groups it is meant for.", scopes: ["global", "senior", "junior", "members"] },
  { key: "events.write", name: "Manage events", description: "Create and edit your group's events and participants. Who an event is for, and whether it costs money, is the Events Coordinator's call.", scopes: ["global", "senior", "junior", "members"] },
  { key: "events.manage", name: "Run the events programme", description: "Own the events module: set who each event is for, whether it needs a contribution, the amount, and publish it to the public site.", scopes: ["global"] },
  { key: "events.payment.approve", name: "Confirm event contributions", description: "Confirm that a participant has paid their contribution for an event, and issue their entrance pass.", scopes: ["global"] },
  { key: "events.checkin", name: "Check people in at an event door", description: "Scan or type an entrance passcode and record who has arrived.", scopes: ["global"] },

  { key: "training.read", name: "View training", description: "View training sessions and participant history.", scopes: ["global"] },
  { key: "training.write", name: "Manage training", description: "Create and edit training sessions and participants.", scopes: ["global"] },

  { key: "announcements.read", name: "View announcements", description: "Read announcements addressed to you.", scopes: ["global"] },
  { key: "announcements.write", name: "Manage announcements", description: "Create, schedule and publish announcements.", scopes: ["global"] },

  { key: "notifications.read", name: "View notifications", description: "Read personal notifications.", scopes: ["global"] },

  { key: "messages.send", name: "Message the Chairman", description: "Send a private message to the Chairman of the choir.", scopes: ["own"] },
  { key: "messages.read", name: "Read Chairman inbox", description: "Read the private messages members have sent to the Chairman.", scopes: ["global"] },
  { key: "messages.reply", name: "Reply as the Chairman", description: "Reply to members' private messages on behalf of the Chairman.", scopes: ["global"] },

  { key: "reports.read", name: "View reports", description: "Access the reporting centre.", scopes: ["global", "senior", "junior", "members"] },
  { key: "audit.read", name: "View audit log", description: "Read the append-only audit history.", scopes: ["global"] },

  { key: "settings.read", name: "View system settings", description: "View configuration and integration status.", scopes: ["global"] },
  { key: "settings.write", name: "Manage system settings", description: "Change configuration, policies and integration credentials.", scopes: ["global"] },
  { key: "roles.manage", name: "Manage roles", description: "Assign and revoke administrator roles and permissions.", scopes: ["global"] },
  { key: "users.manage", name: "Manage accounts", description: "Create, invite, activate and deactivate user accounts.", scopes: ["global"] },
  { key: "search.global", name: "Global search", description: "Search records visible to your permissions.", scopes: ["global"] },
]

export const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key)

export function permissionId(key: string): string {
  return `perm_${key.replace(/\./g, "_")}`
}

export interface RoleDef {
  key: string
  name: string
  description: string
  grants: { key: string; scope: PermissionScope }[]
}

const g = (key: string, scope: PermissionScope) => ({ key, scope })

export const ROLES: RoleDef[] = [
  {
    key: "chairman",
    name: "Chairman",
    description: "Chairman of the choir — founder and supreme overseer. Sees every group's applications, members and day-to-day operations, but does not approve or reject applications: each group is led by its own administrator, who decides that group's requests. Also heads the founders of the choir. Every important action is audited.",
    // Deliberately everything EXCEPT application.decide: the Chairman oversees
    // every group, but only a group's own administrator approves its applicants.
    grants: PERMISSIONS
      .filter((p) => p.key !== "application.decide")
      .map((p) => g(p.key, "global")),
  },
  {
    key: "senior_leader",
    name: "Senior Leader",
    description: "Leads the Senior group: Senior applications, members, attendance, discipline, progress and approved shared choir resources.",
    grants: [
      g("dashboard.view", "global"),
      g("application.read", "senior"), g("application.review", "senior"), g("application.decide", "senior"),
      g("member.read", "senior"), g("member.write", "senior"), g("member.reset_password", "senior"),
      g("music.read", "global"), g("music.write", "global"), g("music.discovery", "global"),
      g("music.lyrics.write", "global"), g("music.audio.write", "global"), g("music.progress.write", "global"),
      g("attendance.read", "senior"), g("attendance.write", "senior"),
      g("discipline.read", "senior"), g("discipline.write", "senior"), g("recognition.write", "senior"),
      g("goals.read", "global"), g("goals.write", "global"),
      g("events.read", "senior"), g("events.write", "senior"),
      g("training.read", "global"), g("training.write", "global"),
      g("announcements.read", "global"), g("announcements.write", "global"),
      g("notifications.read", "global"),
      g("messages.send", "own"),
      g("reports.read", "senior"),
      g("search.global", "global"),
    ],
  },
  {
    key: "junior_admin",
    name: "Junior Administrator",
    description: "Manages Junior applications, members, attendance, discipline, progress and approved shared choir resources.",
    grants: [
      g("dashboard.view", "global"),
      g("application.read", "junior"), g("application.review", "junior"), g("application.decide", "junior"),
      g("member.read", "junior"), g("member.write", "junior"), g("member.reset_password", "junior"), g("member.sensitive.read", "junior"),
      g("music.read", "global"), g("music.write", "global"), g("music.discovery", "global"),
      g("music.lyrics.write", "global"), g("music.audio.write", "global"), g("music.progress.write", "global"),
      g("attendance.read", "junior"), g("attendance.write", "junior"),
      g("discipline.read", "junior"), g("discipline.write", "junior"), g("recognition.write", "junior"),
      g("goals.read", "global"), g("goals.write", "global"),
      g("events.read", "junior"), g("events.write", "junior"),
      g("training.read", "global"), g("training.write", "global"),
      g("announcements.read", "global"), g("announcements.write", "global"),
      g("notifications.read", "global"),
      g("messages.send", "own"),
      g("reports.read", "junior"),
      g("search.global", "global"),
    ],
  },
  {
    key: "members_admin",
    name: "Members Administrator",
    description: "Manages Support Member applications, profiles, responsibilities, attendance, training, events and reports.",
    grants: [
      g("dashboard.view", "global"),
      g("application.read", "members"), g("application.review", "members"), g("application.decide", "members"),
      g("member.read", "members"), g("member.write", "members"), g("member.reset_password", "members"),
      g("music.read", "global"),
      g("attendance.read", "members"), g("attendance.write", "members"),
      g("goals.read", "global"),
      g("events.read", "members"), g("events.write", "members"),
      g("training.read", "global"), g("training.write", "global"),
      g("announcements.read", "global"), g("announcements.write", "global"),
      g("notifications.read", "global"),
      g("messages.send", "own"),
      g("reports.read", "members"),
      g("search.global", "global"),
    ],
  },
  {
    key: "events_coordinator",
    name: "Events Coordinator",
    description: "Runs the choir's events programme across all groups. Decides who each event is for, whether it needs a contribution and how much, confirms who has paid, issues entrance passes and checks people in at the door. Does not manage members or applications: each group still looks after its own.",
    grants: [
      g("dashboard.view", "global"),
      // Events are the whole job — including the parts group administrators do
      // not touch: the audience, the contribution and the door.
      g("events.read", "global"), g("events.write", "global"), g("events.manage", "global"),
      g("events.payment.approve", "global"), g("events.checkin", "global"),
      // Enough of the register to pick participants and see who is in which
      // group — but read-only, and no applications or sensitive minor records.
      g("member.read", "global"),
      g("music.read", "global"),
      g("announcements.read", "global"), g("announcements.write", "global"),
      g("notifications.read", "global"),
      g("messages.send", "own"),
      g("reports.read", "global"),
      g("search.global", "global"),
    ],
  },
  {
    key: "senior_singer",
    name: "Senior Singer",
    description: "Ordinary Senior chorister. Own profile, own attendance, own progress and shared choir information.",
    grants: [
      g("dashboard.view", "global"),
      g("member.read", "own"), g("member.write", "own"),
      g("music.read", "global"),
      g("attendance.read", "own"),
      g("discipline.read", "own"),
      g("goals.read", "global"),
      g("events.read", "global"),
      g("training.read", "global"),
      g("announcements.read", "global"),
      g("notifications.read", "global"),
      g("messages.send", "own"),
      g("search.global", "global"),
    ],
  },
  {
    key: "junior_singer",
    name: "Junior Singer",
    description: "Young chorister still in school. Own profile, attendance, discipline, progress, junior events and announcements.",
    grants: [
      g("dashboard.view", "global"),
      g("member.read", "own"), g("member.write", "own"),
      g("music.read", "global"),
      g("attendance.read", "own"),
      g("discipline.read", "own"),
      g("goals.read", "global"),
      g("events.read", "global"),
      g("training.read", "global"),
      g("announcements.read", "global"),
      g("notifications.read", "global"),
      g("messages.send", "own"),
      g("search.global", "global"),
    ],
  },
  {
    key: "support_member",
    name: "Support Member",
    description: "Supports the choir without singing: media, sound, IT, finance, transport, events and related duties.",
    grants: [
      g("dashboard.view", "global"),
      g("member.read", "own"), g("member.write", "own"),
      g("attendance.read", "own"),
      g("discipline.read", "own"),
      g("goals.read", "global"),
      g("events.read", "global"),
      g("training.read", "global"),
      g("announcements.read", "global"),
      g("notifications.read", "global"),
      g("messages.send", "own"),
      g("search.global", "global"),
    ],
  },
]

export const ROLE_KEYS = ROLES.map((r) => r.key)

export const ADMIN_ROLE_KEYS = ["chairman", "senior_leader", "junior_admin", "members_admin", "events_coordinator"]

/** Roles a Chairman may grant (self-service beyond this is not allowed). */
export const ASSIGNABLE_ROLE_KEYS = ROLE_KEYS
