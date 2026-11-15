import { useState } from 'react';
import RoomSetupModal from './RoomSetupModal';

export default function ModeStep({
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
  onNext,
  onEnterGroup,
}) {
  const [setupOpen, setSetupOpen] = useState(false);

  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">เลือกรูปแบบการซ้อม</h1>
        <p className="mt-2 text-sm text-muted">
          เลือกโหมดที่ต้องการ จากนั้นตั้งค่าห้องซ้อมก่อนเริ่มอัปโหลดสไลด์
        </p>
      </div>

      <div className="mt-10 grid gap-5 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => setSetupOpen(true)}
          className="flex flex-col justify-between rounded-2xl border border-line bg-white p-6 text-left transition hover:border-ink hover:shadow-sm cursor-pointer"
        >
          <div>
            <span className="inline-block rounded-full bg-ink px-2.5 py-0.5 text-[11px] font-medium text-paper">
              พร้อมใช้งาน
            </span>
            <h2 className="mt-4 text-lg font-semibold text-ink">ซ้อมเดี่ยว</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">
              ซ้อมพูดคนเดียวทีละสไลด์ พร้อมจับเวลา เช็กสายตา ถาม-ตอบ และใช้มือถือเป็นรีโมตได้
            </p>
          </div>
          <span className="mt-6 text-sm font-medium text-ink">ตั้งค่าห้องซ้อม →</span>
        </button>

        <button
          type="button"
          onClick={onEnterGroup}
          className="flex flex-col justify-between rounded-2xl border border-line bg-white p-6 text-left transition hover:border-ink hover:shadow-sm cursor-pointer"
        >
          <div>
            <span className="inline-block rounded-full bg-accent/10 px-2.5 py-0.5 text-[11px] font-medium text-accent">
              เปิดห้อง Lobby แล้ว
            </span>
            <h2 className="mt-4 text-lg font-semibold text-ink">ซ้อมกลุ่ม</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">
              สร้างห้องแชร์ลิงก์ให้เพื่อนเข้ามาซ้อมต่อคิวคนละช่วงสไลด์จากคนละเครื่อง
            </p>
          </div>
          <span className="mt-6 text-sm font-medium text-ink">สร้าง / เข้าร่วมห้อง →</span>
        </button>
      </div>

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
          useGeminiTts={useGeminiTts}
          onGeminiTtsToggle={onGeminiTtsToggle}
          cameraEnabled={cameraEnabled}
          onCameraToggle={onCameraToggle}
          confirmLabel="ถัดไป: เตรียมสไลด์"
          onConfirm={() => {
            setSetupOpen(false);
            onNext();
          }}
          onClose={() => setSetupOpen(false)}
        />
      )}
    </div>
  );
}
