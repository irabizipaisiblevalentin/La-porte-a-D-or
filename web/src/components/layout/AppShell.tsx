import { useEffect, useRef, useState, type ReactNode } from "react"
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom"
import { Bell, BellRing, Home, LogOut, Menu, Search, Settings, UserRound, X } from "lucide-react"
import { useAuth } from "../../auth/AuthProvider"
import { useQuery } from "../../api/hooks"
import { Avatar, Badge, Spinner, ThemeToggle } from "../../components/ui"
import { useDesktopNotifications } from "./useDesktopNotifications"
import { usePushNotifications, type PushNotificationsState } from "./usePushNotifications"
import { NotificationPrompt } from "./NotificationPrompt"
import { RestoreAlertBanner } from "./RestoreAlertBanner"
import { NAV_SECTIONS } from "./nav"

function useUnreadCount(): number {
  const { data, reload } = useQuery<{ count: number }>("/notifications/unread-count")
  useEffect(() => {
    const timer = window.setInterval(reload, 60_000)
    return () => window.clearInterval(timer)
  }, [reload])
  return data?.count ?? 0
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link to="/app" className="flex items-center gap-2.5">
      <img src="/logo.png" alt="Chorale La Porte d'Or" className="h-9 w-9 object-contain" />
      {!compact ? (
        <span className="leading-tight">
          <span className="block font-display text-base font-semibold">La Porte d'Or</span>
          <span className="muted block text-[10px] uppercase tracking-[0.18em]">Chorale</span>
        </span>
      ) : null}
    </Link>
  )
}

/** Unread member-message count (0 for everyone except the Chairman). */
function useMessagesUnread(): number {
  const { data, reload } = useQuery<{ count: number }>("/messages/unread-count")
  useEffect(() => {
    const timer = window.setInterval(reload, 60_000)
    return () => window.clearInterval(timer)
  }, [reload])
  return data?.count ?? 0
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { can } = useAuth()
  const unreadMessages = useMessagesUnread()
  return (
    <nav className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 py-4" aria-label="Main navigation">
      {/* The choir's public front page, kept first and always available: signing
          in should not make the landing page unreachable. */}
      <div className="flex flex-col gap-1">
        <a href="/" className="sidebar-link" onClick={onNavigate}>
          <Home size={16} />
          <span>Choir home page</span>
        </a>
      </div>

      {NAV_SECTIONS.map((section) => {
        const items = section.items.filter((item) => !item.permission || (item.permission === "member.read" ? can("member.read") : can(item.permission, item.scope)))
        if (items.length === 0) return null
        return (
          <div key={section.title} className="flex flex-col gap-1">
            <p className="px-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-gold-600 dark:text-gold-300/80">
              {section.title}
            </p>
            {items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/app"}
                className="sidebar-link"
                onClick={onNavigate}
              >
                <item.icon size={16} />
                <span>{item.label}</span>
                {item.to === "/app/messages" && unreadMessages > 0 ? (
                  <span
                    className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold"
                    style={{ background: "var(--color-gold-400)", color: "#221a06" }}
                    aria-label={`${unreadMessages} unread`}
                  >
                    {unreadMessages > 99 ? "99+" : unreadMessages}
                  </span>
                ) : null}
              </NavLink>
            ))}
          </div>
        )
      })}
    </nav>
  )
}

function NotificationBell() {
  const count = useUnreadCount()
  return (
    <Link to="/app/notifications" className="btn btn-ghost btn-sm relative" aria-label={`Notifications${count ? `, ${count} unread` : ""}`}>
      <Bell size={17} />
      {count > 0 ? (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold" style={{ background: "var(--color-gold-400)", color: "#221a06" }}>
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </Link>
  )
}

/**
 * Header shortcut that puts notifications on the device being used. It disappears
 * as soon as this device is registered, so it asks once and then stops nagging;
 * a device whose notifications were blocked never shows it at all.
 */
function EnableDeviceNotifications({ push }: { push: PushNotificationsState }) {
  if (!push.supported || push.registered || push.permission === "denied") return null
  return (
    <button
      className="btn btn-ghost btn-sm"
      onClick={() => void push.enable()}
      disabled={push.busy}
      title="Get a notification on this device, even when the site is closed"
      aria-label="Enable notifications on this device"
    >
      <BellRing size={17} />
    </button>
  )
}

function ProfileMenu() {
  const { user, logout } = useAuth()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [])

  if (!user) return null

  return (
    <div className="relative" ref={ref}>
      <button className="btn btn-ghost btn-sm flex items-center gap-2" onClick={() => setOpen((value) => !value)} aria-haspopup="menu" aria-expanded={open}>
        <Avatar src={user.avatarPath} name={user.displayName} size={28} />
        <span className="hidden text-left sm:block">
          <span className="block max-w-[10rem] truncate text-xs font-medium">{user.displayName}</span>
          <span className="muted block text-[10px]">{user.memberNo ?? user.roles.join(", ")}</span>
        </span>
      </button>
      {open ? (
        <div className="card absolute right-0 z-40 mt-2 w-60 p-1.5" role="menu">
          <div className="px-3 py-2">
            <p className="truncate text-sm font-medium">{user.displayName}</p>
            <p className="muted truncate text-xs">{user.email}</p>
            <div className="mt-2 flex flex-wrap gap-1">
              {user.roles.map((role) => (
                <Badge key={role} tone="gold">
                  {role.replace(/_/g, " ")}
                </Badge>
              ))}
            </div>
          </div>
          <hr className="gold-rule my-1" />
          <button className="sidebar-link w-full" style={{ color: "inherit" }} onClick={() => { setOpen(false); navigate("/app/profile") }} role="menuitem">
            <UserRound size={15} /> My Profile
          </button>
          <button className="sidebar-link w-full" style={{ color: "inherit" }} onClick={() => { setOpen(false); navigate("/app/account") }} role="menuitem">
            <Settings size={15} /> My Account
          </button>
          <button
            className="sidebar-link w-full"
            style={{ color: "inherit" }}
            onClick={async () => {
              setOpen(false)
              await logout()
              navigate("/login")
            }}
            role="menuitem"
          >
            <LogOut size={15} /> Sign out
          </button>
        </div>
      ) : null}
    </div>
  )
}

function GlobalSearch() {
  const [value, setValue] = useState("")
  const navigate = useNavigate()
  const { can } = useAuth()
  if (!can("search.global")) return null
  return (
    <form
      className="relative hidden flex-1 max-w-md md:block"
      onSubmit={(event) => {
        event.preventDefault()
        const query = value.trim()
        if (query) navigate(`/app/search?q=${encodeURIComponent(query)}`)
      }}
      role="search"
    >
      <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 opacity-60" />
      <input
        className="field pl-9"
        placeholder="Search members, songs, events…"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        aria-label="Global search"
      />
    </form>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  const [drawer, setDrawer] = useState(false)
  const location = useLocation()
  const { user } = useAuth()
  const push = usePushNotifications({ enabled: !user?.mustChangePassword })
  // While this device is subscribed to push, the in-tab poller stays off: it
  // would otherwise announce the same arrival a second time.
  useDesktopNotifications({
    enabled: !user?.mustChangePassword && !push.registered,
  })

  useEffect(() => setDrawer(false), [location.pathname])

  if (!user) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner size={22} />
      </div>
    )
  }

  // A temporary password closes the rest of the platform. Only the account page
  // is rendered: no navigation to pages the server refuses, and no bell or unread
  // counters polling endpoints that would answer 403 until the password is set.
  if (user.mustChangePassword) {
    return (
      <div className="flex min-h-dvh flex-col bg-ivory dark:bg-charcoal-950">
        <header className="flex h-16 items-center gap-3 border-b border-black/10 bg-white/85 px-4 backdrop-blur dark:border-gold-400/15 dark:bg-charcoal-900/85">
          <Brand />
          <Link to="/" className="btn btn-ghost btn-sm gap-1.5" title="Go to the choir home page">
            <Home size={16} />
            <span className="hidden sm:inline">Home</span>
          </Link>
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </header>
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-3xl">
            <RestoreAlertBanner />
            {children}
          </div>
        </main>
        <footer className="px-6 py-4 text-center text-[11px] text-black/40 dark:text-ivory/35">
          Chorale La Porte d'Or · Digital Choir Management Platform
        </footer>
      </div>
    )
  }

  return (
    <div className="flex min-h-dvh bg-ivory dark:bg-charcoal-950">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-black/10 bg-white lg:flex dark:border-gold-400/15 dark:bg-charcoal-900">
        <div className="flex h-16 items-center px-4">
          <Brand />
        </div>
        <SidebarContent />
        <div className="px-4 py-3 text-[10px] text-black/40 dark:text-ivory/40">
          {user.groupName ? `${user.groupName} group` : "Administration"}
        </div>
      </aside>

      {drawer ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setDrawer(false)} aria-hidden />
          <div className="absolute left-0 top-0 flex h-full w-72 flex-col bg-white dark:bg-charcoal-900">
            <div className="flex h-16 items-center justify-between px-4">
              <Brand />
              <button className="btn btn-ghost btn-sm" onClick={() => setDrawer(false)} aria-label="Close navigation">
                <X size={16} />
              </button>
            </div>
            <SidebarContent onNavigate={() => setDrawer(false)} />
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-black/10 bg-white/85 px-4 backdrop-blur dark:border-gold-400/15 dark:bg-charcoal-900/85">
          <button className="btn btn-ghost btn-sm lg:hidden" onClick={() => setDrawer(true)} aria-label="Open navigation">
            <Menu size={18} />
          </button>
          <div className="lg:hidden">
            <Brand compact />
          </div>
          {/* The public landing page is a click away, so a member can always get
              back to the choir's front door without signing out. */}
          <Link
            to="/"
            className="btn btn-ghost btn-sm gap-1.5"
            title="Go to the choir home page"
          >
            <Home size={16} />
            <span className="hidden sm:inline">Home</span>
          </Link>
          <GlobalSearch />
          <Link
            to="/app/search"
            className="btn btn-ghost btn-sm md:hidden"
            aria-label="Search"
          >
            <Search size={17} />
          </Link>
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <EnableDeviceNotifications push={push} />
            <NotificationBell />
            <ProfileMenu />
          </div>
        </header>

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-7xl">
            <RestoreAlertBanner />
            {children}
          </div>
        </main>

        <NotificationPrompt push={push} />

        <footer className="px-6 py-4 text-center text-[11px] text-black/40 dark:text-ivory/35">
          Chorale La Porte d'Or · Digital Choir Management Platform
        </footer>
      </div>
    </div>
  )
}
