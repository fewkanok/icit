import { useState } from 'react';
import RoomSetupModal from './RoomSetupModal';
import { ModeBadge } from './ui/StateViews';
import {
  ArrowRightIcon,
  BarChartIcon,
  MicIcon,
  PresentationIcon,
  UserIcon,
  UsersIcon,
} from './ui/Icons';

const ONBOARDING_STEPS = [
  {
    num: '01',
    icon: PresentationIcon,
    title: 'เตรียมสไลด์',
    desc: 'อัปโหลด PDF / รูป หรือเลือกเฉพาะหน้าที่จะซ้อม',
  },
  {
    num: '02',
    icon: MicIcon,
    title: 'ซ้อมพูดจริง',
    desc: 'จับเวลา เช็กความเร็วพูด คำติดปาก และสบตากล้อง',
  },
  {
    num: '03',
    icon: BarChartIcon,
    title: 'สรุป & เทียบรอบ',
    desc: 'ดูผลพัฒนาการ Q&A รวมคลิป และบันทึกประวัติ',
  },
];

export default function ModeStep({
  rehearsalMode,
  onRehearsalModeChange,
  audience,
  onAudienceChange,
  timeBudget,
  onTimeBudgetChange,
  interruptEnabled,
  onInterruptToggle,
  cameraEnabled = true,
  onCameraToggle,
  onNext,
  onEnterGroup,
}) {
  const [setupOpen, setSetupOpen] = useState(false);
  const [showGuide, setShowGuide] = useState(() => {
    if (typeof window === 'undefined') return true;
    return window.localStorage.getItem('icit_onboarding_dismissed') !== '1';
  });

  const dismissGuide = () => {
    setShowGuide(false);
    try {
      window.localStorage.setItem('icit_onboarding_dismissed', '1');
    } catch {
      // ignore
    }
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-3 py-8 sm:px-6 sm:py-14 space-y-8 sm:space-y-10">
      <div className="text-center space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-4xl break-words">
          ซ้อมพรีเซนต์งานอย่างมั่นใจ
        </h1>
        <p className="mx-auto max-w-2xl text-sm sm:text-base text-muted break-words">
          เลือกรูปแบบการซ้อมที่เหมาะกับงานของคุณ ระบบจะช่วยวิเคราะห์จังหวะพูด สายตา และจำลองถาม-ตอบ Q&amp;A
        </p>
      </div>

      {/* 3-Step Strip (ไร้เส้นขอบซ้อน ใช้พื้นผิวต่างระดับอย่างเดียว) */}
      {showGuide ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">
              เริ่มต้นใช้งานใน 3 ขั้นตอน
            </p>
            <button
              type="button"
              onClick={dismissGuide}
              className="rounded-md px-2.5 py-1 text-xs text-muted transition hover:bg-white hover:text-ink cursor-pointer"
            >
              ซ่อน
            </button>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {ONBOARDING_STEPS.map((s) => {
              const Icon = s.icon;
              return (
                <div
                  key={s.num}
                  className="flex items-start gap-3.5 rounded-2xl bg-white/80 p-4 shadow-[0_1px_3px_rgba(27,27,26,0.05)]"
                >
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-paper text-accent">
                    <Icon className="size-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink">
                      <span className="mr-1.5 font-mono text-xs text-muted">{s.num}</span>
                      {s.title}
                    </p>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted">{s.desc}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => setShowGuide(true)}
            className="rounded-full bg-white px-4 py-1.5 text-xs font-medium text-muted shadow-xs transition hover:text-ink cursor-pointer"
          >
            แสดงคำแนะนำการใช้งาน (3 ขั้นตอน)
          </button>
        </div>
      )}

      {/* Hero Mode Cards (ใช้ Surface Contrast + Subtle Shadow แทนเส้นขอบซ้อน) */}
      <div className="grid grid-cols-1 gap-5 sm:gap-6 md:grid-cols-2">
        <button
          type="button"
          onClick={() => setSetupOpen(true)}
          className="group flex w-full min-w-0 flex-col justify-between rounded-2xl bg-white p-5 sm:p-7 text-left shadow-[0_2px_10px_rgba(27,27,26,0.06)] ring-1 ring-black/5 transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(27,27,26,0.09)] cursor-pointer"
        >
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-paper text-ink">
                  <UserIcon className="size-5" />
                </span>
                <ModeBadge mode="solo" />
              </div>
              <span className="text-xs text-muted">1 คน · เครื่องเดียว</span>
            </div>
            <div>
              <h2 className="text-lg sm:text-xl font-semibold text-ink break-words">ซ้อมพรีเซนต์เดี่ยว</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-muted break-words">
                ฝึกพูดคนเดียวทีละสไลด์หรือซ้อมใหญ่ต่อเนื่อง พร้อมตัวช่วยวิเคราะห์ครบชุด
              </p>
            </div>
            <ul className="space-y-2 rounded-xl bg-paper/75 p-4 text-sm text-ink/90 break-words">
              <li>• เลือกซ้อมเฉพาะหน้าสไลด์ที่ต้องการได้</li>
              <li>• ใช้มือถือเป็นรีโมตควบคุมสไลด์ได้</li>
              <li>• บันทึกประวัติ + เทียบรอบ + รวมคลิปอัตโนมัติ</li>
            </ul>
          </div>
          <span className="mt-6 inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-ink px-5 py-3 text-sm font-semibold text-paper transition group-hover:bg-ink/90">
            เริ่มตั้งค่าซ้อมเดี่ยว
            <ArrowRightIcon className="size-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
          </span>
        </button>

        <button
          type="button"
          onClick={onEnterGroup}
          className="group flex w-full min-w-0 flex-col justify-between rounded-2xl bg-white p-5 sm:p-7 text-left shadow-[0_2px_10px_rgba(27,27,26,0.06)] ring-1 ring-black/5 transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(217,72,15,0.12)] cursor-pointer"
        >
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
                  <UsersIcon className="size-5" />
                </span>
                <ModeBadge mode="group" />
              </div>
              <span className="text-xs text-muted">2–6 คน · ออนไลน์คนละเครื่อง</span>
            </div>
            <div>
              <h2 className="text-lg sm:text-xl font-semibold text-ink break-words">ซ้อมพรีเซนต์กลุ่ม</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-muted break-words">
                สร้างห้องแชร์ลิงก์ให้เพื่อนเข้ามาซ้อมต่อคิวพูดจากคนละเครื่องแบบเรียลไทม์
              </p>
            </div>
            <ul className="space-y-2 rounded-xl bg-paper/75 p-4 text-sm text-ink/90 break-words">
              <li>• แบ่งคิวคนพูดตามหน้าสไลด์ ซิงก์ตรงกันทั้งห้อง</li>
              <li>• สลับกล้อง/เสียงผู้พูดอัตโนมัติตามสไลด์</li>
              <li>• หัวหน้ากลุ่มบันทึก History ให้เพื่อนเห็นร่วมกันได้</li>
            </ul>
          </div>
          <span className="mt-6 inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-white transition group-hover:bg-accent/90">
            สร้าง / เข้าร่วมห้องกลุ่ม
            <ArrowRightIcon className="size-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
          </span>
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
