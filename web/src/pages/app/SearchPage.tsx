import { useEffect, useMemo, useState, type FormEvent } from "react"
import { Link, useSearchParams } from "react-router-dom"
import {
  CalendarDays,
  FileText,
  GraduationCap,
  Music,
  Search,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react"
import { toQuery } from "../../api/client"
import { useDebounced, useQuery } from "../../api/hooks"
import { Badge, EmptyState, Field, Input, LoadingBlock, PageHeader, humanize } from "../../components/ui"

// --- Response shape (mirroring server/src/routes/search.ts) -----------------

interface SearchResult {
  type: string
  id: string
  title: string
  subtitle: string
  link: string
}

interface SearchResponse {
  results: SearchResult[]
}

const TYPE_ORDER = ["member", "song", "event", "training", "application", "group", "voice"]

const TYPE_ICONS: Record<string, LucideIcon> = {
  member: UserRound,
  song: Music,
  event: CalendarDays,
  training: GraduationCap,
  application: FileText,
  group: Users,
  voice: Users,
}

/**
 * The API returns app-relative paths (e.g. `/members/:id`) while the authed
 * router mounts every screen under `/app`. Normalise so result links resolve.
 */
function appLink(link: string): string {
  if (/^https?:\/\//.test(link)) return link
  if (link.startsWith("/app")) return link
  return `/app${link.startsWith("/") ? "" : "/"}${link}`
}

export function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const urlQuery = searchParams.get("q") ?? ""
  const [input, setInput] = useState(urlQuery)
  const debounced = useDebounced(input, 300)

  useEffect(() => {
    setSearchParams(debounced ? { q: debounced } : {}, { replace: true })
  }, [debounced, setSearchParams])

  const trimmed = urlQuery.trim()
  const path = trimmed.length >= 2 ? `/search${toQuery({ q: trimmed })}` : null
  const { data, loading, error } = useQuery<SearchResponse>(path)

  const groups = useMemo(() => {
    const map = new Map<string, SearchResult[]>()
    for (const result of data?.results ?? []) {
      const list = map.get(result.type) ?? []
      list.push(result)
      map.set(result.type, list)
    }
    const ordered = TYPE_ORDER.filter((type) => map.has(type))
    const extras = [...map.keys()].filter((type) => !TYPE_ORDER.includes(type))
    return [...ordered, ...extras].map((type) => ({ type, results: map.get(type) ?? [] }))
  }, [data])

  const totalResults = data?.results.length ?? 0

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    setSearchParams(trimmed ? { q: input.trim() } : {}, { replace: true })
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Search"
        description="Search members, songs, events and more. Results are filtered to what your role is allowed to see."
      />

      <form onSubmit={onSubmit} className="max-w-2xl">
        <Field label="Search term" htmlFor="global-search" hint="Enter at least two characters.">
          <div className="relative">
            <Search size={16} className="muted pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" />
            <Input
              id="global-search"
              type="search"
              autoFocus
              className="pl-9"
              placeholder="Search members, songs, events…"
              value={input}
              onChange={(event) => setInput(event.target.value)}
            />
          </div>
        </Field>
      </form>

      {trimmed.length < 2 ? (
        <EmptyState
          icon={<Search size={22} />}
          title="Start typing to search"
          description="Enter at least two characters and results you are permitted to see will appear here."
        />
      ) : loading ? (
        <LoadingBlock label={`Searching for “${trimmed}”…`} rows={4} />
      ) : error ? (
        <EmptyState tone="danger" title="Search failed" description={error.message} />
      ) : totalResults === 0 ? (
        <EmptyState
          icon={<Search size={22} />}
          title={`No results for “${trimmed}”`}
          description="Nothing matched within the records your account can access. Try a different spelling or a broader term."
        />
      ) : (
        <div className="flex flex-col gap-4">
          <p className="muted text-sm">
            {totalResults} result{totalResults === 1 ? "" : "s"} for “{trimmed}”.
          </p>
          {groups.map((group) => {
            const Icon = TYPE_ICONS[group.type] ?? Search
            return (
              <section key={group.type} className="card overflow-hidden">
                <header className="flex items-center gap-2 border-b hairline px-5 py-3">
                  <Icon size={16} className="text-gold-600 dark:text-gold-300" aria-hidden />
                  <h2 className="text-sm font-semibold">{humanize(group.type)}</h2>
                  <Badge tone="neutral">{group.results.length}</Badge>
                </header>
                <ul>
                  {group.results.map((result) => (
                    <li key={`${result.type}-${result.id}`} className="border-t hairline first:border-t-0">
                      <Link
                        to={appLink(result.link)}
                        className="flex items-center justify-between gap-4 px-5 py-3 transition-colors hover:bg-gold-400/10"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">{result.title}</span>
                          {result.subtitle ? <span className="muted block truncate text-xs">{result.subtitle}</span> : null}
                        </span>
                        <span className="link shrink-0 text-xs">Open</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
