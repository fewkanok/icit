import { useEffect, useMemo, useRef, useState } from 'react';
import { formatTime, pace, PACE_TEXT } from '../lib/metrics';
import {
  analyzeSummaryWithAi,
  evaluateQaAnswer,
  saveRehearsalSession,
  uploadSessionVideoToCloud,
} from '../lib/api';
import { saveLocalSessionVideo } from '../lib/videoStore';
import { mergeAudioTracks, mergeVideoTracks } from '../lib/mediaMerge';
import { askConfirm } from './ConfirmModal';
import TimelineReplayPlayer from './TimelineReplayPlayer';
import VideoLayoutModal, { DEFAULT_VIDEO_LAYOUT } from './VideoLayoutModal';
import SummaryCharts from './SummaryCharts';
import Pagination from './Pagination';
import RoundComparisonCard from './RoundComparisonCard';
import QaResultCard from './QaResultCard';
import ShareSessionModal from './ShareSessionModal';
import MiniAudioPlayer from './ui/MiniAudioPlayer';
import GeminiCooldownButton from './ui/GeminiCooldownButton';
import { SkeletonSummaryOverview, SkeletonVideoMerge } from './ui/Skeleton';
import { ErrorState, SlowOperationBar } from './ui/StateViews';
import { ClockIcon, GaugeIcon, MessageSquareIcon } from './ui/Icons';

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
  seriesId = null,
  onSavedSessionIdChange,
  onTokensChange,
  onUpdateQaResults,
  onBack,
  onReRecordSlide,
  onUpdateTranscript,
  roundsHistory = [],
  compareAiCache = {},
  onCompareAiCacheChange,
  onClearRoundsHistory,
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
  const totalDeadAir = done.reduce((a, x) => a + (x.r?.deadAir?.count || 0), 0);
  const matchingRoundsHistory = useMemo(
    () => roundsHistory.filter((r) => !r?.deckName || r.deckName === (deck.name || 'ชุดสไลด์')),
    [roundsHistory, deck.name],
  );
  const currentRoundSnapshot = useMemo(() => {
    const qaAnswered = qaResults.filter((q) => q.answerTranscript?.trim());
    const qaDirect = qaAnswered.filter(
      (q) => q.directness === 'direct' || q.evaluation?.directness === 'direct',
    );
    return {
      roundNumber: matchingRoundsHistory.length + 1,
      deckName: deck.name || 'ชุดสไลด์',
      slideCount: deck.slides.length,
      avgWpm,
      fillersCount: totalFillers,
      deadAirCount: totalDeadAir,
      totalDurationSec: Math.floor(totalTime),
      eyeContactPct: avgEyeContact,
      qaAnsweredCount: qaAnswered.length,
      qaDirectCount: qaDirect.length,
      transcriptExcerpt: done
        .map((x) => `[หน้า ${x.i + 1}] ${x.r?.transcript || ''}`)
        .join('\n')
        .slice(0, 5500),
    };
  }, [matchingRoundsHistory.length, deck.name, avgWpm, totalFillers, totalDeadAir, totalTime, avgEyeContact, qaResults, done]);

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
  const [cloudUploading, setCloudUploading] = useState(false);
  const [cloudUploaded, setCloudUploaded] = useState(false);
  const [cloudError, setCloudError] = useState('');

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
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareMeta, setShareMeta] = useState({ shareId: '', isPublic: false });
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
        seriesId: seriesId || undefined,
        roundNumber: matchingRoundsHistory.length + 1,
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
            setShareMeta((prev) => ({
              shareId: res.session.shareId || prev.shareId || '',
              isPublic:
                typeof res.session.isPublic === 'boolean'
                  ? res.session.isPublic
                  : prev.isPublic,
            }));
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
        const evs = Array.isArray(results[i]?.timelineEvents) ? results[i].timelineEvents : [];
        const slideChanges = [];
        for (const ev of evs) {
          if (ev.type === 'slide') {
            let sIdx = typeof ev.slideIndex === 'number' ? ev.slideIndex : i;
            if (typeof ev.label === 'string') {
              const m = ev.label.match(/เริ่มสไลด์\s*(\d+)/);
              if (m) sIdx = Math.max(0, Number(m[1]) - 1);
            }
            if (deck.slides[sIdx]) {
              slideChanges.push({ t: ev.t || 0, slide: deck.slides[sIdx] });
            }
          }
        }
        list.push({
          slideNumber: i + 1,
          videoUrl: url,
          videoExt: results[i]?.videoExt || 'webm',
          slide: deck.slides[i] || null,
          ...(slideChanges.length > 0 ? { slideChanges } : {}),
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
          slide: deck.slides[q.slideIndex ?? 0] || deck.slides[0] || null,
          qaQuestion: q.question || '',
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
          combined.push({
            ...ev,
            slideIndex: typeof ev.slideIndex === 'number' ? ev.slideIndex : i,
            t: Number((offset + (ev.t || 0)).toFixed(1)),
          });
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
      const qSlideIdx = q.slideIndex ?? 0;
      if (Array.isArray(q.timelineEvents) && q.timelineEvents.length > 0) {
        for (const ev of q.timelineEvents) {
          combined.push({
            ...ev,
            slideIndex: qSlideIdx,
            t: Number((offset + (ev.t || 0)).toFixed(1)),
          });
        }
      } else if (q.duration > 0) {
        combined.push({
          t: Number(offset.toFixed(1)),
          type: 'qa',
          slideIndex: qSlideIdx,
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
  const [moreActionsSlideIdx, setMoreActionsSlideIdx] = useState(null);

  const activeHistoryVideoUrl =
    mergedVideo?.url || (videoItems.length === 1 ? videoItems[0]?.videoUrl : null);

  useEffect(() => {
    const sid = savedSessionId || savedSessionIdRef.current;
    if (!sid || !activeHistoryVideoUrl) return;
    let active = true;
    fetch(activeHistoryVideoUrl)
      .then((r) => r.blob())
      .then((blob) => {
        if (active && blob.size > 0) {
          return saveLocalSessionVideo(sid, blob);
        }
        return false;
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [savedSessionId, activeHistoryVideoUrl]);

  const handleUploadVideoToCloud = async () => {
    const sid = savedSessionId || savedSessionIdRef.current;
    if (!sid || !activeHistoryVideoUrl || cloudUploading) return;
    setCloudUploading(true);
    setCloudError('');
    try {
      const blob = await fetch(activeHistoryVideoUrl).then((r) => r.blob());
      await uploadSessionVideoToCloud(sid, blob);
      setCloudUploaded(true);
    } catch (err) {
      setCloudError(err?.message || 'อัปโหลดคลิปขึ้นคลาวด์ไม่สำเร็จ');
    } finally {
      setCloudUploading(false);
    }
  };

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
    setMergedVideo((prev) => {
      if (prev?.url && !prev.isDirect) URL.revokeObjectURL(prev.url);
      return null;
    });
    setVideoMergeError(null);
    setVideoMergeProgress(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoKey]);

  const [layoutModalOpen, setLayoutModalOpen] = useState(false);
  const [videoLayout, setVideoLayout] = useState(DEFAULT_VIDEO_LAYOUT);
  const [slideFilter, setSlideFilter] = useState('all');
  const [expandedSlides, setExpandedSlides] = useState({});
  const [activeTab, setActiveTab] = useState('overview');
  const [slidePage, setSlidePage] = useState(1);
  const [qaPage, setQaPage] = useState(1);

  const handleMergeVideo = async (chosenLayout = videoLayout) => {
    if (videoItems.length === 0 || videoMerging) return;
    setVideoMerging(true);
    setVideoMergeError(null);
    setVideoMergeProgress({ stage: 'loading', current: 1, total: videoItems.length, pct: 0 });
    try {
      const res = await mergeVideoTracks(
        videoItems,
        (prog) => {
          setVideoMergeProgress(prog);
        },
        { forceCompose: true, layout: chosenLayout },
      );
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
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
      {/* หัวข้อสรุปผล */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-stone-900">สรุปการซ้อม</h1>
          <p className="mt-1 text-sm text-muted">{deck.name}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={async () => {
              const ok = await askConfirm({
                key: 'leave-summary',
                title: 'กลับไปหน้าซ้อม?',
                message: 'หากกลับไปอัดใหม่บางหน้า คลิปเสียงและวิดีโอรวมจะเปลี่ยนไป ต้องการกลับไปหน้าซ้อมหรือไม่?',
                confirmText: 'กลับไปหน้าซ้อม',
              });
              if (ok) onBack();
            }}
            className="min-h-[40px] rounded-xl border border-line bg-white px-4 py-2 text-xs font-medium text-ink transition hover:border-faint active:scale-[0.99] cursor-pointer"
          >
            กลับไปหน้าซ้อม
          </button>
          <button
            type="button"
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
              if (ok) onRestart(currentRoundSnapshot);
            }}
            className="min-h-[40px] rounded-xl bg-ink px-4 py-2 text-xs font-semibold text-paper transition hover:bg-ink/90 active:scale-[0.99] cursor-pointer"
          >
            ซ้อมใหม่ทั้งหมด
          </button>
        </div>
      </div>

      {/* แถบแท็บสลับหมวด ไม่ให้หน้าสรุปผลยาวลงล่าง */}
      <div className="mb-6 flex flex-wrap gap-2 border-b border-line pb-3">
        <button
          type="button"
          onClick={() => setActiveTab('overview')}
          className={`rounded-lg px-3.5 py-2 text-xs font-medium transition cursor-pointer ${
            activeTab === 'overview'
              ? 'bg-ink text-paper'
              : 'border border-line bg-white text-muted hover:text-ink'
          }`}
        >
          ภาพรวม & คลิปรวม
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('slides')}
          className={`rounded-lg px-3.5 py-2 text-xs font-medium transition cursor-pointer ${
            activeTab === 'slides'
              ? 'bg-ink text-paper'
              : 'border border-line bg-white text-muted hover:text-ink'
          }`}
        >
          รายสไลด์ ({deck.slides.length})
        </button>
        {qaResults.length > 0 && (
          <button
            type="button"
            onClick={() => setActiveTab('qa')}
            className={`rounded-lg px-3.5 py-2 text-xs font-medium transition cursor-pointer ${
              activeTab === 'qa'
                ? 'bg-ink text-paper'
                : 'border border-line bg-white text-muted hover:text-ink'
            }`}
          >
            ถาม-ตอบ ({qaResults.length})
          </button>
        )}
      </div>

      {activeTab === 'overview' && (
        <>
          <div className="mt-6">
            <RoundComparisonCard
              roundsHistory={matchingRoundsHistory}
              currentRound={currentRoundSnapshot}
              deckName={deck.name}
              audience={audience}
              mode="solo"
              aiCache={compareAiCache}
              onAiCacheChange={onCompareAiCacheChange}
              onClearHistory={onClearRoundsHistory}
            />
          </div>

      {/* การ์ดไฟล์รวม (Default สำหรับดาวน์โหลดและแชร์) */}
      {(hasAnyAudio || hasAnyVideo) && (
        <div className="mt-6 rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(27,27,26,0.06)] space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-ink">ไฟล์สรุปรวมทุกสไลด์ (พร้อมแชร์และดาวน์โหลด)</h2>
              <p className="mt-0.5 text-xs text-muted">
                ไฟล์ชั่วคราวบนหน้านี้ (บันทึกเข้าเครื่องอัตโนมัติใน History เมื่อล็อกอิน — แนะนำให้ดาวน์โหลดหรืออัปโหลดขึ้นคลาวด์ก่อนออก)
              </p>
            </div>
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
                {mergedVideo?.url && !videoMerging ? (
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
                      download={`${deck.name || 'presentation'}-with-slides.${mergedVideo.ext || 'mp4'}`}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-xs font-medium text-white transition hover:bg-accent/90"
                    >
                      ดาวน์โหลดวิดีโอพร้อมสไลด์ (.{mergedVideo.ext || 'mp4'})
                    </a>
                    <button
                      type="button"
                      onClick={() => setLayoutModalOpen(true)}
                      disabled={videoMerging}
                      className="rounded-lg border border-line bg-white px-3 py-2 text-xs font-medium text-muted transition hover:text-ink hover:border-faint disabled:opacity-60 cursor-pointer"
                    >
                      จัดวางตำแหน่งใหม่
                    </button>
                    {user && savedSessionId && (
                      <button
                        type="button"
                        onClick={handleUploadVideoToCloud}
                        disabled={cloudUploading || cloudUploaded}
                        className="rounded-lg border border-line bg-paper px-3 py-2 text-xs font-medium text-ink transition hover:border-ink disabled:opacity-60 cursor-pointer"
                      >
                        {cloudUploaded
                          ? '✓ บันทึกขึ้นคลาวด์แล้ว'
                          : cloudUploading
                            ? 'กำลังอัปโหลดขึ้นคลาวด์...'
                            : 'บันทึกคลิปขึ้นคลาวด์ (ดูข้ามเครื่อง)'}
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    {videoItems.length === 1 && (
                      <button
                        type="button"
                        onClick={() => setShowMergedVideo((v) => !v)}
                        className="rounded-lg border border-line bg-white px-3.5 py-2 text-xs font-medium text-ink transition hover:border-faint cursor-pointer"
                      >
                        {showMergedVideo ? 'ซ่อนคลิป' : 'ดูคลิปพร้อมสไลด์'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setLayoutModalOpen(true)}
                      disabled={videoMerging}
                      className="rounded-lg bg-accent px-3.5 py-2 text-xs font-medium text-white transition hover:bg-accent/90 disabled:opacity-60 cursor-pointer"
                    >
                      {videoMerging && videoMergeProgress
                        ? videoMergeProgress.stage === 'encoding'
                          ? `กำลังสร้างไฟล์พร้อมสไลด์ ${videoMergeProgress.pct}%...`
                          : `กำลังเตรียมคลิป (${videoMergeProgress.current}/${videoMergeProgress.total})...`
                        : videoItems.length === 1
                          ? 'สร้างไฟล์ดาวน์โหลดพร้อมสไลด์ (.mp4)'
                          : `รวมวิดีโอพร้อมสไลด์ (${videoItems.length} คลิป)`}
                    </button>
                  </>
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

          {videoMerging && (
            <SkeletonVideoMerge
              label={
                videoMergeProgress?.stage === 'encoding'
                  ? 'กำลังสร้างวิดีโอใหม่ตามเลย์เอาต์ที่เลือก...'
                  : 'กำลังเตรียมไฟล์วิดีโอและสไลด์...'
              }
              progressText={
                videoMergeProgress?.stage === 'encoding'
                  ? `${videoMergeProgress.pct || 0}%`
                  : `${videoMergeProgress?.current || 1}/${videoMergeProgress?.total || 1}`
              }
              percent={
                videoMergeProgress?.stage === 'encoding'
                  ? videoMergeProgress.pct || 0
                  : 10
              }
            />
          )}

          {showMergedVideo && !videoMerging && (mergedVideo?.url || videoItems.length === 1) && (
            <TimelineReplayPlayer
              videoUrl={mergedVideo?.url || videoItems[0].videoUrl}
              duration={mergedDuration || totalTime}
              events={mergedTimelineEvents}
              slides={deck.slides}
              isMergedExport={Boolean(mergedVideo?.url && !mergedVideo.isDirect)}
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

      {/* Hero Metric Cards (3 ช่อง) */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(27,27,26,0.06)]">
          <div className="flex items-center justify-between text-xs text-muted">
            <span>เวลารวม</span>
            <ClockIcon className="size-4 text-muted" />
          </div>
          <p className="mt-2 font-mono text-3xl font-semibold tabular-nums tracking-tight text-ink">
            {formatTime(totalTime)}
          </p>
        </div>

        <div className="rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(27,27,26,0.06)]">
          <div className="flex items-center justify-between text-xs text-muted">
            <span>ความเร็วเฉลี่ย (คำ/นาที)</span>
            <GaugeIcon className="size-4 text-muted" />
          </div>
          <div className="mt-2 flex items-baseline gap-2.5">
            <p className="font-mono text-3xl font-semibold tabular-nums tracking-tight text-ink">
              {avgWpm || '–'}
            </p>
            {avgWpm > 0 && (() => {
              const p = pace(avgWpm);
              if (!p) return null;
              const badgeCls =
                p.tone === 'good'
                  ? 'bg-ok/10 text-ok'
                  : p.tone === 'slow'
                    ? 'bg-slow/10 text-slow'
                    : 'bg-accent/10 text-accent';
              return (
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${badgeCls}`}>
                  {p.label}
                </span>
              );
            })()}
          </div>
        </div>

        <div className="rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(27,27,26,0.06)]">
          <div className="flex items-center justify-between text-xs text-muted">
            <span>คำติดปากรวม</span>
            <MessageSquareIcon className="size-4 text-muted" />
          </div>
          <div className="mt-2 flex items-baseline gap-2.5">
            <p className="font-mono text-3xl font-semibold tabular-nums tracking-tight text-ink">
              {totalFillers > 0 ? totalFillers : '0'}
            </p>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                totalFillers === 0 ? 'bg-ok/10 text-ok' : 'bg-paper text-muted'
              }`}
            >
              {totalFillers === 0 ? 'พูดลื่นไหลดีมาก' : 'ครั้ง'}
            </span>
          </div>
        </div>
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

      {rows.length > 0 && (
        <div className="mt-4">
          <SummaryCharts
            avgWpm={avgWpm}
            avgEyeContact={avgEyeContact}
            items={rows.map(({ i, r }) => {
              const aiSlide = aiSummary?.slides?.find((x) => x.index === i);
              const missedCount = aiSlide?.missed?.length || 0;
              const fillerCount = r?.fillers?.total || 0;
              const deadAirCount = r?.deadAir?.count || 0;
              const hints = [];
              if (missedCount > 0) hints.push(`ลืม ${missedCount} ประเด็น`);
              if (fillerCount > 0) hints.push(`ติดปาก ${fillerCount}`);
              if (deadAirCount > 0) hints.push(`เงียบค้าง ${deadAirCount}`);
              return {
                index: i,
                label: `สไลด์ ${i + 1}`,
                wpm: r?.wpm || 0,
                eyeContactPct: r?.vision?.cameraUsed ? r.vision.eyeContactPct : null,
                hasIssue: hints.length > 0,
                issueHint: hints[0] || '',
              };
            })}
            onSelectSlide={(idx) => {
              setSlideFilter('all');
              setActiveTab('slides');
              setSlidePage(Math.floor(idx / 5) + 1);
              setExpandedSlides((prev) => ({ ...prev, [idx]: true }));
            }}
          />
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
          <GeminiCooldownButton
            loading={aiLoading}
            loadingLabel="กำลังวิเคราะห์..."
            onClick={runAiAnalysis}
            className="shrink-0 rounded-xl bg-accent px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-accent/90 cursor-pointer"
          >
            วิเคราะห์สรุปผลด้วย AI (-2 Tokens)
          </GeminiCooldownButton>
        </div>
      )}

      {aiLoading && (
        <div className="mt-4 space-y-3">
          <SlowOperationBar visible label="กำลังวิเคราะห์เนื้อหาสไลด์และความเข้าใจของผู้ฟัง..." />
          <SkeletonSummaryOverview />
        </div>
      )}

      {!aiLoading && aiError && (
        <div className="mt-4">
          <ErrorState
            title="วิเคราะห์สรุปผลไม่สำเร็จ"
            message={aiError}
            onRetry={runAiAnalysis}
            retryLabel="ลองวิเคราะห์อีกครั้ง (-2 Tokens)"
          />
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
            <div className="rounded-xl bg-paper/75 p-4 sm:p-5 text-base leading-relaxed text-stone-900">
              <p className="text-sm font-medium text-muted mb-1.5">สิ่งที่คนฟังจับใจความได้</p>
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
              <div className="rounded-lg border border-ok/20 bg-ok/5 p-4 space-y-1.5">
                <p className="font-semibold text-ok">จุดเด่น</p>
                <ul className="space-y-1.5 text-ink/90 list-disc pl-4 leading-relaxed">
                  {aiSummary.topStrengths.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              </div>
            )}
            {aiSummary.topImprovements?.length > 0 && (
              <div className="rounded-lg border border-accent/20 bg-accent/5 p-4 space-y-1.5">
                <p className="font-semibold text-accent">สิ่งที่ควรปรับ</p>
                <ul className="space-y-1.5 text-ink/90 list-disc pl-4 leading-relaxed">
                  {aiSummary.topImprovements.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
        </>
      )}

      {/* รายการสไลด์แต่ละหน้า พร้อมเครื่องเล่นเสียงและปุ่มแก้ไข (แบ่งหน้าละ 5) */}
      {activeTab === 'slides' && (() => {
        const hasIssue = (r, idx) => {
          const aiSlide = aiSummary?.slides?.find((x) => x.index === idx);
          return (
            (aiSlide?.missed?.length || 0) > 0 ||
            (r?.fillers?.total || 0) > 0 ||
            (r?.deadAir?.count || 0) > 0
          );
        };
        const needFixCount = rows.filter(({ i, r }) => hasIssue(r, i)).length;
        const filteredRows =
          slideFilter === 'issues' ? rows.filter(({ i, r }) => hasIssue(r, i)) : rows;
        const totalSlidePages = Math.max(1, Math.ceil(filteredRows.length / 5));
        const safeSlidePage = Math.min(slidePage, totalSlidePages);
        const pagedRows = filteredRows.slice((safeSlidePage - 1) * 5, safeSlidePage * 5);
        const allExpanded =
          pagedRows.length > 0 && pagedRows.every(({ i }) => expandedSlides[i]);

        return (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-ink">รายละเอียดแต่ละหน้า ({filteredRows.length} สไลด์)</h3>
                <p className="text-[11px] text-muted">คลิกที่หัวข้อสไลด์เพื่อดูคำพูด คำแนะนำ และเล่นคลิปย้อนหลัง</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {needFixCount > 0 && (
                  <div className="flex rounded-lg border border-line bg-white p-0.5 text-xs">
                    <button
                      type="button"
                      onClick={() => {
                        setSlideFilter('all');
                        setSlidePage(1);
                      }}
                      className={`rounded-md px-2.5 py-1 transition cursor-pointer ${
                        slideFilter === 'all' ? 'bg-ink text-paper font-medium' : 'text-muted hover:text-ink'
                      }`}
                    >
                      ทั้งหมด ({rows.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSlideFilter('issues');
                        setSlidePage(1);
                      }}
                      className={`rounded-md px-2.5 py-1 transition cursor-pointer ${
                        slideFilter === 'issues' ? 'bg-accent text-white font-medium' : 'text-muted hover:text-ink'
                      }`}
                    >
                      ควรปรับ ({needFixCount})
                    </button>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => {
                    const next = { ...expandedSlides };
                    pagedRows.forEach(({ i }) => {
                      next[i] = !allExpanded;
                    });
                    setExpandedSlides(next);
                  }}
                  className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs text-muted hover:border-faint hover:text-ink cursor-pointer"
                >
                  {allExpanded ? 'ย่อหน้านี้' : 'เปิดดูหน้านี้'}
                </button>
              </div>
            </div>

            {pagedRows.map(({ s, i, r }) => {
              const p = r ? pace(r.wpm) : null;
              const isPlayingThis = playingIndex === i;
              const isEditingThis = editingIndex === i;
              const aiSlide = aiSummary?.slides?.find((x) => x.index === i);
              const flagged = hasIssue(r, i);
              const sharedContinuousResult =
                rehearsalMode === 'continuous'
                  ? rows.find((row) => row.r?.videoUrl || row.r?.audioUrl)?.r || null
                  : null;
              const clipResult =
                r?.videoUrl || r?.audioUrl ? r : sharedContinuousResult;
              const isContinuousClip =
                rehearsalMode === 'continuous' &&
                Boolean(clipResult) &&
                ((clipResult.timelineEvents || []).filter((ev) => ev.type === 'slide').length > 1 ||
                  rows.some((row) => row.r && !row.r.videoUrl));
              const slideEvents = isContinuousClip
                ? (clipResult?.timelineEvents || [])
                    .filter((ev) => ev.type === 'slide')
                    .sort((a, b) => a.t - b.t)
                : [];
              const currentSlideEvIdx = slideEvents.findIndex(
                (ev) => ev.label === `เริ่มสไลด์ ${i + 1}`,
              );
              const slideStartTime =
                currentSlideEvIdx >= 0 ? slideEvents[currentSlideEvIdx].t : 0;
              const nextSlideEv =
                currentSlideEvIdx >= 0 && currentSlideEvIdx + 1 < slideEvents.length
                  ? slideEvents[currentSlideEvIdx + 1]
                  : null;
              const slideEndTime = nextSlideEv ? nextSlideEv.t : null;
              const isOpen =
                expandedSlides[i] ??
                (flagged || isPlayingThis || isEditingThis || openVideoIndex === i);

              return (
                <div
                  id={`summary-slide-${i}`}
                  key={s.id}
                  className={`rounded-xl border transition-all bg-white overflow-hidden ${
                    isPlayingThis ? 'border-accent ring-1 ring-accent/30' : 'border-line'
                  }`}
                >
                  {/* แถวบน: หัวข้อสไลด์และป้ายสถิติ (คลิกพับ/กางได้) */}
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedSlides((prev) => ({
                        ...prev,
                        [i]: !isOpen,
                      }))
                    }
                    className="flex w-full flex-wrap items-center justify-between gap-2 px-5 py-3.5 text-left transition hover:bg-paper/50 cursor-pointer"
                  >
                    <div className="flex flex-wrap items-center gap-2 min-w-0">
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-paper font-mono text-xs font-semibold text-ink">
                        {i + 1}
                      </span>
                      <span className="text-sm font-semibold text-ink truncate max-w-xs sm:max-w-md">
                        {s.title || `สไลด์หน้า ${i + 1}`}
                      </span>
                      {r ? (
                        flagged ? (
                          <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent">
                            มีประเด็นแนะนำ
                          </span>
                        ) : (
                          <span className="rounded-full bg-ok/10 px-2 py-0.5 text-[11px] font-medium text-ok">
                            ผ่านเกณฑ์
                          </span>
                        )
                      ) : (
                        <span className="rounded-full bg-paper px-2 py-0.5 text-[11px] text-faint">
                          ยังไม่ได้ซ้อม
                        </span>
                      )}
                    </div>

                    {r && (
                      <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono tabular-nums">
                        <span className="rounded-md bg-paper px-2 py-0.5 text-ink">{formatTime(r.duration)}</span>
                        <span className={`rounded-md bg-paper px-2 py-0.5 ${p ? PACE_TEXT[p.tone] : 'text-muted'}`}>
                          {r.wpm} คำ/นาที {p && `(${p.label})`}
                        </span>
                        {r.fillers?.total > 0 && (
                          <span className="rounded-md bg-accent/10 px-2 py-0.5 text-accent font-sans font-medium">
                            ติดปาก {r.fillers.total}
                          </span>
                        )}
                        {r.deadAir?.count > 0 && (
                          <span className="rounded-md bg-slow/10 px-2 py-0.5 text-slow font-sans font-medium">
                            เดดแอร์ {r.deadAir.count}
                          </span>
                        )}
                        {r.vision?.cameraUsed && (
                          <span
                            className={`rounded-md bg-paper px-2 py-0.5 font-sans ${
                              r.vision.eyeContactPct >= 70 ? 'text-ok' : 'text-slow'
                            }`}
                          >
                            สบตา {r.vision.eyeContactPct}%
                          </span>
                        )}
                        <span className="ml-1 font-sans text-xs text-faint">{isOpen ? 'ซ่อน' : 'ดูเพิ่ม'}</span>
                      </div>
                    )}
                  </button>

                  {isOpen && (
                    <div className="border-t border-line px-5 pb-5 pt-4 bg-paper/20">
                      {/* ข้อความที่พูด (โหมดแสดงผล หรือ โหมดแก้ไข) + ภาพสไลด์ย่อ */}
                      <div className={s.src ? 'grid gap-3 sm:grid-cols-[150px_1fr] items-start' : ''}>
                        {s.src && (
                          <div className="overflow-hidden rounded-lg border border-line bg-white">
                            <img
                              src={s.src}
                              alt={s.title || `สไลด์ ${i + 1}`}
                              className="aspect-video w-full object-contain"
                            />
                          </div>
                        )}
                        <div className={aiSlide && (aiSlide.missed?.length > 0 || aiSlide.polishedScript) ? 'grid grid-cols-1 gap-4 lg:grid-cols-2' : ''}>
                        {isEditingThis ? (
                          <div className="space-y-2">
                            <textarea
                              value={editText}
                              onChange={(e) => setEditText(e.target.value)}
                              rows={3}
                              className="w-full rounded-xl border border-ink/30 bg-white p-3.5 text-base focus:border-ink focus:outline-none"
                              placeholder="พิมพ์แก้ไขข้อความที่ถอดเสียง..."
                            />
                            <div className="flex justify-end gap-2 text-xs">
                              <button
                                onClick={() => setEditingIndex(null)}
                                className="rounded-lg border border-line bg-white px-3 py-1.5 transition hover:bg-paper cursor-pointer"
                              >
                                ยกเลิก
                              </button>
                              <button
                                onClick={() => handleSaveEdit(i)}
                                className="rounded-lg bg-ink px-3 py-1.5 font-medium text-paper transition hover:bg-ink/85 cursor-pointer"
                              >
                                บันทึกข้อความ
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="rounded-xl border-l-4 border-ink/30 bg-white p-4 shadow-2xs space-y-1.5">
                            <p className="text-sm font-medium text-muted">คำพูดของคุณ</p>
                            {r?.transcript ? (
                              <p className="text-base leading-relaxed text-stone-900">&ldquo;{r.transcript}&rdquo;</p>
                            ) : (
                              <p className="text-base italic text-faint">ยังไม่มีข้อความเสียงในสไลด์นี้</p>
                            )}
                          </div>
                        )}

                        {aiSlide && (aiSlide.missed?.length > 0 || aiSlide.polishedScript) && (
                          <div className="space-y-2.5">
                            {aiSlide.missed?.length > 0 && (
                              <div className="rounded-xl bg-accent/5 p-4 space-y-1">
                                <p className="text-sm font-medium text-accent">ประเด็นที่ยังไม่ได้พูด</p>
                                <p className="text-base leading-relaxed text-stone-900">{aiSlide.missed.join(' · ')}</p>
                              </div>
                            )}
                            {aiSlide.polishedScript && (
                              <div className="rounded-xl bg-ok/10 p-4 space-y-1">
                                <p className="text-sm font-medium text-ok">ตัวอย่างประโยคที่กระชับขึ้น</p>
                                <p className="text-base leading-relaxed text-stone-900">{aiSlide.polishedScript}</p>
                              </div>
                            )}
                          </div>
                        )}
                        </div>
                      </div>

                      {/* แถบปุ่ม Action ด้านล่างของสไลด์นี้ (หน้าตาเดียวกับแท็บถาม-ตอบ) */}
                      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line/60 pt-3 text-xs">
                        <div className="flex flex-wrap items-center gap-2">
                          {r?.audioUrl ? (
                            <MiniAudioPlayer
                              src={r.audioUrl}
                              downloadName={`slide-${i + 1}-audio.webm`}
                            />
                          ) : (
                            <span className="text-faint italic text-xs">
                              {isContinuousClip
                                ? 'ใช้เสียงจากคลิปซ้อมใหญ่ต่อเนื่อง'
                                : 'ไม่มีไฟล์เสียง'}
                            </span>
                          )}
                          {(clipResult?.videoUrl || clipResult?.audioUrl) && (
                            <button
                              type="button"
                              onClick={() => setOpenVideoIndex(openVideoIndex === i ? null : i)}
                              className="min-h-[34px] rounded-full bg-ink px-3.5 py-1 text-xs font-medium text-white transition hover:opacity-90 cursor-pointer"
                            >
                              {openVideoIndex === i ? 'ซ่อน Timeline Replay' : 'ดู Timeline Replay'}
                            </button>
                          )}
                          {r?.videoUrl && (
                            <a
                              href={r.videoUrl}
                              download={`slide-${i + 1}.${r.videoExt || 'webm'}`}
                              className="inline-flex min-h-[34px] items-center rounded-full bg-paper px-3 py-1 text-xs font-medium text-ink transition hover:bg-line/70"
                            >
                              โหลดคลิปดิบ
                            </a>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          {r && !isEditingThis && (
                            <button
                              type="button"
                              onClick={() => handleStartEdit(i, r.transcript)}
                              className="inline-flex min-h-[34px] items-center gap-1 rounded-full border border-line bg-white px-3 py-1 text-xs font-medium text-ink transition hover:border-faint hover:bg-paper cursor-pointer"
                            >
                              แก้ข้อความ
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => onReRecordSlide(i)}
                            className="inline-flex min-h-[34px] items-center gap-1 rounded-full border border-line bg-white px-3 py-1 text-xs font-medium text-ink transition hover:border-faint hover:bg-paper cursor-pointer"
                          >
                            อัดใหม่หน้านี้
                          </button>
                        </div>
                      </div>

              {(clipResult?.videoUrl || clipResult?.audioUrl) && openVideoIndex === i && (() => {
                const clipDuration = isContinuousClip
                  ? Math.max(totalTime, clipResult.duration || 0)
                  : clipResult.duration;

                return (
                  <TimelineReplayPlayer
                    key={`replay-${i}-${slideStartTime}-${slideEndTime ?? 'end'}`}
                    videoUrl={clipResult.videoUrl}
                    audioUrl={clipResult.audioUrl}
                    duration={clipDuration}
                    initialTime={isContinuousClip ? slideStartTime : 0}
                    endTime={isContinuousClip ? slideEndTime : null}
                    events={clipResult.timelineEvents || []}
                    slides={deck.slides}
                    slideIndex={i}
                  />
                );
              })()}
                  </div>
                  )}
                </div>
              );
            })}
            <Pagination
              page={safeSlidePage}
              totalItems={filteredRows.length}
              pageSize={5}
              onPageChange={setSlidePage}
            />
          </div>
        );
      })()}

      {/* ผลช่วงถาม-ตอบ (แบ่งหน้าละ 5) */}
      {activeTab === 'qa' && qaResults.length > 0 && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(27,27,26,0.06)]">
            <div>
              <h3 className="text-lg sm:text-xl font-semibold text-stone-900">ผลช่วงถาม-ตอบ</h3>
              <p className="mt-0.5 text-sm text-muted">
                คำถามที่ฝึกตอบ {qaResults.length} ข้อ
              </p>
            </div>
            {unevaluatedQaCount > 0 && (
              <button
                type="button"
                onClick={handleEvaluateAllQa}
                disabled={qaEvaluating}
                className="min-h-[44px] rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent/90 disabled:opacity-50 cursor-pointer"
              >
                {qaEvaluating
                  ? 'กำลังตรวจคำตอบ Q&A...'
                  : `ให้ AI ตรวจคำตอบ Q&A (-1 Token/ข้อ • ${unevaluatedQaCount} ข้อ)`}
              </button>
            )}
          </div>
          {qaEvalError && <p className="text-sm text-accent">{qaEvalError}</p>}

          <div className="space-y-4">
            {qaResults.slice((qaPage - 1) * 5, qaPage * 5).map((q, idx) => {
              const realIdx = (qaPage - 1) * 5 + idx;
              return (
                <QaResultCard
                  key={realIdx}
                  index={realIdx}
                  question={q.question}
                  isInterrupt={Boolean(q.isInterrupt)}
                  slideIndex={q.slideIndex ?? 0}
                  answerText={q.answerTranscript || q.answer || ''}
                  directness={q.directness || ''}
                  feedback={q.feedback || ''}
                  timelineNote={q.timelineNote || ''}
                  betterAnswer={q.betterAnswer || ''}
                  audioUrl={q.audioUrl || ''}
                  audioDownloadName={q.audioUrl ? `qa-${realIdx + 1}-audio.webm` : ''}
                  actionSlot={
                    q.videoUrl ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setOpenQaVideoIndex(openQaVideoIndex === realIdx ? null : realIdx)}
                          className="min-h-[34px] rounded-full bg-ink px-3.5 py-1 text-xs font-medium text-white hover:opacity-90 cursor-pointer"
                        >
                          {openQaVideoIndex === realIdx ? 'ซ่อน Timeline Replay' : 'ดู Timeline Replay'}
                        </button>
                        <a
                          href={q.videoUrl}
                          download={`qa-${realIdx + 1}.${q.videoExt || 'webm'}`}
                          className="rounded-full bg-paper px-3 py-1 text-xs font-medium text-ink hover:bg-line/70"
                        >
                          โหลดคลิปดิบ
                        </a>
                      </div>
                    ) : null
                  }
                  replaySlot={
                    (q.videoUrl || q.audioUrl) && openQaVideoIndex === realIdx ? (
                      <div className="pt-2">
                        <TimelineReplayPlayer
                          videoUrl={q.videoUrl}
                          audioUrl={q.audioUrl}
                          duration={q.duration}
                          events={q.timelineEvents || []}
                          slides={deck.slides}
                          slideIndex={q.slideIndex ?? 0}
                          qaQuestion={q.question}
                        />
                      </div>
                    ) : null
                  }
                />
              );
            })}
          </div>
          <Pagination page={qaPage} totalItems={qaResults.length} pageSize={5} onPageChange={setQaPage} />
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
            ส่งลิงก์สรุปผลไป LINE, X, Facebook หรือคัดลอกส่งให้อาจารย์/เพื่อน (เปิดแชร์วันละครั้งรับ +1 Token)
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {user && (
            <button
              type="button"
              onClick={() => setShareModalOpen(true)}
              className="rounded-lg bg-ink px-4 py-2 text-xs font-semibold text-paper transition hover:bg-ink/90 cursor-pointer"
            >
              แชร์ผลการซ้อม (LINE / X / ลิงก์)
            </button>
          )}
          {referralUrl && (
            <button
              type="button"
              onClick={handleCopyReferral}
              className="rounded-lg border border-line bg-paper px-3.5 py-2 text-xs font-medium text-ink transition hover:border-ink cursor-pointer"
            >
              {refCopied ? 'คัดลอกลิงก์ชวนเพื่อนแล้ว' : 'คัดลอกลิงก์ชวนเพื่อน (+10 Tokens)'}
            </button>
          )}
        </div>
      </div>

      <ShareSessionModal
        open={shareModalOpen}
        onClose={() => setShareModalOpen(false)}
        sessionId={savedSessionId || savedSessionIdRef.current}
        initialShareId={shareMeta.shareId}
        initialIsPublic={shareMeta.isPublic}
        deckName={deck.name}
        isGroup={false}
        totalDurationSec={Math.floor(totalTime)}
        avgWpm={avgWpm}
        avgEyeContactPct={avgEyeContact}
        referralCode={user?.referralCode || ''}
        onShareUpdated={(res) => {
          setShareMeta({ shareId: res.shareId || '', isPublic: Boolean(res.isPublic) });
          if (typeof res.tokens === 'number') {
            onTokensChange?.(res.tokens);
          }
        }}
      />

      <VideoLayoutModal
        open={layoutModalOpen}
        initialLayout={videoLayout}
        previewSlide={videoItems[0]?.slide || deck.slides[0] || null}
        previewVideoUrl={videoItems[0]?.videoUrl || null}
        onCancel={() => setLayoutModalOpen(false)}
        onConfirm={(chosenLayout) => {
          setVideoLayout(chosenLayout);
          setLayoutModalOpen(false);
          void handleMergeVideo(chosenLayout);
        }}
      />
    </div>
  );
}
