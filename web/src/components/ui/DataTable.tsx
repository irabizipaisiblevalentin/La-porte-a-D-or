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
    <div className="table-wrap">
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
  )
}
