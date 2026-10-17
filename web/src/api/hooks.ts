import { useCallback, useEffect, useRef, useState } from "react"
import { api, ApiError } from "./client"

export interface QueryState<T> {
  data: T | null
  loading: boolean
  error: ApiError | null
  reload: () => void
  setData: (data: T | null) => void
}

/** Fetches a GET endpoint, re-running when `deps` change. Pass `null` to skip. */
export function useQuery<T>(path: string | null, deps: unknown[] = []): QueryState<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState<boolean>(Boolean(path))
  const [error, setError] = useState<ApiError | null>(null)
  const [nonce, setNonce] = useState(0)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    if (!path) {
      setLoading(false)
      setData(null)
      return
    }
    setLoading(true)
    setError(null)
    api
      .get<T>(path)
      .then((result) => {
        if (mounted.current) setData(result)
      })
      .catch((caught: unknown) => {
        if (mounted.current) setError(caught instanceof ApiError ? caught : new ApiError(0, "error", "Request failed."))
      })
      .finally(() => {
        if (mounted.current) setLoading(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, nonce, ...deps])

  const reload = useCallback(() => setNonce((value) => value + 1), [])
  return { data, loading, error, reload, setData }
}

export interface MutationState {
  saving: boolean
  error: ApiError | null
}

/** Wraps a mutating call with saving/error state, resetting errors on each attempt. */
export function useMutation<Args extends unknown[], Result>(
  fn: (...args: Args) => Promise<Result>,
): MutationState & { run: (...args: Args) => Promise<Result | undefined>; reset: () => void } {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)

  const run = useCallback(
    async (...args: Args) => {
      setSaving(true)
      setError(null)
      try {
        return await fn(...args)
      } catch (caught) {
        setError(caught instanceof ApiError ? caught : new ApiError(0, "error", "Request failed."))
        return undefined
      } finally {
        setSaving(false)
      }
    },
    [fn],
  )

  const reset = useCallback(() => setError(null), [])
  return { saving, error, run, reset }
}

/** Debounces a rapidly-changing value (search boxes). */
export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(timer)
  }, [value, delay])
  return debounced
}
