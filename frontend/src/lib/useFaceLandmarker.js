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
export function useFaceLandmarker() {
  const [cameraActive, setCameraActive] = useState(false);
  const [modelLoading, setModelLoading] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [cameraError, setCameraError] = useState(null);

  // สถานะการตรวจจับสด
  const [currentStatus, setCurrentStatus] = useState('off'); // 'eye_contact' | 'looking_down' | 'looking_away' | 'no_face' | 'off'
  const [eyeContactPct, setEyeContactPct] = useState(100);
  const [poseAngles, setPoseAngles] = useState({ pitch: 0, yaw: 0 });

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const animFrameRef = useRef(null);
  const landmarkerRef = useRef(null);

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

  // 2. ปิดกล้องเว็บแคม
  const stopCamera = useCallback(() => {
    isTrackingRef.current = false;
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (streamRef.current) {
      try {
        streamRef.current.getTracks().forEach((track) => track.stop());
      } catch (_) {}
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
    setCurrentStatus('off');
  }, []);

  // Callback ref เชื่อมต่อสัญญาณวิดีโอทันที
  const setVideoRef = useCallback((node) => {
    videoRef.current = node;
    if (node && streamRef.current) {
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
            // landmark 234 (แก้มซ้าย), landmark 454 (แก้มขวา), landmark 1 (ปลายจมูก)
            const leftCheek = lm[234];
            const rightCheek = lm[454];
            const noseTip = lm[1];
            const faceWidth = Math.abs(rightCheek.x - leftCheek.x) || 0.001;
            const noseRatio = (noseTip.x - leftCheek.x) / faceWidth;
            // หน้าตรง noseRatio อยู่ที่ประมาณ 0.50
            const calculatedYaw = Math.round((noseRatio - 0.5) * 110);

            // 2. คำนวณองศาการก้ม/เงย (Pitch) จากความลึกแกน Z และอัตราส่วนจมูก-คาง
            // landmark 10 (หน้าผาก), landmark 152 (ปลายคาง), landmark 168 (ดั้งจมูก)
            const forehead = lm[10];
            const chin = lm[152];
            const noseBridge = lm[168];
            const faceHeight = Math.abs(chin.y - forehead.y) || 0.001;
            const upperDist = Math.abs(noseTip.y - forehead.y);
            const lowerDist = Math.abs(chin.y - noseTip.y);
            const verticalRatio = upperDist / (lowerDist || 0.001);
            // ความลึกแกน Z (หน้าผากยื่นหรือคางยื่น)
            const zTilt = (forehead.z - chin.z);
            // คำนวณเป็นองศาก้ม/เงย (ติดลบ = ก้มหน้า, บวก = เงยหน้า)
            const calculatedPitch = Math.round((verticalRatio - 1.25) * -45 + zTilt * -120);

            setPoseAngles({ pitch: calculatedPitch, yaw: calculatedYaw });

            // 3. วิเคราะห์ดวงตา (การกะพริบตา และ ตำแหน่งตาดำ Iris)
            // ตาซ้าย: บน (159), ล่าง (145), หัวตา (133), หางตา (33), ตาดำ (468)
            const eyeOpenHeight = Math.abs(lm[145].y - lm[159].y);
            const eyeWidth = Math.abs(lm[133].x - lm[33].x) || 0.001;
            const eyeOpenRatio = eyeOpenHeight / eyeWidth;
            // ถ้าตี่/ปิดตามากกว่าปกติ = กำลังกะพริบตา
            const isBlinking = eyeOpenRatio < 0.12;

            // ตำแหน่งตาดำในแนวตั้ง (0 = มองบน, 0.5 = มองตรง, 0.8+ = มองต่ำลงโพย)
            const irisY = lm[468]?.y ?? noseTip.y;
            const eyeTopY = lm[159].y;
            const irisVerticalPos = (irisY - eyeTopY) / (eyeOpenHeight || 0.001);

            // 4. ตัดสินสถานะแบบเฉียบคม:
            // ก้มอ่านโพย = ก้มหน้าจริง (pitch < -11 องศา) หรือ (หน้าก้มเล็กน้อย + สายตามองต่ำชัดเจน irisVerticalPos > 0.65 โดยไม่ได้หลับตา)
            const isLookingDownRaw = !isBlinking && (calculatedPitch < -11 || (calculatedPitch < -5 && irisVerticalPos > 0.65) || irisVerticalPos > 0.78);
            // หันมองสไลด์/มองออกข้าง = หันหน้าชัดเจน (|yaw| > 16 องศา)
            const isLookingAwayRaw = !isBlinking && Math.abs(calculatedYaw) > 16;

            // ใช้ Buffer สั้นๆ 4-5 เฟรม (~120ms) เพื่อความเนียน ไม่กระตุก
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

            if (lookDownBufferRef.current >= 4) {
              setCurrentStatus('looking_down');
              isEyeContactNow = false;
              if (isTrackingRef.current) {
                lookingDownFramesRef.current += 1;
                lookDownTotalSecRef.current += deltaSec;
                if (!inLookDownInstanceRef.current && lookDownBufferRef.current === 4) {
                  inLookDownInstanceRef.current = true;
                  lookDownCountRef.current += 1;
                }
              }
            } else if (lookAwayBufferRef.current >= 4) {
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
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
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
    poseAngles,
    startCamera,
    stopCamera,
    startTracking,
    stopTracking,
  };
}
