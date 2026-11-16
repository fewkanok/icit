import { useState } from 'react';

const AUDIENCES = [
  { id: 'general', label: 'คนทั่วไป' },
  { id: 'teacher', label: 'อาจารย์ / กรรมการ' },
  { id: 'executive', label: 'ผู้บริหาร' },
];

const PRESENT_PRESETS = [
  { label: 'ไม่จำกัด', mins: 0 },
  { label: '5 นาที', mins: 5 },
  { label: '10 นาที', mins: 10 },
  { label: '15 นาที', mins: 15 },
];

const QA_PRESETS = [
  { label: 'ไม่จำกัด', mins: 0 },
  { label: '3 นาที', mins: 3 },
  { label: '5 นาที', mins: 5 },
  { label: '10 นาที', mins: 10 },
];

export default function GroupSetupModal({
  settings,
  currentMemberCount = 1,
  onSave,
  onClose,
}) {
  const [step, setStep] = useState(1);
  const [audience, setAudience] = useState(settings?.audience || 'general');
  const [maxMembers, setMaxMembers] = useState(settings?.maxMembers || 6);
  const [presentMins, setPresentMins] = useState(settings?.presentMins ?? 5);
  const [qaMins, setQaMins] = useState(settings?.qaMins ?? 5);
  const [interruptEnabled, setInterruptEnabled] = useState(Boolean(settings?.interruptEnabled));
  const [allowAnySlideControl, setAllowAnySlideControl] = useState(
    Boolean(settings?.allowAnySlideControl),
  );

  const minAllowed = Math.max(2, currentMemberCount);

  const handleConfirm = () => {
    onSave({
      audience,
      maxMembers: Math.max(minAllowed, Math.min(6, Number(maxMembers) || 6)),
      presentMins: Math.max(0, Math.min(30, Number(presentMins) || 0)),
      qaMins: Math.max(0, Math.min(15, Number(qaMins) || 0)),
      useGeminiTts: false,
      interruptEnabled,
      allowAnySlideControl,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-xs">
      <div className="w-full max-w-lg rounded-2xl border border-line bg-white p-6 shadow-2xl space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <span className="inline-block rounded-full border border-line bg-paper px-3 py-0.5 text-[11px] font-medium text-muted">
              ขั้นตอนที่ {step} จาก 2
            </span>
            <h2 className="mt-2 text-lg font-semibold text-ink">
              {step === 1 ? 'เลือกกลุ่มผู้ฟังและจำนวนคน' : 'ตั้งเวลาและอุปกรณ์เสริม'}
            </h2>
            <p className="mt-0.5 text-xs text-muted">
              {step === 1
                ? 'กำหนดระดับความเข้มข้นของคำถาม AI และจำนวนคนสูงสุดในห้อง'
                : 'กำหนดเป้าหมายเวลาพรีเซนต์ เวลาถาม-ตอบ และเสียงอ่านคำถาม'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-muted hover:text-ink cursor-pointer"
          >
            ปิด
          </button>
        </div>

        <div className="border-t border-line pt-4">
          {step === 1 ? (
            <div className="space-y-5">
              <div>
                <p className="text-xs font-semibold text-ink">1. คนฟังคือใคร</p>
                <div className="mt-2.5 grid grid-cols-3 gap-2">
                  {AUDIENCES.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setAudience(a.id)}
                      className={`rounded-xl border px-3 py-2.5 text-xs font-medium transition cursor-pointer ${
                        audience === a.id
                          ? 'border-ink bg-ink text-paper'
                          : 'border-line bg-white text-ink hover:border-faint'
                      }`}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-ink">2. จำนวนสมาชิกสูงสุดในห้อง</p>
                  <span className="text-[11px] text-muted">แนะนำไม่เกิน 6 คน</span>
                </div>
                <div className="mt-2.5 grid grid-cols-5 gap-2">
                  {[2, 3, 4, 5, 6].map((n) => {
                    const disabled = n < minAllowed;
                    return (
                      <button
                        key={n}
                        type="button"
                        disabled={disabled}
                        onClick={() => setMaxMembers(n)}
                        className={`rounded-xl border py-2.5 text-xs font-medium transition ${
                          maxMembers === n
                            ? 'border-ink bg-ink text-paper'
                            : 'border-line bg-white text-ink hover:border-faint'
                        } ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
                      >
                        {n} คน
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border border-line bg-paper/40 p-4 space-y-4">
                <p className="text-xs font-semibold text-ink">เป้าหมายเวลา</p>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted">เวลาพรีเซนต์</span>
                    <span className="text-[11px] text-faint">สูงสุด 30 นาที</span>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {PRESENT_PRESETS.map((p) => (
                      <button
                        key={p.mins}
                        type="button"
                        onClick={() => setPresentMins(p.mins)}
                        className={`rounded-lg border py-2 text-xs font-medium transition cursor-pointer ${
                          Number(presentMins) === p.mins
                            ? 'border-ink bg-ink text-paper'
                            : 'border-line bg-white text-ink hover:border-faint'
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      max={30}
                      value={presentMins}
                      onChange={(e) =>
                        setPresentMins(Math.max(0, Math.min(30, Number(e.target.value) || 0)))
                      }
                      className="w-full rounded-lg border border-line bg-white px-3 py-1.5 text-xs text-ink focus:border-ink focus:outline-none"
                    />
                    <span className="shrink-0 text-xs text-muted">นาที</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted">เวลาถาม-ตอบ</span>
                    <span className="text-[11px] text-faint">สูงสุด 15 นาที</span>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {QA_PRESETS.map((p) => (
                      <button
                        key={p.mins}
                        type="button"
                        onClick={() => setQaMins(p.mins)}
                        className={`rounded-lg border py-2 text-xs font-medium transition cursor-pointer ${
                          Number(qaMins) === p.mins
                            ? 'border-ink bg-ink text-paper'
                            : 'border-line bg-white text-ink hover:border-faint'
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      max={15}
                      value={qaMins}
                      onChange={(e) =>
                        setQaMins(Math.max(0, Math.min(15, Number(e.target.value) || 0)))
                      }
                      className="w-full rounded-lg border border-line bg-white px-3 py-1.5 text-xs text-ink focus:border-ink focus:outline-none"
                    />
                    <span className="shrink-0 text-xs text-muted">นาที</span>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-semibold text-ink">อุปกรณ์และตัวเลือกเสริม</p>
                <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-paper/50 px-4 py-3">
                  <div>
                    <p className="text-xs font-medium text-ink">
                      สุ่มถามแทรกระหว่างซ้อม (-1 Token/คำถาม)
                    </p>
                    <p className="text-[11px] text-muted">
                      มีคำถามแทรกสั้นๆ หลังพูดจบสไลด์บางหน้า (~20% เมื่อมี 3 หน้าขึ้นไป)
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setInterruptEnabled((v) => !v)}
                    className={`shrink-0 rounded-full px-3.5 py-1 text-xs font-medium transition cursor-pointer ${
                      interruptEnabled
                        ? 'bg-ink text-paper'
                        : 'border border-line bg-white text-muted'
                    }`}
                  >
                    {interruptEnabled ? 'เปิด' : 'ปิด'}
                  </button>
                </div>

                <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-paper/50 px-4 py-3">
                  <div>
                    <p className="text-xs font-medium text-ink">
                      ให้เพื่อนในห้องช่วยกดเลื่อนสไลด์ได้
                    </p>
                    <p className="text-[11px] text-muted">
                      เปิดเมื่ออยากให้สมาชิกคนอื่นกดเปลี่ยนสไลด์แทนคนพูดได้
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAllowAnySlideControl((v) => !v)}
                    className={`shrink-0 rounded-full px-3.5 py-1 text-xs font-medium transition cursor-pointer ${
                      allowAnySlideControl
                        ? 'bg-ink text-paper'
                        : 'border border-line bg-white text-muted'
                    }`}
                  >
                    {allowAnySlideControl ? 'เปิด' : 'ปิด'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-line pt-4">
          {step === 1 ? (
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-line px-4 py-2 text-xs font-medium text-ink hover:border-faint cursor-pointer"
            >
              ยกเลิก
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setStep(1)}
              className="rounded-xl border border-line px-4 py-2 text-xs font-medium text-ink hover:border-faint cursor-pointer"
            >
              ← ย้อนกลับ
            </button>
          )}

          {step === 1 ? (
            <button
              type="button"
              onClick={() => setStep(2)}
              className="rounded-xl bg-accent px-5 py-2 text-xs font-semibold text-white hover:bg-accent/90 cursor-pointer"
            >
              ถัดไป →
            </button>
          ) : (
            <button
              type="button"
              onClick={handleConfirm}
              className="rounded-xl bg-accent px-5 py-2 text-xs font-semibold text-white hover:bg-accent/90 cursor-pointer"
            >
              บันทึกการตั้งค่า
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
