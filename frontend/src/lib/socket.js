import { io } from 'socket.io-client';

function getSocketUrl() {
  if (typeof window === 'undefined') return 'http://localhost:3000';
  const configured = import.meta.env.VITE_API_URL?.trim();
  const isLocalConfigured = !configured || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(configured);
  if (import.meta.env.DEV && isLocalConfigured) {
    // ใช้ origin เดียวกับหน้าเว็บเพื่อผ่าน Vite proxy (/socket.io) ไม่ติด firewall พอร์ต 3000 บนมือถือ
    return window.location.origin;
  }
  if (configured) {
    const pageHost = window.location.hostname;
    if (pageHost !== 'localhost' && pageHost !== '127.0.0.1') {
      return configured.replace(/localhost|127\.0\.0\.1/g, pageHost);
    }
    return configured;
  }
  return `http://${window.location.hostname}:3000`;
}

export function createSocket() {
  return io(getSocketUrl(), {
    transports: ['polling', 'websocket'],
  });
}
