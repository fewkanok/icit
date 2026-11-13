import { networkInterfaces } from 'node:os';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';

function getLanIp(): string | null {
  const nets = networkInterfaces();
  for (const list of Object.values(nets)) {
    for (const net of list ?? []) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return null;
}

function makeRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

@WebSocketGateway({
  maxHttpBufferSize: 10 * 1024 * 1024,
  cors: {
    origin: true,
    credentials: true,
  },
})
export class RemoteGateway {
  @WebSocketServer()
  server!: Server;

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
    @MessageBody() body: { code: string; action: 'prev' | 'next' | 'start' | 'stop' | 'finish' },
  ) {
    if (!body?.code) return;
    client.to(body.code).emit('stage_command', { action: body.action });
  }

  @SubscribeMessage('remote_laser')
  handleRemoteLaser(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { code: string; x: number; y: number; active: boolean },
  ) {
    if (!body?.code) return;
    client.to(body.code).emit('stage_laser', {
      x: body.x,
      y: body.y,
      active: body.active,
    });
  }

  @SubscribeMessage('remote_transcript')
  handleRemoteTranscript(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    body: { code: string; finalText: string; interim: string; listening: boolean },
  ) {
    if (!body?.code) return;
    client.to(body.code).emit('stage_transcript', {
      finalText: body.finalText,
      interim: body.interim,
      listening: body.listening,
    });
  }

  @SubscribeMessage('stage_state')
  handleStageState(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { code: string; [key: string]: unknown },
  ) {
    if (!body?.code) return;
    client.to(body.code).emit('remote_state', body);
  }

  @SubscribeMessage('stage_speak')
  handleStageSpeak(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { code: string; text: string },
  ) {
    if (!body?.code || !body?.text) return;
    client.to(body.code).emit('remote_speak', { text: body.text });
  }

  @SubscribeMessage('stage_vibrate')
  handleStageVibrate(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { code: string; pattern?: number | number[] },
  ) {
    if (!body?.code) return;
    client.to(body.code).emit('remote_vibrate', { pattern: body.pattern ?? 200 });
  }
}
