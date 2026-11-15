import { useEffect, useState } from 'react';
import { fetchWallet, mockTopupTokens } from '../lib/api';
import Pagination from './Pagination';

const PACKAGES = [
  { id: 'starter', name: 'Starter Pack', tokens: 50, price: '49 บาท (จำลอง)' },
  { id: 'pro', name: 'Pro Pack', tokens: 150, price: '99 บาท (จำลอง)' },
];

export default function WalletModal({ open, onClose, onBalanceChange }) {
  const [wallet, setWallet] = useState(null);
  const [loading, setLoading] = useState(false);
  const [buyingId, setBuyingId] = useState(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(null);
  const [txPage, setTxPage] = useState(1);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError(null);
    fetchWallet()
      .then((data) => {
        if (active) setWallet(data);
      })
      .catch((err) => {
        if (active) setError(err.message || 'โหลดข้อมูลกระเป๋า Token ไม่สำเร็จ');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open]);

  if (!open) return null;

  const referralUrl =
    wallet?.referralCode && typeof window !== 'undefined'
      ? `${window.location.origin}/?ref=${wallet.referralCode}`
      : '';

  const handleCopy = async () => {
    if (!referralUrl) return;
    await navigator.clipboard.writeText(referralUrl).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleBuy = async (packageId) => {
    if (buyingId) return;
    setBuyingId(packageId);
    setError(null);
    try {
      const res = await mockTopupTokens(packageId);
      onBalanceChange?.(res.tokenBalance);
      const refreshed = await fetchWallet();
      setWallet(refreshed);
    } catch (err) {
      setError(err.message || 'เติม Token ไม่สำเร็จ');
    } finally {
      setBuyingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-white p-6 shadow-xl space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-ink">กระเป๋า Token และชวนเพื่อน</h2>
            <p className="mt-0.5 text-xs text-muted">
              ซ้อมพื้นฐานฟรีตลอด ใช้ Token เฉพาะตอนให้ AI วิเคราะห์หรืออ่านเสียง
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-line px-2.5 py-1 text-xs text-muted hover:text-ink cursor-pointer"
          >
            ปิด
          </button>
        </div>

        {loading && !wallet ? (
          <p className="py-6 text-center text-xs text-muted">กำลังโหลดข้อมูล...</p>
        ) : (
          <>
            <div className="rounded-xl border border-line bg-paper p-4 flex items-center justify-between">
              <span className="text-xs text-muted">Token คงเหลือปัจจุบัน</span>
              <span className="font-mono text-2xl font-semibold text-ink">
                {wallet?.tokenBalance ?? 0}
              </span>
            </div>

            {error && <p className="text-xs text-accent">{error}</p>}

            {/* ชวนเพื่อน */}
            <div className="rounded-xl border border-line p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-ink">ชวนเพื่อนรับเพิ่ม +10 Tokens ทั้งคู่</h3>
                <span className="font-mono text-[11px] text-muted">
                  {wallet?.referralCount ?? 0}/{wallet?.maxReferrals ?? 10} คน
                </span>
              </div>
              <p className="text-[11px] text-muted">
                เพื่อนต้องเข้าสู่ระบบผ่านลิงก์นี้และซ้อมจบอย่างน้อย 1 รอบ (30 วินาทีขึ้นไป)
              </p>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={referralUrl}
                  className="w-full rounded-lg border border-line bg-paper px-3 py-1.5 font-mono text-[11px] text-ink"
                />
                <button
                  type="button"
                  onClick={handleCopy}
                  className="shrink-0 rounded-lg bg-ink px-3 py-1.5 text-xs font-medium text-paper hover:bg-ink/85 cursor-pointer"
                >
                  {copied ? 'คัดลอกแล้ว' : 'คัดลอก'}
                </button>
              </div>
            </div>

            {/* ร้านค้าเติม Token จำลอง */}
            <div className="space-y-2.5">
              <h3 className="text-xs font-semibold text-ink">เติม Token (โหมดทดลองระบบ)</h3>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {PACKAGES.map((pkg) => (
                  <button
                    key={pkg.id}
                    type="button"
                    disabled={Boolean(buyingId)}
                    onClick={() => handleBuy(pkg.id)}
                    className="flex flex-col items-start rounded-xl border border-line bg-paper/60 p-3.5 text-left transition hover:border-ink disabled:opacity-50 cursor-pointer"
                  >
                    <span className="text-xs font-medium text-ink">{pkg.name}</span>
                    <span className="mt-1 font-mono text-lg font-semibold text-accent">
                      +{pkg.tokens} Tokens
                    </span>
                    <span className="mt-0.5 text-[11px] text-muted">
                      {buyingId === pkg.id ? 'กำลังเติม...' : pkg.price}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* ประวัติธุรกรรม */}
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-ink">ประวัติล่าสุด</h3>
              {!wallet?.transactions?.length ? (
                <p className="text-xs text-muted">ยังไม่มีรายการ</p>
              ) : (
                <>
                  <div className="divide-y divide-line rounded-xl border border-line">
                    {wallet.transactions.slice((txPage - 1) * 5, txPage * 5).map((tx) => (
                      <div
                        key={tx.id}
                        className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-xs"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-ink">{tx.description || tx.type}</p>
                          <p className="text-[10px] text-muted">
                            {new Date(tx.createdAt).toLocaleString('th-TH')}
                          </p>
                        </div>
                        <span
                          className={`shrink-0 font-mono font-medium ${
                            tx.amount >= 0 ? 'text-emerald-700' : 'text-accent'
                          }`}
                        >
                          {tx.amount >= 0 ? `+${tx.amount}` : tx.amount}
                        </span>
                      </div>
                    ))}
                  </div>
                  <Pagination
                    page={txPage}
                    totalItems={wallet.transactions.length}
                    pageSize={5}
                    onPageChange={setTxPage}
                  />
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
