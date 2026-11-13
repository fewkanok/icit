import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';

export type AudienceType = 'teacher' | 'executive' | 'general';

const AUDIENCE_LABELS: Record<AudienceType, string> = {
  teacher: 'อาจารย์หรือกรรมการสายวิชาการ (เน้นเหตุผล ความถูกต้อง และรายละเอียดสำคัญ)',
  executive: 'ผู้บริหารหรือนักลงทุน (เน้นปัญหา ทางออก ความคุ้มค่า และกระชับเข้าประเด็น)',
  general: 'คนทั่วไปหรือเพื่อนต่างคณะ (เน้นภาษาเข้าใจง่าย ไม่ใช้ศัพท์เทคนิคซับซ้อน)',
};

export interface SlideCheckInput {
  slideTitle?: string;
  slideText?: string;
  slideImageBase64?: string;
  transcript: string;
  audience?: AudienceType;
}

export interface QaGenerateInput {
  deckName: string;
  audience?: AudienceType;
  slides: Array<{
    index: number;
    title?: string;
    text?: string;
    transcript?: string;
  }>;
}

export interface QaEvaluateInput {
  question: string;
  slideContext?: string;
  answerTranscript: string;
  audience?: AudienceType;
}

export interface SummaryAnalyzeInput {
  deckName: string;
  audience?: AudienceType;
  slides: Array<{
    index: number;
    title?: string;
    text?: string;
    transcript?: string;
    wpm?: number;
    fillersCount?: number;
    deadAirCount?: number;
    eyeContactPct?: number | null;
  }>;
  qaResults?: Array<{
    question: string;
    answerTranscript: string;
    score?: number;
  }>;
}

@Injectable()
export class GeminiService {
  private readonly ttsCache = new Map<string, string>();

  private pcmToWavDataUrl(base64Pcm: string, sampleRate = 24000): string {
    const pcm = Buffer.from(base64Pcm, 'base64');
    const header = Buffer.alloc(44);
    const byteRate = sampleRate * 2; // mono, 16-bit
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + pcm.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(pcm.length, 40);
    return `data:audio/wav;base64,${Buffer.concat([header, pcm]).toString('base64')}`;
  }

  private getClient(apiVersion?: string): { ai: GoogleGenAI; model: string } {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) {
      throw new ServiceUnavailableException({
        error: 'MISSING_API_KEY',
        message: 'ยังไม่ได้ตั้งค่า GEMINI_API_KEY ในไฟล์ backend/.env',
      });
    }
    return {
      ai: new GoogleGenAI(apiVersion ? { apiKey, apiVersion } : { apiKey }),
      model: process.env.GEMINI_MODEL?.trim() || 'gemini-2.5-flash',
    };
  }

  private audienceDesc(audience?: AudienceType): string {
    return AUDIENCE_LABELS[audience || 'general'] || AUDIENCE_LABELS.general;
  }

  private async askJson<T>(contents: unknown): Promise<T> {
    const { ai, model } = this.getClient();
    const candidates = Array.from(
      new Set([model, 'gemini-3.1-flash-lite', 'gemini-2.5-flash-lite', 'gemini-2.5-flash']),
    );

    let lastError: unknown;
    for (const candidate of candidates) {
      try {
        const res = await ai.models.generateContent({
          model: candidate,
          contents: contents as Parameters<typeof ai.models.generateContent>[0]['contents'],
          config: {
            responseMimeType: 'application/json',
            temperature: 0.4,
          },
        });
        const text = res.text?.trim() || '{}';
        return JSON.parse(text) as T;
      } catch (err: unknown) {
        lastError = err;
        const status = (err as { status?: number })?.status;
        const msg = err instanceof Error ? err.message : String(err);
        const isTransient = status === 503 || status === 429 || msg.includes('503') || msg.includes('429');
        if (!isTransient) throw err;
      }
    }

    throw new ServiceUnavailableException({
      error: 'AI_TEMPORARILY_UNAVAILABLE',
      message: 'ตอนนี้ระบบ AI มีคนใช้งานพร้อมกันเยอะ กรุณากดส่งใหม่อีกครั้งในอีกสักครู่',
      detail: lastError instanceof Error ? lastError.message : undefined,
    });
  }

  private buildParts(prompt: string, slideImageBase64?: string): Array<Record<string, unknown>> {
    const parts: Array<Record<string, unknown>> = [{ text: prompt }];
    if (slideImageBase64?.startsWith('data:image/')) {
      const [meta, data] = slideImageBase64.split(',');
      const mimeType = meta.replace('data:', '').replace(';base64', '');
      if (data) {
        parts.push({ inlineData: { mimeType, data } });
      }
    }
    return parts;
  }

  async checkSlide(input: SlideCheckInput) {
    const prompt = `คุณคือโค้ชช่วยซ้อมพรีเซนต์ หน้าที่ของคุณคือตรวจว่าผู้พูดพูดตรงตามสไลด์และสื่อสารให้คนฟังเข้าใจหรือไม่
กลุ่มคนฟังเป้าหมาย: ${this.audienceDesc(input.audience)}

ข้อมูลสไลด์:
- ชื่อหน้า: ${input.slideTitle || 'ไม่มี'}
- ข้อความบนสไลด์: ${input.slideText || '(สไลด์นี้เป็นรูปภาพหรือไม่มีข้อความ)'}

สิ่งที่ผู้พูดพูดออกมาจริง (Transcript):
"${input.transcript || '(ไม่ได้ยินเสียงพูด)'}"

ให้ตอบเป็น JSON ภาษาไทยที่กระชับ อ่านง่าย สำหรับผู้ใช้ทั่วไป:
{
  "alignmentScore": <ตัวเลข 0-100 ความตรงกับเนื้อหาสไลด์>,
  "summary": "<สรุปสั้นๆ 1-2 ประโยคว่าในมุมคนฟัง จับใจความได้อะไรจากที่พูด>",
  "coveredPoints": ["<ประเด็นที่พูดตรงกับสไลด์แล้ว>"],
  "missedPoints": ["<ประเด็นบนสไลด์ที่ยังไม่ได้พูดหรือตกหล่น>"],
  "suggestion": "<คำแนะนำสั้นๆ 1-2 ประโยคว่าควรปรับการพูดหน้านี้อย่างไร>"
}`;

    return this.askJson(this.buildParts(prompt, input.slideImageBase64));
  }

  async generateInterruptQuestion(input: SlideCheckInput & { slideNumber?: number }) {
    const prompt = `คุณคือผู้ฟังกลุ่มเป้าหมาย: ${this.audienceDesc(input.audience)}
กำลังฟังผู้พูดนำเสนอสไลด์หน้า ${input.slideNumber || 1} (${input.slideTitle || 'ไม่มีชื่อหน้า'}) แล้วอยากยกมือถามแทรกสั้นๆ 1 ข้อทันทีที่จบหน้านี้

เนื้อหาสไลด์: ${input.slideText || '(ดูจากรูปสไลด์)'}
สิ่งที่ผู้พูดเพิ่งพูดจบ: "${input.transcript || '(ไม่ได้ยินเสียงพูด)'}"

จงตั้งคำถามแทรกสั้นๆ 1 ข้อที่เป็นธรรมชาติ เหมือนคนฟังถามสดกลางคัน (ไม่ยาวเกิน 1-2 ประโยค)
ตอบเป็น JSON ภาษาไทยเท่านั้น:
{
  "question": "<คำถามแทรก 1 ข้อ>",
  "intent": "<เหตุผลสั้นๆ ที่ถาม>"
}`;

    return this.askJson(this.buildParts(prompt, input.slideImageBase64));
  }

  async generateQa(input: QaGenerateInput) {
    const slideBlock = input.slides
      .map(
        (s) =>
          `[หน้า ${s.index + 1}] ${s.title || ''}\nเนื้อหาสไลด์: ${s.text || '(ไม่มีข้อความ)'}\nสิ่งที่พูดจริง: ${s.transcript || '(ไม่ได้พูด)'}`,
      )
      .join('\n\n');

    const prompt = `คุณคือผู้ฟังกลุ่มเป้าหมาย: ${this.audienceDesc(input.audience)}
เพิ่งฟังการนำเสนอเรื่อง "${input.deckName}" จบลง

ข้อมูลสไลด์และคำพูดจริง:
${slideBlock}

จงตั้งคำถามถาม-ตอบ (Q&A) จำนวน 2 ถึง 3 ข้อ ที่ตรงประเด็นและท้าทายความเข้าใจของผู้พูด โดยอ้างอิงจากสิ่งที่เขียนบนสไลด์หรือสิ่งที่ผู้พูดอธิบายยังไม่ชัด
ตอบเป็น JSON ภาษาไทยเท่านั้น:
{
  "questions": [
    {
      "id": 1,
      "slideIndex": <เลข index หน้าสไลด์ที่เกี่ยวข้อง เริ่มที่ 0>,
      "question": "<คำถามสั้น กระชับ เหมือนถามสดหน้าห้อง>",
      "intent": "<เหตุผลสั้นๆ ว่าผู้ฟังอยากรู้เรื่องอะไรจากคำถามนี้>"
    }
  ]
}`;

    return this.askJson(prompt);
  }

  async evaluateQa(input: QaEvaluateInput) {
    const prompt = `คุณคือผู้ฟังกลุ่มเป้าหมาย: ${this.audienceDesc(input.audience)}
คำถามที่ถามผู้พูด: "${input.question}"
บริบทสไลด์: ${input.slideContext || '-'}
คำตอบที่ผู้พูดตอบสด: "${input.answerTranscript || '(ไม่ได้ตอบ)'}"

จงประเมินคำตอบนี้แบบกระชับ ตรงไปตรงมา เป็น JSON ภาษาไทย:
{
  "score": <คะแนน 1-10>,
  "directness": "<เลือก 1 คำ: ตอบตรงประเด็น | ตอบอ้อม/ยังไม่ชัด | ยังไม่ได้ตอบ>",
  "feedback": "<คำติชมสั้นๆ 1-2 ประโยค>",
  "betterAnswer": "<ตัวอย่างประโยคแนวทางการตอบที่ดีขึ้น กระชับขึ้น>"
}`;

    return this.askJson(prompt);
  }

  async analyzeSummary(input: SummaryAnalyzeInput) {
    const slideBlock = input.slides
      .map(
        (s) =>
          `[หน้า ${s.index + 1}] ${s.title || ''}
ข้อความบนสไลด์: ${s.text || '(ไม่มีข้อความ)'}
คำพูดจริง: ${s.transcript || '(ไม่ได้พูด)'}
สถิติการพูด: ความเร็ว ${s.wpm || 0} คำ/นาที, คำติดปาก ${s.fillersCount || 0} ครั้ง, เงียบค้าง ${s.deadAirCount || 0} ครั้ง${
            s.eyeContactPct !== null && s.eyeContactPct !== undefined ? `, สบตากล้อง ${s.eyeContactPct}%` : ''
          }`,
      )
      .join('\n\n');

    const qaBlock =
      input.qaResults && input.qaResults.length > 0
        ? input.qaResults
            .map((q, idx) => `คำถาม ${idx + 1}: ${q.question}\nคำตอบ: ${q.answerTranscript || '(ไม่ได้ตอบ)'}`)
            .join('\n\n')
        : '(ไม่มีช่วงถาม-ตอบ)';

    const prompt = `คุณคือโค้ชช่วยซ้อมพรีเซนต์ วิเคราะห์การนำเสนอเรื่อง "${input.deckName}" สำหรับผู้ฟังกลุ่ม: ${this.audienceDesc(input.audience)}

ข้อมูลสไลด์และคำพูดจริง:
${slideBlock}

ช่วงถาม-ตอบ:
${qaBlock}

จงประเมิน 2 ด้านสำคัญ:
1. ความตรงตามสไลด์ (พูดครบ ตกหล่น หรือลืมพูดประเด็นไหน)
2. ความเข้าใจของผู้ฟัง (คนฟังจับใจความได้แค่ไหน และควรเกลาคำพูดแต่ละหน้าอย่างไรให้คนฟังเข้าใจง่ายขึ้น)

ตอบเป็น JSON ภาษาไทยที่อ่านง่าย สั้น กระชับ ไม่ต้องใช้ศัพท์วิชาการซับซ้อน:
{
  "overallScore": <คะแนนรวม 0-100>,
  "alignmentScore": <คะแนนความตรงกับสไลด์ 0-100>,
  "clarityScore": <คะแนนความเข้าใจง่ายของคนฟัง 0-100>,
  "listenerSummary": "<ในมุมมองคนฟัง: สรุปสิ่งที่คนฟังเข้าใจได้จริงจากการฟังทั้งหมด 2-3 ประโยค>",
  "slides": [
    {
      "index": <index หน้า เริ่มที่ 0>,
      "status": "<complete | partial | missed>",
      "covered": ["<ประเด็นที่พูดครบ>"],
      "missed": ["<ประเด็นที่ลืมพูดหรือขาดรายละเอียด>"],
      "polishedScript": "<ตัวอย่างประโยคที่เกลาให้ใหม่ กระชับและเข้าใจง่ายขึ้นสำหรับหน้านี้>"
    }
  ],
  "topStrengths": ["<จุดเด่น 1-2 ข้อ>"],
  "topImprovements": ["<สิ่งที่ควรปรับปรุง 1-2 ข้อ>"]
}`;

    return this.askJson(prompt);
  }

  async synthesizeSpeech(text: string) {
    const clean = text?.trim();
    if (!clean) return { audioDataUrl: null };

    const cached = this.ttsCache.get(clean);
    if (cached) return { audioDataUrl: cached };

    const { ai } = this.getClient('v1beta');
    const ttsModels = [
      'gemini-2.5-flash-preview-tts',
      'gemini-2.5-flash-tts',
      'gemini-3.1-flash-tts',
      'gemini-3.8-flash-lite-tts',
      'gemini-3.8-flash-tts',
    ];

    for (const model of ttsModels) {
      try {
        const generateAudio = (includeSpeechConfig: boolean) =>
          ai.models.generateContent({
            model,
            contents: clean,
            config: includeSpeechConfig
              ? {
                  responseModalities: ['AUDIO'],
                  speechConfig: {
                    voiceConfig: {
                      prebuiltVoiceConfig: { voiceName: 'Kore' },
                    },
                  },
                }
              : { responseModalities: ['AUDIO'] },
          });

        let res;
        try {
          res = await generateAudio(true);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (!msg.includes('speechConfig')) throw err;
          res = await generateAudio(false);
        }

        const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
        const inline = part?.inlineData;
        if (inline?.data) {
          const mime = inline.mimeType || 'audio/L16;rate=24000';
          let audioDataUrl: string;
          if (mime.includes('L16') || mime.includes('pcm')) {
            const rateMatch = mime.match(/rate=(\d+)/);
            const rate = rateMatch ? Number(rateMatch[1]) : 24000;
            audioDataUrl = this.pcmToWavDataUrl(inline.data, rate);
          } else {
            audioDataUrl = `data:${mime};base64,${inline.data}`;
          }

          if (this.ttsCache.size >= 50) {
            const firstKey = this.ttsCache.keys().next().value;
            if (firstKey) this.ttsCache.delete(firstKey);
          }
          this.ttsCache.set(clean, audioDataUrl);
          return { audioDataUrl };
        }
        console.warn(`[GeminiTTS] ${model} returned no audio data`);
      } catch (err) {
        console.warn(`[GeminiTTS] ${model} failed:`, err instanceof Error ? err.message : err);
      }
    }

    throw new ServiceUnavailableException({
      error: 'TTS_UNAVAILABLE',
      message: 'ไม่สามารถสร้างเสียง Gemini TTS ได้ในขณะนี้',
    });
  }
}
