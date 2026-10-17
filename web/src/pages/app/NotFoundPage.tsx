import { Link } from "react-router-dom"
import { Compass } from "lucide-react"
import { EmptyState } from "../../components/ui"
import { useAuth } from "../../auth/AuthProvider"

export function NotFoundPage() {
  const { user } = useAuth()
  const home = user ? "/app" : "/"
  return (
    <div className="flex min-h-dvh items-center justify-center px-5">
      <div className="w-full max-w-md">
        <EmptyState
          icon={<Compass size={22} />}
          title="Page not found"
          description="The page you were looking for does not exist or may have been moved."
          action={
            <Link to={home} className="btn btn-gold">
              {user ? "Back to dashboard" : "Back to home"}
            </Link>
          }
        />
      </div>
    </div>
  )
}
