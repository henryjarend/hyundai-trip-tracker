/**
 * Client-side paging, shared by the trip archive and the activity timeline.
 *
 * Both lists arrive whole — the API is asked for a bounded slice once and the page does
 * the rest — so paging here is pure presentation: no refetch, no loading state, and
 * sorting still applies to the entire list rather than to the visible page.
 */
import { useEffect, useState } from 'react';

/**
 * 10 first: the newest handful is what either list is opened for, and the rest is a page
 * away rather than a screenful of scroll below. `0` is "all", for the reader who wants
 * one long list or the browser's own find.
 */
export const PAGE_SIZES = [10, 25, 50, 100, 0] as const;
export const DEFAULT_PAGE_SIZE = 10;

export interface Pagination<T> {
  /** The rows for the current page. */
  visible: T[];
  /** Index of the first visible row in the full list, for the "11–20 of 63" caption. */
  firstIndex: number;
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
}

export function usePager<T>(items: T[], defaultSize: number = DEFAULT_PAGE_SIZE): Pagination<T> {
  const [pageSize, setPageSize] = useState(defaultSize);
  const [page, setPage] = useState(1);

  // Page 5 of the last time range is nothing in this one, and the first page of a new
  // sort order is the only one anybody means. Both show up here as a new `items`
  // identity, so resetting on it covers refetches and re-sorts alike.
  useEffect(() => {
    setPage(1);
  }, [items, pageSize]);

  const pageCount = pageSize === 0 ? 1 : Math.max(1, Math.ceil(items.length / pageSize));
  // Clamped as well as reset: the effect above runs after this render, so a list that
  // just got shorter would paint one blank page first.
  const current = Math.min(page, pageCount);
  const firstIndex = pageSize === 0 ? 0 : (current - 1) * pageSize;

  return {
    visible: pageSize === 0 ? items : items.slice(firstIndex, firstIndex + pageSize),
    firstIndex,
    total: items.length,
    page: current,
    pageCount,
    pageSize,
    setPage,
    setPageSize,
  };
}

interface Props<T> extends Pagination<T> {
  /** Names the control group, since a page has more than one of these. */
  label: string;
}

export function Pager<T>({
  visible,
  firstIndex,
  total,
  page,
  pageCount,
  pageSize,
  setPage,
  setPageSize,
  label,
}: Props<T>) {
  // A list that fits in the smallest page has nothing to page and nothing the size
  // control could reveal, so the whole row would be furniture.
  if (total <= PAGE_SIZES[0]) return null;

  return (
    <nav className="pager" aria-label={label}>
      {/* Announced, because the rows it describes change without anything moving focus —
          a keyboard reader pressing Next would otherwise get silence. */}
      <p className="pager-count" aria-live="polite">
        {visible.length === total
          ? `All ${total} shown`
          : `${firstIndex + 1}–${firstIndex + visible.length} of ${total}`}
      </p>

      <div className="pager-controls">
        <label className="pager-size">
          Per page
          <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size === 0 ? 'All' : size}
              </option>
            ))}
          </select>
        </label>

        {pageCount > 1 && (
          <>
            <button
              type="button"
              className="range-chip"
              onClick={() => setPage(page - 1)}
              disabled={page === 1}
            >
              ← Prev
            </button>
            <span className="pager-page">
              Page {page} of {pageCount}
            </span>
            <button
              type="button"
              className="range-chip"
              onClick={() => setPage(page + 1)}
              disabled={page === pageCount}
            >
              Next →
            </button>
          </>
        )}
      </div>
    </nav>
  );
}
