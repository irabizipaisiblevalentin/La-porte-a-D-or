import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter } from "react-router-dom"
import { App } from "./App"
import { AuthProvider } from "./auth/AuthProvider"
import { ToastProvider } from "./components/ui"
import "./styles.css"

const container = document.getElementById("root")
if (!container) throw new Error("Root element #root was not found in index.html")

// The service worker is what lets a pushed notification reach this device while
// the app is closed. Registration is skipped quietly where it is unsupported
// (or on an insecure origin); the in-page notifier still works in that case.
if ("serviceWorker" in navigator) {
  void navigator.serviceWorker.register("/sw.js").catch(() => undefined)
}

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
)
