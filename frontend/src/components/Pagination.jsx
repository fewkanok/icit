export default function Pagination({ page, totalItems, pageSize = 5, onPageChange }) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  if (totalItems <= pageSize) return null;

  const safePage = Math.max(1, Math.min(page, totalPages));

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 text-xs">
      <span className="text-muted font-mono">
        หน้า {safePage} / {totalPages} · ทั้งหมด {totalItems} รายการ
      </span>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => onPageChange(safePage - 1)}
          disabled={safePage <= 1}
          className="rounded-lg border border-line bg-white px-3 py-1.5 font-medium text-ink transition hover:border-faint disabled:opacity-40 cursor-pointer"
        >
          ‹ ก่อนหน้า
        </button>
        <button
          type="button"
          onClick={() => onPageChange(safePage + 1)}
          disabled={safePage >= totalPages}
          className="rounded-lg border border-line bg-white px-3 py-1.5 font-medium text-ink transition hover:border-faint disabled:opacity-40 cursor-pointer"
        >
          ถัดไป ›
        </button>
      </div>
    </div>
  );
}
