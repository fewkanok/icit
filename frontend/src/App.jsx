import { Component, Suspense, lazy, useEffect, useMemo, useState } from 'react';
import Header from './components/Header';
import ModeStep from './components/ModeStep';
import { OfflineBanner, ServerWakeBanner, SessionExpiredNotice } from './components/ui/StateViews';
import { ConfirmDialogHost, askConfirm, resetConfirmSuppressions } from './components/ConfirmModal';
import { analyze } from './lib/metrics';
import { API_BASE, fetchLangmindPreset, fetchMe } from './lib/api';
import { signInWithGoogle, signOut, supabase } from './lib/supabase';

const UploadStep = lazy(() => import('./components/UploadStep'));
const RehearsalStep = lazy(() => import('./components/RehearsalStep'));
const QaStep = lazy(() => import('./components/QaStep'));
const SummaryStep = lazy(() => import('./components/SummaryStep'));
const RemotePage = lazy(() => import('./components/RemotePage'));
const PublicSharePage = lazy(() => import('./components/PublicSharePage'));
const GroupLobbyStep = lazy(() => import('./components/GroupLobbyStep'));
const WalletModal = lazy(() => import('./components/WalletModal'));
const HistoryModal = lazy(() => import('./components/HistoryModal'));
const PrivacyPage = lazy(() => import('./components/PrivacyPage'));

function LazyFallback() {
  return (
    <div className="mx-auto flex max-w-5xl items-center justify-center px-6 py-20">
      <div className="inline-flex items-center gap-2.5 rounded-xl border border-line bg-white px-4 py-2.5 text-xs font-medium text-muted shadow-xs">
        <span className="size-2 rounded-full bg-accent animate-pulse" aria-hidden="true" />
        <span>กำลังโหลดหน้า...</span>
      </div>
    </div>
  );
}

class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="mx-auto max-w-lg px-6 py-16">
          <div className="rounded-2xl border border-accent/30 bg-white p-6 space-y-4">
            <h2 className="text-base font-semibold text-ink">เกิดข้อผิดพลาดในการแสดงผล</h2>
            <p className="rounded-lg bg-paper px-3 py-2 font-mono text-xs text-accent break-all">
              {this.state.error?.message || String(this.state.error)}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => this.setState({ error: null })}
                className="rounded-xl border border-line bg-white px-4 py-2 text-xs font-medium text-ink hover:border-faint cursor-pointer"
              >
                ลองแสดงผลอีกครั้ง
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="rounded-xl bg-ink px-4 py-2 text-xs font-semibold text-paper hover:opacity-90 cursor-pointer"
              >
                รีเฟรชหน้า
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const isPrivacyPage =
    typeof window !== 'undefined' && /^\/privacy\/?$/i.test(window.location.pathname);

  const publicShareId =
    typeof window !== 'undefined'
      ? (() => {
          const m = window.location.pathname.match(/^\/share\/([^/]+)\/?$/);
          if (m?.[1]) return decodeURIComponent(m[1]).trim();
          const q = new URLSearchParams(window.location.search).get('share');
          return q ? q.trim() : '';
        })()
      : '';

  const remoteCode =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('remote')
      : null;

  const initialGroupCode =
    typeof window !== 'undefined'
      ? (new URLSearchParams(window.location.search).get('group') || '').trim().toUpperCase()
      : '';

  const initialPresetCode =
    typeof window !== 'undefined'
      ? (new URLSearchParams(window.location.search).get('preset') || '').trim().toUpperCase()
      : '';

  const initialLmDeckParam =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('lmDeck')
      : null;

  const initialZParam =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('z')
      : null;

  const initialHasSimpleSlides =
    typeof window !== 'undefined'
      ? Boolean(
          new URLSearchParams(window.location.search).get('s1') ||
            new URLSearchParams(window.location.search).get('pdfId'),
        )
      : false;

  const [step, setStep] = useState(
    initialGroupCode
      ? 'group'
      : initialPresetCode || initialLmDeckParam || initialZParam || initialHasSimpleSlides
        ? 'upload'
        : 'mode',
  );
  const [deck, setDeck] = useState(null); // { name, slides }
  const [slideSelection, setSlideSelection] = useState({ deckRef: null, indices: null });
  const selectedSlideIndices =
    slideSelection.deckRef === deck ? slideSelection.indices : null;
  const activeDeck = useMemo(() => {
    if (!deck) return null;
    if (!selectedSlideIndices || selectedSlideIndices.length === 0) return deck;
    const filtered = selectedSlideIndices.map((i) => deck.slides[i]).filter(Boolean);
    return filtered.length > 0 ? { ...deck, slides: filtered } : deck;
  }, [deck, selectedSlideIndices]);
  const [rehearsalMode, setRehearsalMode] = useState('per_slide'); // per_slide | continuous
  const [audience, setAudience] = useState('general');
  const [timeBudget, setTimeBudget] = useState({ presentMinutes: 5, qaMinutes: 5 });
  const [results, setResults] = useState({}); // { [slideIndex]: analysis }
  const [interruptEnabled, setInterruptEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [interruptResults, setInterruptResults] = useState({}); // { [slideIndex]: evalObj }
  const [qaResults, setQaResults] = useState([]);
  const [aiSummary, setAiSummary] = useState(null);
  const [compareAiCache, setCompareAiCache] = useState({});
  const [savedSessionId, setSavedSessionId] = useState(null);
  const [soloSeriesId, setSoloSeriesId] = useState(() => `solo_${Date.now().toString(36)}`);
  const [rehearsalIndex, setRehearsalIndex] = useState(0); // หน้าสไลด์ที่จะซ้อม
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(Boolean(supabase));
  const [signingIn, setSigningIn] = useState(false);
  const [authRetryNeeded, setAuthRetryNeeded] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [linePdfLoading, setLinePdfLoading] = useState(null);
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const [sessionExpired, setSessionExpired] = useState(false);
  const [soloRoundsHistory, setSoloRoundsHistory] = useState(() => {
    if (typeof window === 'undefined') return [];
    try {
      // ล้างค่าเก่าที่เคยค้างใน localStorage (ย้ายมาใช้ sessionStorage เฉพาะเซสชันปัจจุบัน)
      window.localStorage.removeItem('icit_solo_rounds');
      const raw = window.sessionStorage.getItem('icit_solo_rounds');
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.slice(-10) : [];
    } catch {
      return [];
    }
  });

  const [serverWaking, setServerWaking] = useState(false);
  const [serverWakeSec, setServerWakeSec] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined' || isPrivacyPage) return undefined;
    let active = true;
    const startedAt = Date.now();
    const showTimer = setTimeout(() => {
      if (active) setServerWaking(true);
    }, 3500);
    const tickTimer = setInterval(() => {
      if (active) {
        setServerWakeSec(Math.floor((Date.now() - startedAt) / 1000));
      }
    }, 1000);

    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), 60000);
    fetch(`${API_BASE}/`, { signal: controller.signal })
      .catch(() => {})
      .finally(() => {
        clearTimeout(showTimer);
        clearTimeout(abortTimer);
        clearInterval(tickTimer);
        if (active) setServerWaking(false);
      });

    return () => {
      active = false;
      clearTimeout(showTimer);
      clearTimeout(abortTimer);
      clearInterval(tickTimer);
      controller.abort();
    };
  }, [isPrivacyPage]);

  useEffect(() => {
    const onTokensUpdated = (e) => {
      const nextBalance = e.detail;
      if (typeof nextBalance === 'number') {
        setUser((prev) => (prev ? { ...prev, tokenBalance: nextBalance } : prev));
      }
    };
    window.addEventListener('tokens-updated', onTokensUpdated);
    return () => window.removeEventListener('tokens-updated', onTokensUpdated);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const ref = params.get('ref');
    if (ref?.trim()) {
      localStorage.setItem('sq_ref', ref.trim().toUpperCase());
    }

    const autoStart = params.get('autoStart') === '1';

    if (initialZParam) {
      const decodeZ = async (zStr) => {
        const b64 = zStr.replace(/-/g, '+').replace(/_/g, '/');
        const padded = b64 + '==='.slice((b64.length + 3) % 4);
        const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
        try {
          return JSON.parse(new TextDecoder('utf-8').decode(bytes));
        } catch {
          const ds = new DecompressionStream('deflate-raw');
          const writer = ds.writable.getWriter();
          writer.write(bytes);
          writer.close();
          const outBuf = await new Response(ds.readable).arrayBuffer();
          return JSON.parse(new TextDecoder('utf-8').decode(outBuf));
        }
      };

      decodeZ(initialZParam)
        .then((data) => {
          const topic = String(data?.n || 'สไลด์จาก LangMind AI').trim();
          const rawSlides = Array.isArray(data?.sl) && data.sl.length > 0
            ? data.sl.map((s, idx) => ({
                title: s.t || s.title || `สไลด์หน้าที่ ${idx + 1}`,
                points: Array.isArray(s.p || s.points) ? (s.p || s.points) : [topic],
                script: s.s || s.script || '',
              }))
            : [
                {
                  title: `ที่มาและความสำคัญ (${topic})`,
                  points: [
                    'สภาพปัญหาปัจจุบันและเหตุผลที่ต้องพัฒนาโครงงานนี้',
                    'ช่องว่างของระบบเดิมและโอกาสในการนำเทคโนโลยีมาช่วย',
                    'ประโยชน์ที่คาดว่าจะได้รับจากโครงงาน',
                  ],
                  script: `สวัสดีคณะกรรมการทุกท่านครับ วันนี้พวกเราขอนำเสนอโครงงานเรื่อง ${topic} โดยเริ่มต้นจากปัญหาสำคัญที่เราพบในปัจจุบัน และเหตุผลที่ต้องพัฒนาโซลูชันนี้ขึ้นมาแก้ไขครับ`,
                },
                {
                  title: 'วัตถุประสงค์และขอบเขตของโครงงาน',
                  points: [
                    'วัตถุประสงค์หลักของการพัฒนาและวิจัย',
                    'ขอบเขตด้านระบบ กลุ่มเป้าหมาย และข้อมูลที่ใช้ทดสอบ',
                    'ตัวชี้วัดความสำเร็จของโครงงาน',
                  ],
                  script: `สำหรับวัตถุประสงค์หลักของโครงงาน ${topic} คือการพัฒนาระบบที่ตอบโจทย์ผู้ใช้งานจริงภายใต้ขอบเขตและตัวชี้วัดที่เราได้กำหนดไว้อย่างชัดเจนครับ`,
                },
                {
                  title: 'สถาปัตยกรรมระบบและวิธีการดำเนินงาน',
                  points: [
                    'ขั้นตอนการทำงานตั้งแต่รับข้อมูลจนถึงการประมวลผล',
                    'เครื่องมือ เทคโนโลยี และทฤษฎีที่เลือกใช้',
                    'การออกแบบส่วนติดต่อผู้ใช้และการเชื่อมต่อระบบ',
                  ],
                  script: `ในส่วนของวิธีการดำเนินงาน เราได้ออกแบบสถาปัตยกรรมระบบให้ทำงานเป็นลำดับขั้น ตั้งแต่การรับข้อมูล ประมวลผล ไปจนถึงการแสดงผลลัพธ์อย่างมีประสิทธิภาพครับ`,
                },
                {
                  title: 'ผลการทดลองและการประเมินประสิทธิภาพ',
                  points: [
                    'ผลการทดสอบการทำงานจริงเทียบกับเกณฑ์ที่ตั้งไว้',
                    'การวิเคราะห์ความแม่นยำและความเร็วในการประมวลผล',
                    'สรุปความพึงพอใจและผลกระทบจากการใช้งาน',
                  ],
                  script: `จากผลการทดลองและประเมินประสิทธิภาพ พบว่าระบบสามารถทำงานได้ตรงตามวัตถุประสงค์ที่ตั้งไว้ และช่วยลดเวลาการทำงานลงได้อย่างชัดเจนครับ`,
                },
                {
                  title: 'สรุปผล ข้อจำกัด และแนวทางการพัฒนาต่อยอด',
                  points: [
                    'สรุปผลสำเร็จตามวัตถุประสงค์ของโครงงาน',
                    'ข้อจำกัดที่พบระหว่างการพัฒนาและทดสอบจริง',
                    'แนวทางการขยายผลและพัฒนาต่อยอดในอนาคต',
                  ],
                  script: `โดยสรุป โครงงาน ${topic} สามารถตอบโจทย์ปัญหาที่ตั้งไว้ได้ครบถ้วน และพร้อมนำไปพัฒนาต่อยอดขยายผลในอนาคต ขอบคุณคณะกรรมการทุกท่านครับ พร้อมรับฟังคำถามครับ`,
                },
              ];

          const normalizedSlides = rawSlides.map((s, idx) => ({
            id: idx + 1,
            title: s.title,
            points: s.points,
            script: s.script,
            text: [s.title, s.points.join(' | '), s.script].filter(Boolean).join('\n'),
          }));

          setDeck({ name: topic, slides: normalizedSlides });
          if (['general', 'teacher', 'executive'].includes(data?.a)) {
            setAudience(data.a);
          }
          setRehearsalMode(
            data?.m === 'full' || data?.m === 'continuous' ? 'continuous' : 'per_slide',
          );
          setTimeBudget({
            presentMinutes: Number(data?.pm ?? 5),
            qaMinutes: Number(data?.qm ?? 5),
          });
          setRehearsalIndex(0);
          setStep(autoStart ? 'rehearsal' : 'upload');

          if (data?.pdfId) {
            const pdfId = String(data.pdfId).trim();
            const isCustomSlides = Array.isArray(data?.sl) && data.sl.length > 0;
            const renderBackendBase =
              import.meta.env.VITE_API_URL || 'https://icit.onrender.com';

            setLinePdfLoading({ done: 0, total: 0 });
            const fetchPdfBlob = async () => {
              // 1. ลองดึงผ่าน Vercel API ก่อน (เร็วสำหรับไฟล์ทั่วไป)
              const res1 = await fetch(`/api/line-pdf?id=${encodeURIComponent(pdfId)}`).catch(
                () => null,
              );
              if (res1 && res1.ok) return res1.blob();
              // 2. หากไฟล์มีขนาดใหญ่ (เช่น >4.5MB ถึง 87MB) ให้สตรีมผ่าน Backend หลักที่ไม่มีลิมิตขนาดไฟล์
              const res2 = await fetch(
                `${renderBackendBase}/api/langmind/line-pdf/${encodeURIComponent(pdfId)}`,
              );
              if (!res2.ok) throw new Error('ไม่สามารถดึงไฟล์ PDF จาก LINE ได้');
              return res2.blob();
            };

            fetchPdfBlob()
              .then(async (blob) => {
                const pdfFile = new File([blob], `${topic}.pdf`, { type: 'application/pdf' });
                const { filesToSlides } = await import('./lib/slides');
                const pdfSlides = await filesToSlides([pdfFile], (done, total) =>
                  setLinePdfLoading({ done, total }),
                );
                const merged = pdfSlides.map((s, idx) => {
                  const sc = isCustomSlides ? normalizedSlides[idx] : null;
                  const pageText = String(s.text || '').trim();
                  const autoScript = pageText
                    ? idx === 0
                      ? `สวัสดีคณะกรรมการทุกท่านครับ สำหรับสไลด์หน้าแรก ${pageText.slice(0, 260)} ครับ`
                      : `ในสไลด์หน้าที่ ${idx + 1} ประเด็นสำคัญคือ ${pageText.slice(0, 260)} ครับ`
                    : normalizedSlides[idx]?.script ||
                      `สไลด์หน้าที่ ${idx + 1} ของหัวข้อ ${topic} ครับ`;
                  const finalScript = sc?.script || autoScript;
                  const finalTitle =
                    sc?.title ||
                    (pageText ? pageText.split(/\s{2,}|\r?\n/)[0].slice(0, 70) : `หน้า ${idx + 1}`);
                  return {
                    ...s,
                    title: finalTitle,
                    points: sc?.points || s.points,
                    script: finalScript,
                    text: [finalTitle, pageText, `บทพูด: ${finalScript}`]
                      .filter(Boolean)
                      .join('\n'),
                  };
                });
                setDeck({ name: `${topic}.pdf`, slides: merged });
              })
              .catch((err) => {
                console.warn('[LINE PDF Auto-Load] ดึงไฟล์ PDF ไม่สำเร็จ:', err);
              })
              .finally(() => {
                setLinePdfLoading(null);
              });
          }
        })
        .catch((err) => {
          console.warn('[LangMind Z Param] ถอดรหัสลิงก์สไลด์ไม่สำเร็จ:', err);
        });
      return;
    }

    if (initialPresetCode) {
      fetchLangmindPreset(initialPresetCode)
        .then((preset) => {
          if (!preset?.slides?.length) return;
          setDeck({
            name: preset.deckName || 'สไลด์จาก LangMind AI',
            slides: preset.slides,
          });
          if (preset.audience) setAudience(preset.audience);
          if (preset.rehearsalMode) {
            setRehearsalMode(
              preset.rehearsalMode === 'full' ? 'continuous' : preset.rehearsalMode,
            );
          }
          if (preset.timeBudget) {
            setTimeBudget({
              presentMinutes: Number(preset.timeBudget.presentMinutes ?? 5),
              qaMinutes: Number(preset.timeBudget.qaMinutes ?? 5),
            });
          }
          setRehearsalIndex(0);
          setStep(autoStart ? 'rehearsal' : 'upload');
        })
        .catch((err) => {
          console.warn('[LangMind Preset] โหลดสไลด์จากลิงก์ไม่สำเร็จ:', err);
        });
      return;
    }

    if (initialLmDeckParam) {
      try {
        const parsed = JSON.parse(initialLmDeckParam);
        if (Array.isArray(parsed?.slides) && parsed.slides.length > 0) {
          const normalizedSlides = parsed.slides.map((s, idx) => {
            const title = String(s?.title || `สไลด์หน้าที่ ${idx + 1}`).trim();
            const script = String(s?.script || s?.text || '').trim();
            const points = Array.isArray(s?.points)
              ? s.points.map((p) => String(p).trim()).filter(Boolean)
              : [title];
            const text = [title, points.join(' | '), script].filter(Boolean).join('\n');
            return { id: idx + 1, title, points, script, text };
          });
          setDeck({
            name: parsed.deckName || parsed.name || 'สไลด์จาก LangMind AI',
            slides: normalizedSlides,
          });
          if (parsed.audience) setAudience(parsed.audience);
          if (parsed.rehearsalMode) {
            setRehearsalMode(
              parsed.rehearsalMode === 'full' ? 'continuous' : parsed.rehearsalMode,
            );
          }
          if (parsed.presentMinutes !== undefined || parsed.qaMinutes !== undefined) {
            setTimeBudget({
              presentMinutes: Number(parsed.presentMinutes ?? 5),
              qaMinutes: Number(parsed.qaMinutes ?? 5),
            });
          }
          setRehearsalIndex(0);
          setStep(autoStart ? 'rehearsal' : 'upload');
        }
      } catch (err) {
        console.warn('[LangMind URL Deck] แปลงข้อมูลสไลด์ไม่สำเร็จ:', err);
      }
      return;
    }

    if (initialHasSimpleSlides) {
      const cleanText = (str) =>
        String(str || '')
          .replace(/_/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

      const parsedSlides = [];
      for (let i = 1; i <= 15; i++) {
        const rawSlide = params.get(`s${i}`);
        if (!rawSlide) continue;
        // รูปแบบ: หัวข้อ:ประเด็น1,ประเด็น2,ประเด็น3|บทพูดเต็ม
        const [leftPart = '', scriptPart = ''] = rawSlide.split('|');
        const colonIdx = leftPart.indexOf(':');
        const rawTitle = colonIdx !== -1 ? leftPart.slice(0, colonIdx) : leftPart;
        const rawPoints = colonIdx !== -1 ? leftPart.slice(colonIdx + 1) : '';

        const title = cleanText(rawTitle) || `สไลด์หน้าที่ ${i}`;
        const script = cleanText(scriptPart);
        const points = rawPoints
          .split(',')
          .map((p) => cleanText(p))
          .filter(Boolean);
        const finalPoints = points.length > 0 ? points : [title];
        const text = [title, finalPoints.join(' | '), script].filter(Boolean).join('\n');

        parsedSlides.push({
          id: parsedSlides.length + 1,
          title,
          points: finalPoints,
          script,
          text,
        });
      }

      if (parsedSlides.length > 0) {
        const topic = cleanText(params.get('topic')) || 'สไลด์จาก LangMind AI';
        const aud = (params.get('aud') || params.get('audience') || 'teacher').trim();
        const mode = (params.get('mode') || 'per_slide').trim();
        const timeMin = Number(params.get('time') ?? params.get('presentMin') ?? 5);
        const qaMin = Number(params.get('qa') ?? params.get('qaMin') ?? 5);

        setDeck({
          name: topic,
          slides: parsedSlides,
        });
        if (['general', 'teacher', 'executive'].includes(aud)) {
          setAudience(aud);
        }
        setRehearsalMode(mode === 'full' || mode === 'continuous' ? 'continuous' : 'per_slide');
        setTimeBudget({
          presentMinutes: Number.isFinite(timeMin) ? timeMin : 5,
          qaMinutes: Number.isFinite(qaMin) ? qaMin : 5,
        });
        setRehearsalIndex(0);
        setStep(autoStart ? 'rehearsal' : 'upload');
      }

      // หากมี pdfId จากการส่งไฟล์ PDF ใน LINE OA ให้ดึงไฟล์ PDF จริงมาแปลงเป็นภาพสไลด์แล้วผูกกับบทพูดอัตโนมัติ
      const pdfId = (params.get('pdfId') || '').trim();
      if (pdfId) {
        const topic = cleanText(params.get('topic')) || 'สไลด์ PDF จาก LINE OA';
        fetch(`/api/line-pdf?id=${encodeURIComponent(pdfId)}`)
          .then(async (res) => {
            if (!res.ok) throw new Error('ไม่สามารถดึงไฟล์ PDF จาก LINE ได้');
            const blob = await res.blob();
            const pdfFile = new File([blob], `${topic}.pdf`, { type: 'application/pdf' });
            const { filesToSlides } = await import('./lib/slides');
            const pdfSlides = await filesToSlides([pdfFile]);
            const merged = pdfSlides.map((s, idx) => {
              const sc = parsedSlides[idx];
              if (!sc) return s;
              return {
                ...s,
                title: sc.title || s.title,
                points: sc.points || s.points,
                script: sc.script,
                text: [sc.title, s.text, sc.script ? `บทพูด: ${sc.script}` : '']
                  .filter(Boolean)
                  .join('\n'),
              };
            });
            setDeck({
              name: topic,
              slides: merged,
            });
          })
          .catch((err) => {
            console.warn('[LINE PDF Auto-Load] โหลดภาพสไลด์ PDF ไม่สำเร็จ ใช้สไลด์ข้อความแทน:', err);
          });
      }
    }
  }, [initialPresetCode, initialLmDeckParam, initialHasSimpleSlides]);

  useEffect(() => {
    if (!supabase) {
      setAuthLoading(false);
      return undefined;
    }

    let active = true;
    const syncSession = async (session) => {
      if (!session?.access_token) {
        if (active) {
          setUser(null);
          setAuthRetryNeeded(false);
          setAuthLoading(false);
        }
        return;
      }

      if (active) {
        setAuthLoading(true);
        setAuthRetryNeeded(false);
      }

      const retryDelays = [1500, 3000, 5000];
      let lastErr = null;
      for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
        if (!active) return;
        try {
          const ref = localStorage.getItem('sq_ref') || undefined;
          const dbUser = await fetchMe(ref);
          if (active) {
            setUser(dbUser);
            setAuthRetryNeeded(false);
          }
          if (ref) localStorage.removeItem('sq_ref');
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          if (attempt < retryDelays.length) {
            await new Promise((r) => setTimeout(r, retryDelays[attempt]));
          }
        }
      }

      if (lastErr) {
        console.warn('[Auth] Sync user failed:', lastErr);
        if (active) {
          // อย่าล้าง user เดิมทิ้งหากยังล็อกอิน Google ค้างอยู่ ให้ปุ่มลองเชื่อมต่อใหม่แทน
          setAuthRetryNeeded(true);
        }
      }

      if (active) setAuthLoading(false);
    };

    supabase.auth.getSession().then(({ data }) => {
      void syncSession(data?.session);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      void syncSession(session);
    });

    return () => {
      active = false;
      listener?.subscription?.unsubscribe();
    };
  }, []);

  const handleSignIn = async () => {
    setSigningIn(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      setSigningIn(false);
      alert(err.message || 'ไม่สามารถเข้าสู่ระบบด้วย Google ได้');
    }
  };

  const handleRetryAuth = async () => {
    if (!supabase) return;
    setAuthLoading(true);
    setAuthRetryNeeded(false);
    try {
      const { data } = await supabase.auth.getSession();
      if (!data?.session?.access_token) {
        setUser(null);
        return;
      }
      const ref = localStorage.getItem('sq_ref') || undefined;
      const dbUser = await fetchMe(ref);
      setUser(dbUser);
      if (ref) localStorage.removeItem('sq_ref');
    } catch (err) {
      console.warn('[Auth] Retry sync failed:', err);
      setAuthRetryNeeded(true);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    setUser(null);
    setAuthRetryNeeded(false);
  };

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    const onExpired = () => {
      try {
        window.sessionStorage.setItem(
          'icit_session_draft',
          JSON.stringify({
            savedAt: Date.now(),
            step,
            deckName: deck?.name || null,
            rehearsalMode,
            audience,
            transcripts: Object.entries(results).map(([k, v]) => ({
              slideIndex: Number(k),
              transcript: v?.transcript || '',
              duration: v?.duration || 0,
            })),
          }),
        );
      } catch {
        // ignore
      }
      setSessionExpired(true);
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('session-expired', onExpired);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('session-expired', onExpired);
    };
  }, [step, deck?.name, rehearsalMode, audience, results]);

  if (isPrivacyPage) {
    return (
      <Suspense fallback={<LazyFallback />}>
        <PrivacyPage />
      </Suspense>
    );
  }

  if (publicShareId) {
    return (
      <Suspense fallback={<LazyFallback />}>
        <PublicSharePage shareId={publicShareId} />
      </Suspense>
    );
  }

  if (remoteCode) {
    return (
      <Suspense fallback={<LazyFallback />}>
        <RemotePage code={remoteCode.trim().toUpperCase()} />
      </Suspense>
    );
  }

  const allQaResults = [
    ...Object.values(interruptResults).sort((a, b) => (a.slideIndex ?? 0) - (b.slideIndex ?? 0)),
    ...qaResults.filter(Boolean),
  ];

  const handleUpdateTranscript = (slideIndex, newTranscript) => {
    const current = results[slideIndex];
    if (!current) return;
    const reanalyzed = analyze(newTranscript, current.duration);
    setResults((prev) => ({
      ...prev,
      [slideIndex]: {
        ...current,
        ...reanalyzed,
      },
    }));
    setAiSummary(null);
  };

  return (
    <div className="flex min-h-screen flex-col">
      <Header
        step={step}
        user={user}
        authLoading={authLoading}
        signingIn={signingIn}
        authRetryNeeded={authRetryNeeded}
        onRetryAuth={handleRetryAuth}
        onSignIn={handleSignIn}
        onSignOut={handleSignOut}
        onOpenWallet={() => setWalletOpen(true)}
        onOpenHistory={() => setHistoryOpen(true)}
        onGoHome={async () => {
          const hasRecording =
            (step === 'rehearsal' || step === 'qa' || step === 'summary') &&
            Object.keys(results).length > 0;
          if (hasRecording) {
            const ok = await askConfirm({
              title: 'กลับหน้าแรก?',
              message: 'ข้อมูลการซ้อมและเสียงที่ยังไม่ได้บันทึกจะหายไป ยืนยันที่จะกลับหน้าแรกหรือไม่?',
              confirmText: 'กลับหน้าแรก',
              cancelText: 'อยู่หน้านี้ต่อ',
              danger: true,
            });
            if (!ok) return;
          }
          setHistoryOpen(false);
          setSoloRoundsHistory([]);
          setCompareAiCache({});
          setResults({});
          setInterruptResults({});
          setQaResults([]);
          setAiSummary(null);
          setSavedSessionId(null);
          setRehearsalIndex(0);
          try {
            window.sessionStorage.removeItem('icit_solo_rounds');
          } catch {
            // ignore
          }
          setStep('mode');
        }}
      />
      {!isOnline && (
        <OfflineBanner onRetry={() => setIsOnline(typeof navigator !== 'undefined' ? navigator.onLine : true)} />
      )}
      {isOnline && serverWaking && <ServerWakeBanner elapsedSec={serverWakeSec} />}
      {sessionExpired && (
        <SessionExpiredNotice
          onSignIn={() => {
            setSessionExpired(false);
            handleSignIn();
          }}
          onDismiss={() => setSessionExpired(false)}
        />
      )}
      <AppErrorBoundary>
        <main className="flex-1">
        <Suspense fallback={<LazyFallback />}>
        {historyOpen && (
          <HistoryModal
            open={historyOpen}
            onClose={() => setHistoryOpen(false)}
            user={user}
            onTokensChange={(tokenBalance) =>
              setUser((prev) =>
                prev && typeof tokenBalance === 'number' ? { ...prev, tokenBalance } : prev,
              )
            }
          />
        )}
        <div className={historyOpen ? 'hidden' : ''}>
            {step === 'mode' && (
          <ModeStep
            rehearsalMode={rehearsalMode}
            onRehearsalModeChange={setRehearsalMode}
            audience={audience}
            onAudienceChange={setAudience}
            timeBudget={timeBudget}
            onTimeBudgetChange={setTimeBudget}
            interruptEnabled={interruptEnabled}
            onInterruptToggle={() => setInterruptEnabled((v) => !v)}
            cameraEnabled={cameraEnabled}
            onCameraToggle={() => setCameraEnabled((v) => !v)}
            onNext={() => setStep('upload')}
            onEnterGroup={() => setStep('group')}
          />
        )}

        {step === 'group' && (
          <GroupLobbyStep
            initialCode={initialGroupCode}
            user={user}
            onBack={() => {
              if (typeof window !== 'undefined' && window.location.search.includes('group=')) {
                const url = new URL(window.location.href);
                url.searchParams.delete('group');
                window.history.replaceState({}, '', url.toString());
              }
              setStep('mode');
            }}
          />
        )}

        {step === 'upload' && (
          <UploadStep
            deck={deck}
            selectedIndices={selectedSlideIndices}
            onSelectedIndicesChange={(nextIndices) => {
              setSlideSelection({ deckRef: deck, indices: nextIndices });
              setResults({});
              setInterruptResults({});
              setQaResults([]);
              setAiSummary(null);
              setSavedSessionId(null);
              setSoloSeriesId(`solo_${Date.now().toString(36)}`);
              resetConfirmSuppressions();
              setRehearsalIndex(0);
            }}
            externalProgress={linePdfLoading}
            rehearsalMode={rehearsalMode}
            onRehearsalModeChange={setRehearsalMode}
            audience={audience}
            onAudienceChange={setAudience}
            timeBudget={timeBudget}
            onTimeBudgetChange={setTimeBudget}
            interruptEnabled={interruptEnabled}
            onInterruptToggle={() => setInterruptEnabled((v) => !v)}
            cameraEnabled={cameraEnabled}
            onCameraToggle={() => setCameraEnabled((v) => !v)}
            onBackToMode={() => {
              setSoloRoundsHistory([]);
              setCompareAiCache({});
              try {
                window.sessionStorage.removeItem('icit_solo_rounds');
              } catch {
                // ignore
              }
              setStep('mode');
            }}
            onDeckChange={(d) => {
              setDeck(d);
              setResults({});
              setInterruptResults({});
              setQaResults([]);
              setAiSummary(null);
              setSavedSessionId(null);
              setSoloSeriesId(`solo_${Date.now().toString(36)}`);
              resetConfirmSuppressions();
              setRehearsalIndex(0);
            }}
            onStart={() => {
              setRehearsalIndex(0);
              setStep('rehearsal');
            }}
          />
        )}

        {step === 'rehearsal' && activeDeck && (
          <RehearsalStep
            user={user}
            onSignIn={handleSignIn}
            deck={activeDeck}
            rehearsalMode={rehearsalMode}
            audience={audience}
            timeBudget={timeBudget}
            initialIndex={rehearsalIndex}
            onIndexChange={setRehearsalIndex}
            results={results}
            onResult={(i, r) => {
              setResults((prev) => ({ ...prev, [i]: r }));
              setAiSummary(null);
            }}
            interruptEnabled={interruptEnabled}
            onInterruptToggle={() => setInterruptEnabled((v) => !v)}
            cameraEnabled={cameraEnabled}
            onCameraToggle={() => setCameraEnabled((v) => !v)}
            interruptResults={interruptResults}
            onInterruptResult={(i, r) => {
              setInterruptResults((prev) => ({ ...prev, [i]: r }));
              setAiSummary(null);
            }}
            onBack={() => setStep('upload')}
            onFinish={(skipQa = false) => setStep(skipQa ? 'summary' : 'qa')}
          />
        )}

        {step === 'qa' && activeDeck && (
          <QaStep
            deck={activeDeck}
            audience={audience}
            timeBudget={timeBudget}
            cameraEnabled={cameraEnabled}
            onCameraToggle={() => setCameraEnabled((v) => !v)}
            results={results}
            qaResults={qaResults}
            onQaResultsChange={setQaResults}
            onBack={() => setStep('rehearsal')}
            onFinish={() => setStep('summary')}
          />
        )}

        {step === 'summary' && activeDeck && (
          <SummaryStep
            user={user}
            onSignIn={handleSignIn}
            deck={activeDeck}
            audience={audience}
            rehearsalMode={rehearsalMode}
            timeBudget={timeBudget}
            results={results}
            qaResults={allQaResults}
            aiSummary={aiSummary}
            onAiSummaryChange={setAiSummary}
            savedSessionId={savedSessionId}
            seriesId={soloSeriesId}
            onSavedSessionIdChange={setSavedSessionId}
            onTokensChange={(tokenBalance) =>
              setUser((prev) =>
                prev && typeof tokenBalance === 'number' ? { ...prev, tokenBalance } : prev,
              )
            }
            onUpdateQaResults={setQaResults}
            onBack={() => setStep('rehearsal')}
            onReRecordSlide={(i) => {
              setRehearsalIndex(i);
              setStep('rehearsal');
            }}
            onUpdateTranscript={handleUpdateTranscript}
            roundsHistory={soloRoundsHistory}
            compareAiCache={compareAiCache}
            onCompareAiCacheChange={(key, val) =>
              setCompareAiCache((prev) => ({ ...prev, [key]: val }))
            }
            onClearRoundsHistory={() => {
              setSoloRoundsHistory([]);
              setCompareAiCache({});
              try {
                window.sessionStorage.removeItem('icit_solo_rounds');
              } catch {
                // ignore
              }
            }}
            onRestart={(roundSnapshot) => {
              setCompareAiCache({});
              if (roundSnapshot && typeof roundSnapshot === 'object') {
                setSoloRoundsHistory((prev) => {
                  const next = [...prev, roundSnapshot].slice(-10);
                  try {
                    window.sessionStorage.setItem('icit_solo_rounds', JSON.stringify(next));
                  } catch {
                    // ignore
                  }
                  return next;
                });
              }
              Object.values(results).forEach((r) => {
                if (r?.audioUrl) URL.revokeObjectURL(r.audioUrl);
                if (r?.videoUrl) URL.revokeObjectURL(r.videoUrl);
              });
              setResults({});
              setInterruptResults({});
              setQaResults([]);
              setAiSummary(null);
              setSavedSessionId(null);
              setSoloSeriesId(`solo_${Date.now().toString(36)}`);
              resetConfirmSuppressions();
              setRehearsalIndex(0);
              setStep('rehearsal');
            }}
          />
        )}
          </div>
        </Suspense>
        </main>
      </AppErrorBoundary>

      <footer className="border-t border-line/60 bg-paper/60 px-4 py-4 text-center text-xs text-muted">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-4 gap-y-1">
          <span>ZomGon</span>
          <span aria-hidden="true">·</span>
          <a href="/privacy" className="underline-offset-2 transition hover:text-ink hover:underline">
            นโยบายความเป็นส่วนตัว
          </a>
        </div>
      </footer>

      {walletOpen && (
        <Suspense fallback={null}>
          <WalletModal
            open={walletOpen}
            onClose={() => setWalletOpen(false)}
            onBalanceChange={(bal) =>
              setUser((prev) => (prev ? { ...prev, tokenBalance: bal } : prev))
            }
          />
        </Suspense>
      )}
      <ConfirmDialogHost />
    </div>
  );
}
