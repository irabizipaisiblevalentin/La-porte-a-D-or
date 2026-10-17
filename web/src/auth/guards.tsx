import type { ReactNode } from "react"
import { Navigate, useLocation } from "react-router-dom"
import { useAuth, type PermissionScope } from "./AuthProvider"
import { LoadingBlock } from "../components/ui"
import { EmptyState } from "../components/ui"

function FullPageLoading() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <LoadingBlock label="Checking your session…" rows={0} />
    </div>
  )
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <FullPageLoading />
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <>{children}</>
}

export function RequirePermission({
  permission,
  scope,
  children,
}: {
  permission: string
  scope?: PermissionScope
  children: ReactNode
}) {
  const { can } = useAuth()
  if (!can(permission, scope)) {
    return (
      <div className="p-6">
        <EmptyState
          title="Not permitted"
          description="Your role does not have access to this section. If you believe this is a mistake, contact a choir administrator."
          tone="danger"
        />
      </div>
    )
  }
  return <>{children}</>
}
