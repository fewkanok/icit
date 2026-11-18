const DB_NAME = 'icit_local_videos';
const STORE_NAME = 'videos';
const DB_VERSION = 1;
const MAX_LOCAL_VIDEOS = 8; // เก็บอัตโนมัติสูงสุด 8 คลิปล่าสุดในเครื่อง

function openVideoDb() {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('เบราว์เซอร์นี้ไม่รองรับ IndexedDB'));
  }
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'sessionId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('เปิด IndexedDB ไม่สำเร็จ'));
  });
}

export async function saveLocalSessionVideo(sessionId, blob) {
  if (!sessionId || !blob) return false;
  try {
    const db = await openVideoDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put({
        sessionId,
        blob,
        mimeType: blob.type || 'video/mp4',
        size: blob.size || 0,
        savedAt: Date.now(),
      });
      const allReq = store.getAll();
      allReq.onsuccess = () => {
        const items = Array.isArray(allReq.result) ? allReq.result : [];
        if (items.length > MAX_LOCAL_VIDEOS) {
          items.sort((a, b) => (a.savedAt || 0) - (b.savedAt || 0));
          const toDelete = items.slice(0, items.length - MAX_LOCAL_VIDEOS);
          toDelete.forEach((it) => {
            if (it?.sessionId && it.sessionId !== sessionId) {
              store.delete(it.sessionId);
            }
          });
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return true;
  } catch {
    return false;
  }
}

export async function getLocalSessionVideo(sessionId) {
  if (!sessionId) return null;
  try {
    const db = await openVideoDb();
    const record = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(sessionId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    if (!record?.blob) return null;
    return {
      blob: record.blob,
      url: URL.createObjectURL(record.blob),
      mimeType: record.mimeType || record.blob.type || 'video/mp4',
      size: record.size || record.blob.size || 0,
      savedAt: record.savedAt || null,
    };
  } catch {
    return null;
  }
}

export async function deleteLocalSessionVideo(sessionId) {
  if (!sessionId) return;
  try {
    const db = await openVideoDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(sessionId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // ignore
  }
}

export async function getLocalVideosStats() {
  try {
    const db = await openVideoDb();
    const items = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
      req.onerror = () => reject(req.error);
    });
    db.close();
    const totalBytes = items.reduce((sum, it) => sum + (Number(it?.size) || it?.blob?.size || 0), 0);
    return { count: items.length, totalBytes };
  } catch {
    return { count: 0, totalBytes: 0 };
  }
}

export async function clearAllLocalVideos() {
  try {
    const db = await openVideoDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return true;
  } catch {
    return false;
  }
}
