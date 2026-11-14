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
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-[2px]">
      <div className="w-full max-w-lg rounded-2xl border border-line bg-white p-6 shadow-xl space-y-5">
        <div className="flex items-center justify-between border-b border-line pb-3">
          <div>
            <h2 className="text-base font-semibold text-ink">ตั้งค่าห้องซ้อม</h2>
            <p className="text-xs text-muted">ปรับรูปแบบผู้ฟังและเวลาให้ตรงกับงานของคุณ</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-xs text-muted hover:bg-paper hover:text-ink cursor-pointer"
          >
            ปิด
          </button>
        </div>

        {onRehearsalModeChange && (
          <div>
            <p className="text-xs font-medium text-muted">รูปแบบการซ้อม</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => onRehearsalModeChange('per_slide')}
                className={`rounded-lg border px-3 py-2.5 text-left text-xs transition cursor-pointer ${
                  rehearsalMode === 'per_slide'
                    ? 'border-ink bg-ink text-paper'
                    : 'border-line bg-white text-muted hover:border-faint hover:text-ink'
                }`}
              >
                <p className="font-medium">ซ้อมทีละหน้า</p>
                <p className={`mt-0.5 text-[11px] ${rehearsalMode === 'per_slide' ? 'text-paper/75' : 'text-faint'}`}>
                  หยุดดูผลและเช็ก AI ทีละหน้า
                </p>
              </button>
              <button
                type="button"
                onClick={() => onRehearsalModeChange('continuous')}
                className={`rounded-lg border px-3 py-2.5 text-left text-xs transition cursor-pointer ${
                  rehearsalMode === 'continuous'
                    ? 'border-ink bg-ink text-paper'
                    : 'border-line bg-white text-muted hover:border-faint hover:text-ink'
                }`}
              >
                <p className="font-medium">ซ้อมใหญ่ (พูดต่อเนื่อง)</p>
                <p className={`mt-0.5 text-[11px] ${rehearsalMode === 'continuous' ? 'text-paper/75' : 'text-faint'}`}>
                  กดเริ่มครั้งเดียว พูดรวดเดียวจบ
                </p>
              </button>
            </div>
          </div>
        )}

        <div>
          <p className="text-xs font-medium text-muted">คนฟังคือใคร</p>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {AUDIENCES.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => onAudienceChange(a.id)}
                className={`rounded-lg border px-3 py-2.5 text-xs transition cursor-pointer ${
                  audience === a.id
                    ? 'border-ink bg-ink text-paper font-medium'
                    : 'border-line bg-white text-muted hover:border-faint hover:text-ink'
                }`}
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-4">
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
          <div className="flex items-center justify-between rounded-xl border border-line bg-paper px-4 py-3">
            <div>
              <p className="text-xs font-medium text-ink">สุ่มถามแทรกระหว่างซ้อม (-1 Token/คำถาม)</p>
              <p className="text-[11px] text-muted">มีคำถามแทรกสั้นๆ หลังพูดบางสไลด์ (ตรวจคำตอบ -1 Token)</p>
            </div>
            <button
              type="button"
              onClick={onInterruptToggle}
              className={`rounded-full px-3.5 py-1 text-xs font-medium transition cursor-pointer ${
                interruptEnabled
                  ? 'bg-ink text-paper'
                  : 'border border-line bg-white text-muted'
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
                  cameraEnabled
                    ? 'bg-ink text-paper'
                    : 'border border-line bg-white text-muted'
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
                  useGeminiTts
                    ? 'bg-ink text-paper'
                    : 'border border-line bg-white text-muted'
                }`}
              >
                {useGeminiTts ? 'เปิด' : 'ปิด'}
              </button>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-line px-4 py-2.5 text-sm text-muted hover:border-faint hover:text-ink cursor-pointer"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-lg bg-ink px-5 py-2.5 text-sm font-medium text-paper hover:bg-ink/85 cursor-pointer"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
