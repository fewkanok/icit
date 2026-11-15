import { randomInt } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';

const ALLOWED_ACTIONS = new Set(['prev', 'next', 'start', 'stop', 'finish']);

function isAllowedRemoteOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  if (process.env.NODE_ENV !== 'production') return true;
  const configured = process.env.FRONTEND_URL?.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return Boolean(configured?.includes(origin));
}

function getLanIp(): string | null {
  const nets = networkInterfaces();
  const candidates: string[] = [];
  for (const list of Object.values(nets)) {
    for (const net of list ?? []) {
      if (net.family === 'IPv4' && !net.internal) {
        candidates.push(net.address);
      }
    }
  }
  // ให้ความสำคัญกับ Wi-Fi / LAN จริง (192.168.x.x, 10.x.x.x) ก่อน Virtual adapter (เช่น 172.x ของ WSL/Docker)
  return (
    candidates.find((ip) => ip.startsWith('192.168.')) ??
    candidates.find((ip) => ip.startsWith('10.')) ??
    candidates[0] ??
    null
  );
}

function makeRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[randomInt(chars.length)];
  }
  return code;
}

@WebSocketGateway({
  maxHttpBufferSize: 2 * 1024 * 1024,
  cors: {
    origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
      cb(null, isAllowedRemoteOrigin(origin));
    },
    credentials: true,
  },
})
export class RemoteGateway {
  @WebSocketServer()
  server!: Server;

  private readonly joinAttempts = new Map<string, { count: number; resetAt: number }>();

  private checkJoinRateLimit(socketId: string): boolean {
    const now = Date.now();
    const cur = this.joinAttempts.get(socketId);
    if (!cur || now > cur.resetAt) {
      this.joinAttempts.set(socketId, { count: 1, resetAt: now + 60_000 });
      return true;
    }
    cur.count += 1;
    return cur.count <= 10;
  }

  private getJoinedRoom(client: Socket, rawCode?: string): string | null {
    const code = rawCode?.trim().toUpperCase();
    if (!code || !client.rooms.has(code)) {
      return null;
    }
    return code;
  }

  @SubscribeMessage('create_room')
  handleCreateRoom(@ConnectedSocket() client: Socket) {
    let code = makeRoomCode();
    while (this.server.sockets.adapter.rooms.has(code)) {
      code = makeRoomCode();
    }
    void client.join(code);
    return { code, lanIp: getLanIp() };
  }

  @SubscribeMessage('join_remote')
  handleJoinRemote(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { code?: string },
  ) {
    if (!this.checkJoinRateLimit(client.id)) {
      return { ok: false, message: 'ลองเข้าร่วมห้องบ่อยเกินไป กรุณารอสักครู่' };
    }
    const code = body?.code?.trim().toUpperCase();
    if (!code || !this.server.sockets.adapter.rooms.has(code)) {
      return { ok: false, message: 'ไม่พบห้องนี้ หรือหน้าจอคอมปิดโหมดเวทีไปแล้ว' };
    }
    void client.join(code);
    client.to(code).emit('remote_joined', { connected: true });
    return { ok: true, code };
  }

  @SubscribeMessage('remote_command')
  handleRemoteCommand(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { code?: string; action?: string },
  ) {
    const code = this.getJoinedRoom(client, body?.code);
    if (!code || !body?.action || !ALLOWED_ACTIONS.has(body.action)) return;
    client.to(code).emit('stage_command', { action: body.action });
  }

  @SubscribeMessage('remote_laser')
  handleRemoteLaser(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { code?: string; x?: number; y?: number; active?: boolean },
  ) {
    const code = this.getJoinedRoom(client, body?.code);
    if (!code) return;
    const x = typeof body?.x === 'number' && Number.isFinite(body.x) ? Math.max(0, Math.min(1, body.x)) : 0.5;
    const y = typeof body?.y === 'number' && Number.isFinite(body.y) ? Math.max(0, Math.min(1, body.y)) : 0.5;
    client.to(code).emit('stage_laser', {
      x,
      y,
      active: Boolean(body?.active),
    });
  }

  @SubscribeMessage('remote_transcript')
  handleRemoteTranscript(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    body: { code?: string; finalText?: string; interim?: string; listening?: boolean },
  ) {
    const code = this.getJoinedRoom(client, body?.code);
    if (!code) return;
    client.to(code).emit('stage_transcript', {
      finalText: typeof body?.finalText === 'string' ? body.finalText.slice(0, 10000) : '',
      interim: typeof body?.interim === 'string' ? body.interim.slice(0, 1000) : '',
      listening: Boolean(body?.listening),
    });
  }

  @SubscribeMessage('stage_state')
  handleStageState(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { code?: string; [key: string]: unknown },
  ) {
    const code = this.getJoinedRoom(client, body?.code);
    if (!code) return;
    client.to(code).emit('remote_state', body);
  }

  @SubscribeMessage('stage_speak')
  handleStageSpeak(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { code?: string; text?: string },
  ) {
    const code = this.getJoinedRoom(client, body?.code);
    if (!code || typeof body?.text !== 'string' || !body.text.trim()) return;
    client.to(code).emit('remote_speak', { text: body.text.slice(0, 1000) });
  }

  @SubscribeMessage('stage_vibrate')
  handleStageVibrate(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { code?: string; pattern?: number | number[] },
  ) {
    const code = this.getJoinedRoom(client, body?.code);
    if (!code) return;
    client.to(code).emit('remote_vibrate', { pattern: body?.pattern ?? 200 });
  }
}
