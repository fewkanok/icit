import { Injectable } from '@nestjs/common';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

const EDGE_TTS_CACHE_MAX = 120;

@Injectable()
export class AppService {
  private readonly edgeTtsCache = new Map<string, string>();
  private readonly edgeTtsPending = new Map<string, Promise<{ audioDataUrl: string }>>();

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

    const task = (async () => {
      let audioDataUrl = '';
      try {
        audioDataUrl = await this.runEdgeTtsOnce(clean);
      } catch {
        await new Promise((r) => setTimeout(r, 250));
        audioDataUrl = await this.runEdgeTtsOnce(clean);
      }

      if (this.edgeTtsCache.size >= EDGE_TTS_CACHE_MAX) {
        const firstKey = this.edgeTtsCache.keys().next().value;
        if (firstKey !== undefined) this.edgeTtsCache.delete(firstKey);
      }
      this.edgeTtsCache.set(clean, audioDataUrl);
      return { audioDataUrl };
    })().finally(() => {
      this.edgeTtsPending.delete(clean);
    });

    this.edgeTtsPending.set(clean, task);
    return task;
  }
}
