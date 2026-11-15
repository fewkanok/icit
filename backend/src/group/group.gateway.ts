import { randomInt } from 'node:crypto';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service.js';

export interface GroupMember {
  id: string;
  name: string;
  role: 'host' | 'member';
  ready: boolean;
  micEnabled: boolean;
  camEnabled: boolean;
  joinedAt: number;
}

export interface GroupSlide {
  id: string;
  title: string;
  src?: string;
  points?: string[];
}

interface GroupRoom {
  code: string;
  hostId: string;
  createdAt: number;
  members: GroupMember[];
  deckName: string;
  slides: GroupSlide[];
  assignments: Record<number, string>;
  started: boolean;
  finished: boolean;
  currentSlideIndex: number;
  uploadedSlides: number[];
}

function isAllowedGroupOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  if (process.env.NODE_ENV !== 'production') return true;
  const normalizedOrigin = origin.trim().replace(/\/+$/, '');
  const configured = process.env.FRONTEND_URL?.split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  return Boolean(configured?.includes(normalizedOrigin));
}

function makeGroupCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[randomInt(chars.length)];
  }
  return code;
}

function channelName(code: string): string {
  return `group:${code}`;
}

@WebSocketGateway({
  maxHttpBufferSize: 10 * 1024 * 1024,
  cors: {
    origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
      cb(null, isAllowedGroupOrigin(origin));
    },
    credentials: true,
  },
})
export class GroupGateway implements OnGatewayDisconnect, OnModuleInit, OnModuleDestroy {
  @WebSocketServer()
  server!: Server;

  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    void this.pruneExpiredClips();
    // กวาดลบคลิปที่ค้างเกิน 4 ชั่วโมงอัตโนมัติทุกๆ 15 นาที (กันบั๊กหรือเน็ตหลุด)
    this.cleanupTimer = setInterval(() => {
      void this.pruneExpiredClips();
    }, 15 * 60 * 1000);
    this.cleanupTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  private async pruneExpiredClips() {
    const cutoff = new Date(Date.now() - 4 * 60 * 60 * 1000);
    await this.prisma.groupClip
      .deleteMany({ where: { createdAt: { lt: cutoff } } })
      .catch(() => {});
  }

  private readonly rooms = new Map<string, GroupRoom>();
  private readonly socketToCode = new Map<string, string>();
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

  private serializeRoom(room: GroupRoom) {
    return {
      code: room.code,
      hostId: room.hostId,
      members: room.members,
      deckName: room.deckName,
      slides: room.slides,
      assignments: room.assignments,
      started: room.started,
      finished: room.finished,
      currentSlideIndex: room.currentSlideIndex,
      uploadedSlides: room.uploadedSlides,
    };
  }

  private emitState(room: GroupRoom) {
    this.server.to(channelName(room.code)).emit('group:state', this.serializeRoom(room));
  }

  private deleteRoomClips(code: string) {
    void this.prisma.groupClip.deleteMany({ where: { roomCode: code } }).catch(() => {});
  }

  notifyClipUploaded(code: string, slideIndex: number) {
    const room = this.rooms.get(code);
    if (!room) return;
    if (!room.uploadedSlides.includes(slideIndex)) {
      room.uploadedSlides = [...room.uploadedSlides, slideIndex].sort((a, b) => a - b);
    }
    this.emitState(room);
  }

  private getRoomForSocket(client: Socket): GroupRoom | null {
    const code = this.socketToCode.get(client.id);
    if (!code) return null;
    return this.rooms.get(code) ?? null;
  }

  private removeMemberFromCurrentRoom(client: Socket) {
    const prevCode = this.socketToCode.get(client.id);
    if (!prevCode) return;
    this.socketToCode.delete(client.id);
    void client.leave(channelName(prevCode));

    const room = this.rooms.get(prevCode);
    if (!room) return;

    room.members = room.members.filter((m) => m.id !== client.id);
    if (room.members.length === 0) {
      this.rooms.delete(prevCode);
      this.deleteRoomClips(prevCode);
      return;
    }

    // ถ้า Host ออกจากห้อง ให้เลื่อนสมาชิกคนถัดไปเป็น Host แทน
    if (room.hostId === client.id) {
      room.members[0].role = 'host';
      room.members[0].ready = true;
      room.hostId = room.members[0].id;
    }

    // ลบคิวสไลด์ที่ผูกกับคนที่ออกไปแล้ว
    const nextAssignments: Record<number, string> = {};
    for (const [k, memberId] of Object.entries(room.assignments)) {
      if (memberId !== client.id) {
        nextAssignments[Number(k)] = memberId;
      }
    }
    room.assignments = nextAssignments;

    this.emitState(room);
  }

  handleDisconnect(client: Socket) {
    this.joinAttempts.delete(client.id);
    this.removeMemberFromCurrentRoom(client);
  }

  @SubscribeMessage('group:create')
  handleCreateGroup(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { name?: string },
  ) {
    this.removeMemberFromCurrentRoom(client);

    let code = makeGroupCode();
    while (this.rooms.has(code)) {
      code = makeGroupCode();
    }

    const displayName = body?.name?.trim().slice(0, 30) || 'หัวหน้ากลุ่ม';
    const room: GroupRoom = {
      code,
      hostId: client.id,
      createdAt: Date.now(),
      members: [
        {
          id: client.id,
          name: displayName,
          role: 'host',
          ready: true,
          micEnabled: true,
          camEnabled: true,
          joinedAt: Date.now(),
        },
      ],
      deckName: '',
      slides: [],
      assignments: {},
      started: false,
      finished: false,
      currentSlideIndex: 0,
      uploadedSlides: [],
    };

    this.rooms.set(code, room);
    this.socketToCode.set(client.id, code);
    void client.join(channelName(code));

    return {
      ok: true,
      selfId: client.id,
      room: this.serializeRoom(room),
    };
  }

  @SubscribeMessage('group:join')
  handleJoinGroup(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { code?: string; name?: string },
  ) {
    if (!this.checkJoinRateLimit(client.id)) {
      return { ok: false, message: 'ลองเข้าร่วมห้องบ่อยเกินไป กรุณารอสักครู่' };
    }

    const code = body?.code?.trim().toUpperCase();
    const room = code ? this.rooms.get(code) : undefined;
    if (!code || !room) {
      return { ok: false, message: 'ไม่พบห้องซ้อมกลุ่มนี้ หรือห้องถูกปิดไปแล้ว' };
    }

    const displayName = body?.name?.trim().slice(0, 30);
    if (!displayName) {
      return { ok: false, message: 'กรุณากรอกชื่อของคุณก่อนเข้าห้อง' };
    }

    const existing = room.members.find((m) => m.id === client.id);
    if (existing) {
      existing.name = displayName;
    } else {
      this.removeMemberFromCurrentRoom(client);
      room.members.push({
        id: client.id,
        name: displayName,
        role: 'member',
        ready: false,
        micEnabled: true,
        camEnabled: true,
        joinedAt: Date.now(),
      });
      this.socketToCode.set(client.id, code);
      void client.join(channelName(code));
    }

    this.emitState(room);
    return {
      ok: true,
      selfId: client.id,
      room: this.serializeRoom(room),
    };
  }

  @SubscribeMessage('group:ready')
  handleToggleReady(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { ready?: boolean },
  ) {
    const room = this.getRoomForSocket(client);
    if (!room) return { ok: false };

    const member = room.members.find((m) => m.id === client.id);
    if (!member) return { ok: false };

    member.ready = typeof body?.ready === 'boolean' ? body.ready : !member.ready;
    this.emitState(room);
    return { ok: true, ready: member.ready };
  }

  @SubscribeMessage('group:set_deck')
  handleSetDeck(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { deckName?: string; slides?: GroupSlide[] },
  ) {
    const room = this.getRoomForSocket(client);
    if (!room || room.hostId !== client.id) {
      return { ok: false, message: 'เฉพาะหัวหน้ากลุ่มเท่านั้นที่เปลี่ยนสไลด์ได้' };
    }

    const rawSlides = Array.isArray(body?.slides) ? body.slides.slice(0, 50) : [];
    room.deckName = body?.deckName?.trim().slice(0, 80) || '';
    room.slides = rawSlides.map((s, idx) => ({
      id: String(s.id || `slide-${idx + 1}`),
      title: String(s.title || `สไลด์หน้า ${idx + 1}`).slice(0, 120),
      ...(typeof s.src === 'string' && s.src.startsWith('data:image/') ? { src: s.src } : {}),
      ...(Array.isArray(s.points)
        ? { points: s.points.slice(0, 8).map((p) => String(p).slice(0, 160)) }
        : {}),
    }));
    room.assignments = {};
    room.started = false;
    room.finished = false;
    room.currentSlideIndex = 0;
    room.uploadedSlides = [];
    this.deleteRoomClips(room.code);

    this.emitState(room);
    return { ok: true };
  }

  @SubscribeMessage('group:set_assignments')
  handleSetAssignments(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { assignments?: Record<string, string> },
  ) {
    const room = this.getRoomForSocket(client);
    if (!room || room.hostId !== client.id) {
      return { ok: false, message: 'เฉพาะหัวหน้ากลุ่มเท่านั้นที่จัดคิวสไลด์ได้' };
    }

    const memberIds = new Set(room.members.map((m) => m.id));
    const nextAssignments: Record<number, string> = {};
    if (body?.assignments && typeof body.assignments === 'object') {
      for (const [key, memberId] of Object.entries(body.assignments)) {
        const idx = Number(key);
        if (
          Number.isInteger(idx) &&
          idx >= 0 &&
          idx < room.slides.length &&
          typeof memberId === 'string' &&
          memberIds.has(memberId)
        ) {
          nextAssignments[idx] = memberId;
        }
      }
    }

    room.assignments = nextAssignments;
    this.emitState(room);
    return { ok: true };
  }

  @SubscribeMessage('group:start')
  handleStartGroup(@ConnectedSocket() client: Socket) {
    const room = this.getRoomForSocket(client);
    if (!room || room.hostId !== client.id) {
      return { ok: false, message: 'เฉพาะหัวหน้ากลุ่มเท่านั้นที่เริ่มซ้อมได้' };
    }
    if (room.slides.length === 0) {
      return { ok: false, message: 'กรุณาอัปโหลดสไลด์ก่อนเริ่มซ้อม' };
    }
    const allReady = room.members.length > 0 && room.members.every((m) => m.ready);
    if (!allReady) {
      return { ok: false, message: 'ต้องรอให้สมาชิกทุกคนในห้องกดพร้อมก่อนจึงจะเริ่มซ้อมได้' };
    }

    room.started = true;
    room.finished = false;
    room.currentSlideIndex = 0;
    room.uploadedSlides = [];
    this.deleteRoomClips(room.code);
    this.emitState(room);
    return { ok: true };
  }

  @SubscribeMessage('group:finish')
  handleFinishGroup(@ConnectedSocket() client: Socket) {
    const room = this.getRoomForSocket(client);
    if (!room) return { ok: false };
    const lastIdx = Math.max(0, room.slides.length - 1);
    const lastOwnerId = room.assignments[lastIdx];
    const isHost = room.hostId === client.id;
    const isLastSpeaker = lastOwnerId === client.id;
    if (!isHost && !isLastSpeaker) {
      return { ok: false, message: 'เฉพาะหัวหน้ากลุ่มหรือผู้พูดสไลด์สุดท้ายเท่านั้นที่กดจบได้' };
    }
    room.started = false;
    room.finished = true;
    this.emitState(room);
    return { ok: true };
  }

  @SubscribeMessage('group:slide_change')
  handleSlideChange(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { index?: number },
  ) {
    const room = this.getRoomForSocket(client);
    if (!room || !room.started || room.slides.length === 0) {
      return { ok: false };
    }

    const currentOwnerId = room.assignments[room.currentSlideIndex];
    const isHost = room.hostId === client.id;
    const isCurrentOwner = currentOwnerId === client.id;
    if (!isHost && !isCurrentOwner) {
      return { ok: false, message: 'รอเจ้าของคิวสไลด์นี้กดเปลี่ยนหน้า' };
    }

    const rawIndex = Number(body?.index);
    if (!Number.isInteger(rawIndex)) return { ok: false };
    room.currentSlideIndex = Math.max(0, Math.min(room.slides.length - 1, rawIndex));
    this.emitState(room);
    return { ok: true, currentSlideIndex: room.currentSlideIndex };
  }

  @SubscribeMessage('group:stop')
  handleStopGroup(@ConnectedSocket() client: Socket) {
    const room = this.getRoomForSocket(client);
    if (!room || room.hostId !== client.id) {
      return { ok: false };
    }

    room.started = false;
    room.finished = false;
    room.currentSlideIndex = 0;
    room.uploadedSlides = [];
    this.deleteRoomClips(room.code);
    this.emitState(room);
    return { ok: true };
  }

  @SubscribeMessage('group:media_state')
  handleMediaState(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { micEnabled?: boolean; camEnabled?: boolean },
  ) {
    const room = this.getRoomForSocket(client);
    if (!room) return { ok: false };
    const member = room.members.find((m) => m.id === client.id);
    if (!member) return { ok: false };

    if (typeof body?.micEnabled === 'boolean') member.micEnabled = body.micEnabled;
    if (typeof body?.camEnabled === 'boolean') member.camEnabled = body.camEnabled;
    this.emitState(room);
    return { ok: true };
  }

  @SubscribeMessage('group:rtc_signal')
  handleRtcSignal(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { toId?: string; signal?: unknown },
  ) {
    const room = this.getRoomForSocket(client);
    const toId = body?.toId;
    if (!room || !toId || toId === client.id) return;
    if (!room.members.some((m) => m.id === toId)) return;

    this.server.to(toId).emit('group:rtc_signal', {
      fromId: client.id,
      signal: body?.signal,
    });
  }

  @SubscribeMessage('group:leave')
  handleLeaveGroup(@ConnectedSocket() client: Socket) {
    this.removeMemberFromCurrentRoom(client);
    return { ok: true };
  }
}
