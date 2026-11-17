import { useEffect, useMemo, useRef, useState } from 'react';
import {
  analyzeSummaryWithAi,
  deleteGroupClips,
  evaluateQaAnswer,
  fetchGroupClips,
  saveRehearsalSession,
  uploadSessionVideoToCloud,
} from '../lib/api';
import { saveLocalSessionVideo } from '../lib/videoStore';
import { analyze, formatTime, pace, PACE_PILL, PACE_TEXT } from '../lib/metrics';
import { mergeAudioTracks, mergeVideoTracks } from '../lib/mediaMerge';
import { askConfirm } from './ConfirmModal';
import SummaryCharts from './SummaryCharts';
import TimelineReplayPlayer from './TimelineReplayPlayer';
import VideoLayoutModal from './VideoLayoutModal';
import RoundComparisonCard from './RoundComparisonCard';

export default function GroupSummaryView({
  socket,
  room,
  user = null,
  selfId,
  onBackToLobby,
  onLeaveRoom,
}) {
  const isHost = room.hostId === selfId;
  const slides = room.slides || [];
  const qaQuestions = room.qaQuestions || [];
  const qaAnswers = room.qaAnswers || {};
  const uploadedKey = (room.uploadedSlides || []).join(',');

  const [clips, setClips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('overview'); // 'overview' | 'slides' | 'qa'
  const [selectedMember, setSelectedMember] = useState('all'); // 'all' | memberName
  const [expandedSlides, setExpandedSlides] = useState({});
  const [openReplayIdx, setOpenReplayIdx] = useState(null);
  const [openQaReplayIdx, setOpenQaReplayIdx] = useState(null);
  const [showMoreMap, setShowMoreMap] = useState({});
  const [editingIdx, setEditingIdx] = useState(null);
  const [editText, setEditText] = useState('');
  const [downloadingAudioIdx, setDownloadingAudioIdx] = useState(null);
  const audioRefs = useRef({});

  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [localAiSummary, setLocalAiSummary] = useState(null);
  const [qaEvalLoading, setQaEvalLoading] = useState({});
  const [localQaEvals, setLocalQaEvals] = useState({});
  const [localCompareCache, setLocalCompareCache] = useState({});

  const [layoutModalOpen, setLayoutModalOpen] = useState(false);
  const [merging, setMerging] = useState(false);
  const [mergeProgress, setMergeProgress] = useState(0);
  const [mergedVideoUrl, setMergedVideoUrl] = useState(null);
  const [mergedVideoExt, setMergedVideoExt] = useState('mp4');
  const [mergedAudioUrl, setMergedAudioUrl] = useState(null);
  const [audioMerging, setAudioMerging] = useState(false);
  const [savedSessionId, setSavedSessionId] = useState(null);
  const [savingHistory, setSavingHistory] = useState(false);
  const [historySavedMsg, setHistorySavedMsg] = useState('');
  const [cloudUploading, setCloudUploading] = useState(false);
  const [cloudUploaded, setCloudUploaded] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchGroupClips(room.code)
      .then((data) => {
        if (active) {
          setClips(data);
          setError('');
        }
      })
      .catch((err) => {
        if (active) setError(err?.message || 'โหลดผลซ้อมกลุ่มไม่สำเร็จ');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [room.code, uploadedKey]);

  useEffect(() => {
    return () => {
      if (mergedVideoUrl) URL.revokeObjectURL(mergedVideoUrl);
    };
  }, [mergedVideoUrl]);

  const slideClips = useMemo(() => clips.filter((c) => c.slideIndex < 1000), [clips]);
  const clipMap = useMemo(() => new Map(slideClips.map((c) => [c.slideIndex, c])), [slideClips]);
  const qaClipMap = useMemo(() => {
    const m = new Map();
    clips.forEach((c) => {
      if (c.slideIndex >= 1000) m.set(c.slideIndex - 1000, c);
    });
    return m;
  }, [clips]);

  const aiSummary = room.aiSummary || localAiSummary;
  const qaEvaluations = useMemo(
    () => ({ ...(room.qaEvaluations || {}), ...localQaEvals }),
    [room.qaEvaluations, localQaEvals],
  );

  // รายชื่อสมาชิกที่มีข้อมูลคลิป (สำหรับแถบสลับดูรวม/แยกคน)
  const memberTabs = useMemo(() => {
    const names = [];
    const seen = new Set();
    slideClips.forEach((c) => {
      const name = c.memberName || 'สมาชิก';
      if (!seen.has(name)) {
        seen.add(name);
        names.push(name);
      }
    });
    return names;
  }, [slideClips]);

  // กรองรายการสไลด์ตามมุมมองที่เลือก (ภาพรวมทั้งกลุ่ม หรือ แยกตามชื่อ)
  const visibleRows = useMemo(() => {
    return slides
      .map((s, idx) => ({ s, idx, clip: clipMap.get(idx) || null }))
      .filter(({ clip }) => {
        if (selectedMember === 'all') return true;
        return clip && (clip.memberName || 'สมาชิก') === selectedMember;
      });
  }, [slides, clipMap, selectedMember]);

  const visibleClips = useMemo(
    () => visibleRows.map((r) => r.clip).filter(Boolean),
    [visibleRows],
  );

  const totals = useMemo(() => {
    let duration = 0;
    let words = 0;
    let fillers = 0;
    visibleClips.forEach((c) => {
      const a = c.analysis || {};
      duration += Number(a.duration || 0);
      words += Number(a.words || 0);
      fillers += Number(a.fillers?.total || 0);
    });
    const wpm = duration > 3 ? Math.round(words / (duration / 60)) : 0;
    return { duration, words, fillers, wpm };
  }, [visibleClips]);

  const issueItems = useMemo(() => {
    const out = [];
    visibleRows.forEach(({ s, idx, clip }) => {
      if (!clip) return;
      const a = clip.analysis || {};
      const p = pace(a.wpm);
      const hints = [];
      if (p && p.tone !== 'good') hints.push(p.label);
      if ((a.fillers?.total || 0) >= 3) hints.push(`ติดปาก ${a.fillers.total}`);
      if (hints.length > 0) {
        out.push({
          index: idx,
          label: `หน้า ${idx + 1}: ${s.title || `สไลด์ ${idx + 1}`}`,
          issueHint: hints.join(' · '),
        });
      }
    });
    return out;
  }, [visibleRows]);

  const visibleQaClips = useMemo(() => {
    return Array.from(qaClipMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([qIdx, clip]) => ({ qIdx, clip }))
      .filter(({ clip }) => {
        if (selectedMember === 'all') return true;
        return (clip.memberName || 'สมาชิก') === selectedMember;
      });
  }, [qaClipMap, selectedMember]);

  const allMergedClips = useMemo(
    () => [...visibleClips, ...visibleQaClips.map((x) => x.clip)],
    [visibleClips, visibleQaClips],
  );

  const videoClips = useMemo(
    () =>
      allMergedClips.filter(
        (c) => c.mimeType?.startsWith('video/') || !c.mimeType?.startsWith('audio/'),
      ),
    [allMergedClips],
  );

  const mergedTimelineMeta = useMemo(() => {
    const events = [];
    let offset = 0;
    for (const c of videoClips) {
      const dur = Math.max(1, Number(c.analysis?.duration || 0));
      if (c.slideIndex >= 1000) {
        const qIdx = c.slideIndex - 1000;
        const ans = qaAnswers[qIdx];
        const responder = ans?.responderName || c.memberName || 'สมาชิก';
        events.push({
          t: offset,
          type: 'qa',
          label: `เริ่มตอบ Q&A ข้อ ${qIdx + 1} (${responder} ตอบ)`,
        });
      } else {
        events.push({
          t: offset,
          type: 'slide',
          slideIndex: c.slideIndex,
          label: `เริ่มสไลด์ ${c.slideIndex + 1} (${c.memberName || 'สมาชิก'})`,
        });
      }
      const clipEvents = Array.isArray(c.analysis?.timelineEvents) ? c.analysis.timelineEvents : [];
      for (const ev of clipEvents) {
        if (!ev || typeof ev.t !== 'number') continue;
        events.push({
          t: offset + ev.t,
          type: ev.type || 'pace_fast',
          label: `${c.memberName || 'สมาชิก'}: ${ev.label}`,
        });
      }
      offset += dur;
    }
    return { events, totalDuration: offset };
  }, [videoClips, qaQuestions, qaAnswers]);

  // รวมเสียงอัตโนมัติตามมุมมองที่เลือก (ทั้งกลุ่มหรือรายคน + รวมช่วง Q&A)
  useEffect(() => {
    const urls = allMergedClips.map((c) => c.mediaUrl).filter(Boolean);
    if (urls.length === 0) {
      setMergedAudioUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      return;
    }

    let cancelled = false;
    setAudioMerging(true);
    mergeAudioTracks(urls)
      .then((res) => {
        if (cancelled) {
          if (res?.url) URL.revokeObjectURL(res.url);
          return;
        }
        setMergedAudioUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return res?.url || null;
        });
      })
      .catch(() => {
        // ignore audio merge error if browser blocks decode
      })
      .finally(() => {
        if (!cancelled) setAudioMerging(false);
      });

    return () => {
      cancelled = true;
    };
  }, [allMergedClips]);

  const handleMergeAll = async (customLayout) => {
    if (videoClips.length === 0 || merging) return;
    setLayoutModalOpen(false);
    setMerging(true);
    setMergeProgress(0);
    setError('');
    try {
      const items = videoClips.map((c) => {
        if (c.slideIndex >= 1000) {
          const qIdx = c.slideIndex - 1000;
          const q = qaQuestions[qIdx];
          const ans = qaAnswers[qIdx];
          const responder = ans?.responderName || c.memberName || 'สมาชิก';
          return {
            videoUrl: c.mediaUrl,
            slide: slides[0] || { title: `ช่วงถาม-ตอบ Q&A ข้อ ${qIdx + 1}` },
            qaQuestion: `คำถามที่ ${qIdx + 1} (${responder} ตอบ): ${q?.question || ''}`,
            duration: c.analysis?.duration || 0,
          };
        }
        return {
          videoUrl: c.mediaUrl,
          slide: slides[c.slideIndex] || { title: `สไลด์หน้า ${c.slideIndex + 1}` },
          qaQuestion: '',
          duration: c.analysis?.duration || 0,
        };
      });
      const merged = await mergeVideoTracks(
        items,
        (info) => {
          const pct = typeof info === 'number' ? info : (info?.pct ?? 0);
          setMergeProgress(Number.isFinite(pct) ? pct : 0);
        },
        {
          forceCompose: true,
          layout: customLayout,
        },
      );
      if (merged?.url) {
        if (mergedVideoUrl) URL.revokeObjectURL(mergedVideoUrl);
        setMergedVideoUrl(merged.url);
        setMergedVideoExt(merged.ext || 'mp4');
      }
    } catch (err) {
      setError(err?.message || 'รวมวิดีโอกลุ่มไม่สำเร็จ');
    } finally {
      setMerging(false);
    }
  };

  const groupRoundSnapshot = useMemo(() => {
    const roundsHistory = Array.isArray(room.roundsHistory) ? room.roundsHistory : [];
    const totalDur = slideClips.reduce((s, c) => s + (c.analysis?.duration || 0), 0);
    const totalFillers = slideClips.reduce((s, c) => s + (c.analysis?.fillers?.total || 0), 0);
    const totalDeadAir = slideClips.reduce((s, c) => s + (c.analysis?.deadAir?.count || 0), 0);
    const avgWpm = slideClips.length
      ? Math.round(slideClips.reduce((s, c) => s + (c.analysis?.wpm || 0), 0) / slideClips.length)
      : 0;
    const visionClips = slideClips.filter((c) => c.analysis?.vision?.cameraUsed);
    const avgEye = visionClips.length
      ? Math.round(
          visionClips.reduce((s, c) => s + (c.analysis.vision.eyeContactPct || 0), 0) /
            visionClips.length,
        )
      : null;

    const byMember = new Map();
    slideClips.forEach((c) => {
      const name = c.memberName || 'สมาชิก';
      if (!byMember.has(name)) {
        byMember.set(name, { name, wpmSum: 0, count: 0, fillersCount: 0, eyeSum: 0, eyeCount: 0 });
      }
      const entry = byMember.get(name);
      entry.wpmSum += c.analysis?.wpm || 0;
      entry.count += 1;
      entry.fillersCount += c.analysis?.fillers?.total || 0;
      if (c.analysis?.vision?.cameraUsed) {
        entry.eyeSum += c.analysis.vision.eyeContactPct || 0;
        entry.eyeCount += 1;
      }
    });

    const members = Array.from(byMember.values()).map((m) => ({
      name: m.name,
      avgWpm: m.count ? Math.round(m.wpmSum / m.count) : 0,
      fillersCount: m.fillersCount,
      eyeContactPct: m.eyeCount ? Math.round(m.eyeSum / m.eyeCount) : null,
    }));

    const qaAnswered = qaQuestions.filter((_, i) => qaAnswers[i]?.answerTranscript?.trim());
    const qaDirect = qaQuestions.filter((_, i) => qaEvaluations[i]?.directness === 'direct');

    return {
      roundNumber: roundsHistory.length + 1,
      slideCount: slides.length,
      avgWpm,
      fillersCount: totalFillers,
      deadAirCount: totalDeadAir,
      totalDurationSec: Math.round(totalDur),
      eyeContactPct: avgEye,
      qaAnsweredCount: qaAnswered.length,
      qaDirectCount: qaDirect.length,
      transcriptExcerpt: slideClips
        .map((c) => `[หน้า ${c.slideIndex + 1}] [ผู้พูด: ${c.memberName || 'สมาชิก'}] ${c.analysis?.transcript || ''}`)
        .join('\n')
        .slice(0, 5500),
      members,
    };
  }, [room.roundsHistory, slideClips, qaQuestions, qaAnswers, qaEvaluations]);

  const handleBackLobbyAndClean = async () => {
    await deleteGroupClips(room.code).catch(() => {});
    onBackToLobby(groupRoundSnapshot);
  };

  const handleSaveGroupHistory = async () => {
    if (!user || savingHistory) return;
    setSavingHistory(true);
    setError('');
    setHistorySavedMsg('');
    try {
      const roundsHistory = Array.isArray(room.roundsHistory) ? room.roundsHistory : [];
      const participants = (room.members || []).map((m) => {
        const myClips = slideClips.filter((c) => c.memberName === m.name);
        const myDur = myClips.reduce((s, c) => s + (c.analysis?.duration || 0), 0);
        const myWpm = myClips.length
          ? Math.round(myClips.reduce((s, c) => s + (c.analysis?.wpm || 0), 0) / myClips.length)
          : 0;
        const myEyeClips = myClips.filter((c) => c.analysis?.vision?.cameraUsed);
        const myEye = myEyeClips.length
          ? Math.round(
              myEyeClips.reduce((s, c) => s + (c.analysis.vision.eyeContactPct || 0), 0) /
                myEyeClips.length,
            )
          : null;
        return {
          userId: m.userId || null,
          displayName: m.name,
          role: m.id === room.hostId ? 'host' : 'member',
          slideIndexes: myClips.map((c) => c.slideIndex),
          durationSec: myDur,
          avgWpm: myWpm,
          avgEyeContactPct: myEye,
          transcript: myClips
            .map((c) => `[หน้า ${c.slideIndex + 1}] ${c.analysis?.transcript || ''}`)
            .join('\n'),
        };
      });

      const res = await saveRehearsalSession({
        sessionId: savedSessionId || undefined,
        deckName: room.deckName || `ห้องกลุ่ม ${room.code}`,
        audience: room.settings?.audience || 'general',
        rehearsalMode: 'per_slide',
        isGroup: true,
        roomCode: room.code,
        seriesId: `group_${room.code}`,
        roundNumber: roundsHistory.length + 1,
        slideCount: slides.length,
        totalDurationSec: groupRoundSnapshot.totalDurationSec,
        avgWpm: groupRoundSnapshot.avgWpm,
        avgEyeContactPct: groupRoundSnapshot.eyeContactPct,
        slidesJson: slides.map((s, idx) => {
          const c = clipMap.get(idx);
          return {
            index: idx,
            title: s?.title || `หน้า ${idx + 1}`,
            memberName: c?.memberName || null,
            duration: c?.analysis?.duration || 0,
            wpm: c?.analysis?.wpm || 0,
            fillersCount: c?.analysis?.fillers?.total || 0,
            deadAirCount: c?.analysis?.deadAir?.count || 0,
            transcript: c?.analysis?.transcript || '',
            eyeContactPct: c?.analysis?.vision?.cameraUsed ? c.analysis.vision.eyeContactPct : null,
          };
        }),
        qaJson: qaQuestions.map((q, idx) => ({
          question: q.question,
          answerTranscript: qaAnswers[idx]?.answerTranscript || '',
          responderName: qaAnswers[idx]?.responderName || null,
          ...(qaEvaluations[idx] || {}),
        })),
        summaryJson: aiSummary || null,
        participants,
      });

      const sid = res?.session?.id;
      if (sid) {
        setSavedSessionId(sid);
        if (mergedVideoUrl) {
          const blob = await fetch(mergedVideoUrl).then((r) => r.blob()).catch(() => null);
          if (blob && blob.size > 0) {
            await saveLocalSessionVideo(sid, blob);
          }
        }
        setHistorySavedMsg(
          mergedVideoUrl
            ? 'บันทึกลงประวัติ + คลิปในเครื่องเรียบร้อยแล้ว'
            : 'บันทึกลงประวัติเรียบร้อยแล้ว (รวมคลิปก่อนบันทึกเพื่อเก็บวิดีโอในเครื่อง)',
        );
      }
    } catch (err) {
      setError(err?.message || 'บันทึกลงประวัติไม่สำเร็จ');
    } finally {
      setSavingHistory(false);
    }
  };

  const handleUploadGroupVideoToCloud = async () => {
    if (!savedSessionId || !mergedVideoUrl || cloudUploading) return;
    setCloudUploading(true);
    setError('');
    try {
      const blob = await fetch(mergedVideoUrl).then((r) => r.blob());
      await uploadSessionVideoToCloud(savedSessionId, blob);
      setCloudUploaded(true);
    } catch (err) {
      setError(err?.message || 'อัปโหลดคลิปขึ้นคลาวด์ไม่สำเร็จ');
    } finally {
      setCloudUploading(false);
    }
  };

  const handleLeaveAndClean = () => {
    // ปล่อยให้ Backend ลบคลิปอัตโนมัติเมื่อสมาชิกคนสุดท้ายออกจากห้องแล้วเท่านั้น
    onLeaveRoom();
  };

  const runGroupAiAnalysis = async () => {
    if (aiLoading) return;
    const ok = await askConfirm({
      key: 'token-spend',
      title: 'ยืนยันการใช้ 2 Tokens',
      message: 'ระบบจะใช้ 2 Tokens เพื่อวิเคราะห์สรุปผลทั้งกลุ่มและความตรงตามสไลด์ (ทุกคนในห้องจะเห็นผลพร้อมกัน)',
      confirmText: 'ใช้ 2 Tokens',
    });
    if (!ok) return;

    setAiLoading(true);
    setAiError('');
    try {
      const payload = {
        deckName: room.deckName || 'ชุดสไลด์พรีเซนต์กลุ่ม',
        audience: room.settings?.audience || 'general',
        slides: slides.map((s, idx) => {
          const c = clipMap.get(idx);
          const a = c?.analysis || {};
          const speakerPrefix = c?.memberName ? `[ผู้พูด: ${c.memberName}] ` : '';
          return {
            index: idx,
            title: s.title || `สไลด์หน้า ${idx + 1}`,
            text: s.text || (Array.isArray(s.points) ? s.points.join(', ') : ''),
            transcript: a.transcript ? `${speakerPrefix}${a.transcript}` : '',
            wpm: a.wpm || 0,
            fillersCount: a.fillers?.total || 0,
            deadAirCount: a.deadAir?.count || 0,
            eyeContactPct: a.vision?.cameraUsed ? a.vision.eyeContactPct : null,
          };
        }),
        qaResults: qaQuestions.map((q, qIdx) => ({
          question: q.question,
          answerTranscript: qaAnswers[qIdx]?.transcript
            ? `[ผู้ตอบ: ${qaAnswers[qIdx].responderName}] ${qaAnswers[qIdx].transcript}`
            : '',
        })),
        timelineEvents: mergedTimelineMeta.events,
      };
      const data = await analyzeSummaryWithAi(payload);
      setLocalAiSummary(data);
      socket?.emit('group:set_ai_summary', { aiSummary: data });
    } catch (err) {
      setAiError(err?.message || 'ไม่สามารถวิเคราะห์ด้วย AI ได้');
    } finally {
      setAiLoading(false);
    }
  };

  const handleEvaluateGroupQa = async (qIdx) => {
    const q = qaQuestions[qIdx];
    const ans = qaAnswers[qIdx];
    if (!q || qaEvalLoading[qIdx]) return;
    const ok = await askConfirm({
      key: 'token-spend',
      title: 'ยืนยันการใช้ 1 Token',
      message: 'ระบบจะใช้ 1 Token เพื่อให้ AI ประเมินคำตอบข้อนี้ (ทุกคนในห้องจะเห็นผลพร้อมกัน)',
      confirmText: 'ใช้ 1 Token',
    });
    if (!ok) return;

    setQaEvalLoading((prev) => ({ ...prev, [qIdx]: true }));
    try {
      const slideContext = slides
        .slice(0, 5)
        .map((s) => `${s.title || ''}: ${s.text || ''}`)
        .join(' | ')
        .slice(0, 1200);
      const qaClip = qaClipMap.get(qIdx);
      const evaluation = await evaluateQaAnswer({
        audience: room.settings?.audience || 'general',
        question: q.question,
        slideContext,
        answerTranscript: ans?.transcript || '',
        timelineEvents: Array.isArray(qaClip?.analysis?.timelineEvents)
          ? qaClip.analysis.timelineEvents
          : [],
      });
      setLocalQaEvals((prev) => ({ ...prev, [qIdx]: evaluation }));
      socket?.emit('group:set_qa_eval', { index: qIdx, evaluation });
    } catch (err) {
      setError(err?.message || 'ประเมินคำตอบไม่สำเร็จ');
    } finally {
      setQaEvalLoading((prev) => ({ ...prev, [qIdx]: false }));
    }
  };

  const avgPace = pace(totals.wpm);

  return (
    <div className="mx-auto max-w-4xl px-6 py-10 space-y-6">
      {/* หัวข้อ */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-accent">สรุปผลการซ้อมกลุ่ม · ห้อง {room.code}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">
            {room.deckName || 'ชุดสไลด์พรีเซนต์กลุ่ม'}
          </h1>
          <p className="mt-1 text-xs text-muted">
            คลิปและเสียงจะถูกลบออกจาก Database อัตโนมัติเมื่อสมาชิกทุกคนออกจากห้องแล้ว
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isHost && (
            <button
              type="button"
              onClick={handleBackLobbyAndClean}
              className="rounded-xl border border-line bg-white px-3.5 py-2 text-xs font-medium text-ink hover:border-faint cursor-pointer"
            >
              ซ้อมอีกรอบ (กลับ Lobby)
            </button>
          )}
          <button
            type="button"
            onClick={handleLeaveAndClean}
            className="rounded-xl bg-ink px-4 py-2 text-xs font-semibold text-paper hover:opacity-90 cursor-pointer"
          >
            จบและออกจากห้อง
          </button>
        </div>
      </div>

      {/* แถบแท็บสลับหมวดสไตล์เดียวกับซ้อมเดี่ยว */}
      <div className="flex flex-wrap gap-2 border-b border-line pb-3">
        <button
          type="button"
          onClick={() => setActiveTab('overview')}
          className={`rounded-lg px-3.5 py-2 text-xs font-medium transition cursor-pointer ${
            activeTab === 'overview'
              ? 'bg-ink text-paper'
              : 'border border-line bg-white text-muted hover:text-ink'
          }`}
        >
          ภาพรวม &amp; คลิปรวม
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
          รายสไลด์ ({slides.length})
        </button>
        {qaQuestions.length > 0 && (
          <button
            type="button"
            onClick={() => setActiveTab('qa')}
            className={`rounded-lg px-3.5 py-2 text-xs font-medium transition cursor-pointer ${
              activeTab === 'qa'
                ? 'bg-ink text-paper'
                : 'border border-line bg-white text-muted hover:text-ink'
            }`}
          >
            ถาม-ตอบ ({qaQuestions.length})
          </button>
        )}
      </div>

      {/* แถบเลือกดู: ภาพรวมทั้งกลุ่ม / แยกรายคน */}
      {activeTab !== 'qa' && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-white p-3">
          <span className="px-2 text-xs font-medium text-muted">มุมมอง:</span>
          <button
            type="button"
            onClick={() => setSelectedMember('all')}
            className={`rounded-lg px-3.5 py-1.5 text-xs font-medium transition cursor-pointer ${
              selectedMember === 'all'
                ? 'bg-ink text-paper'
                : 'bg-paper text-ink hover:bg-line/50'
            }`}
          >
            ภาพรวมทั้งกลุ่ม ({slideClips.length} หน้า)
          </button>
          {memberTabs.map((name) => {
            const count = slideClips.filter((c) => (c.memberName || 'สมาชิก') === name).length;
            return (
              <button
                key={name}
                type="button"
                onClick={() => setSelectedMember(name)}
                className={`rounded-lg px-3.5 py-1.5 text-xs font-medium transition cursor-pointer ${
                  selectedMember === name
                    ? 'bg-accent text-white'
                    : 'bg-paper text-ink hover:bg-line/50'
                }`}
              >
                {name} ({count} หน้า)
              </button>
            );
          })}
        </div>
      )}

      {error && (
        <p className="rounded-xl bg-accent/10 px-4 py-2.5 text-xs text-accent">{error}</p>
      )}

      {activeTab === 'overview' && (
        <>
          <RoundComparisonCard
            roundsHistory={room.roundsHistory || []}
            currentRound={groupRoundSnapshot}
            deckName={room.deckName || 'ชุดสไลด์กลุ่ม'}
            audience={room.settings?.audience || 'general'}
            mode="group"
            aiCache={{ ...localCompareCache, ...(room.roundCompareCache || {}) }}
            onAiCacheChange={(key, result) => {
              setLocalCompareCache((prev) => ({ ...prev, [key]: result }));
              socket?.emit('group:set_round_compare', { key, result });
            }}
          />
      {/* การ์ดสถิติหลัก 4 ช่อง (สไตล์เดียวกับซ้อมเดี่ยว) */}
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-line bg-white p-4">
          <p className="text-xs text-muted">เวลารวม</p>
          <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-ink">
            {formatTime(totals.duration)}
          </p>
        </div>
        <div className="rounded-xl border border-line bg-white p-4">
          <p className="text-xs text-muted">ความเร็วเฉลี่ย</p>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-semibold tabular-nums text-ink">
              {totals.wpm}
            </span>
            <span className="text-xs text-muted">คำ/นาที</span>
          </div>
          {avgPace && (
            <span
              className={`mt-1.5 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${PACE_PILL[avgPace.tone]}`}
            >
              {avgPace.label}
            </span>
          )}
        </div>
        <div className="rounded-xl border border-line bg-white p-4">
          <p className="text-xs text-muted">คำติดปาก</p>
          <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-ink">
            {totals.fillers} <span className="text-xs font-normal text-muted">ครั้ง</span>
          </p>
        </div>
        <div className="rounded-xl border border-line bg-white p-4">
          <p className="text-xs text-muted">สไลด์ที่บันทึก</p>
          <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-ink">
            {visibleClips.length}/{visibleRows.length}
          </p>
        </div>
      </div>

      {/* กราฟสรุปความพร้อมและทางลัดสไลด์ที่ควรปรับ (เหมือนซ้อมเดี่ยว) */}
      {visibleClips.length > 0 && (
        <SummaryCharts
          avgWpm={totals.wpm}
          avgEyeContact={null}
          issueItems={issueItems}
          onSelectSlide={(idx) => {
            setExpandedSlides((prev) => ({ ...prev, [idx]: true }));
            document.getElementById(`group-slide-${idx}`)?.scrollIntoView({
              behavior: 'smooth',
              block: 'center',
            });
          }}
        />
      )}

      {/* กล่องไฟล์สรุปรวมทุกสไลด์ (สไตล์เดียวกับซ้อมเดี่ยว) */}
      {visibleClips.length > 0 && (
        <div className="rounded-xl border border-line bg-white p-5 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-ink">
              {selectedMember === 'all'
                ? 'ไฟล์สรุปรวมทุกสไลด์ (พร้อมแชร์และดาวน์โหลด)'
                : `ไฟล์สรุปรวมเฉพาะของ ${selectedMember}`}
            </h3>
            <p className="mt-0.5 text-xs text-muted">
              รวมคลิปจากการซ้อมทั้งหมดไว้ในไฟล์เดียว หรือเลื่อนลงด้านล่างเพื่อดูและโหลดแยกทีละสไลด์ได้
            </p>
          </div>

          <div className="rounded-lg border border-amber-300 bg-amber-50/80 px-4 py-2.5 text-xs leading-relaxed text-amber-900">
            หมายเหตุ: คลิปและเสียงจะเก็บไว้ชั่วคราวใน Database และจะถูกลบอัตโนมัติเมื่อสมาชิกทุกคนออกจากห้องนี้ กรุณาดาวน์โหลดเก็บไว้ก่อนออก
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {mergedAudioUrl ? (
              <a
                href={mergedAudioUrl}
                download={`group-${room.code}-${selectedMember}.wav`}
                className="rounded-lg bg-ink px-4 py-2 text-xs font-medium text-paper transition hover:opacity-90"
              >
                ดาวน์โหลดเสียงรวม (.wav)
              </a>
            ) : (
              <button
                type="button"
                disabled
                className="rounded-lg bg-ink/50 px-4 py-2 text-xs font-medium text-paper cursor-not-allowed"
              >
                {audioMerging ? 'กำลังเตรียมเสียงรวม...' : 'ดาวน์โหลดเสียงรวม (.wav)'}
              </button>
            )}

            {videoClips.length > 0 && (
              <>
                {mergedVideoUrl && !merging && (
                  <a
                    href={mergedVideoUrl}
                    download={`group-${room.code}-${selectedMember}.${mergedVideoExt}`}
                    className="rounded-lg bg-accent px-4 py-2 text-xs font-medium text-white transition hover:bg-accent/90"
                  >
                    ดาวน์โหลดวิดีโอพร้อมสไลด์ (.{mergedVideoExt})
                  </a>
                )}
                <button
                  type="button"
                  disabled={merging}
                  onClick={() => setLayoutModalOpen(true)}
                  className={`rounded-lg px-4 py-2 text-xs font-medium transition disabled:opacity-50 cursor-pointer ${
                    mergedVideoUrl
                      ? 'border border-line bg-white text-ink hover:border-faint'
                      : 'bg-accent text-white hover:bg-accent/90'
                  }`}
                >
                  {merging
                    ? `กำลังสร้างไฟล์พร้อมสไลด์ ${mergeProgress}%...`
                    : mergedVideoUrl
                      ? 'จัดวางตำแหน่งใหม่'
                      : 'สร้างไฟล์ดาวน์โหลดพร้อมสไลด์ (.mp4)'}
                </button>
              </>
            )}

            {user && (
              <button
                type="button"
                onClick={handleSaveGroupHistory}
                disabled={savingHistory}
                className="rounded-lg border border-ink bg-white px-4 py-2 text-xs font-medium text-ink transition hover:bg-paper disabled:opacity-50 cursor-pointer"
              >
                {savingHistory
                  ? 'กำลังบันทึก...'
                  : savedSessionId
                    ? 'อัปเดตประวัติกลุ่มแล้ว ✓'
                    : 'บันทึกลงประวัติ'}
              </button>
            )}

            {user && savedSessionId && mergedVideoUrl && (
              <button
                type="button"
                onClick={handleUploadGroupVideoToCloud}
                disabled={cloudUploading || cloudUploaded}
                className="rounded-lg border border-line bg-paper px-3.5 py-2 text-xs font-medium text-ink transition hover:border-ink disabled:opacity-60 cursor-pointer"
              >
                {cloudUploaded
                  ? '✓ บันทึกขึ้นคลาวด์แล้ว'
                  : cloudUploading
                    ? 'กำลังอัปโหลด...'
                    : 'บันทึกคลิปขึ้นคลาวด์'}
              </button>
            )}
          </div>

          {historySavedMsg && (
            <p className="text-xs text-emerald-700">{historySavedMsg}</p>
          )}

          {mergedAudioUrl && (
            <div className="space-y-1.5 pt-1">
              <p className="text-[11px] text-muted">ฟังไฟล์เสียงรวมทั้งหมด</p>
              <audio controls src={mergedAudioUrl} className="w-full" />
            </div>
          )}

          {merging && (
            <div className="space-y-1.5">
              <div className="h-2 overflow-hidden rounded-full bg-paper border border-line">
                <div
                  className="h-full bg-accent transition-all"
                  style={{ width: `${Math.max(4, mergeProgress)}%` }}
                />
              </div>
              <p className="text-[11px] text-muted">
                กำลังประมวลผลรวมวิดีโอ ({mergeProgress}%)...
              </p>
            </div>
          )}

          {mergedVideoUrl && !merging && (
            <TimelineReplayPlayer
              videoUrl={mergedVideoUrl}
              audioUrl={mergedVideoUrl}
              duration={mergedTimelineMeta.totalDuration}
              events={mergedTimelineMeta.events}
              slides={slides}
              isMergedExport
            />
          )}
        </div>
      )}

      {/* กล่องวิเคราะห์สรุปผลด้วย AI (สไตล์เดียวกับซ้อมเดี่ยว) */}
      {!aiLoading && !aiSummary && !aiError && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-line bg-white px-5 py-4">
          <div>
            <p className="text-sm font-medium text-ink">อยากรู้ว่าคนฟังเข้าใจแค่ไหน</p>
            <p className="mt-0.5 text-xs text-muted">
              ให้ AI ประเมินความตรงตามสไลด์ ความเข้าใจง่าย และแนะนำประโยคที่กระชับขึ้น (ทุกคนในห้องเห็นผลพร้อมกัน)
            </p>
          </div>
          <button
            type="button"
            onClick={runGroupAiAnalysis}
            className="shrink-0 rounded-xl bg-accent px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-accent/90 cursor-pointer"
          >
            วิเคราะห์สรุปผลด้วย AI (-2 Tokens)
          </button>
        </div>
      )}

      {aiLoading && (
        <div className="rounded-xl border border-line bg-white px-5 py-5 text-sm text-muted">
          กำลังวิเคราะห์เนื้อหาสไลด์และความเข้าใจของผู้ฟังทั้งกลุ่ม...
        </div>
      )}

      {!aiLoading && aiError && (
        <div className="flex items-center justify-between gap-4 rounded-xl border border-line bg-white px-5 py-4">
          <p className="text-xs text-accent">{aiError}</p>
          <button
            type="button"
            onClick={runGroupAiAnalysis}
            className="shrink-0 rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink hover:border-faint cursor-pointer"
          >
            ลองวิเคราะห์อีกครั้ง (-2 Tokens)
          </button>
        </div>
      )}

      {!aiLoading && aiSummary && (
        <div className="rounded-xl border border-line bg-white p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
            <div>
              <p className="text-sm font-semibold text-ink">มุมมองคนฟังและความตรงตามสไลด์</p>
              <p className="text-xs text-muted">ประเมินจากการเทียบเนื้อหาสไลด์กับคำพูดของสมาชิกทั้งกลุ่ม</p>
            </div>
            <button
              type="button"
              onClick={runGroupAiAnalysis}
              className="rounded-md border border-line px-2.5 py-1 text-xs text-muted hover:text-ink hover:border-faint cursor-pointer"
            >
              วิเคราะห์ใหม่ (-2 Tokens)
            </button>
          </div>

          {aiSummary.listenerSummary && (
            <div className="rounded-lg bg-paper p-3.5 text-sm leading-relaxed text-ink">
              <p className="mb-1 text-xs font-medium text-muted">สิ่งที่คนฟังจับใจความได้</p>
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
                <ul className="list-disc space-y-1.5 pl-4 leading-relaxed text-ink/90">
                  {aiSummary.topStrengths.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              </div>
            )}
            {aiSummary.topImprovements?.length > 0 && (
              <div className="rounded-lg border border-accent/20 bg-accent/5 p-4 space-y-1.5">
                <p className="font-semibold text-accent">สิ่งที่ควรปรับ</p>
                <ul className="list-disc space-y-1.5 pl-4 leading-relaxed text-ink/90">
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

      {/* รายละเอียดรายสไลด์ (พับ-กาง + TimelineReplayPlayer เหมือนซ้อมเดี่ยว) */}
      {activeTab === 'slides' && (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">
            รายละเอียดแต่ละสไลด์ ({visibleRows.length} หน้า)
          </h2>
        </div>

        {loading && clips.length === 0 ? (
          <p className="text-xs text-muted">กำลังโหลดข้อมูลคลิป...</p>
        ) : (
          visibleRows.map(({ s, idx, clip }) => {
            const a = clip?.analysis || {};
            const p = pace(a.wpm);
            const hasIssue = Boolean(
              clip && ((p && p.tone !== 'good') || (a.fillers?.total || 0) >= 3),
            );
            const isOpen = expandedSlides[idx] ?? (hasIssue || openReplayIdx === idx || visibleRows.length <= 4);

            return (
              <div
                id={`group-slide-${idx}`}
                key={s.id || idx}
                className="rounded-xl border border-line bg-white overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() =>
                    setExpandedSlides((prev) => ({ ...prev, [idx]: !isOpen }))
                  }
                  className="flex w-full flex-wrap items-center justify-between gap-2 px-5 py-3.5 text-left transition hover:bg-paper/50 cursor-pointer"
                >
                  <div className="flex flex-wrap items-center gap-2 min-w-0">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-paper font-mono text-xs font-semibold text-ink">
                      {idx + 1}
                    </span>
                    <span className="text-sm font-semibold text-ink truncate max-w-xs sm:max-w-md">
                      {s.title || `สไลด์หน้า ${idx + 1}`}
                    </span>
                    {clip && (
                      <span className="rounded-full bg-paper border border-line px-2 py-0.5 text-[11px] font-medium text-ink">
                        ผู้พูด: {clip.memberName}
                      </span>
                    )}
                    {clip ? (
                      hasIssue ? (
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
                        ยังไม่มีคลิป
                      </span>
                    )}
                  </div>

                  {clip && (
                    <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono tabular-nums">
                      <span className="rounded-md bg-paper px-2 py-0.5 text-ink">
                        {formatTime(a.duration)}
                      </span>
                      <span
                        className={`rounded-md bg-paper px-2 py-0.5 ${
                          p ? PACE_TEXT[p.tone] : 'text-muted'
                        }`}
                      >
                        {a.wpm || 0} คำ/นาที {p && `(${p.label})`}
                      </span>
                      {a.fillers?.total > 0 && (
                        <span className="rounded-md bg-accent/10 px-2 py-0.5 text-accent font-sans font-medium">
                          ติดปาก {a.fillers.total}
                        </span>
                      )}
                      {a.deadAir?.count > 0 && (
                        <span className="rounded-md bg-slow/10 px-2 py-0.5 text-slow font-sans font-medium">
                          เดดแอร์ {a.deadAir.count}
                        </span>
                      )}
                      {a.vision?.cameraUsed && (
                        <span
                          className={`rounded-md bg-paper px-2 py-0.5 font-sans ${
                            a.vision.eyeContactPct >= 70 ? 'text-ok' : 'text-slow'
                          }`}
                        >
                          สบตา {a.vision.eyeContactPct}%
                        </span>
                      )}
                      <span className="ml-1 font-sans text-xs text-faint">
                        {isOpen ? 'ซ่อน' : 'ดูเพิ่ม'}
                      </span>
                    </div>
                  )}
                </button>

                {isOpen && (
                  <div className="border-t border-line px-5 pb-5 pt-4 bg-paper/20 space-y-3">
                    <div className={s.src ? 'grid gap-3 sm:grid-cols-[150px_1fr] items-start' : ''}>
                      {s.src && (
                        <div className="overflow-hidden rounded-lg border border-line bg-white">
                          <img
                            src={s.src}
                            alt={s.title || `สไลด์ ${idx + 1}`}
                            className="aspect-video w-full object-contain"
                          />
                        </div>
                      )}
                      {editingIdx === idx && clip ? (
                        <div className="rounded-lg border border-line bg-white p-3 space-y-2.5">
                          <textarea
                            rows={3}
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            className="w-full rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-ink"
                            placeholder="พิมพ์ข้อความที่พูดในสไลด์หน้านี้..."
                          />
                          <div className="flex items-center gap-2 text-xs">
                            <button
                              type="button"
                              onClick={() => {
                                const durationSec = Math.max(1, Number(clip.analysis?.duration || 1));
                                const nextAnalysis = {
                                  ...analyze(editText, durationSec),
                                  transcript: editText.trim(),
                                };
                                setClips((prev) =>
                                  prev.map((c) =>
                                    c.slideIndex === idx ? { ...c, analysis: nextAnalysis } : c,
                                  ),
                                );
                                setEditingIdx(null);
                              }}
                              className="rounded-md bg-ink px-3 py-1.5 font-medium text-paper hover:opacity-90 cursor-pointer"
                            >
                              บันทึกข้อความ
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingIdx(null)}
                              className="rounded-md border border-line bg-white px-3 py-1.5 font-medium text-muted hover:text-ink cursor-pointer"
                            >
                              ยกเลิก
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-2.5">
                          <div className="rounded-lg border border-line bg-white p-3.5 text-sm leading-relaxed text-ink/90">
                            {a.transcript ? (
                              <p>&quot;{a.transcript}&quot;</p>
                            ) : (
                              <p className="text-faint italic">ยังไม่มีข้อความเสียงในสไลด์นี้</p>
                            )}
                          </div>
                          {(() => {
                            const aiSlide = aiSummary?.slides?.find((x) => x.index === idx);
                            if (!aiSlide || (!aiSlide.missed?.length && !aiSlide.polishedScript)) {
                              return null;
                            }
                            return (
                              <div className="rounded-lg border border-line bg-white p-3.5 text-xs space-y-2">
                                {aiSlide.missed?.length > 0 && (
                                  <div>
                                    <p className="font-semibold text-accent">ประเด็นที่ยังไม่ได้พูด</p>
                                    <p className="mt-0.5 text-muted leading-relaxed">
                                      {aiSlide.missed.join(' · ')}
                                    </p>
                                  </div>
                                )}
                                {aiSlide.polishedScript && (
                                  <div>
                                    <p className="font-semibold text-ink">ตัวอย่างประโยคที่กระชับขึ้น</p>
                                    <p className="mt-0.5 text-ink/90 leading-relaxed">
                                      {aiSlide.polishedScript}
                                    </p>
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                          {(() => {
                            const intRes = room.interruptResults?.[idx];
                            if (!intRes) return null;
                            return (
                              <div className="rounded-lg border border-accent/25 bg-accent/5 p-3.5 text-xs space-y-1.5">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-semibold text-accent">คำถามแทรกหน้านี้</span>
                                  {intRes.evaluation?.directness && (
                                    <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-ink border border-line">
                                      {intRes.evaluation.directness}
                                    </span>
                                  )}
                                </div>
                                <p className="font-medium text-ink">{intRes.question}</p>
                                {intRes.answerTranscript && (
                                  <p className="text-muted">คำตอบ: &quot;{intRes.answerTranscript}&quot;</p>
                                )}
                                {intRes.evaluation?.feedback && (
                                  <p className="text-ink/90">{intRes.evaluation.feedback}</p>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      )}
                    </div>

                    {clip?.mediaUrl && (
                      <div className="space-y-2 border-t border-line/60 pt-3 text-xs">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              const el = audioRefs.current[idx];
                              if (!el) return;
                              if (el.paused) void el.play().catch(() => {});
                              else el.pause();
                            }}
                            className="rounded-md border border-line bg-white px-3 py-1.5 font-medium text-ink hover:border-faint cursor-pointer"
                          >
                            ▶ ฟังคลิปหน้านี้
                          </button>
                          <audio
                            ref={(el) => {
                              if (el) audioRefs.current[idx] = el;
                            }}
                            controls
                            src={clip.mediaUrl}
                            className="h-8 max-w-60"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setOpenReplayIdx(openReplayIdx === idx ? null : idx)
                            }
                            className="rounded-md bg-ink px-3 py-1.5 font-medium text-white hover:opacity-90 transition cursor-pointer"
                          >
                            {openReplayIdx === idx ? 'ซ่อน Timeline Replay' : 'ดู Timeline Replay'}
                          </button>

                          {!showMoreMap[idx] && (
                            <button
                              type="button"
                              onClick={() =>
                                setShowMoreMap((prev) => ({ ...prev, [idx]: true }))
                              }
                              className="ml-auto rounded-md border border-line bg-white px-2.5 py-1.5 font-medium text-muted hover:text-ink hover:border-faint transition cursor-pointer"
                            >
                              เพิ่มเติม
                            </button>
                          )}
                        </div>

                        {showMoreMap[idx] && (
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                setShowMoreMap((prev) => ({ ...prev, [idx]: false }))
                              }
                              className="rounded-md border border-line bg-white px-2.5 py-1.5 font-medium text-muted hover:text-ink hover:border-faint transition cursor-pointer"
                            >
                              ซ่อนตัวเลือก
                            </button>
                            <button
                              type="button"
                              disabled={downloadingAudioIdx === idx}
                              onClick={async () => {
                                setDownloadingAudioIdx(idx);
                                try {
                                  const res = await mergeAudioTracks([clip.mediaUrl]);
                                  if (res?.url) {
                                    const link = document.createElement('a');
                                    link.href = res.url;
                                    link.download = `slide-${idx + 1}-audio.wav`;
                                    link.click();
                                    setTimeout(() => URL.revokeObjectURL(res.url), 5000);
                                  }
                                } catch (err) {
                                  setError(err?.message || 'แยกไฟล์เสียงไม่สำเร็จ');
                                } finally {
                                  setDownloadingAudioIdx(null);
                                }
                              }}
                              className="rounded-md border border-line bg-paper px-2.5 py-1.5 font-medium text-ink hover:border-faint disabled:opacity-50 cursor-pointer"
                            >
                              {downloadingAudioIdx === idx ? 'กำลังแปลงเสียง...' : 'โหลดเสียง'}
                            </button>
                            <a
                              href={clip.mediaUrl}
                              download={`slide-${idx + 1}-${clip.memberName || 'clip'}.webm`}
                              className="rounded-md border border-line bg-paper px-2.5 py-1.5 font-medium text-ink hover:border-faint"
                            >
                              โหลดคลิปดิบ
                            </a>
                            {editingIdx !== idx && (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingIdx(idx);
                                  setEditText(a.transcript || '');
                                }}
                                className="flex items-center gap-1 rounded-md border border-line bg-white px-2.5 py-1.5 text-ink hover:border-faint hover:bg-paper transition cursor-pointer"
                              >
                                <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
                                  <path d="M11.5 2.5a1.414 1.414 0 0 1 2 2L4.5 13.5l-3 1 1-3L11.5 2.5z" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                                <span>แก้ข้อความ</span>
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {clip?.mediaUrl && openReplayIdx === idx && (
                      <TimelineReplayPlayer
                        videoUrl={clip.mimeType?.startsWith('audio/') ? null : clip.mediaUrl}
                        audioUrl={clip.mediaUrl}
                        duration={a.duration || 0}
                        events={[
                          {
                            t: 0,
                            type: 'slide',
                            slideIndex: idx,
                            label: `เริ่มสไลด์ ${idx + 1} (${clip.memberName || 'สมาชิก'})`,
                          },
                          ...(Array.isArray(a.timelineEvents) ? a.timelineEvents : []),
                        ]}
                        slides={slides}
                        slideIndex={idx}
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
      )}

      {/* แท็บช่วงถาม-ตอบ Q&A (สไตล์เดียวกับซ้อมเดี่ยว) */}
      {activeTab === 'qa' && (
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-ink">ช่วงถาม-ตอบ ({qaQuestions.length} ข้อ)</h3>
            <p className="text-[11px] text-muted">
              ดูคำตอบของสมาชิกที่อาสาตอบแต่ละข้อ และกดให้ AI ช่วยตรวจความตรงประเด็นได้
            </p>
          </div>

          {qaQuestions.map((q, qIdx) => {
            const ans = qaAnswers[qIdx] || null;
            const qaClip = qaClipMap.get(qIdx) || null;
            const ev = qaEvaluations[qIdx] || null;
            const busyEval = Boolean(qaEvalLoading[qIdx]);
            return (
              <div key={q.id || qIdx} className="rounded-xl border border-line bg-white p-5 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded bg-paper px-2 py-0.5 font-mono text-[11px] font-semibold text-ink">
                        คำถามที่ {qIdx + 1}
                      </span>
                      {ans?.responderName ? (
                        <span className="rounded-full border border-line bg-paper px-2.5 py-0.5 text-[11px] font-medium text-ink">
                          ผู้ตอบ: {ans.responderName}
                        </span>
                      ) : (
                        <span className="rounded-full bg-paper px-2.5 py-0.5 text-[11px] text-faint">
                          ยังไม่มีผู้ตอบ
                        </span>
                      )}
                      {ev?.directness && (
                        <span className="rounded-full bg-accent/10 px-2.5 py-0.5 text-[11px] font-medium text-accent">
                          {ev.directness}
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-semibold text-ink">{q.question}</p>
                  </div>

                  {!ev && (
                    <button
                      type="button"
                      disabled={busyEval}
                      onClick={() => void handleEvaluateGroupQa(qIdx)}
                      className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition hover:bg-accent/90 disabled:opacity-50 cursor-pointer"
                    >
                      {busyEval ? 'กำลังตรวจ...' : 'ให้ AI ตรวจคำตอบ (-1 Token)'}
                    </button>
                  )}
                </div>

                <div className="rounded-lg border border-line bg-paper/50 p-3.5 text-sm leading-relaxed text-ink">
                  {ans?.transcript ? (
                    <p>&quot;{ans.transcript}&quot;</p>
                  ) : (
                    <p className="text-faint italic">ยังไม่มีข้อความคำตอบในข้อนี้</p>
                  )}
                </div>

                {qaClip?.mediaUrl && (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <audio controls src={qaClip.mediaUrl} className="h-8 max-w-64" />
                      <button
                        type="button"
                        onClick={() =>
                          setOpenQaReplayIdx(openQaReplayIdx === qIdx ? null : qIdx)
                        }
                        className="rounded-md bg-ink px-3 py-1.5 font-medium text-white hover:opacity-90 cursor-pointer"
                      >
                        {openQaReplayIdx === qIdx ? 'ซ่อน Timeline Replay' : 'ดู Timeline Replay'}
                      </button>
                    </div>
                    {openQaReplayIdx === qIdx && (
                      <TimelineReplayPlayer
                        videoUrl={qaClip.mimeType?.startsWith('audio/') ? null : qaClip.mediaUrl}
                        audioUrl={qaClip.mediaUrl}
                        duration={ans?.duration || 0}
                        events={[
                          {
                            t: 0,
                            type: 'qa',
                            label: `เริ่มตอบ Q&A ข้อ ${qIdx + 1} (${ans?.responderName || qaClip.memberName || 'สมาชิก'} ตอบ)`,
                          },
                          ...(Array.isArray(qaClip.analysis?.timelineEvents)
                            ? qaClip.analysis.timelineEvents
                            : []),
                        ]}
                        slides={slides}
                        qaQuestion={q.question}
                      />
                    )}
                  </div>
                )}

                {ev && (
                  <div className="rounded-lg border border-line bg-paper/70 p-3.5 text-xs space-y-1.5">
                    {ev.feedback && (
                      <p className="text-ink leading-relaxed">
                        <strong className="font-semibold">คำติชม:</strong> {ev.feedback}
                      </p>
                    )}
                    {ev.betterAnswer && (
                      <p className="text-muted leading-relaxed">
                        <strong className="font-semibold text-ink">แนวทางตอบที่ดีขึ้น:</strong>{' '}
                        {ev.betterAnswer}
                      </p>
                    )}
                    {ev.timelineNote && (
                      <p className="text-accent leading-relaxed">
                        <strong className="font-semibold">จังหวะระหว่างตอบ:</strong> {ev.timelineNote}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <VideoLayoutModal
        open={layoutModalOpen}
        previewSlide={slides[videoClips[0]?.slideIndex ?? 0] || slides[0] || null}
        previewVideoUrl={videoClips[0]?.mediaUrl || null}
        onCancel={() => setLayoutModalOpen(false)}
        onConfirm={(chosenLayout) => {
          setLayoutModalOpen(false);
          void handleMergeAll(chosenLayout);
        }}
      />
    </div>
  );
}
