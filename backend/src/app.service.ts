import { Injectable } from '@nestjs/common';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

const EDGE_TTS_CACHE_MAX = 120;

@Injectable()
export class AppService {
  private readonly edgeTtsCache = new Map<string, string>();
  private readonly edgeTtsPending = new Map<string, Promise<{ audioDataUrl: string }>>();
  private edgeTtsQueue: Promise<void> = Promise.resolve();

  getHello(): string {
    return 'Hello World!';
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
