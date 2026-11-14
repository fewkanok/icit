import { io } from 'socket.io-client';

function getSocketUrl() {
  const pageHost = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
  const configured = import.meta.env.VITE_API_URL?.trim();
  if (configured) {
    if (pageHost !== 'localhost' && pageHost !== '127.0.0.1') {
      return configured.replace(/localhost|127\.0\.0\.1/g, pageHost);
    }
    return configured;
  }
  return `http://${pageHost}:3000`;
}

export function createSocket() {
  return io(getSocketUrl(), {
    transports: ['polling', 'websocket'],
  });
}
