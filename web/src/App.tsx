import type { ReactNode } from "react"
import { Outlet, Route, Routes } from "react-router-dom"
import { RequireAuth, RequirePermission } from "./auth/guards"
import { AppShell } from "./components/layout/AppShell"
import { ContactChairman } from "./components/layout/ContactChairman"
import { PublicLayout } from "./components/layout/PublicLayout"
import { LandingPage } from "./pages/public/LandingPage"
import { LoginPage, AdminLoginPage } from "./pages/auth/LoginPage"
import { SetupPage } from "./pages/auth/SetupPage"
import { InvitePage } from "./pages/auth/InvitePage"
import { ResetPasswordPage } from "./pages/auth/ResetPasswordPage"
import { AccountPage } from "./pages/app/AccountPage"
import { NotFoundPage } from "./pages/app/NotFoundPage"
import { DashboardPage } from "./pages/app/DashboardPage"
import { ProfilePage } from "./pages/app/ProfilePage"
import { ApplicationsListPage } from "./pages/app/ApplicationsListPage"
import { ApplicationDetailPage } from "./pages/app/ApplicationDetailPage"
import { MembersListPage } from "./pages/app/MembersListPage"
import { MemberDetailPage } from "./pages/app/MemberDetailPage"
import { MusicLibraryPage } from "./pages/app/MusicLibraryPage"
import { SongDetailPage } from "./pages/app/SongDetailPage"
import { DiscoveryPage } from "./pages/app/DiscoveryPage"
import { AttendancePage } from "./pages/app/AttendancePage"
import { AttendanceSessionPage } from "./pages/app/AttendanceSessionPage"
import { DisciplinePage } from "./pages/app/DisciplinePage"
import { GoalsPage } from "./pages/app/GoalsPage"
import { EventsPage } from "./pages/app/EventsPage"
import { EventDetailPage } from "./pages/app/EventDetailPage"
import { TrainingPage } from "./pages/app/TrainingPage"
import { TrainingDetailPage } from "./pages/app/TrainingDetailPage"
import { AnnouncementsPage } from "./pages/app/AnnouncementsPage"
import { AnnouncementDetailPage } from "./pages/app/AnnouncementDetailPage"
import { NotificationsPage } from "./pages/app/NotificationsPage"
import { MessagesPage } from "./pages/app/MessagesPage"
import { ReportsPage } from "./pages/app/ReportsPage"
import { AuditPage } from "./pages/app/AuditPage"
import { SearchPage } from "./pages/app/SearchPage"
import { AccountsPage } from "./pages/app/AccountsPage"
import { SettingsPage } from "./pages/app/SettingsPage"

function guarded(permission: string, element: ReactNode): ReactNode {
  return <RequirePermission permission={permission}>{element}</RequirePermission>
}

export function App() {
  return (
    <>
      <Routes>
      <Route
        path="/"
        element={
          <PublicLayout>
            <LandingPage />
          </PublicLayout>
        }
      />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/admin" element={<AdminLoginPage />} />
      <Route path="/admin/login" element={<AdminLoginPage />} />
      <Route path="/setup" element={<SetupPage />} />
      <Route path="/invite/:token" element={<InvitePage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />

      <Route
        path="/app"
        element={
          <RequireAuth>
            <AppShell>
              <Outlet />
            </AppShell>
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="account" element={<AccountPage />} />
        <Route path="profile" element={<ProfilePage />} />

        <Route path="applications" element={guarded("application.read", <ApplicationsListPage />)} />
        <Route path="applications/:id" element={guarded("application.read", <ApplicationDetailPage />)} />

        <Route path="members" element={guarded("member.read", <MembersListPage />)} />
        <Route path="members/:id" element={guarded("member.read", <MemberDetailPage />)} />

        <Route path="music" element={guarded("music.read", <MusicLibraryPage />)} />
        <Route path="music/:id" element={guarded("music.read", <SongDetailPage />)} />
        <Route path="discovery" element={guarded("music.discovery", <DiscoveryPage />)} />

        <Route path="attendance" element={guarded("attendance.read", <AttendancePage />)} />
        <Route path="attendance/:id" element={guarded("attendance.read", <AttendanceSessionPage />)} />
        <Route path="discipline" element={guarded("discipline.read", <DisciplinePage />)} />
        <Route path="goals" element={guarded("goals.read", <GoalsPage />)} />

        <Route path="events" element={guarded("events.read", <EventsPage />)} />
        <Route path="events/:id" element={guarded("events.read", <EventDetailPage />)} />
        <Route path="training" element={guarded("training.read", <TrainingPage />)} />
        <Route path="training/:id" element={guarded("training.read", <TrainingDetailPage />)} />

        <Route path="announcements" element={guarded("announcements.read", <AnnouncementsPage />)} />
        <Route path="announcements/:id" element={guarded("announcements.read", <AnnouncementDetailPage />)} />
        <Route path="notifications" element={guarded("notifications.read", <NotificationsPage />)} />
        <Route path="messages" element={guarded("messages.send", <MessagesPage />)} />

        <Route path="reports" element={guarded("reports.read", <ReportsPage />)} />
        <Route path="search" element={guarded("search.global", <SearchPage />)} />
        <Route path="audit" element={guarded("audit.read", <AuditPage />)} />
        <Route path="admin/accounts" element={guarded("users.manage", <AccountsPage />)} />
        <Route path="settings" element={guarded("settings.read", <SettingsPage />)} />

        <Route path="*" element={<NotFoundPage />} />
      </Route>

      <Route path="*" element={<NotFoundPage />} />
      </Routes>
      <ContactChairman />
    </>
  )
}

export default App
