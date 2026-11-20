export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-paper text-ink">
      <header className="sticky top-0 z-40 border-b border-line/80 bg-white/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between gap-3 px-4 sm:px-6">
          <a
            href="/"
            className="inline-flex items-center gap-2 text-base font-semibold tracking-tight text-ink transition hover:opacity-80"
          >
            <span className="size-2.5 shrink-0 rounded-full bg-accent" />
            <span>Zomgon</span>
          </a>
          <a
            href="/"
            className="rounded-xl bg-ink px-4 py-2 text-xs font-medium text-paper transition hover:bg-ink/85"
          >
            กลับหน้าหลัก
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14 space-y-6">
        <div className="space-y-2">
          <p className="font-mono text-xs uppercase tracking-wider text-accent">Privacy Policy</p>
          <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
            นโยบายความเป็นส่วนตัว (Zomgon)
          </h1>
          <p className="text-sm text-muted">
            อัปเดตล่าสุด: พฤศจิกายน 2026
          </p>
        </div>

        <div className="rounded-2xl border border-line bg-white p-6 sm:p-8 shadow-[0_1px_4px_rgba(27,27,26,0.05)] space-y-6 text-sm leading-relaxed text-ink">
          <section className="space-y-2">
            <h2 className="text-base font-semibold text-ink">1. ข้อมูลที่เราจัดเก็บ</h2>
            <p className="text-muted">
              เมื่อคุณเข้าสู่ระบบ Zomgon ด้วยบัญชี Google เราจะจัดเก็บเฉพาะข้อมูลที่จำเป็นต่อการให้บริการ ได้แก่:
            </p>
            <ul className="list-disc pl-5 space-y-1 text-muted">
              <li>ชื่อที่แสดง อีเมล และรูปโปรไฟล์จากบัญชี Google ของคุณ</li>
              <li>ประวัติการซ้อมพรีเซนต์ สถิติความเร็วการพูด (WPM) สัดส่วนการสบตากล้อง คำถอดเสียง (Transcript) และคำแนะนำจาก AI ที่คุณเลือกบันทึก</li>
              <li>ยอด Token คงเหลือและประวัติการใช้งาน Token</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-ink">2. การใช้งานกล้องและไมโครโฟน</h2>
            <p className="text-muted">
              การตรวจจับการสบตากล้อง (Eye Contact) และการถอดเสียงพูดระหว่างซ้อมทำงานบนอุปกรณ์ของคุณโดยตรง (Client-side Processing) ผ่านเบราว์เซอร์ ระบบจะไม่บันทึกหรืออัปโหลดวิดีโอขึ้นเซิร์ฟเวอร์โดยอัตโนมัติ เว้นแต่คุณจะกดบันทึกหรืออัปโหลดคลิปขึ้นคลาวด์ด้วยตนเอง
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-ink">3. การจัดเก็บไฟล์วิดีโอและความปลอดภัย</h2>
            <ul className="list-disc pl-5 space-y-1 text-muted">
              <li>คลิปวิดีโอที่คุณอัปโหลดขึ้นคลาวด์ถูกจัดเก็บในพื้นที่ส่วนตัว (Private Storage) และเข้าถึงได้ผ่านลิงก์ชั่วคราวที่มีวันหมดอายุ (Signed URLs) เท่านั้น</li>
              <li>ฐานข้อมูลมีการควบคุมสิทธิ์ระดับแถว (Row-Level Security) และการยืนยันตัวตนฝั่งเซิร์ฟเวอร์ทุกครั้งที่เรียกใช้งาน</li>
              <li>คุณสามารถเปิดหรือปิดลิงก์แชร์สาธารณะ รวมถึงลบคลิปวิดีโอและประวัติการซ้อมของคุณได้เองทุกเมื่อ</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-ink">4. การประมวลผลด้วย AI</h2>
            <p className="text-muted">
              เมื่อคุณกดใช้ฟีเจอร์วิเคราะห์บทพูด สุ่มคำถาม Q&amp;A หรือสรุปผลการซ้อม ข้อความจากสไลด์และคำถอดเสียงพูดจะถูกส่งไปยัง Google Gemini API ผ่านเซิร์ฟเวอร์ของ Zomgon เพื่อสร้างคำแนะนำให้คุณโดยเฉพาะ
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-ink">5. สิทธิ์ของผู้ใช้งาน</h2>
            <p className="text-muted">
              คุณสามารถดูและลบประวัติการซ้อม รวมถึงคลิปวิดีโอที่บันทึกไว้ได้ตลอดเวลาผ่านหน้า "ประวัติการซ้อม" ภายในแอป หากต้องการขอลบบัญชีหรือสอบถามเพิ่มเติมเกี่ยวกับข้อมูลส่วนบุคคล สามารถติดต่อทีมผู้พัฒนาได้ผ่านช่องทางติดต่อของ Zomgon
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
