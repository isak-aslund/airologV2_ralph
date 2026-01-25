interface PaginationProps {
  page: number
  totalPages: number
  perPage: 25 | 50 | 100
  onPageChange: (page: number) => void
  onPerPageChange: (perPage: 25 | 50 | 100) => void
}

const PER_PAGE_OPTIONS: Array<25 | 50 | 100> = [25, 50, 100]

export default function Pagination({
  page,
  totalPages,
  perPage,
  onPageChange,
  onPerPageChange,
}: PaginationProps) {
  // Generate array of page numbers to display
  function getPageNumbers(): (number | 'ellipsis')[] {
    const pages: (number | 'ellipsis')[] = []
    const maxVisible = 5

    if (totalPages <= maxVisible) {
      // Show all pages if total is small
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i)
      }
    } else {
      // Always show first page
      pages.push(1)

      if (page > 3) {
        pages.push('ellipsis')
      }

      // Show pages around current page
      const start = Math.max(2, page - 1)
      const end = Math.min(totalPages - 1, page + 1)

      for (let i = start; i <= end; i++) {
        pages.push(i)
      }

      if (page < totalPages - 2) {
        pages.push('ellipsis')
      }

      // Always show last page
      if (totalPages > 1) {
        pages.push(totalPages)
      }
    }

    return pages
  }

  const isPreviousDisabled = page <= 1
  const isNextDisabled = page >= totalPages

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 mt-4 px-2">
      {/* Page info */}
      <div className="text-sm text-gray-600">
        Page {page} of {totalPages}
      </div>

      {/* Page navigation */}
      <div className="flex items-center gap-1">
        {/* Previous button */}
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={isPreviousDisabled}
          className={`px-3 py-1 text-sm font-medium rounded-md ${
            isPreviousDisabled
              ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
              : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-300'
          }`}
        >
          Previous
        </button>

        {/* Page numbers */}
        {getPageNumbers().map((pageNum, index) =>
          pageNum === 'ellipsis' ? (
            <span key={`ellipsis-${index}`} className="px-2 py-1 text-gray-500">
              ...
            </span>
          ) : (
            <button
              key={pageNum}
              onClick={() => onPageChange(pageNum)}
              className={`px-3 py-1 text-sm font-medium rounded-md ${
                pageNum === page
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-300'
              }`}
            >
              {pageNum}
            </button>
          )
        )}

        {/* Next button */}
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={isNextDisabled}
          className={`px-3 py-1 text-sm font-medium rounded-md ${
            isNextDisabled
              ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
              : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-300'
          }`}
        >
          Next
        </button>
      </div>

      {/* Per page dropdown */}
      <div className="flex items-center gap-2">
        <label htmlFor="per-page-select" className="text-sm text-gray-600">
          Show:
        </label>
        <select
          id="per-page-select"
          value={perPage}
          onChange={(e) => onPerPageChange(Number(e.target.value) as 25 | 50 | 100)}
          className="px-2 py-1 text-sm border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {PER_PAGE_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
