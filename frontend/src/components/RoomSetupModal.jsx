import { useState } from 'react';

const AUDIENCES = [
  { id: 'general', label: 'คนทั่วไป' },
  { id: 'teacher', label: 'อาจารย์ / กรรมการ' },
  { id: 'executive', label: 'ผู้บริหาร' },
];

const PRESENT_TIME_OPTIONS = [
  { value: 0, label: 'ไม่จำกัด' },
  { value: 5, label: '5 นาที' },
  { value: 10, label: '10 นาที' },
  { value: 15, label: '15 นาที' },
];

const QA_TIME_OPTIONS = [
  { value: 0, label: 'ไม่จำกัด' },
  { value: 3, label: '3 นาที' },
  { value: 5, label: '5 นาที' },
  { value: 10, label: '10 นาที' },
];

function TimePicker({ label, value, options, maxMinutes, onChange }) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted">{label}</p>
        <span className="text-[11px] text-faint">สูงสุด {maxMinutes} นาที</span>
      </div>
      <div className="mt-2 grid grid-cols-4 gap-1.5">
        {options.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => onChange(t.value)}
            className={`rounded-lg border px-2 py-2 text-xs transition cursor-pointer ${
              value === t.value
                ? 'border-ink bg-ink text-paper font-medium'
                : 'border-line bg-white text-muted hover:border-faint hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <input
          type="number"
          min="0"
          max={maxMinutes}
          value={value || ''}
          onChange={(e) => {
            const num = Math.max(0, Math.min(maxMinutes, Number(e.target.value) || 0));
            onChange(num);
          }}
          placeholder={`กำหนดเวลาเอง (ไม่เกิน ${maxMinutes} นาที)`}
          className="w-full rounded-lg border border-line bg-paper px-3 py-1.5 text-xs text-ink focus:border-ink focus:outline-none"
        />
        <span className="shrink-0 text-xs text-muted">นาที</span>
      </div>
    </div>
  );
}

export default function RoomSetupModal({
  rehearsalMode = 'per_slide',
  onRehearsalModeChange,
  audience,
  onAudienceChange,
  timeBudget,
  onTimeBudgetChange,
  interruptEnabled,
  onInterruptToggle,
  useGeminiTts = false,
  onGeminiTtsToggle,
  cameraEnabled = true,
  onCameraToggle,
  confirmLabel = 'ถัดไป',
  onConfirm,
  onClose,
}) {
  const [step, setStep] = useState(1);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-[2px]">
      <div className="w-full max-w-lg rounded-2xl border border-line bg-white p-7 shadow-xl space-y-6">
        <div className="flex items-start justify-between border-b border-line pb-4">
          <div>
            <span className="inline-block rounded-full bg-paper border border-line px-2.5 py-0.5 text-[11px] font-medium text-muted">
              ขั้นตอนที่ {step} จาก 2
            </span>
            <h2 className="mt-2 text-lg font-semibold text-ink">
              {step === 1 ? 'เลือกรูปแบบและกลุ่มผู้ฟัง' : 'ตั้งเวลาและอุปกรณ์เสริม'}
            </h2>
            <p className="mt-0.5 text-xs text-muted">
              {step === 1
                ? 'กำหนดวิธีซ้อมและระดับความเข้มข้นของคำถาม'
                : 'กำหนดเป้าหมายเวลาและเปิด/ปิดฟีเจอร์เสริมได้ตามต้องการ'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2.5 py-1 text-xs text-muted hover:bg-paper hover:text-ink cursor-pointer"
          >
            ปิด
          </button>
        </div>

        {step === 1 ? (
          <div className="space-y-5">
            {onRehearsalModeChange && (
              <div>
                <p className="text-xs font-semibold text-ink">1. รูปแบบการซ้อม</p>
                <div className="mt-2.5 grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => onRehearsalModeChange('per_slide')}
                    className={`rounded-xl border px-3.5 py-3 text-left text-xs transition cursor-pointer ${
                      rehearsalMode === 'per_slide'
                        ? 'border-ink bg-ink text-paper'
                        : 'border-line bg-white text-muted hover:border-faint hover:text-ink'
                    }`}
                  >
                    <p className="font-semibold">ซ้อมทีละหน้า</p>
                    <p className={`mt-1 text-[11px] ${rehearsalMode === 'per_slide' ? 'text-paper/80' : 'text-faint'}`}>
                      หยุดดูผลและเช็ก AI ทีละหน้า
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => onRehearsalModeChange('continuous')}
                    className={`rounded-xl border px-3.5 py-3 text-left text-xs transition cursor-pointer ${
                      rehearsalMode === 'continuous'
                        ? 'border-ink bg-ink text-paper'
                        : 'border-line bg-white text-muted hover:border-faint hover:text-ink'
                    }`}
                  >
                    <p className="font-semibold">ซ้อมใหญ่ (พูดต่อเนื่อง)</p>
                    <p className={`mt-1 text-[11px] ${rehearsalMode === 'continuous' ? 'text-paper/80' : 'text-faint'}`}>
                      กดเริ่มครั้งเดียว พูดรวดเดียวจบ
                    </p>
                  </button>
                </div>
              </div>
            )}

            <div>
              <p className="text-xs font-semibold text-ink">{onRehearsalModeChange ? '2. ' : '1. '}คนฟังคือใคร</p>
              <div className="mt-2.5 grid grid-cols-3 gap-2.5">
                {AUDIENCES.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => onAudienceChange(a.id)}
                    className={`rounded-xl border px-3 py-3 text-xs transition cursor-pointer ${
                      audience === a.id
                        ? 'border-ink bg-ink text-paper font-semibold'
                        : 'border-line bg-white text-muted hover:border-faint hover:text-ink'
                    }`}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-5 max-h-[60vh] overflow-y-auto pr-1">
            <div className="rounded-xl border border-line bg-paper/50 p-4 space-y-4">
              <p className="text-xs font-semibold text-ink">เป้าหมายเวลา</p>
              <TimePicker
                label="เวลาพรีเซนต์"
                value={timeBudget.presentMinutes}
                options={PRESENT_TIME_OPTIONS}
                maxMinutes={30}
                onChange={(v) => onTimeBudgetChange({ ...timeBudget, presentMinutes: v })}
              />
              <TimePicker
                label="เวลาถาม-ตอบ"
                value={timeBudget.qaMinutes}
                options={QA_TIME_OPTIONS}
                maxMinutes={15}
                onChange={(v) => onTimeBudgetChange({ ...timeBudget, qaMinutes: v })}
              />
            </div>

            <div className="space-y-2.5">
              <p className="text-xs font-semibold text-ink">อุปกรณ์และตัวเลือกเสริม</p>
              <div className="flex items-center justify-between rounded-xl border border-line bg-paper px-4 py-3">
                <div>
                  <p className="text-xs font-medium text-ink">สุ่มถามแทรกระหว่างซ้อม (-1 Token/คำถาม)</p>
                  <p className="text-[11px] text-muted">มีคำถามแทรกสั้นๆ หลังพูดบางสไลด์ (ตรวจคำตอบ -1 Token)</p>
                </div>
                <button
                  type="button"
                  onClick={onInterruptToggle}
                  className={`rounded-full px-3.5 py-1 text-xs font-medium transition cursor-pointer ${
                    interruptEnabled ? 'bg-ink text-paper' : 'border border-line bg-white text-muted'
                  }`}
                >
                  {interruptEnabled ? 'เปิด' : 'ปิด'}
                </button>
              </div>

              {onCameraToggle && (
                <div className="flex items-center justify-between rounded-xl border border-line bg-paper px-4 py-3">
                  <div>
                    <p className="text-xs font-medium text-ink">เปิดกล้องเช็กสายตา & อัดวิดีโอ</p>
                    <p className="text-[11px] text-muted">เปิดต่อเนื่องอัตโนมัติทั้งช่วงซ้อมพูดและช่วงถาม-ตอบ</p>
                  </div>
                  <button
                    type="button"
                    onClick={onCameraToggle}
                    className={`rounded-full px-3.5 py-1 text-xs font-medium transition cursor-pointer ${
                      cameraEnabled ? 'bg-ink text-paper' : 'border border-line bg-white text-muted'
                    }`}
                  >
                    {cameraEnabled ? 'เปิด' : 'ปิด'}
                  </button>
                </div>
              )}

              {onGeminiTtsToggle && (
                <div className="flex items-center justify-between rounded-xl border border-line bg-paper px-4 py-3">
                  <div>
                    <p className="text-xs font-medium text-ink">เสียงอ่านคำถาม Gemini TTS (-1 Token/ข้อ)</p>
                    <p className="text-[11px] text-muted">เปิดเมื่อต้องการเสียงธรรมชาติ (ปิดไว้ใช้เสียงเครื่องฟรี)</p>
                  </div>
                  <button
                    type="button"
                    onClick={onGeminiTtsToggle}
                    className={`rounded-full px-3.5 py-1 text-xs font-medium transition cursor-pointer ${
                      useGeminiTts ? 'bg-ink text-paper' : 'border border-line bg-white text-muted'
                    }`}
                  >
                    {useGeminiTts ? 'เปิด' : 'ปิด'}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-line pt-4">
          <button
            type="button"
            onClick={step === 1 ? onClose : () => setStep(1)}
            className="rounded-lg border border-line px-4 py-2.5 text-sm text-muted hover:border-faint hover:text-ink cursor-pointer"
          >
            {step === 1 ? 'ยกเลิก' : '← ย้อนกลับ'}
          </button>
          {step === 1 ? (
            <button
              type="button"
              onClick={() => setStep(2)}
              className="rounded-lg bg-accent px-6 py-2.5 text-sm font-medium text-white hover:bg-accent/90 cursor-pointer"
            >
              ถัดไป →
            </button>
          ) : (
            <button
              type="button"
              onClick={onConfirm}
              className="rounded-lg bg-accent px-6 py-2.5 text-sm font-medium text-white hover:bg-accent/90 cursor-pointer"
            >
              {confirmLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
