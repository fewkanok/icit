import { useRef, useState } from 'react';
import SlideViewer from './SlideViewer';
import SlideSelector from './SlideSelector';
import RoomSetupModal from './RoomSetupModal';
import DeviceTestCard from './DeviceTestCard';
import { EmptyState, ErrorState, SlowOperationBar } from './ui/StateViews';
import { SkeletonSlideGrid } from './ui/Skeleton';
import { filesToSlides, SAMPLE_DECK } from '../lib/slides';

const AUDIENCE_LABEL = {
  general: 'คนทั่วไป',
  teacher: 'อาจารย์ / กรรมการ',
  executive: 'ผู้บริหาร',
};

export default function UploadStep({
  deck,
  selectedIndices = null,
  onSelectedIndicesChange,
  externalProgress = null,
  rehearsalMode,
  onRehearsalModeChange,
  audience,
  onAudienceChange,
  timeBudget,
  onTimeBudgetChange,
  interruptEnabled,
  onInterruptToggle,
  useGeminiTts,
  onGeminiTtsToggle,
  cameraEnabled = true,
  onCameraToggle,
  onBackToMode,
  onDeckChange,
  onStart,
}) {
  const [setupOpen, setSetupOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);
  const stopTestRef = useRef(null);

  async function handleFiles(fileList) {
    const files = Array.from(fileList ?? []);
    if (!files.length) return;
    setError(null);
    setProgress({ done: 0, total: 0 });
    try {
      const uploadedSlides = await filesToSlides(files, (done, total) => setProgress({ done, total }));
      // หากมีบทพูด (script) จากลิงก์ LangMind อยู่แล้ว ให้ผูกบทพูดเดิมเข้ากับรูปสไลด์จริงที่เพิ่งอัปโหลด
      const existingHasScript = Array.isArray(deck?.slides) && deck.slides.some((s) => s?.script);
      const mergedSlides = existingHasScript
        ? uploadedSlides.map((s, idx) => {
            const prev = deck.slides[idx];
            if (!prev?.script) return s;
            const combinedText = [
              prev.title || '',
              s.text || '',
              `บทพูด: ${prev.script}`,
            ]
              .filter(Boolean)
              .join('\n');
            return {
              ...s,
              title: prev.title || s.title,
              points: prev.points || s.points,
              script: prev.script,
              text: combinedText,
            };
          })
        : uploadedSlides;
      onDeckChange({
        name: existingHasScript && deck?.name
          ? deck.name
          : files.length === 1
            ? files[0].name
            : `รูปภาพ ${files.length} ไฟล์`,
        slides: mergedSlides,
      });
      setIndex(0);
    } catch (e) {
      setError(e.message || 'อ่านไฟล์ไม่สำเร็จ ลองไฟล์อื่นอีกครั้ง');
    } finally {
      setProgress(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  const activeProgress = progress || externalProgress;
  const loading = activeProgress !== null;
  const totalSlides = deck?.slides?.length ?? 0;
  const selectedCount =
    totalSlides === 0
      ? 0
      : selectedIndices === null
        ? totalSlides
        : selectedIndices.filter((i) => i >= 0 && i < totalSlides).length || totalSlides;

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-6 px-3 py-6 sm:gap-10 sm:px-6 sm:py-12 lg:grid-cols-[320px_1fr] lg:gap-14">
      {/* ซ้าย: อัปโหลด */}
      <section className="flex min-w-0 flex-col">
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
            <SlowOperationBar
              visible
              label={
                externalProgress
                  ? 'กำลังดึงไฟล์สไลด์ PDF จาก LINE อัตโนมัติ...'
                  : 'กำลังแปลงสไลด์...'
              }
              progress={
                activeProgress.total > 0
                  ? Math.round((activeProgress.done / activeProgress.total) * 100)
                  : null
              }
            />
          </div>
        )}

        {error && (
          <div className="mt-4">
            <ErrorState
              title="อ่านไฟล์ไม่สำเร็จ"
              message={error}
              onRetry={() => inputRef.current?.click()}
              retryLabel="เลือกไฟล์ใหม่"
            />
          </div>
        )}

        {deck && !loading && (
          <div className="mt-4 flex items-center justify-between rounded-lg border border-line bg-white px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{deck.name}</p>
              <p className="text-xs text-muted">
                {selectedCount < deck.slides.length
                  ? `เลือกซ้อม ${selectedCount}/${deck.slides.length} หน้า`
                  : `${deck.slides.length} หน้า`}
              </p>
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

        <div className="mt-8 lg:mt-auto lg:pt-8">
          <DeviceTestCard cameraEnabled={cameraEnabled} stopRef={stopTestRef} />

          <div className="mb-4 flex items-center justify-between gap-2 rounded-lg border border-line bg-white px-3.5 py-2.5">
            <div className="min-w-0">
              <p className="text-xs font-medium text-ink">ตั้งค่าห้องซ้อม</p>
              <p className="truncate text-[11px] text-muted">
                {rehearsalMode === 'continuous' ? 'ซ้อมใหญ่' : 'ทีละหน้า'}
                {' · '}
                {AUDIENCE_LABEL[audience] || 'คนทั่วไป'}
                {' · '}
                {timeBudget.presentMinutes ? `พรีเซนต์ ${timeBudget.presentMinutes} น.` : 'ไม่จำกัดเวลา'}
                {' · '}
                {timeBudget.qaMinutes ? `Q&A ${timeBudget.qaMinutes} น.` : 'Q&A ไม่จำกัด'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSetupOpen(true)}
              className="shrink-0 rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink transition hover:border-faint cursor-pointer"
            >
              แก้ไข
            </button>
          </div>

          <button
            onClick={() => {
              stopTestRef.current?.();
              onStart();
            }}
            disabled={!deck || loading}
            className="w-full rounded-xl bg-accent py-3.5 text-sm font-semibold text-white shadow-xs transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:bg-line disabled:text-faint cursor-pointer"
          >
            {deck && selectedCount < deck.slides.length
              ? `เริ่มซ้อมพูด (${selectedCount} หน้า)`
              : 'เริ่มซ้อมพูด'}
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
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-faint">
            <button
              type="button"
              onClick={onBackToMode}
              className="min-h-[36px] text-muted underline-offset-4 hover:text-ink hover:underline cursor-pointer"
            >
              ← เปลี่ยนโหมดซ้อม
            </button>
            <span>ประมวลผลบนเครื่องคุณ</span>
          </div>
        </div>
      </section>

      {/* ขวา: พรีวิวสไลด์ */}
      <section className="min-w-0">
        {loading && !deck ? (
          <div className="space-y-4">
            <div className="aspect-video w-full rounded-xl border border-line bg-white p-6">
              <SkeletonSlideGrid />
            </div>
          </div>
        ) : !deck ? (
          <EmptyState
            title="ยังไม่มีสไลด์ในขั้นตอนนี้"
            description="อัปโหลดไฟล์ PDF หรือรูปภาพในช่องอัปโหลด หรือทดลองใช้สไลด์แนะนำตัว 2 หน้าเพื่อเริ่มซ้อมได้ทันที"
            actionLabel="ทดลองใช้สไลด์แนะนำตัว (2 หน้า)"
            onAction={() => {
              onDeckChange(SAMPLE_DECK);
              setIndex(0);
            }}
          />
        ) : (
          <SlideViewer slides={deck?.slides} index={index} onIndexChange={setIndex} />
        )}
        {deck && !loading && onSelectedIndicesChange && (
          <SlideSelector
            slides={deck.slides}
            selectedIndices={selectedIndices}
            onChange={onSelectedIndicesChange}
            activeIndex={index}
            onSelectPreview={setIndex}
          />
        )}
      </section>

      {setupOpen && (
        <RoomSetupModal
          rehearsalMode={rehearsalMode}
          onRehearsalModeChange={onRehearsalModeChange}
          audience={audience}
          onAudienceChange={onAudienceChange}
          timeBudget={timeBudget}
          onTimeBudgetChange={onTimeBudgetChange}
          interruptEnabled={interruptEnabled}
          onInterruptToggle={onInterruptToggle}
          cameraEnabled={cameraEnabled}
          onCameraToggle={onCameraToggle}
          confirmLabel="บันทึก"
          onConfirm={() => setSetupOpen(false)}
          onClose={() => setSetupOpen(false)}
        />
      )}
    </div>
  );
}
