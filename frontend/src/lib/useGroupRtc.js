import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE } from './api';

const DEFAULT_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

let iceCache = { servers: null, expiresAt: 0 };
let icePending = null;

async function loadIceServers() {
  const now = Date.now();
  if (iceCache.servers && iceCache.expiresAt > now) {
    return iceCache.servers;
  }
  if (icePending) return icePending;

  icePending = fetch(`${API_BASE}/api/rtc/ice-servers`)
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (Array.isArray(data?.iceServers) && data.iceServers.length > 0) {
        iceCache = { servers: data.iceServers, expiresAt: Date.now() + 5 * 60 * 1000 };
        return data.iceServers;
      }
      return DEFAULT_ICE_SERVERS;
    })
    .catch(() => DEFAULT_ICE_SERVERS)
    .finally(() => {
      icePending = null;
    });

  return icePending;
}

export function useGroupRtc({ socket, active, selfId, members }) {
  const [localStream, setLocalStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState({});
  const [micEnabled, setMicEnabled] = useState(true);
  const [camEnabled, setCamEnabled] = useState(true);
  const [micGain, setMicGain] = useState(() => {
    try {
      const saved = Number(localStorage.getItem('rehearse_mic_gain'));
      return Number.isFinite(saved) && saved >= 0 && saved <= 2 ? saved : 1;
    } catch {
      return 1;
    }
  });
  const [mediaError, setMediaError] = useState('');

  const localStreamRef = useRef(null);
  const rawStreamRef = useRef(null);
  const audioCtxRef = useRef(null);
  const gainNodeRef = useRef(null);
  const micGainRef = useRef(1);
  const peersRef = useRef(new Map()); // peerId -> RTCPeerConnection
  const pendingIceRef = useRef(new Map()); // peerId -> RTCIceCandidateInit[]
  const iceServersRef = useRef(DEFAULT_ICE_SERVERS);

  useEffect(() => {
    if (!active) return;
    let mounted = true;
    void loadIceServers().then((servers) => {
      if (mounted && Array.isArray(servers) && servers.length > 0) {
        iceServersRef.current = servers;
      }
    });
    return () => {
      mounted = false;
    };
  }, [active]);

  const closePeer = useCallback((peerId) => {
    const pc = peersRef.current.get(peerId);
    if (pc) {
      try {
        pc.close();
      } catch {
        // ignore
      }
      peersRef.current.delete(peerId);
    }
    pendingIceRef.current.delete(peerId);
    setRemoteStreams((prev) => {
      if (!(peerId in prev)) return prev;
      const next = { ...prev };
      delete next[peerId];
      return next;
    });
  }, []);

  const createPeer = useCallback(
    (peerId) => {
      const existing = peersRef.current.get(peerId);
      if (existing) return existing;

      const pc = new RTCPeerConnection({ iceServers: iceServersRef.current });
      peersRef.current.set(peerId, pc);

      const stream = localStreamRef.current;
      if (stream) {
        stream.getTracks().forEach((track) => {
          pc.addTrack(track, stream);
        });
      }

      pc.onicecandidate = (e) => {
        if (e.candidate && socket) {
          socket.emit('group:rtc_signal', {
            toId: peerId,
            signal: { type: 'ice', candidate: e.candidate },
          });
        }
      };

      pc.ontrack = (e) => {
        const [remoteStream] = e.streams;
        if (remoteStream) {
          setRemoteStreams((prev) => ({ ...prev, [peerId]: remoteStream }));
        }
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          closePeer(peerId);
        }
      };

      return pc;
    },
    [socket, closePeer],
  );

  // เปิดกล้อง + ไมค์เมื่อเข้าสู่โหมดซ้อมกลุ่ม
  useEffect(() => {
    if (!active || !socket) return undefined;
    let cancelled = false;

    const initMedia = async () => {
      setMediaError('');
      const icePromise = Promise.race([
        loadIceServers(),
        new Promise((resolve) => setTimeout(() => resolve(DEFAULT_ICE_SERVERS), 2000)),
      ]).then((servers) => {
        if (!cancelled && Array.isArray(servers) && servers.length > 0) {
          iceServersRef.current = servers;
        }
      });

      let stream = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 360 } },
        });
      } catch {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true },
            video: false,
          });
          setMediaError('ไม่พบกล้องหรือไม่ได้รับสิทธิ์กล้อง (ใช้งานเฉพาะไมโครโฟน)');
        } catch {
          setMediaError('ไม่สามารถเปิดกล้องหรือไมโครโฟนได้ (ยังสามารถดูสไลด์และฟังเพื่อนได้)');
        }
      }

      await icePromise;

      if (cancelled) {
        stream?.getTracks().forEach((t) => t.stop());
        return;
      }

      rawStreamRef.current = stream;

      // ผ่าน GainNode เพื่อให้ปรับความดังไมค์ตัวเองได้แบบเรียลไทม์ (0% - 200%)
      let outStream = stream;
      if (stream && stream.getAudioTracks().length > 0) {
        try {
          const AudioCtx = window.AudioContext || window.webkitAudioContext;
          if (AudioCtx) {
            const ctx = new AudioCtx();
            audioCtxRef.current = ctx;
            const src = ctx.createMediaStreamSource(stream);
            const gain = ctx.createGain();
            gain.gain.value = micGainRef.current;
            gainNodeRef.current = gain;
            const dest = ctx.createMediaStreamDestination();
            src.connect(gain);
            gain.connect(dest);
            outStream = new MediaStream([
              ...dest.stream.getAudioTracks(),
              ...stream.getVideoTracks(),
            ]);
          }
        } catch {
          outStream = stream;
        }
      }

      localStreamRef.current = outStream;
      setLocalStream(outStream);

      // หากมี Peer ที่เชื่อมมาก่อน getUserMedia เสร็จ ให้เพิ่ม track แล้วส่ง offer อัปเดต
      if (outStream) {
        for (const [peerId, pc] of peersRef.current.entries()) {
          const existingTracks = new Set(pc.getSenders().map((s) => s.track).filter(Boolean));
          let added = false;
          outStream.getTracks().forEach((track) => {
            if (!existingTracks.has(track)) {
              pc.addTrack(track, outStream);
              added = true;
            }
          });
          if (added && pc.signalingState === 'stable') {
            pc.createOffer()
              .then((offer) => pc.setLocalDescription(offer))
              .then(() => {
                socket.emit('group:rtc_signal', {
                  toId: peerId,
                  signal: { type: 'offer', sdp: pc.localDescription },
                });
              })
              .catch(() => {});
          }
        }
      }

      const hasAudio = Boolean(stream?.getAudioTracks().length);
      const hasVideo = Boolean(stream?.getVideoTracks().length);
      setMicEnabled(hasAudio);
      setCamEnabled(hasVideo);
      socket.emit('group:media_state', { micEnabled: hasAudio, camEnabled: hasVideo });
    };

    void initMedia();

    return () => {
      cancelled = true;
      for (const peerId of Array.from(peersRef.current.keys())) {
        closePeer(peerId);
      }
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
        localStreamRef.current = null;
      }
      if (rawStreamRef.current) {
        rawStreamRef.current.getTracks().forEach((t) => t.stop());
        rawStreamRef.current = null;
      }
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close().catch(() => {});
        audioCtxRef.current = null;
      }
      gainNodeRef.current = null;
      setLocalStream(null);
      setRemoteStreams({});
    };
  }, [active, socket, closePeer]);

  // รับสัญญาณ WebRTC จากเพื่อนในห้อง
  useEffect(() => {
    if (!active || !socket) return undefined;

    const onSignal = async ({ fromId, signal }) => {
      if (!fromId || !signal) return;
      const pc = createPeer(fromId);

      try {
        if (signal.type === 'offer' && signal.sdp) {
          await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
          const queued = pendingIceRef.current.get(fromId) || [];
          pendingIceRef.current.delete(fromId);
          for (const cand of queued) {
            await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
          }
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socket.emit('group:rtc_signal', {
            toId: fromId,
            signal: { type: 'answer', sdp: pc.localDescription },
          });
        } else if (signal.type === 'answer' && signal.sdp) {
          await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
          const queued = pendingIceRef.current.get(fromId) || [];
          pendingIceRef.current.delete(fromId);
          for (const cand of queued) {
            await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
          }
        } else if (signal.type === 'ice' && signal.candidate) {
          if (pc.remoteDescription) {
            await pc.addIceCandidate(new RTCIceCandidate(signal.candidate)).catch(() => {});
          } else {
            const list = pendingIceRef.current.get(fromId) || [];
            list.push(signal.candidate);
            pendingIceRef.current.set(fromId, list);
          }
        }
      } catch {
        // ignore transient signaling errors
      }
    };

    socket.on('group:rtc_signal', onSignal);
    return () => {
      socket.off('group:rtc_signal', onSignal);
    };
  }, [active, socket, createPeer]);

  // เชื่อม Peer กับสมาชิกในห้องและตัดการเชื่อมต่อคนที่ออกไปแล้ว
  useEffect(() => {
    if (!active || !socket || !selfId) return;

    const memberIds = new Set(members.map((m) => m.id));
    for (const peerId of Array.from(peersRef.current.keys())) {
      if (!memberIds.has(peerId)) {
        closePeer(peerId);
      }
    }

    members.forEach((m) => {
      if (m.id === selfId) return;
      if (peersRef.current.has(m.id)) return;

      const pc = createPeer(m.id);
      // ฝั่งที่ socket.id น้อยกว่าจะเป็นคนส่ง offer ก่อนเสมอ เพื่อกันชนกัน
      if (selfId < m.id) {
        pc.createOffer()
          .then((offer) => pc.setLocalDescription(offer))
          .then(() => {
            socket.emit('group:rtc_signal', {
              toId: m.id,
              signal: { type: 'offer', sdp: pc.localDescription },
            });
          })
          .catch(() => {});
      }
    });
  }, [active, socket, selfId, members, localStream, createPeer, closePeer]);

  const toggleMic = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const tracks = stream.getAudioTracks();
    if (tracks.length === 0) return;
    const next = !micEnabled;
    tracks.forEach((t) => {
      t.enabled = next;
    });
    setMicEnabled(next);
    socket?.emit('group:media_state', { micEnabled: next });
  }, [micEnabled, socket]);

  const toggleCam = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const tracks = stream.getVideoTracks();
    if (tracks.length === 0) return;
    const next = !camEnabled;
    tracks.forEach((t) => {
      t.enabled = next;
    });
    setCamEnabled(next);
    socket?.emit('group:media_state', { camEnabled: next });
  }, [camEnabled, socket]);

  useEffect(() => {
    micGainRef.current = micGain;
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = micGain;
    }
    try {
      localStorage.setItem('rehearse_mic_gain', String(micGain));
    } catch {
      // ignore storage errors
    }
  }, [micGain]);

  return {
    localStream,
    remoteStreams,
    micEnabled,
    camEnabled,
    micGain,
    setMicGain,
    mediaError,
    toggleMic,
    toggleCam,
  };
}
