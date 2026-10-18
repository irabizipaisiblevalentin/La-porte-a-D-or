import type { ReactNode } from "react"
import { EmptyState, Spinner } from "./Feedback"

export interface Column<T> {
  key: string
  header: ReactNode
  render: (row: T) => ReactNode
  className?: string
  align?: "left" | "right" | "center"
}

export interface DataTableProps<T> {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T, index: number) => string
  loading?: boolean
  error?: string | null
  emptyTitle?: string
  emptyDescription?: string
  emptyAction?: ReactNode
  onRowClick?: (row: T) => void
  caption?: string
}

const ALIGN_CLASS = { left: "text-left", right: "text-right", center: "text-center" } as const

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  error,
  emptyTitle = "Nothing here yet",
  emptyDescription,
  emptyAction,
  onRowClick,
  caption,
}: DataTableProps<T>) {
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-14">
        <Spinner />
        <span className="muted text-sm">Loading…</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="py-12">
        <EmptyState title="Could not load this list" description={error} tone="danger" />
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="py-12">
        <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />
      </div>
    )
  }

  return (
    <>
      {/* Phones: stacked cards — every value visible, nothing scrolls sideways. */}
      <div className="md:hidden">
        {caption ? <p className="muted mb-2 px-1 text-xs">{caption}</p> : null}
        {rows.map((row, index) => {
          if (columns.length === 0) return null
          const [first, ...rest] = columns
          return (
            <div
              key={rowKey(row, index)}
              className="card mb-3 p-4 last:mb-0"
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              style={onRowClick ? { cursor: "pointer" } : undefined}
            >
              <div className="break-words text-sm font-semibold">{first.render(row)}</div>
              {rest.length > 0 ? (
                <dl className="mt-2.5 flex flex-col gap-1.5 border-t border-black/5 pt-2.5 dark:border-ivory/5">
                  {rest.map((column) => (
                    <div key={column.key} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <dt className="muted shrink-0 text-[11px] font-medium uppercase tracking-wide">{column.header}</dt>
                      <dd className="min-w-0 max-w-full break-words text-right text-sm">{column.render(row)}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </div>
          )
        })}
      </div>

      {/* Tablet and up: the classic table (scrolls sideways if a screen is truly too narrow). */}
      <div className="table-wrap hidden md:block">
        <table className="data">
          {caption ? <caption className="muted px-3 pt-3 text-left text-xs">{caption}</caption> : null}
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key} className={ALIGN_CLASS[column.align ?? "left"]}>
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={rowKey(row, index)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                style={onRowClick ? { cursor: "pointer" } : undefined}
              >
                {columns.map((column) => (
                  <td key={column.key} className={`${ALIGN_CLASS[column.align ?? "left"]} ${column.className ?? ""}`}>
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
