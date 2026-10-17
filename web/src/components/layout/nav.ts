import {
  BadgeCheck,
  Bell,
  CalendarDays,
  ClipboardCheck,
  Compass,
  FileText,
  GraduationCap,
  LayoutDashboard,
  Library,
  ListChecks,
  Mail,
  Megaphone,
  Search,
  Settings,
  ShieldAlert,
  Target,
  UserCog,
  UserRound,
  Users,
  Wallet,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { PermissionScope } from "../../auth/AuthProvider"

export interface NavItem {
  label: string
  to: string
  icon: LucideIcon
  permission?: string
  scope?: PermissionScope
  adminOnly?: boolean
}

export interface NavSection {
  title: string
  items: NavItem[]
}

export const NAV_SECTIONS: NavSection[] = [
  {
    title: "Overview",
    items: [
      { label: "Dashboard", to: "/app", icon: LayoutDashboard, permission: "dashboard.view" },
      { label: "My Account", to: "/app/account", icon: UserCog },
    ],
  },
  {
    title: "Membership",
    items: [
      { label: "Applications", to: "/app/applications", icon: FileText, permission: "application.read" },
      { label: "Members", to: "/app/members", icon: Users, permission: "member.read" },
      { label: "My Profile", to: "/app/profile", icon: UserRound },
    ],
  },
  {
    title: "Music",
    items: [
      { label: "Music Library", to: "/app/music", icon: Library, permission: "music.read" },
      { label: "Discovery", to: "/app/discovery", icon: Compass, permission: "music.discovery" },
    ],
  },
  {
    title: "Operations",
    items: [
      { label: "Attendance", to: "/app/attendance", icon: ClipboardCheck, permission: "attendance.read" },
      { label: "Discipline", to: "/app/discipline", icon: ShieldAlert, permission: "discipline.read" },
      { label: "Goals", to: "/app/goals", icon: Target, permission: "goals.read" },
      { label: "Events", to: "/app/events", icon: CalendarDays, permission: "events.read" },
      { label: "Training", to: "/app/training", icon: GraduationCap, permission: "training.read" },
    ],
  },
  {
    title: "Communication",
    items: [
      { label: "Messages", to: "/app/messages", icon: Mail, permission: "messages.send" },
      { label: "Announcements", to: "/app/announcements", icon: Megaphone, permission: "announcements.read" },
      { label: "Notifications", to: "/app/notifications", icon: Bell, permission: "notifications.read" },
    ],
  },
  {
    title: "Administration",
    items: [
      { label: "Reports", to: "/app/reports", icon: ListChecks, permission: "reports.read" },
      { label: "Search", to: "/app/search", icon: Search, permission: "search.global" },
      { label: "Audit Log", to: "/app/audit", icon: BadgeCheck, permission: "audit.read" },
      { label: "Accounts", to: "/app/admin/accounts", icon: Wallet, permission: "users.manage" },
      { label: "Settings", to: "/app/settings", icon: Settings, permission: "settings.read" },
    ],
  },
]
