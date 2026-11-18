import { Injectable } from '@nestjs/common';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

const EDGE_TTS_CACHE_MAX = 120;
const DEFAULT_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];
const ICE_CACHE_TTL_MS = 5 * 60 * 1000;

@Injectable()
export class AppService {
  private readonly edgeTtsCache = new Map<string, string>();
  private readonly edgeTtsPending = new Map<string, Promise<{ audioDataUrl: string }>>();
  private edgeTtsQueue: Promise<void> = Promise.resolve();
  private iceServersCache: { servers: unknown[]; expiresAt: number } | null = null;

  getHello(): string {
    return 'Hello World!';
  }

  async getRtcIceServers(): Promise<{ iceServers: unknown[] }> {
    const now = Date.now();
    if (this.iceServersCache && this.iceServersCache.expiresAt > now) {
      return { iceServers: this.iceServersCache.servers };
    }

    const turnUser = process.env.METERED_TURN_USERNAME?.trim();
    const turnCred = process.env.METERED_TURN_CREDENTIAL?.trim();
    if (turnUser && turnCred) {
      const servers = [
        ...DEFAULT_ICE_SERVERS,
        { urls: 'stun:stun.relay.metered.ca:80' },
        {
          urls: [
            'turn:global.relay.metered.ca:80',
            'turn:global.relay.metered.ca:80?transport=tcp',
            'turn:global.relay.metered.ca:443',
            'turns:global.relay.metered.ca:443?transport=tcp',
          ],
          username: turnUser,
          credential: turnCred,
        },
      ];
      this.iceServersCache = { servers, expiresAt: now + ICE_CACHE_TTL_MS };
      return { iceServers: servers };
    }

    const rawDomain = process.env.METERED_DOMAIN?.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    const apiKey = process.env.METERED_API_KEY?.trim();

    if (!rawDomain || !apiKey) {
      return { iceServers: DEFAULT_ICE_SERVERS };
    }

    try {
      const res = await fetch(
        `https://${rawDomain}/api/v1/turn/credentials?apiKey=${encodeURIComponent(apiKey)}`,
        { signal: AbortSignal.timeout(5000) },
      );
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const list = (await res.json()) as unknown;
      if (Array.isArray(list) && list.length > 0) {
        const servers = [...DEFAULT_ICE_SERVERS, ...list];
        this.iceServersCache = { servers, expiresAt: now + ICE_CACHE_TTL_MS };
        return { iceServers: servers };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[TURN] Metered fetch failed, falling back to STUN: ${msg}`);
    }

    return { iceServers: DEFAULT_ICE_SERVERS };
  }

  private async runEdgeTtsOnce(clean: string): Promise<string> {
    const tts = new MsEdgeTTS({ connectionTimeoutMs: 8000, synthesisTimeoutMs: 15000 });
    try {
      await tts.setMetadata('th-TH-PremwadeeNeural', OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
      const { audioStream } = tts.toStream(clean);
      const buffer = await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        audioStream.on('data', (chunk: Buffer | Uint8Array) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        audioStream.on('end', () => resolve(Buffer.concat(chunks)));
        audioStream.on('error', (err: Error) => reject(err));
      });

      if (!buffer.length) {
        throw new Error('Edge TTS returned empty audio');
      }

      return `data:audio/mpeg;base64,${buffer.toString('base64')}`;
    } finally {
      try {
        tts.close();
      } catch {
        // ignore close errors
      }
    }
  }

  private enqueueEdgeTts<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.edgeTtsQueue.then(async () => {
      try {
        return await fn();
      } finally {
        await new Promise((r) => setTimeout(r, 120));
      }
    });
    this.edgeTtsQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async synthesizeEdgeSpeech(rawText: string): Promise<{ audioDataUrl: string }> {
    const clean = String(rawText || '').trim().slice(0, 600);
    if (!clean) {
      return { audioDataUrl: '' };
    }

    const cached = this.edgeTtsCache.get(clean);
    if (cached) {
      return { audioDataUrl: cached };
    }

    const pending = this.edgeTtsPending.get(clean);
    if (pending) {
      return pending;
    }

    const task = this.enqueueEdgeTts(async () => {
      const cachedAfterQueue = this.edgeTtsCache.get(clean);
      if (cachedAfterQueue) {
        return { audioDataUrl: cachedAfterQueue };
      }

      const backoffMs = [400, 900];
      let audioDataUrl = '';
      let lastErr: unknown = null;

      for (let attempt = 0; attempt <= backoffMs.length; attempt++) {
        try {
          audioDataUrl = await this.runEdgeTtsOnce(clean);
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          if (attempt < backoffMs.length) {
            await new Promise((r) => setTimeout(r, backoffMs[attempt]));
          }
        }
      }

      if (!audioDataUrl) {
        const msg = lastErr instanceof Error ? lastErr.message : String(lastErr || 'unknown error');
        console.warn(`[EdgeTTS] Fallback to browser speech: ${msg}`);
        return { audioDataUrl: '' };
      }

      if (this.edgeTtsCache.size >= EDGE_TTS_CACHE_MAX) {
        const firstKey = this.edgeTtsCache.keys().next().value;
        if (firstKey !== undefined) this.edgeTtsCache.delete(firstKey);
      }
      this.edgeTtsCache.set(clean, audioDataUrl);
      return { audioDataUrl };
    }).finally(() => {
      this.edgeTtsPending.delete(clean);
    });

    this.edgeTtsPending.set(clean, task);
    return task;
  }
}
