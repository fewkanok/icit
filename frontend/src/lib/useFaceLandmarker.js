import { useCallback, useEffect, useRef, useState } from 'react';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

let landmarkerPromise = null;

// โหลดโมเดล MediaPipe FaceLandmarker แบบ Singleton
async function getFaceLandmarker() {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      try {
        const fileset = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
        );
        return await FaceLandmarker.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
            delegate: 'GPU',
          },
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: true,
          runningMode: 'VIDEO',
          numFaces: 1,
        });
      } catch (err) {
        console.error('[FaceLandmarker] Failed to load model:', err);
        landmarkerPromise = null;
        throw err;
      }
    })();
  }
  return landmarkerPromise;
}

/**
 * useFaceLandmarker Hook:
 * - วิเคราะห์ท่าทางใบหน้า 3D (Head Pose) และตำแหน่งตาดำ (Iris Tracking) โดยตรงจาก 478 จุด Landmarks
 * - ไม่พึ่งพา Matrix อย่างเดียว จึงทำงานได้ 100% ทุกกล้องและทุกการ์ดจอ
 * - แยกแยะการกะพริบตาออกจากการก้มอ่านโพย และตอบสนองต่อการขยับศีรษะ/สายตาแบบ Real-time
 */
const BASELINE_STORAGE_KEY = 'zomgon_eye_baseline_v2';
const MANUAL_CALIB_KEY = 'zomgon_eye_manual_calibrated_v1';

function loadManualCalibrated() {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(MANUAL_CALIB_KEY) === '1';
  } catch {
    return false;
  }
}

function saveManualCalibrated() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(MANUAL_CALIB_KEY, '1');
  } catch {
    // ignore
  }
}

function loadSavedBaseline() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(BASELINE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.pitch === 'number' &&
      typeof parsed?.yaw === 'number' &&
      typeof parsed?.irisY === 'number'
    ) {
      return parsed;
    }
  } catch {
    // ignore
  }
  return null;
}

function saveBaseline(baseline) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(BASELINE_STORAGE_KEY, JSON.stringify(baseline));
  } catch {
    // ignore
  }
}

export function useFaceLandmarker() {
  const [cameraActive, setCameraActive] = useState(false);
  const [modelLoading, setModelLoading] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [cameraError, setCameraError] = useState(null);

  // สถานะการตรวจจับสด
  const [currentStatus, setCurrentStatus] = useState('off'); // 'eye_contact' | 'looking_down' | 'looking_away' | 'no_face' | 'off'
  const [eyeContactPct, setEyeContactPct] = useState(100);
  const [lookingDownCount, setLookingDownCount] = useState(0);
  const [poseAngles, setPoseAngles] = useState({ pitch: 0, yaw: 0 });
  const [calibrated, setCalibrated] = useState(() => Boolean(loadSavedBaseline()));
  const [manualCalibrated, setManualCalibrated] = useState(() => loadManualCalibrated());

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const ownsStreamRef = useRef(true);
  const animFrameRef = useRef(null);
  const landmarkerRef = useRef(null);

  // ค่าศูนย์ (Baseline) + EMA Smoothing เพื่อความแม่นยำตามมุมกล้องแต่ละเครื่อง
  const baselineRef = useRef(loadSavedBaseline());
  const autoCalibSamplesRef = useRef([]);
  const smoothRef = useRef({ pitch: null, yaw: null, irisY: null });

  // ตัวนับเฟรมสะสมสำหรับความนิ่ง (Smoothing filter)
  const lookDownBufferRef = useRef(0);
  const lookAwayBufferRef = useRef(0);
  const rollingHistoryRef = useRef([]); // เก็บประวัติ 30 เฟรมล่าสุด (~1 วินาที) สำหรับวัด % สด

  // โหมดบันทึกสถิติ (ทำงานเมื่อกดเริ่มซ้อมพูด)
  const isTrackingRef = useRef(false);
  const totalFramesRef = useRef(0);
  const eyeContactFramesRef = useRef(0);
  const lookingDownFramesRef = useRef(0);
  const inLookDownInstanceRef = useRef(false);
  const lookDownCountRef = useRef(0);
  const lookDownTotalSecRef = useRef(0);

  // 1. เปิดกล้องเว็บแคม
  const startCamera = useCallback(async () => {
    try {
      setCameraError(null);
      setModelLoading(true);

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        audio: false,
      });
      streamRef.current = stream;
      ownsStreamRef.current = true;

      // โหลดโมเดล MediaPipe
      const landmarker = await getFaceLandmarker();
      landmarkerRef.current = landmarker;
      setModelReady(true);
      setModelLoading(false);
      setCameraActive(true);
    } catch (err) {
      console.error('[FaceLandmarker] startCamera error:', err);
      setCameraError(err.name === 'NotAllowedError' ? 'โปรดอนุญาตให้เข้าถึงกล้อง' : err.message);
      setModelLoading(false);
      setCameraActive(false);
    }
  }, []);

  // เชื่อมต่อ Stream ภายนอก (เช่น WebRTC localStream ของโหมดกลุ่ม) โดยไม่เปิดกล้องซ้อน
  const attachExternalStream = useCallback(async (stream) => {
    if (!stream || stream.getVideoTracks().length === 0) return;
    try {
      setCameraError(null);
      setModelLoading(true);
      ownsStreamRef.current = false;
      streamRef.current = stream;
      const landmarker = await getFaceLandmarker();
      landmarkerRef.current = landmarker;
      setModelReady(true);
      setModelLoading(false);
      setCameraActive(true);
    } catch (err) {
      console.warn('[FaceLandmarker] attachExternalStream error:', err);
      setModelLoading(false);
      setCameraActive(false);
    }
  }, []);

  // 2. ปิดกล้องเว็บแคม
  const stopCamera = useCallback(() => {
    isTrackingRef.current = false;
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (streamRef.current) {
      if (ownsStreamRef.current) {
        try {
          streamRef.current.getTracks().forEach((track) => track.stop());
        } catch (_) {}
      }
      streamRef.current = null;
    }
    if (videoRef.current && ownsStreamRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
    setCurrentStatus('off');
  }, []);

  // Callback ref เชื่อมต่อสัญญาณวิดีโอทันที
  const setVideoRef = useCallback((node) => {
    videoRef.current = node;
    if (node && streamRef.current && node.srcObject !== streamRef.current) {
      node.srcObject = streamRef.current;
      node.onloadedmetadata = () => {
        node.play().catch((e) => console.log('[FaceLandmarker] Play err:', e));
      };
      node.play().catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (cameraActive && videoRef.current && streamRef.current) {
      const video = videoRef.current;
      if (video.srcObject !== streamRef.current) {
        video.srcObject = streamRef.current;
        video.play().catch(() => {});
      }
    }
  }, [cameraActive]);

  // ลูปตรวจจับใบหน้าแบบ Real-time
  useEffect(() => {
    if (!cameraActive || !modelReady) return;

    let lastVideoTime = -1;
    let lastCheckTime = performance.now();

    const loop = () => {
      const video = videoRef.current;
      const landmarker = landmarkerRef.current;

      if (video && landmarker && video.readyState >= 2) {
        if (video.currentTime !== lastVideoTime) {
          lastVideoTime = video.currentTime;
          const now = performance.now();
          const results = landmarker.detectForVideo(video, now);

          const deltaSec = (now - lastCheckTime) / 1000;
          lastCheckTime = now;

          if (results && results.faceLandmarks && results.faceLandmarks.length > 0) {
            const lm = results.faceLandmarks[0];

            // 1. คำนวณองศาการหันศีรษะ (Yaw) จากตำแหน่งจมูกเทียบกับแก้มซ้าย-ขวา
            const leftCheek = lm[234];
            const rightCheek = lm[454];
            const noseTip = lm[1];
            const faceWidth = Math.abs(rightCheek.x - leftCheek.x) || 0.001;
            const noseRatio = (noseTip.x - leftCheek.x) / faceWidth;
            const rawYaw = (noseRatio - 0.5) * 110;

            // 2. คำนวณองศาการก้ม/เงย (Pitch) จากอัตราส่วนจมูก-คาง และความลึกแกน Z
            // ใน MediaPipe แกน -Z คือเข้าหากล้อง: ก้มหน้า -> หน้าผากใกล้กล้องกว่าคาง (forehead.z - chin.z < 0)
            // เงยหน้า -> คางใกล้กล้องกว่าหน้าผาก (forehead.z - chin.z > 0)
            // ดังนั้น pitch < 0 = ก้มหน้า, pitch > 0 = เงยหน้า
            const forehead = lm[10];
            const chin = lm[152];
            const upperDist = Math.abs(noseTip.y - forehead.y);
            const lowerDist = Math.abs(chin.y - noseTip.y);
            const verticalRatio = upperDist / (lowerDist || 0.001);
            const zTilt = forehead.z - chin.z;
            const rawPitch = (verticalRatio - 1.25) * -45 + zTilt * 120;

            // 3. วิเคราะห์ดวงตาทั้ง 2 ข้าง (ซ้าย + ขวา) เพื่อลดอาการแกว่งเมื่อเอียงหน้าหรือใส่แว่น
            const lOpenH = Math.abs(lm[145].y - lm[159].y);
            const lWidth = Math.abs(lm[133].x - lm[33].x) || 0.001;
            const rOpenH = Math.abs(lm[374].y - lm[386].y);
            const rWidth = Math.abs(lm[263].x - lm[362].x) || 0.001;
            const eyeOpenRatio = (lOpenH / lWidth + rOpenH / rWidth) / 2;

            const lIrisY = lm[468] ? (lm[468].y - lm[159].y) / (lOpenH || 0.001) : 0.5;
            const rIrisY = lm[473] ? (lm[473].y - lm[386].y) / (rOpenH || 0.001) : lIrisY;
            const rawIrisY = Math.max(0, Math.min(1, (lIrisY + rIrisY) / 2));

            // ดึง MediaPipe Blendshapes (eyeBlink / eyeLookDown) ถ้าโมเดลส่งมา
            let blendBlink = 0;
            let blendLookDown = 0;
            const bsCats = results.faceBlendshapes?.[0]?.categories;
            if (Array.isArray(bsCats) && bsCats.length > 0) {
              let blinkL = 0;
              let blinkR = 0;
              let downL = 0;
              let downR = 0;
              for (const c of bsCats) {
                if (c.categoryName === 'eyeBlinkLeft') blinkL = c.score;
                else if (c.categoryName === 'eyeBlinkRight') blinkR = c.score;
                else if (c.categoryName === 'eyeLookDownLeft') downL = c.score;
                else if (c.categoryName === 'eyeLookDownRight') downR = c.score;
              }
              blendBlink = (blinkL + blinkR) / 2;
              blendLookDown = (downL + downR) / 2;
            }

            const isBlinking = eyeOpenRatio < 0.13 || blendBlink > 0.55;

            // EMA Smoothing (กรองสัญญาณให้นิ่ง ไม่กระตุก)
            const alpha = 0.25;
            if (smoothRef.current.pitch === null) {
              smoothRef.current = { pitch: rawPitch, yaw: rawYaw, irisY: rawIrisY };
            } else {
              smoothRef.current.pitch += (rawPitch - smoothRef.current.pitch) * alpha;
              smoothRef.current.yaw += (rawYaw - smoothRef.current.yaw) * alpha;
              if (!isBlinking) {
                smoothRef.current.irisY += (rawIrisY - smoothRef.current.irisY) * alpha;
              }
            }

            // Auto-Calibrate อัตโนมัติในช่วง ~12 เฟรมแรกเมื่อเปิดกล้องครั้งแรก (ถ้ายังไม่เคยตั้งศูนย์)
            if (!baselineRef.current && !isBlinking && Math.abs(smoothRef.current.yaw) < 25) {
              autoCalibSamplesRef.current.push({
                pitch: smoothRef.current.pitch,
                yaw: smoothRef.current.yaw,
                irisY: smoothRef.current.irisY,
              });
              if (autoCalibSamplesRef.current.length >= 12) {
                const n = autoCalibSamplesRef.current.length;
                const avg = autoCalibSamplesRef.current.reduce(
                  (acc, s) => ({
                    pitch: acc.pitch + s.pitch / n,
                    yaw: acc.yaw + s.yaw / n,
                    irisY: acc.irisY + s.irisY / n,
                  }),
                  { pitch: 0, yaw: 0, irisY: 0 },
                );
                baselineRef.current = avg;
                saveBaseline(avg);
                setCalibrated(true);
              }
            }

            const base = baselineRef.current || { pitch: 0, yaw: 0, irisY: 0.5 };
            const relPitch = Math.round(smoothRef.current.pitch - base.pitch);
            const relYaw = Math.round(smoothRef.current.yaw - base.yaw);
            const relIrisY = smoothRef.current.irisY - base.irisY;

            setPoseAngles({ pitch: relPitch, yaw: relYaw });

            // 4. ตัดสินสถานะโดยเทียบกับจุดศูนย์ของเครื่อง (ลด False Positive ตอนมองสไลด์บนจอ)
            // ก้มอ่านโพย: ต้องไม่ได้กำลังเงยหน้าอยู่ (relPitch <= 4)
            const isLookingDownRaw =
              !isBlinking &&
              relPitch <= 4 &&
              (relPitch < -14 ||
                (relPitch < -7 && (relIrisY > 0.14 || blendLookDown > 0.48)) ||
                blendLookDown > 0.65 ||
                relIrisY > 0.25);
            // หันออกข้าง หรือ เงยหน้าหนีกล้องชัดเจน
            const isLookingAwayRaw =
              !isBlinking && (Math.abs(relYaw) > 20 || relPitch > 18);

            // ใช้ Buffer 7 เฟรม (~250-300ms) เพื่อกันอาการกระพริบสถานะเวลาเหลือบตามองสไลด์แวบเดียว
            if (isLookingDownRaw) {
              lookDownBufferRef.current += 1;
              lookAwayBufferRef.current = 0;
            } else if (isLookingAwayRaw) {
              lookAwayBufferRef.current += 1;
              lookDownBufferRef.current = 0;
            } else {
              lookDownBufferRef.current = Math.max(0, lookDownBufferRef.current - 1);
              lookAwayBufferRef.current = Math.max(0, lookAwayBufferRef.current - 1);
            }

            // แสดงผลสถานะ
            let isEyeContactNow = false;

            if (lookDownBufferRef.current >= 7) {
              setCurrentStatus('looking_down');
              isEyeContactNow = false;
              if (isTrackingRef.current) {
                lookingDownFramesRef.current += 1;
                lookDownTotalSecRef.current += deltaSec;
                if (!inLookDownInstanceRef.current && lookDownBufferRef.current === 7) {
                  inLookDownInstanceRef.current = true;
                  lookDownCountRef.current += 1;
                  setLookingDownCount(lookDownCountRef.current);
                }
              }
            } else if (lookAwayBufferRef.current >= 7) {
              setCurrentStatus('looking_away');
              isEyeContactNow = false;
              inLookDownInstanceRef.current = false;
            } else {
              setCurrentStatus('eye_contact');
              isEyeContactNow = true;
              inLookDownInstanceRef.current = false;
              if (isTrackingRef.current) {
                eyeContactFramesRef.current += 1;
              }
            }

            // อัปเดต % Eye Contact สด (คำนวณจากช่วง 30 เฟรมล่าสุด ทั้งตอนพรีวิวและตอนซ้อม)
            rollingHistoryRef.current.push(isEyeContactNow ? 1 : 0);
            if (rollingHistoryRef.current.length > 30) {
              rollingHistoryRef.current.shift();
            }
            const activeSum = rollingHistoryRef.current.reduce((a, b) => a + b, 0);
            const liveScore = Math.round((activeSum / rollingHistoryRef.current.length) * 100);
            setEyeContactPct(liveScore);

            if (isTrackingRef.current) {
              totalFramesRef.current += 1;
            }
          } else {
            setCurrentStatus('no_face');
            rollingHistoryRef.current.push(0);
            if (rollingHistoryRef.current.length > 30) {
              rollingHistoryRef.current.shift();
            }
            const activeSum = rollingHistoryRef.current.reduce((a, b) => a + b, 0);
            setEyeContactPct(Math.round((activeSum / rollingHistoryRef.current.length) * 100));

            if (isTrackingRef.current) {
              totalFramesRef.current += 1;
            }
          }
        }
      }

      animFrameRef.current = requestAnimationFrame(loop);
    };

    animFrameRef.current = requestAnimationFrame(loop);

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [cameraActive, modelReady]);

  // 3. เริ่มสะสมสถิติจริง (เรียกเมื่อกด "เริ่มพูด")
  const startTracking = useCallback(() => {
    isTrackingRef.current = true;
    totalFramesRef.current = 0;
    eyeContactFramesRef.current = 0;
    lookingDownFramesRef.current = 0;
    inLookDownInstanceRef.current = false;
    lookDownCountRef.current = 0;
    lookDownTotalSecRef.current = 0;
    lookDownBufferRef.current = 0;
    lookAwayBufferRef.current = 0;
    rollingHistoryRef.current = [];
    setEyeContactPct(100);
    setLookingDownCount(0);
  }, []);

  // 4. สรุปผลการวิเคราะห์เมื่อหยุดพูด
  const stopTracking = useCallback(() => {
    isTrackingRef.current = false;
    const total = totalFramesRef.current || 1;
    const finalEyeContact = Math.round((eyeContactFramesRef.current / total) * 100);

    return {
      cameraUsed: cameraActive,
      eyeContactPct: cameraActive ? finalEyeContact : null,
      lookingDownCount: cameraActive ? lookDownCountRef.current : 0,
      lookingDownSec: cameraActive ? Math.round(lookDownTotalSecRef.current * 10) / 10 : 0,
    };
  }, [cameraActive]);

  // คลีนอัพเมื่อ Unmount
  useEffect(() => {
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (streamRef.current && ownsStreamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  // ตั้งศูนย์สายตาด้วยตนเอง (เรียกเมื่อผู้ใช้มองกล้องตรงๆ แล้วกดปุ่ม "ตั้งศูนย์")
  const calibrate = useCallback(() => {
    if (smoothRef.current.pitch === null) return false;
    const next = {
      pitch: smoothRef.current.pitch,
      yaw: smoothRef.current.yaw,
      irisY: smoothRef.current.irisY ?? 0.5,
    };
    baselineRef.current = next;
    autoCalibSamplesRef.current = [];
    lookDownBufferRef.current = 0;
    lookAwayBufferRef.current = 0;
    saveBaseline(next);
    saveManualCalibrated();
    setCalibrated(true);
    setManualCalibrated(true);
    setPoseAngles({ pitch: 0, yaw: 0 });
    return true;
  }, []);

  const dismissCalibrationTip = useCallback(() => {
    saveManualCalibrated();
    setManualCalibrated(true);
  }, []);

  return {
    videoRef,
    setVideoRef,
    cameraActive,
    modelLoading,
    modelReady,
    cameraError,
    currentStatus,
    eyeContactPct,
    lookingDownCount,
    poseAngles,
    calibrated,
    manualCalibrated,
    calibrate,
    dismissCalibrationTip,
    startCamera,
    attachExternalStream,
    stopCamera,
    startTracking,
    stopTracking,
    getStream: () => streamRef.current,
  };
}
