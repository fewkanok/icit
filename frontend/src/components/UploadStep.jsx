import { useRef, useState } from 'react';
import SlideViewer from './SlideViewer';
import { filesToSlides, SAMPLE_DECK } from '../lib/slides';

export default function UploadStep({ deck, onDeckChange, onStart }) {
  const [index, setIndex] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  async function handleFiles(fileList) {
    const files = Array.from(fileList ?? []);
    if (!files.length) return;
    setError(null);
    setProgress({ done: 0, total: 0 });
    try {
      const slides = await filesToSlides(files, (done, total) => setProgress({ done, total }));
      onDeckChange({ name: files.length === 1 ? files[0].name : `รูปภาพ ${files.length} ไฟล์`, slides });
      setIndex(0);
    } catch (e) {
      setError(e.message || 'อ่านไฟล์ไม่สำเร็จ ลองไฟล์อื่นอีกครั้ง');
    } finally {
      setProgress(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  const loading = progress !== null;

  return (
    <div className="mx-auto grid max-w-6xl gap-10 px-6 py-12 lg:grid-cols-[320px_1fr] lg:gap-14">
      {/* ซ้าย: อัปโหลด */}
      <section className="flex flex-col">
        <h1 className="text-2xl font-semibold tracking-tight">เตรียมสไลด์</h1>
        <p className="mt-2 text-sm leading-6 text-muted">
          อัปโหลดไฟล์ PDF หรือรูปสไลด์ ระบบจะแยกเป็นหน้า ให้คุณซ้อมพูดทีละหน้า
        </p>

        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            handleFiles(e.dataTransfer.files);
          }}
          className={`mt-8 flex cursor-pointer flex-col items-center rounded-xl border border-dashed px-6 py-8 text-center transition ${
            dragging ? 'border-ink bg-white' : 'border-faint/70 bg-white/50 hover:border-muted hover:bg-white'
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,image/png,image/jpeg"
            multiple
            className="sr-only"
            onChange={(e) => handleFiles(e.target.files)}
          />
          <svg viewBox="0 0 24 24" className="size-6 text-muted" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M12 15V4m0 0L7.5 8.5M12 4l4.5 4.5M5 15v3.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V15" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <p className="mt-3 text-sm">
            ลากไฟล์มาวาง หรือ <span className="font-medium underline underline-offset-4">เลือกไฟล์</span>
          </p>
          <p className="mt-1 text-xs text-faint">PDF, PNG, JPG</p>
        </label>

        {loading && (
          <div className="mt-4">
            <div className="flex justify-between text-xs text-muted">
              <span>กำลังแปลงสไลด์</span>
              {progress.total > 0 && (
                <span className="font-mono tabular-nums">
                  {progress.done}/{progress.total}
                </span>
              )}
            </div>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-line">
              <div
                className="h-full bg-ink transition-all"
                style={{ width: progress.total ? `${(progress.done / progress.total) * 100}%` : '15%' }}
              />
            </div>
          </div>
        )}

        {error && <p className="mt-4 text-sm text-accent">{error}</p>}

        {deck && !loading && (
          <div className="mt-4 flex items-center justify-between rounded-lg border border-line bg-white px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{deck.name}</p>
              <p className="text-xs text-muted">{deck.slides.length} หน้า</p>
            </div>
            <button
              onClick={() => onDeckChange(null)}
              className="ml-3 rounded-md p-1.5 text-faint transition hover:bg-black/[0.04] hover:text-ink"
              aria-label="นำไฟล์ออก"
            >
              <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="m4 4 8 8m0-8-8 8" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        )}

        <div className="mt-8 lg:mt-auto lg:pt-10">
          <button
            onClick={onStart}
            disabled={!deck || loading}
            className="w-full rounded-lg bg-ink py-3 text-sm font-medium text-paper transition hover:bg-ink/85 disabled:cursor-not-allowed disabled:bg-line disabled:text-faint"
          >
            เริ่มซ้อม
          </button>
          {!deck && !loading && (
            <button
              onClick={() => {
                onDeckChange(SAMPLE_DECK);
                setIndex(0);
              }}
              className="mt-3 w-full text-center text-sm text-muted underline-offset-4 hover:text-ink hover:underline"
            >
              ยังไม่มีไฟล์? ลองด้วยสไลด์แนะนำตัว
            </button>
          )}
          <p className="mt-6 text-xs leading-5 text-faint">ไฟล์ถูกประมวลผลในเบราว์เซอร์ของคุณ ไม่ได้ถูกส่งขึ้นเซิร์ฟเวอร์</p>
        </div>
      </section>

      {/* ขวา: พรีวิวสไลด์ */}
      <section>
        <SlideViewer slides={deck?.slides} index={index} onIndexChange={setIndex} />
      </section>
    </div>
  );
}
