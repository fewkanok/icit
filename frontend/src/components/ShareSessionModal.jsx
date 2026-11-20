import { useEffect, useMemo, useState } from 'react';
import { updateSessionShare } from '../lib/api';

export default function ShareSessionModal({
  open,
  onClose,
  sessionId,
  initialShareId = '',
  initialIsPublic = false,
  deckName = '',
  avgWpm = 0,
  referralCode = '',
  onShareUpdated,
}) {
  const [shareId, setShareId] = useState(initialShareId || '');
  const [isPublic, setIsPublic] = useState(Boolean(initialIsPublic));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [bonusAwarded, setBonusAwarded] = useState(false);
  const [copiedType, setCopiedType] = useState(''); // 'link' | 'message' | ''

  useEffect(() => {
    if (!open) return;
    setShareId(initialShareId || '');
    setIsPublic(Boolean(initialIsPublic));
    setError(null);
    setBonusAwarded(false);
    setCopiedType('');
  }, [open, sessionId, initialShareId, initialIsPublic]);

  const shareUrl = useMemo(() => {
    if (!shareId || typeof window === 'undefined') return '';
    const base = `${window.location.origin}/share/${encodeURIComponent(shareId)}`;
    return referralCode ? `${base}?ref=${encodeURIComponent(referralCode)}` : base;
  }, [shareId, referralCode]);

  const shareSummaryText = useMemo(() => {
    const title = deckName || 'ชุดสไลด์';
    const wpm = avgWpm || 0;
    return `ลองซ้อมพรีเซนต์ "${title}" บน Zomgon ดู ได้ ${wpm} คำ/นาที แวะเข้ามาดูผลหรือลองซ้อมฟรีได้ที่นี่:`;
  }, [deckName, avgWpm]);

  if (!open) return null;

  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const handleToggleShare = async (nextPublic) => {
    if (!sessionId || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await updateSessionShare(sessionId, nextPublic);
      setShareId(res.shareId || '');
      setIsPublic(Boolean(res.isPublic));
      if (res.shareBonusAwarded) {
        setBonusAwarded(true);
      }
      onShareUpdated?.(res);
    } catch (err) {
      setError(err?.message || 'อัปเดตสถานะการแชร์ไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = async (type) => {
    if (!shareUrl) return;
    const textToCopy = type === 'message' ? `${shareSummaryText} ${shareUrl}` : shareUrl;
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopiedType(type);
      setTimeout(() => setCopiedType(''), 2000);
    } catch {
      setError('เบราว์เซอร์ไม่อนุญาตให้คัดลอกอัตโนมัติ กรุณาคัดลอกจากช่องด้านบน');
    }
  };

  const openSharePopup = (url) => {
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleNativeShare = async () => {
    if (!canNativeShare || !shareUrl) return;
    try {
      await navigator.share({
        title: `Zomgon - สรุปผลซ้อมพรีเซนต์: ${deckName || 'Zomgon'}`,
        text: shareSummaryText,
        url: shareUrl,
      });
    } catch {
      // user cancelled native share
    }
  };

  const lineShareHref = shareUrl
    ? `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(shareSummaryText)}`
    : '';
  const xShareHref = shareUrl
    ? `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareSummaryText)}&url=${encodeURIComponent(shareUrl)}`
    : '';
  const fbShareHref = shareUrl
    ? `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}&quote=${encodeURIComponent(shareSummaryText)}`
    : '';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-2 sm:p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-[95vw] sm:w-full max-w-lg max-h-[90vh] overflow-y-auto overflow-x-hidden rounded-2xl border border-line bg-white p-4 sm:p-6 shadow-xl space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-stone-900">แชร์สรุปผลการซ้อม</h2>
            <p className="mt-0.5 text-sm text-muted">
              ส่งลิงก์ให้เพื่อนหรืออาจารย์เปิดดูผลสถิติ, AI Feedback และ Q&A ได้โดยไม่ต้องล็อกอิน
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-muted hover:text-ink cursor-pointer"
          >
            ปิด
          </button>
        </div>

        {error && (
          <p className="rounded-lg bg-accent/10 px-3 py-2 text-xs text-accent">{error}</p>
        )}

        {bonusAwarded && (
          <div className="rounded-xl border border-ok/30 bg-ok/10 px-4 py-2.5 text-xs font-medium text-ok">
            ได้รับโบนัส +1 Token สำหรับการแชร์วันนี้เรียบร้อยแล้ว!
          </div>
        )}

        {!sessionId ? (
          <div className="rounded-xl border border-line bg-paper p-4 text-sm text-muted">
            กรุณาเข้าสู่ระบบและบันทึกรอบซ้อมก่อนจึงจะสร้างลิงก์แชร์ได้
          </div>
        ) : !isPublic || !shareId ? (
          <div className="rounded-xl border border-line bg-paper/70 p-5 space-y-4">
            <div className="space-y-1">
              <p className="text-sm font-medium text-stone-900">ลิงก์นี้ยังไม่เปิดให้คนนอกเข้าดู</p>
              <p className="text-xs leading-relaxed text-muted">
                เปิดลิงก์แชร์เพื่อรับ URL สำหรับส่งใน LINE, X หรือ Facebook (สามารถกดปิดได้ทุกเมื่อ · เปิดแชร์ครั้งแรกของวันรับฟรี +1 Token)
              </p>
            </div>
            <button
              type="button"
              disabled={saving}
              onClick={() => handleToggleShare(true)}
              className="w-full min-h-[42px] rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-accent/90 disabled:opacity-50 cursor-pointer"
            >
              {saving ? 'กำลังสร้างลิงก์แชร์...' : 'เปิดลิงก์แชร์ผลซ้อม (+1 Token/วัน)'}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* ตัวอย่างข้อความเชิญชวน + ลิงก์ */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-ok">● เปิดแชร์อยู่ (พ่วงรหัสชวนเพื่อน +10 Tokens ให้ในตัว)</span>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => handleToggleShare(false)}
                  className="text-muted underline underline-offset-2 hover:text-accent disabled:opacity-50 cursor-pointer"
                >
                  {saving ? 'กำลังปิด...' : 'ปิดการแชร์'}
                </button>
              </div>
              <div className="rounded-xl border border-line bg-paper/70 p-3 text-xs leading-relaxed text-ink">
                {shareSummaryText}{' '}
                <span className="font-mono text-accent break-all">{shareUrl}</span>
              </div>
            </div>

            {/* ปุ่มแชร์ตรงไปยังแพลตฟอร์ม */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted">แชร์ไปยังแอปโซเชียล</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <button
                  type="button"
                  onClick={() => openSharePopup(lineShareHref)}
                  className="min-h-[40px] rounded-xl bg-[#06C755] px-3 py-2 text-xs font-semibold text-white transition hover:opacity-90 cursor-pointer"
                >
                  แชร์ไป LINE
                </button>
                <button
                  type="button"
                  onClick={() => openSharePopup(xShareHref)}
                  className="min-h-[40px] rounded-xl bg-stone-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-stone-800 cursor-pointer"
                >
                  แชร์ไป X
                </button>
                <button
                  type="button"
                  onClick={() => openSharePopup(fbShareHref)}
                  className="min-h-[40px] rounded-xl bg-[#1877F2] px-3 py-2 text-xs font-semibold text-white transition hover:opacity-90 cursor-pointer"
                >
                  แชร์ไป Facebook
                </button>
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => handleCopy('message')}
                  className="flex-1 min-h-[38px] rounded-xl bg-ink px-3 py-2 text-xs font-medium text-paper transition hover:bg-ink/90 cursor-pointer"
                >
                  {copiedType === 'message'
                    ? '✓ คัดลอกข้อความชวนเพื่อน + ลิงก์แล้ว'
                    : 'คัดลอกข้อความชวนเพื่อน + ลิงก์'}
                </button>
                <button
                  type="button"
                  onClick={() => handleCopy('link')}
                  className="min-h-[38px] rounded-xl border border-line bg-white px-3 py-2 text-xs font-medium text-ink transition hover:border-faint hover:bg-paper cursor-pointer"
                >
                  {copiedType === 'link' ? '✓ คัดลอกลิงก์แล้ว' : 'คัดลอกเฉพาะลิงก์'}
                </button>
                {canNativeShare && (
                  <button
                    type="button"
                    onClick={handleNativeShare}
                    className="min-h-[38px] rounded-xl border border-line bg-paper px-3.5 py-2 text-xs font-medium text-ink transition hover:border-faint cursor-pointer"
                  >
                    แชร์ผ่านแอปอื่น...
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
