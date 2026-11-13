import { io } from 'socket.io-client';

function getSocketUrl() {
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL;
  const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
  return `http://${host}:3000`;
}

export function createSocket() {
  return io(getSocketUrl(), {
    transports: ['websocket', 'polling'],
  });
}
