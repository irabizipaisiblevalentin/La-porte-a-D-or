import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { api } from "../api/client"

export type PermissionScope = "global" | "senior" | "junior" | "members" | "own"

export interface SessionUser {
  id: string
  email: string
  displayName: string
  status: string
  mustChangePassword: boolean
  avatarPath: string | null
  memberId: string | null
  memberNo: string | null
  groupId: string | null
  groupName: string | null
  roles: string[]
  permissions: Record<string, PermissionScope[]>
}

interface AuthContextValue {
  user: SessionUser | null
  loading: boolean
  login: (email: string, password: string) => Promise<SessionUser>
  logout: () => Promise<void>
  refresh: () => Promise<SessionUser | null>
  can: (permission: string, scope?: PermissionScope) => boolean
  isAdmin: boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

const ADMIN_ROLES = ["chairman", "senior_leader", "junior_admin", "members_admin"]

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const result = await api.get<{ user: SessionUser | null }>("/auth/me")
      setUser(result.user)
      return result.user
    } catch {
      setUser(null)
      return null
    }
  }, [])

  useEffect(() => {
    refresh().finally(() => setLoading(false))
  }, [refresh])

  // `identifier` is an email address or, for members who joined without one, the
  // username derived from their full name (see server `services/usernames.ts`).
  const login = useCallback(async (identifier: string, password: string) => {
    const result = await api.post<{ user: SessionUser }>("/auth/login", { identifier, password })
    setUser(result.user)
    return result.user
  }, [])

  const logout = useCallback(async () => {
    try {
      await api.post("/auth/logout")
    } finally {
      setUser(null)
    }
  }, [])

  const can = useCallback(
    (permission: string, scope?: PermissionScope) => {
      if (!user) return false
      const granted = user.permissions[permission]
      if (!granted || granted.length === 0) return false
      if (!scope) return true
      if (granted.includes("global")) return true
      return granted.includes(scope)
    },
    [user],
  )

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      login,
      logout,
      refresh,
      can,
      isAdmin: Boolean(user && user.roles.some((role) => ADMIN_ROLES.includes(role))),
    }),
    [user, loading, login, logout, refresh, can],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error("useAuth must be used within AuthProvider")
  return context
}
