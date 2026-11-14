import { useEffect, useMemo, useRef, useState } from 'react';
import { formatTime, pace, PACE_TEXT } from '../lib/metrics';
import { analyzeSummaryWithAi, evaluateQaAnswer, saveRehearsalSession } from '../lib/api';
import { mergeAudioTracks, mergeVideoTracks } from '../lib/mediaMerge';
import { askConfirm } from './ConfirmModal';
import TimelineReplayPlayer from './TimelineReplayPlayer';

function getSlideText(slide) {
  if (!slide) return '';
  if (slide.text) return slide.text;
  if (slide.bullets?.length) return `${slide.title || ''} - ${slide.bullets.join(', ')}`;
  return slide.title || '';
}

export default function SummaryStep({
  user,
  deck,
  audience,
  rehearsalMode = 'per_slide',
  timeBudget,
  results,
  qaResults = [],
  aiSummary,
  onAiSummaryChange,
  savedSessionId = null,
  onSavedSessionIdChange,
  onUpdateQaResults,
  onBack,
  onReRecordSlide,
  onUpdateTranscript,
  onRestart,
}) {
  const rows = deck.slides.map((s, i) => ({ s, i, r: results[i] }));
  const done = rows.filter((x) => x.r);
  const totalTime = done.reduce((a, x) => a + (x.r?.duration || 0), 0);
  const totalFillers = done.reduce((a, x) => a + (x.r?.fillers?.total || 0), 0);
  const avgWpm = done.length
    ? Math.round(done.reduce((a, x) => a + (x.r?.wpm || 0), 0) / done.length)
    : 0;

  // สถิติจาก Google MediaPipe Vision
  const visionList = done.filter((x) => x.r?.vision?.cameraUsed);
  const avgEyeContact = visionList.length
    ? Math.round(visionList.reduce((a, x) => a + (x.r.vision.eyeContactPct || 0), 0) / visionList.length)
    : null;
  const totalLookingDown = visionList.reduce((a, x) => a + (x.r.vision.lookingDownCount || 0), 0);

  // สำหรับการฟังเสียง
  const audioRef = useRef(null);
  const [playingIndex, setPlayingIndex] = useState(null); // หน้าที่กำลังเล่นเสียงอยู่
  const [isPlayAll, setIsPlayAll] = useState(false); // โหมดเล่นต่อเนื่องทั้งหมด
  const [volume, setVolume] = useState(1.0); // ระดับเสียง 0.0 - 1.0

  const handleVolumeChange = (newVol) => {
    const clamped = Math.max(0, Math.min(1, newVol));
    setVolume(clamped);
    if (audioRef.current) {
      audioRef.current.volume = clamped;
    }
  };

  const handleNativeVolumeChange = () => {
    if (audioRef.current) {
      setVolume(audioRef.current.volume);
    }
  };

  // สำหรับการแก้ไขข้อความ
  const [editingIndex, setEditingIndex] = useState(null);
  const [editText, setEditText] = useState('');
  const [openVideoIndex, setOpenVideoIndex] = useState(null);
  const [openQaVideoIndex, setOpenQaVideoIndex] = useState(null);

  // สำหรับวิเคราะห์ผลด้วย Gemini AI
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState(null);
  const [qaEvaluating, setQaEvaluating] = useState(false);
  const [qaEvalError, setQaEvalError] = useState(null);

  const unevaluatedQaCount = qaResults.filter(
    (q) => !q.isInterrupt && !q.feedback && !q.directness && q.answerTranscript?.trim(),
  ).length;

  const handleEvaluateAllQa = async () => {
    if (qaEvaluating || unevaluatedQaCount === 0) return;
    const ok = await askConfirm({
      key: 'token-spend',
      title: `ยืนยันการใช้ ${unevaluatedQaCount} Tokens`,
      message: `ระบบจะใช้ ${unevaluatedQaCount} Tokens (1 Token/ข้อ) เพื่อตรวจคำตอบช่วงถาม-ตอบทั้งหมดด้วย AI`,
      confirmText: `ใช้ ${unevaluatedQaCount} Tokens`,
    });
    if (!ok) return;
    setQaEvaluating(true);
    setQaEvalError(null);
    try {
      const updatedQaOnly = [];
      for (const q of qaResults) {
        if (q.isInterrupt) continue;
        if (q.feedback || q.directness || !q.answerTranscript?.trim()) {
          updatedQaOnly.push(q);
          continue;
        }
        const slide = deck.slides[q.slideIndex ?? 0];
        const evaluation = await evaluateQaAnswer({
          question: q.question,
          slideContext: getSlideText(slide),
          answerTranscript: q.answerTranscript.trim(),
          audience,
          timelineEvents: Array.isArray(q.timelineEvents) ? q.timelineEvents : [],
        });
        updatedQaOnly.push({
          ...q,
          ...evaluation,
        });
      }
      onUpdateQaResults?.(updatedQaOnly);
    } catch (err) {
      setQaEvalError(err.message || 'ไม่สามารถตรวจคำตอบ Q&A ได้');
    } finally {
      setQaEvaluating(false);
    }
  };

  const runAiAnalysis = async () => {
    if (done.length === 0 || aiLoading) return;
    const ok = await askConfirm({
      key: 'token-spend',
      title: 'ยืนยันการใช้ 2 Tokens',
      message: 'ระบบจะใช้ 2 Tokens เพื่อวิเคราะห์สรุปผลและแนะนำประโยคทั้งรอบซ้อมด้วย AI',
      confirmText: 'ใช้ 2 Tokens',
    });
    if (!ok) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const payload = {
        deckName: deck.name,
        audience,
        slides: deck.slides.map((s, i) => ({
          index: i,
          title: s.title || `หน้า ${i + 1}`,
          text: getSlideText(s),
          transcript: results[i]?.transcript || '',
          wpm: results[i]?.wpm || 0,
          fillersCount: results[i]?.fillers?.total || 0,
          deadAirCount: results[i]?.deadAir?.count || 0,
          eyeContactPct: results[i]?.vision?.cameraUsed ? results[i].vision.eyeContactPct : null,
        })),
        qaResults: qaResults.map((q) => ({
          question: q.question,
          answerTranscript: q.answerTranscript,
          score: q.score,
        })),
        timelineEvents: mergedTimelineEvents,
      };
      const data = await analyzeSummaryWithAi(payload);
      onAiSummaryChange?.(data);
    } catch (err) {
      setAiError(err.message || 'ไม่สามารถวิเคราะห์ผลได้');
    } finally {
      setAiLoading(false);
    }
  };

  const savedSessionIdRef = useRef(savedSessionId);
  if (savedSessionId && !savedSessionIdRef.current) {
    savedSessionIdRef.current = savedSessionId;
  }
  const savingPromiseRef = useRef(null);
  const [referralAwarded, setReferralAwarded] = useState(false);
  const [refCopied, setRefCopied] = useState(false);

  useEffect(() => {
    if (!user || done.length === 0) return;
    let active = true;

    const runSave = async () => {
      if (!savedSessionIdRef.current && savingPromiseRef.current) {
        await savingPromiseRef.current.catch(() => {});
      }
      if (!active) return;

      const payload = {
        sessionId: savedSessionIdRef.current || undefined,
        deckName: deck.name,
        audience,
        rehearsalMode,
        isGroup: false,
        slideCount: deck.slides.length,
        totalDurationSec: totalTime,
        avgWpm,
        avgEyeContactPct: avgEyeContact,
        overallScore: null,
        slidesJson: rows.map((x) => ({
          index: x.i,
          title: x.s?.title || `หน้า ${x.i + 1}`,
          duration: x.r?.duration || 0,
          wpm: x.r?.wpm || 0,
          fillersCount: x.r?.fillers?.total || 0,
          deadAirCount: x.r?.deadAir?.count || 0,
          transcript: x.r?.transcript || '',
          eyeContactPct: x.r?.vision?.cameraUsed ? x.r.vision.eyeContactPct : null,
        })),
        qaJson: qaResults.map(({ audioUrl, videoUrl, videoExt, ...rest }) => rest),
        summaryJson: aiSummary || null,
      };

      const req = saveRehearsalSession(payload)
        .then((res) => {
          if (res?.session?.id) {
            savedSessionIdRef.current = res.session.id;
            onSavedSessionIdChange?.(res.session.id);
          }
          if (active && res?.referralBonusAwarded) {
            setReferralAwarded(true);
          }
          return res;
        })
        .catch((err) => {
          console.warn('[SummaryStep] Save session failed:', err);
        })
        .finally(() => {
          if (savingPromiseRef.current === req) {
            savingPromiseRef.current = null;
          }
        });

      savingPromiseRef.current = req;
      await req;
    };

    void runSave();

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, aiSummary, qaResults]);

  const referralUrl =
    user?.referralCode && typeof window !== 'undefined'
      ? `${window.location.origin}/?ref=${user.referralCode}`
      : '';

  const handleCopyReferral = async () => {
    if (!referralUrl) return;
    await navigator.clipboard.writeText(referralUrl).catch(() => {});
    setRefCopied(true);
    setTimeout(() => setRefCopied(false), 2000);
  };

  const handleDownloadResultCard = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = 560;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#faf8f5';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = '#e6e0d8';
    ctx.lineWidth = 4;
    ctx.strokeRect(24, 24, canvas.width - 48, canvas.height - 48);

    ctx.fillStyle = '#d95d39';
    ctx.beginPath();
    ctx.arc(76, 84, 10, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#1d1b18';
    ctx.font = 'bold 28px sans-serif';
    ctx.fillText('Test SWK - ผลการซ้อมพรีเซนต์', 100, 94);

    ctx.fillStyle = '#6b655e';
    ctx.font = '24px sans-serif';
    ctx.fillText((deck.name || 'Presentation').slice(0, 48), 66, 150);

    const scoreText = `${avgWpm} คำ/นาที`;
    ctx.fillStyle = '#1d1b18';
    ctx.font = 'bold 84px sans-serif';
    ctx.fillText(scoreText, 66, 275);

    ctx.fillStyle = '#6b655e';
    ctx.font = '24px sans-serif';
    ctx.fillText(
      `เวลารวม ${formatTime(totalTime)}   |   ความเร็ว ${avgWpm} คำ/นาที   |   สบตากล้อง ${
        avgEyeContact != null ? `${avgEyeContact}%` : '-'
      }`,
      66,
      360,
    );

    if (user?.referralCode) {
      ctx.fillStyle = '#d95d39';
      ctx.font = 'bold 24px sans-serif';
      ctx.fillText(`ลองซ้อมฟรีด้วยรหัสชวนเพื่อน: ${user.referralCode}`, 66, 460);
    }

    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${deck.name || 'presentation'}-result-card.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'image/png');
  };

  // ฟังก์ชันเล่นเสียงของสไลด์หน้านั้น
  const playSlide = (idx) => {
    const url = results[idx]?.audioUrl;
    if (!url) {
      console.warn('[SummaryStep] No audioUrl for slide', idx);
      return;
    }

    if (playingIndex === idx && audioRef.current && !audioRef.current.paused) {
      audioRef.current.pause();
      setPlayingIndex(null);
      setIsPlayAll(false);
      return;
    }

    setIsPlayAll(false);
    setPlayingIndex(idx);
    if (audioRef.current) {
      audioRef.current.volume = volume;
      audioRef.current.pause();
      audioRef.current.src = url;
      audioRef.current.load();
      audioRef.current.play().catch((err) => {
        console.error('[SummaryStep] Play slide error:', err);
        setPlayingIndex(null);
      });
    }
  };

  // ฟังก์ชันเล่นเสียงทุกหน้าต่อกัน
  const handlePlayAll = () => {
    if (isPlayAll && playingIndex !== null) {
      audioRef.current?.pause();
      setIsPlayAll(false);
      setPlayingIndex(null);
      return;
    }

    // หาหน้าแรกสุดที่มีไฟล์เสียง
    const firstIndex = deck.slides.findIndex((_, i) => results[i]?.audioUrl);
    if (firstIndex !== -1) {
      setIsPlayAll(true);
      setPlayingIndex(firstIndex);
      if (audioRef.current) {
        audioRef.current.volume = volume;
        audioRef.current.pause();
        audioRef.current.src = results[firstIndex].audioUrl;
        audioRef.current.load();
        audioRef.current.play().catch((err) => {
          console.error('[SummaryStep] Play all error:', err);
          setIsPlayAll(false);
          setPlayingIndex(null);
        });
      }
    }
  };

  // เมื่อเสียงของสไลด์หน้านั้นเล่นจบ
  const handleAudioEnded = () => {
    if (isPlayAll && playingIndex !== null) {
      // หาหน้าถัดไปที่มีไฟล์เสียง
      let nextIndex = -1;
      for (let i = playingIndex + 1; i < deck.slides.length; i++) {
        if (results[i]?.audioUrl) {
          nextIndex = i;
          break;
        }
      }

      if (nextIndex !== -1) {
        setPlayingIndex(nextIndex);
        if (audioRef.current) {
          audioRef.current.volume = volume;
          audioRef.current.pause();
          audioRef.current.src = results[nextIndex].audioUrl;
          audioRef.current.load();
          audioRef.current.play().catch((err) => {
            console.error('[SummaryStep] Next slide play error:', err);
            setIsPlayAll(false);
            setPlayingIndex(null);
          });
        }
      } else {
        // เล่นครบทุกหน้าแล้ว
        setIsPlayAll(false);
        setPlayingIndex(null);
      }
    } else {
      setPlayingIndex(null);
    }
  };

  // เริ่มแก้ไขข้อความ
  const handleStartEdit = (idx, currentTranscript) => {
    setEditingIndex(idx);
    setEditText(currentTranscript || '');
  };

  // บันทึกข้อความที่แก้ไข
  const handleSaveEdit = (idx) => {
    onUpdateTranscript(idx, editText);
    setEditingIndex(null);
  };

  const audioUrls = useMemo(() => {
    const seen = new Set();
    const list = [];
    for (let i = 0; i < deck.slides.length; i++) {
      const url = results[i]?.audioUrl;
      if (url && !seen.has(url)) {
        seen.add(url);
        list.push(url);
      }
    }
    for (const q of qaResults) {
      if (q?.audioUrl && !seen.has(q.audioUrl)) {
        seen.add(q.audioUrl);
        list.push(q.audioUrl);
      }
    }
    return list;
  }, [deck.slides, results, qaResults]);

  const hasAnyAudio = audioUrls.length > 0;

  const videoItems = useMemo(() => {
    const seen = new Set();
    const list = [];
    for (let i = 0; i < deck.slides.length; i++) {
      const url = results[i]?.videoUrl;
      if (url && !seen.has(url)) {
        seen.add(url);
        list.push({
          slideNumber: i + 1,
          videoUrl: url,
          videoExt: results[i]?.videoExt || 'webm',
        });
      }
    }
    for (let idx = 0; idx < qaResults.length; idx++) {
      const q = qaResults[idx];
      if (q?.videoUrl && !seen.has(q.videoUrl)) {
        seen.add(q.videoUrl);
        list.push({
          qaNumber: idx + 1,
          videoUrl: q.videoUrl,
          videoExt: q.videoExt || 'webm',
        });
      }
    }
    return list;
  }, [deck.slides, results, qaResults]);

  const audioKey = audioUrls.join('|');
  const videoKey = videoItems.map((v) => v.videoUrl).join('|');

  const { mergedTimelineEvents, mergedDuration } = useMemo(() => {
    const combined = [];
    let offset = 0;
    const seenUrls = new Set();
    for (let i = 0; i < deck.slides.length; i++) {
      const r = results[i];
      if (!r) continue;
      const mediaKey = r.videoUrl || r.audioUrl;
      if (mediaKey && seenUrls.has(mediaKey)) continue;
      if (mediaKey) seenUrls.add(mediaKey);
      if (Array.isArray(r.timelineEvents) && r.timelineEvents.length > 0) {
        for (const ev of r.timelineEvents) {
          combined.push({ ...ev, t: Number((offset + (ev.t || 0)).toFixed(1)) });
        }
      }
      offset += r.duration || 0;
    }
    for (let idx = 0; idx < qaResults.length; idx++) {
      const q = qaResults[idx];
      if (!q) continue;
      const mediaKey = q.videoUrl || q.audioUrl;
      if (mediaKey && seenUrls.has(mediaKey)) continue;
      if (mediaKey) seenUrls.add(mediaKey);
      if (Array.isArray(q.timelineEvents) && q.timelineEvents.length > 0) {
        for (const ev of q.timelineEvents) {
          combined.push({ ...ev, t: Number((offset + (ev.t || 0)).toFixed(1)) });
        }
      } else if (q.duration > 0) {
        combined.push({
          t: Number(offset.toFixed(1)),
          type: 'qa',
          label: `เริ่มตอบ Q&A ข้อ ${idx + 1}`,
        });
      }
      offset += q.duration || 0;
    }
    return { mergedTimelineEvents: combined, mergedDuration: offset };
  }, [deck.slides, results, qaResults]);

  const hasAnyVideo = videoItems.length > 0;
  const [mergedAudio, setMergedAudio] = useState(null);
  const [audioMerging, setAudioMerging] = useState(false);
  const [audioMergeError, setAudioMergeError] = useState(null);

  const [mergedVideo, setMergedVideo] = useState(null);
  const [videoMerging, setVideoMerging] = useState(false);
  const [videoMergeProgress, setVideoMergeProgress] = useState(null);
  const [videoMergeError, setVideoMergeError] = useState(null);
  const [showMergedVideo, setShowMergedVideo] = useState(false);

  useEffect(() => {
    let active = true;
    let createdUrl = null;
    if (audioUrls.length === 0) {
      setMergedAudio(null);
      return undefined;
    }

    setAudioMerging(true);
    setAudioMergeError(null);
    mergeAudioTracks(audioUrls)
      .then((res) => {
        if (!active) {
          if (res?.url) URL.revokeObjectURL(res.url);
          return;
        }
        createdUrl = res?.url || null;
        setMergedAudio(res);
      })
      .catch((err) => {
        if (active) setAudioMergeError(err.message || 'รวมไฟล์เสียงไม่สำเร็จ');
      })
      .finally(() => {
        if (active) setAudioMerging(false);
      });

    return () => {
      active = false;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioKey]);

  useEffect(() => {
    if (videoItems.length === 1) {
      setMergedVideo({
        url: videoItems[0].videoUrl,
        ext: videoItems[0].videoExt || 'webm',
        isDirect: true,
      });
    } else {
      setMergedVideo((prev) => {
        if (prev?.url && !prev.isDirect) URL.revokeObjectURL(prev.url);
        return null;
      });
    }
    setVideoMergeError(null);
    setVideoMergeProgress(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoKey]);

  const handleMergeVideo = async () => {
    if (videoItems.length === 0 || videoMerging) return;
    setVideoMerging(true);
    setVideoMergeError(null);
    setVideoMergeProgress({ stage: 'loading', current: 1, total: videoItems.length, pct: 0 });
    try {
      const res = await mergeVideoTracks(videoItems, (prog) => {
        setVideoMergeProgress(prog);
      });
      setMergedVideo((prev) => {
        if (prev?.url && !prev.isDirect) URL.revokeObjectURL(prev.url);
        return res;
      });
      setShowMergedVideo(true);
    } catch (err) {
      setVideoMergeError(err.message || 'รวมวิดีโอไม่สำเร็จ');
    } finally {
      setVideoMerging(false);
      setVideoMergeProgress(null);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      {/* หัวข้อสรุปผล */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">สรุปการซ้อม</h1>
        <p className="mt-1 text-sm text-muted">{deck.name}</p>
      </div>

      {/* การ์ดไฟล์รวม (Default สำหรับดาวน์โหลดและแชร์) */}
      {(hasAnyAudio || hasAnyVideo) && (
        <div className="mt-6 rounded-xl border border-line bg-white p-5 shadow-xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-medium text-ink">ไฟล์สรุปรวมทุกสไลด์ (พร้อมแชร์และดาวน์โหลด)</h2>
              <p className="mt-0.5 text-xs text-muted">
                รวมคลิปจากการซ้อมทั้งหมดไว้ในไฟล์เดียว หรือเลื่อนลงด้านล่างเพื่อดูและโหลดแยกทีละสไลด์ได้
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900">
            หมายเหตุ: ไฟล์เสียงและวิดีโอจะเก็บไว้ในหน้านี้ชั่วคราวเท่านั้น ไม่ได้บันทึกลงในประวัติย้อนหลัง หากปิดหน้านี้หรือเริ่มซ้อมใหม่ไฟล์จะหาย กรุณาดาวน์โหลดเก็บไว้ก่อนออก
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {hasAnyAudio && (
              <>
                {audioMerging ? (
                  <span className="rounded-lg border border-line bg-paper px-3.5 py-2 text-xs text-muted">
                    กำลังรวมไฟล์เสียง...
                  </span>
                ) : mergedAudio?.url ? (
                  <a
                    href={mergedAudio.url}
                    download={`${deck.name || 'presentation'}-audio-all.wav`}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-3.5 py-2 text-xs font-medium text-paper transition hover:bg-ink/85"
                  >
                    ดาวน์โหลดเสียงรวม (.wav)
                  </a>
                ) : null}
              </>
            )}

            {hasAnyVideo && (
              <>
                {mergedVideo?.url ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setShowMergedVideo((v) => !v)}
                      className="rounded-lg border border-line bg-white px-3.5 py-2 text-xs font-medium text-ink transition hover:border-faint cursor-pointer"
                    >
                      {showMergedVideo ? 'ซ่อนวิดีโอรวม' : 'ดูวิดีโอรวม'}
                    </button>
                    <a
                      href={mergedVideo.url}
                      download={`${deck.name || 'presentation'}-video-all.${mergedVideo.ext || 'webm'}`}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-xs font-medium text-white transition hover:bg-accent/90"
                    >
                      ดาวน์โหลดวิดีโอรวม (.{mergedVideo.ext || 'webm'})
                    </a>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={handleMergeVideo}
                    disabled={videoMerging}
                    className="rounded-lg bg-accent px-3.5 py-2 text-xs font-medium text-white transition hover:bg-accent/90 disabled:opacity-60 cursor-pointer"
                  >
                    {videoMerging && videoMergeProgress
                      ? videoMergeProgress.stage === 'encoding'
                        ? `กำลังรวมวิดีโอ ${videoMergeProgress.pct}%...`
                        : `กำลังเตรียมคลิป (${videoMergeProgress.current}/${videoMergeProgress.total})...`
                      : `รวมวิดีโอทั้งหมด (${videoItems.length} คลิป)`}
                  </button>
                )}
              </>
            )}
          </div>

          {audioMergeError && <p className="text-xs text-accent">{audioMergeError}</p>}
          {videoMergeError && <p className="text-xs text-accent">{videoMergeError}</p>}

          {mergedAudio?.url && (
            <div className="pt-1">
              <p className="mb-1.5 text-[11px] font-medium text-muted">ฟังไฟล์เสียงรวมทั้งหมด</p>
              <audio controls src={mergedAudio.url} className="h-9 w-full" />
            </div>
          )}

          {mergedVideo?.url && showMergedVideo && (
            <TimelineReplayPlayer
              videoUrl={mergedVideo.url}
              duration={mergedDuration || totalTime}
              events={mergedTimelineEvents}
            />
          )}
        </div>
      )}

      <audio ref={audioRef} onEnded={handleAudioEnded} className="hidden" />

      {/* เทียบเวลาเป้าหมาย (ถ้าตั้งไว้) */}
      {(timeBudget?.presentMinutes || 0) > 0 && (() => {
        const targetSec = timeBudget.presentMinutes * 60;
        const diff = Math.round(totalTime - targetSec);
        const onTime = diff <= 0;
        return (
          <div className="mt-6 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-white px-5 py-3.5 text-sm">
            <span className="text-muted">เวลาพรีเซนต์เทียบกับเป้าหมาย ({timeBudget.presentMinutes} นาที)</span>
            <span className={`font-mono font-medium ${onTime ? 'text-ok' : 'text-accent'}`}>
              {formatTime(totalTime)} / {formatTime(targetSec)}{' '}
              ({onTime ? `ทันเวลา เหลือ ${formatTime(Math.abs(diff))}` : `เกินเวลา +${formatTime(diff)}`})
            </span>
          </div>
        );
      })()}

      {/* สถิติรวม 3 ช่อง */}
      <div className="mt-8 grid grid-cols-3 divide-x divide-line rounded-xl border border-line bg-white">
        {[
          ['เวลารวม', formatTime(totalTime)],
          ['คำ/นาที เฉลี่ย', avgWpm || '–'],
          ['คำติดปากรวม', totalFillers > 0 ? totalFillers : 'ไม่พบ'],
        ].map(([label, value]) => (
          <div key={label} className="px-5 py-4">
            <p className="text-xs text-muted">{label}</p>
            <p className="mt-1 font-mono text-2xl tabular-nums tracking-tight">{value}</p>
          </div>
        ))}
      </div>

      {/* สรุปคะแนนสายตาและบุคลิกภาพ (Google MediaPipe Vision) ถ้ามีการเปิดใช้กล้อง */}
      {avgEyeContact !== null && (
        <div className="mt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-line bg-white px-5 py-4">
          <div>
            <p className="text-xs font-medium text-muted">การสบตาเฉลี่ย (กล้องวัดสายตา)</p>
            <p className="mt-0.5 font-mono text-xl font-semibold tabular-nums text-ink">
              {avgEyeContact}%{' '}
              <span className={`font-sans text-xs font-medium ${avgEyeContact >= 70 ? 'text-ok' : 'text-slow'}`}>
                {avgEyeContact >= 70 ? 'สบตากับผู้ฟังได้ดีมาก' : 'ควรมองกล้องเพิ่มขึ้น'}
              </span>
            </p>
          </div>
          {totalLookingDown > 0 && (
            <div className="sm:text-right border-t sm:border-t-0 border-line/60 pt-2 sm:pt-0">
              <p className="text-xs text-muted">ก้มอ่านโพยรวม</p>
              <p className="font-mono text-base font-semibold text-accent">{totalLookingDown} ครั้ง</p>
            </div>
          )}
        </div>
      )}

      {/* ผลวิเคราะห์ความตรงสไลด์ และมุมมองคนฟัง จาก Gemini AI */}
      {!aiLoading && !aiSummary && !aiError && done.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-line bg-white px-5 py-4">
          <div>
            <p className="text-sm font-medium text-ink">วิเคราะห์สรุปผลด้วย AI</p>
            <p className="mt-0.5 text-xs text-muted">
              ให้ AI ประเมินความตรงตามสไลด์ ความเข้าใจง่าย และแนะนำประโยคที่กระชับขึ้น
            </p>
          </div>
          <button
            type="button"
            onClick={runAiAnalysis}
            className="shrink-0 rounded-lg bg-ink px-4 py-2 text-xs font-medium text-paper transition hover:bg-ink/85 cursor-pointer"
          >
            วิเคราะห์สรุปผลด้วย AI (-2 Tokens)
          </button>
        </div>
      )}

      {aiLoading && (
        <div className="mt-4 rounded-xl border border-line bg-white px-5 py-5 text-sm text-muted">
          กำลังวิเคราะห์เนื้อหาสไลด์และความเข้าใจของผู้ฟัง...
        </div>
      )}

      {!aiLoading && aiError && (
        <div className="mt-4 flex items-center justify-between gap-4 rounded-xl border border-line bg-white px-5 py-4">
          <p className="text-xs text-accent">{aiError}</p>
          <button
            type="button"
            onClick={runAiAnalysis}
            className="shrink-0 rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink hover:border-faint cursor-pointer"
          >
            ลองวิเคราะห์อีกครั้ง (-2 Tokens)
          </button>
        </div>
      )}

      {!aiLoading && aiSummary && (
        <div className="mt-4 rounded-xl border border-line bg-white p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
            <div>
              <p className="text-sm font-semibold text-ink">มุมมองคนฟังและความตรงตามสไลด์</p>
              <p className="text-xs text-muted">ประเมินจากการเทียบเนื้อหาสไลด์กับคำพูดทั้งหมด</p>
            </div>
            <div className="flex items-center gap-4 text-xs font-mono">
              <button
                type="button"
                onClick={runAiAnalysis}
                className="font-sans rounded-md border border-line px-2.5 py-1 text-muted hover:text-ink hover:border-faint cursor-pointer"
              >
                วิเคราะห์ใหม่ (-2 Tokens)
              </button>
            </div>
          </div>

          {aiSummary.listenerSummary && (
            <div className="rounded-lg bg-paper p-3.5 text-sm leading-relaxed text-ink">
              <p className="text-xs font-medium text-muted mb-1">สิ่งที่คนฟังจับใจความได้</p>
              <p>{aiSummary.listenerSummary}</p>
            </div>
          )}

          {Array.isArray(aiSummary.timelineAdvice) && aiSummary.timelineAdvice.length > 0 && (
            <div className="rounded-lg border border-line bg-paper/60 p-3.5 space-y-2 text-xs">
              <p className="font-medium text-ink">คำแนะนำตามช่วงเวลา (Timeline)</p>
              <div className="space-y-1.5">
                {aiSummary.timelineAdvice.map((item, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="shrink-0 rounded bg-ink px-1.5 py-0.5 font-mono text-[11px] text-paper">
                      {item.timeLabel || formatTime(item.t || 0)}
                    </span>
                    <span className="text-muted leading-relaxed">{item.comment}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2 text-xs">
            {aiSummary.topStrengths?.length > 0 && (
              <div className="space-y-1.5">
                <p className="font-medium text-ok">จุดเด่น</p>
                <ul className="space-y-1 text-ink/90 list-disc pl-4">
                  {aiSummary.topStrengths.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              </div>
            )}
            {aiSummary.topImprovements?.length > 0 && (
              <div className="space-y-1.5">
                <p className="font-medium text-accent">สิ่งที่ควรปรับ</p>
                <ul className="space-y-1 text-ink/90 list-disc pl-4">
                  {aiSummary.topImprovements.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {/* รายการสไลด์แต่ละหน้า พร้อมเครื่องเล่นเสียงและปุ่มแก้ไข */}
      <div className="mt-8 space-y-4">
        <div className="flex items-center justify-between text-xs text-muted font-medium">
          <span>รายละเอียดแต่ละหน้า ({deck.slides.length} สไลด์)</span>
          <span>คลิกที่หน้าเพื่อฟังคลิปหรือแก้ข้อความ</span>
        </div>

        {rows.map(({ s, i, r }) => {
          const p = r ? pace(r.wpm) : null;
          const isPlayingThis = playingIndex === i;
          const isEditingThis = editingIndex === i;

          return (
            <div
              key={s.id}
              className={`rounded-xl border transition-all bg-white p-5 ${
                isPlayingThis ? 'border-accent ring-1 ring-accent/30' : 'border-line'
              }`}
            >
              {/* แถวบน: ข้อมูลหน้า และ สถิติ */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <span className="flex size-6 items-center justify-center rounded-md bg-paper font-mono text-xs font-semibold text-ink">
                    {i + 1}
                  </span>
                  <span className="text-sm font-semibold text-ink truncate max-w-xs sm:max-w-md">
                    {s.title || `สไลด์หน้า ${i + 1}`}
                  </span>
                </div>

                {r ? (
                  <div className="flex items-center gap-3 text-xs font-mono tabular-nums text-muted">
                    <span>{formatTime(r.duration)}</span>
                    <span className="text-faint">•</span>
                    <span className={p ? PACE_TEXT[p.tone] : ''}>
                      {r.wpm} คำ/นาที {p && `(${p.label})`}
                    </span>
                    {r.fillers?.total > 0 && (
                      <>
                        <span className="text-faint">•</span>
                        <span className="text-accent font-sans">
                          ติดปาก: {r.fillers.found.map((f) => `${f.label}×${f.count}`).join(' ')}
                        </span>
                      </>
                    )}
                    {r.deadAir?.count > 0 && (
                      <>
                        <span className="text-faint">•</span>
                        <span className="text-slow font-sans">
                          เดดแอร์: {r.deadAir.count} ครั้ง
                        </span>
                      </>
                    )}
                    {r.vision?.cameraUsed && (
                      <>
                        <span className="text-faint">•</span>
                        <span className={r.vision.eyeContactPct >= 70 ? 'text-ok font-sans' : 'text-slow font-sans'}>
                          สบตา {r.vision.eyeContactPct}%
                        </span>
                        {r.vision.lookingDownCount > 0 && (
                          <>
                            <span className="text-faint">•</span>
                            <span className="text-accent font-sans">
                              ก้มอ่าน {r.vision.lookingDownCount} ครั้ง
                            </span>
                          </>
                        )}
                      </>
                    )}
                  </div>
                ) : (
                  <span className="text-xs text-faint">ยังไม่ได้ซ้อม</span>
                )}
              </div>

              {/* ข้อความที่พูด (โหมดแสดงผล หรือ โหมดแก้ไข) */}
              <div className="mt-4">
                {isEditingThis ? (
                  <div className="space-y-2">
                    <textarea
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      rows={3}
                      className="w-full rounded-lg border border-ink/30 bg-paper p-3 text-sm focus:border-ink focus:outline-none"
                      placeholder="พิมพ์แก้ไขข้อความที่ถอดเสียง..."
                    />
                    <div className="flex justify-end gap-2 text-xs">
                      <button
                        onClick={() => setEditingIndex(null)}
                        className="rounded-md border border-line px-3 py-1.5 transition hover:bg-paper cursor-pointer"
                      >
                        ยกเลิก
                      </button>
                      <button
                        onClick={() => handleSaveEdit(i)}
                        className="rounded-md bg-ink px-3 py-1.5 font-medium text-paper transition hover:bg-ink/85 cursor-pointer"
                      >
                        บันทึกข้อความ
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg bg-paper p-3.5 text-sm leading-relaxed text-ink/90">
                    {r?.transcript ? (
                      <p>"{r.transcript}"</p>
                    ) : (
                      <p className="text-faint italic">ยังไม่มีข้อความเสียงในสไลด์นี้</p>
                    )}
                  </div>
                )}

                {(() => {
                  const aiSlide = aiSummary?.slides?.find((x) => x.index === i);
                  if (!aiSlide) return null;
                  return (
                    <div className="mt-2.5 rounded-lg border border-line bg-paper/60 p-3 text-xs space-y-1.5">
                      {aiSlide.missed?.length > 0 && (
                        <div>
                          <span className="font-medium text-accent">ประเด็นที่ยังไม่ได้พูด: </span>
                          <span className="text-muted">{aiSlide.missed.join(' · ')}</span>
                        </div>
                      )}
                      {aiSlide.polishedScript && (
                        <div>
                          <span className="font-medium text-ink">ตัวอย่างประโยคที่กระชับขึ้น: </span>
                          <span className="text-ink/90">{aiSlide.polishedScript}</span>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>

              {/* แถบปุ่ม Action ด้านล่างของสไลด์นี้ */}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line/60 pt-3 text-xs">
                {/* ฝั่งซ้าย: ปุ่มฟังเสียงคลิปหน้านี้ และ Audio Player */}
                <div className="flex flex-wrap items-center gap-2">
                  {r?.audioUrl ? (
                    <>
                      <button
                        onClick={() => playSlide(i)}
                        className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition cursor-pointer ${
                          isPlayingThis
                            ? 'bg-accent text-white shadow-xs'
                            : 'border border-line bg-white hover:border-faint text-ink'
                        }`}
                      >
                        {isPlayingThis ? (
                          <>
                            <span className="size-2 rounded-[1px] bg-white animate-pulse" />
                            <span>หยุดฟัง</span>
                          </>
                        ) : (
                          <>
                            <svg viewBox="0 0 16 16" className="size-3.5" fill="currentColor">
                              <path d="M4 3.5v9l8-4.5-8-4.5z" />
                            </svg>
                            <span>ฟังคลิปหน้านี้</span>
                          </>
                        )}
                      </button>
                      <audio controls src={r.audioUrl} className="h-7 w-48 sm:w-56" />
                      <a
                        href={r.audioUrl}
                        download={`slide-${i + 1}-audio.webm`}
                        className="rounded-md border border-line bg-paper px-2.5 py-1.5 font-medium text-ink hover:border-faint"
                      >
                        โหลดเสียง
                      </a>
                    </>
                  ) : (
                    <span className="text-faint italic text-[11px]">
                      {rehearsalMode === 'continuous'
                        ? 'รวมอยู่ในคลิปซ้อมใหญ่ต่อเนื่องด้านบน'
                        : 'ไม่มีไฟล์เสียง'}
                    </span>
                  )}
                  {r?.videoUrl && (
                    <>
                      <button
                        type="button"
                        onClick={() => setOpenVideoIndex(openVideoIndex === i ? null : i)}
                        className="rounded-md border border-line bg-white px-2.5 py-1.5 font-medium text-ink hover:border-faint cursor-pointer"
                      >
                        {openVideoIndex === i ? 'ซ่อนวิดีโอ' : 'ดูวิดีโอ'}
                      </button>
                      <a
                        href={r.videoUrl}
                        download={`slide-${i + 1}.${r.videoExt || 'webm'}`}
                        className="rounded-md border border-line bg-paper px-2.5 py-1.5 font-medium text-ink hover:border-faint"
                      >
                        ดาวน์โหลดคลิป
                      </a>
                    </>
                  )}
                </div>

                {/* ฝั่งขวา: ปุ่มแก้ไขข้อความ & อัดใหม่ */}
                <div className="flex items-center gap-2">
                  {r && !isEditingThis && (
                    <button
                      onClick={() => handleStartEdit(i, r.transcript)}
                      className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-muted hover:text-ink hover:bg-paper transition cursor-pointer"
                    >
                      <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M11.5 2.5a1.414 1.414 0 0 1 2 2L4.5 13.5l-3 1 1-3L11.5 2.5z" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <span>แก้ข้อความ</span>
                    </button>
                  )}

                  <button
                    onClick={() => onReRecordSlide(i)}
                    className="flex items-center gap-1 rounded-md border border-line px-2.5 py-1.5 text-ink hover:border-faint hover:bg-paper transition cursor-pointer"
                  >
                    <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M2.5 8a5.5 5.5 0 0 1 9.5-3.88L14 6m-1.5 2a5.5 5.5 0 0 1-9.5 3.88L1 10" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span>อัดใหม่หน้านี้</span>
                  </button>
                </div>
              </div>

              {(r?.videoUrl || r?.audioUrl) && openVideoIndex === i && (
                <TimelineReplayPlayer
                  videoUrl={r.videoUrl}
                  audioUrl={r.audioUrl}
                  duration={r.duration}
                  events={r.timelineEvents || []}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* ผลช่วงถาม-ตอบ */}
      {qaResults.length > 0 && (
        <div className="mt-8 rounded-xl border border-line bg-white p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium text-ink">ผลช่วงถาม-ตอบ</h3>
              <p className="mt-0.5 text-xs text-muted">
                คำถามที่ฝึกตอบ {qaResults.length} ข้อ
              </p>
            </div>
            {unevaluatedQaCount > 0 && (
              <button
                type="button"
                onClick={handleEvaluateAllQa}
                disabled={qaEvaluating}
                className="rounded-lg bg-ink px-3.5 py-2 text-xs font-medium text-paper transition hover:bg-ink/85 disabled:opacity-50 cursor-pointer"
              >
                {qaEvaluating
                  ? 'กำลังตรวจคำตอบ Q&A...'
                  : `ให้ AI ตรวจคำตอบ Q&A (-1 Token/ข้อ • ${unevaluatedQaCount} ข้อ)`}
              </button>
            )}
          </div>
          {qaEvalError && <p className="text-xs text-accent">{qaEvalError}</p>}

          <div className="space-y-3">
            {qaResults.map((q, idx) => (
              <div key={idx} className="rounded-lg border border-line bg-paper/50 p-4 space-y-2 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="space-y-1">
                    {q.isInterrupt && (
                      <span className="inline-block rounded bg-paper px-2 py-0.5 text-[11px] font-medium text-accent border border-line">
                        ถามแทรกหน้า {(q.slideIndex ?? 0) + 1}
                      </span>
                    )}
                    <p className="font-medium text-ink">
                      {idx + 1}. {q.question}
                    </p>
                  </div>
                  {q.directness && (
                    <span className="rounded-md bg-ink px-2 py-0.5 text-xs text-paper">
                      {q.directness}
                    </span>
                  )}
                </div>
                {(q.answerTranscript || q.answer) && (
                  <p className="text-xs text-muted">คำตอบของคุณ: "{q.answerTranscript || q.answer}"</p>
                )}
                {q.feedback && (
                  <p className="text-xs text-muted">{q.feedback}</p>
                )}
                {q.timelineNote && (
                  <p className="text-xs text-ink/85">
                    <span className="font-medium">จังหวะระหว่างตอบ: </span>
                    {q.timelineNote}
                  </p>
                )}
                {q.betterAnswer && (
                  <p className="text-xs text-ink/90">
                    <span className="font-medium">แนวทางตอบที่กระชับขึ้น: </span>
                    {q.betterAnswer}
                  </p>
                )}
                {(q.audioUrl || q.videoUrl) && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line/60 pt-2.5 text-xs">
                    {q.audioUrl && (
                      <>
                        <audio controls src={q.audioUrl} className="h-7 w-48 sm:w-56" />
                        <a
                          href={q.audioUrl}
                          download={`qa-${idx + 1}-audio.webm`}
                          className="rounded-md border border-line bg-white px-2.5 py-1.5 font-medium text-ink hover:border-faint"
                        >
                          โหลดเสียง
                        </a>
                      </>
                    )}
                    {q.videoUrl && (
                      <>
                        <button
                          type="button"
                          onClick={() => setOpenQaVideoIndex(openQaVideoIndex === idx ? null : idx)}
                          className="rounded-md border border-line bg-white px-2.5 py-1.5 font-medium text-ink hover:border-faint cursor-pointer"
                        >
                          {openQaVideoIndex === idx ? 'ซ่อนวิดีโอ' : 'ดูวิดีโอ'}
                        </button>
                        <a
                          href={q.videoUrl}
                          download={`qa-${idx + 1}.${q.videoExt || 'webm'}`}
                          className="rounded-md border border-line bg-white px-2.5 py-1.5 font-medium text-ink hover:border-faint"
                        >
                          ดาวน์โหลดคลิป
                        </a>
                      </>
                    )}
                  </div>
                )}
                {(q.videoUrl || q.audioUrl) && openQaVideoIndex === idx && (
                  <TimelineReplayPlayer
                    videoUrl={q.videoUrl}
                    audioUrl={q.audioUrl}
                    duration={q.duration}
                    events={q.timelineEvents || []}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* แจ้งเตือนโบนัสชวนเพื่อน และการ์ดแชร์ผล */}
      {referralAwarded && (
        <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-800">
          ยินดีด้วย! คุณและเพื่อนที่ชวนได้รับโบนัสซ้อมครั้งแรก +10 Tokens เรียบร้อยแล้ว
        </div>
      )}

      <div className="mt-8 rounded-xl border border-line bg-white p-5 space-y-3">
        <div>
          <h3 className="text-sm font-medium text-ink">แชร์ผลซ้อมและชวนเพื่อน</h3>
          <p className="mt-0.5 text-xs text-muted">
            ดาวน์โหลดการ์ดคะแนนไว้โพสต์อวดผลงาน หรือส่งลิงก์ให้เพื่อนมาซ้อมเพื่อรับ +10 Tokens ทั้งคู่
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={handleDownloadResultCard}
            className="rounded-lg border border-line bg-paper px-3.5 py-2 text-xs font-medium text-ink transition hover:border-ink cursor-pointer"
          >
            ดาวน์โหลดการ์ดสรุป (.png)
          </button>
          {referralUrl && (
            <button
              type="button"
              onClick={handleCopyReferral}
              className="rounded-lg bg-accent px-3.5 py-2 text-xs font-medium text-white transition hover:bg-accent/90 cursor-pointer"
            >
              {refCopied ? 'คัดลอกลิงก์ชวนเพื่อนแล้ว' : 'คัดลอกลิงก์ชวนเพื่อน (+10 Tokens)'}
            </button>
          )}
        </div>
      </div>

      {/* ปุ่มด้านล่าง */}
      <div className="mt-6 flex gap-2">
        <button
          onClick={async () => {
            const ok = await askConfirm({
              key: 'leave-summary',
              title: 'กลับไปหน้าซ้อม?',
              message: 'หากกลับไปอัดใหม่บางหน้า คลิปเสียงและวิดีโอรวมจะเปลี่ยนไป ต้องการกลับไปหน้าซ้อมหรือไม่?',
              confirmText: 'กลับไปหน้าซ้อม',
            });
            if (ok) onBack();
          }}
          className="rounded-lg border border-line px-5 py-2.5 text-sm transition hover:border-faint cursor-pointer"
        >
          กลับไปหน้าซ้อม
        </button>
        <button
          onClick={async () => {
            const ok = await askConfirm({
              key: 'leave-summary-restart',
              allowDontShowAgain: false,
              danger: true,
              title: 'ออกจากหน้าสรุปผลและซ้อมใหม่?',
              message:
                hasAnyAudio || hasAnyVideo
                  ? 'ไฟล์เสียงและวิดีโอในรอบนี้ไม่ได้ถูกบันทึกในประวัติ หากยังไม่ได้ดาวน์โหลดไฟล์จะหาย ต้องการซ้อมใหม่ทั้งหมดหรือไม่?'
                  : 'ต้องการเริ่มซ้อมใหม่ทั้งหมดตั้งแต่ต้นหรือไม่?',
              confirmText: 'ซ้อมใหม่ทั้งหมด',
            });
            if (ok) onRestart();
          }}
          className="rounded-lg bg-ink px-5 py-2.5 text-sm font-medium text-paper transition hover:bg-ink/85 cursor-pointer"
        >
          ซ้อมใหม่ทั้งหมด
        </button>
      </div>
    </div>
  );
}
