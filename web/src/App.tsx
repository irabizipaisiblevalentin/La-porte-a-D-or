import type { ReactNode } from "react"
import { Outlet, Route, Routes } from "react-router-dom"
import { RequireAuth, RequirePasswordChange, RequirePermission } from "./auth/guards"
import { AppShell } from "./components/layout/AppShell"
import { BootSplash } from "./components/layout/BootSplash"
import { ContactChairman } from "./components/layout/ContactChairman"
import { PublicLayout } from "./components/layout/PublicLayout"
import { LandingPage } from "./pages/public/LandingPage"
import { PublicMusicPage } from "./pages/public/PublicMusicPage"
import { PublicAboutPage } from "./pages/public/PublicAboutPage"
import { PublicContactPage } from "./pages/public/PublicContactPage"
import { PublicEventsPage } from "./pages/public/PublicEventsPage"
import { GalleryLayout } from "./pages/public/gallery/GalleryLayout"
import {
  GalleryAllPage,
  GalleryCollectionPage,
  GalleryMembersPage,
  GalleryPerformancesPage,
} from "./pages/public/gallery/GalleryPages"
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
import { CheckinPage } from "./pages/CheckinPage"

function guarded(permission: string, element: ReactNode): ReactNode {
  return <RequirePermission permission={permission}>{element}</RequirePermission>
}

export function App() {
  return (
    <>
      <BootSplash />
      <Routes>
      <Route
        path="/"
        element={
          <PublicLayout>
            <LandingPage />
          </PublicLayout>
        }
      />
      <Route
        path="/music"
        element={
          <PublicLayout>
            <PublicMusicPage />
          </PublicLayout>
        }
      />
      <Route
        path="/about"
        element={
          <PublicLayout>
            <PublicAboutPage />
          </PublicLayout>
        }
      />
      <Route
        path="/events"
        element={
          <PublicLayout>
            <PublicEventsPage />
          </PublicLayout>
        }
      />
      <Route
        path="/contact"
        element={
          <PublicLayout>
            <PublicContactPage />
          </PublicLayout>
        }
      />
      <Route
        path="/gallery"
        element={
          <PublicLayout>
            <GalleryLayout />
          </PublicLayout>
        }
      >
        <Route index element={<GalleryAllPage />} />
        <Route path="august-2026" element={<GalleryCollectionPage collection="august-2026" />} />
        <Route path="july-2026" element={<GalleryCollectionPage collection="july-2026" />} />
        <Route path="performances" element={<GalleryPerformancesPage />} />
        <Route path="members" element={<GalleryMembersPage />} />
      </Route>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/admin" element={<AdminLoginPage />} />
      <Route path="/admin/login" element={<AdminLoginPage />} />
      {/* What a scanned entrance pass opens. Reachable signed out, because the QR
          is scanned by a phone that may have no session — the page proves whose
          pass it is, and only a signed-in steward can admit anyone. */}
      <Route path="/checkin/:token" element={<CheckinPage />} />
      <Route path="/setup" element={<SetupPage />} />
      <Route path="/invite/:token" element={<InvitePage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />

      <Route
        path="/app"
        element={
          <RequireAuth>
            <RequirePasswordChange>
              <AppShell>
                <Outlet />
              </AppShell>
            </RequirePasswordChange>
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
