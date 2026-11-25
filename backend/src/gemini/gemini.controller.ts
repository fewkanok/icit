import { BadGatewayException, Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { DEMO_USER_ID, SupabaseAuthGuard, type AuthUserPayload } from '../auth/auth.guard.js';
import { TOKEN_COSTS, TokensService } from '../tokens/tokens.service.js';
import {
  CheckSlideDto,
  CompareRoundsDto,
  InterruptQuestionDto,
  QaEvaluateDto,
  QaGenerateDto,
  SummaryAnalyzeDto,
  TtsDto,
} from './dto/gemini.dto.js';
import { GeminiService } from './gemini.service.js';

@Controller('api/gemini')
@UseGuards(SupabaseAuthGuard)
export class GeminiController {
  constructor(
    private readonly geminiService: GeminiService,
    private readonly tokensService: TokensService,
  ) {}

  private async runWithToken<T>(
    userId: string,
    cost: number,
    type: string,
    description: string,
    fn: () => Promise<T>,
  ): Promise<Record<string, unknown>> {
    if (userId === DEMO_USER_ID) {
      const result = await fn();
      return { ...(result as Record<string, unknown>), demoCost: cost };
    }
    const tokenBalance = await this.tokensService.spendTokens(userId, cost, type, description);
    try {
      const result = await fn();
      return { ...(result as Record<string, unknown>), tokenBalance };
    } catch (err) {
      if (cost > 0) {
        await this.tokensService
          .refundTokens(userId, cost, `${type}_REFUND`, `คืน Token เนื่องจาก ${description} ไม่สำเร็จ`)
          .catch(() => {});
      }
      throw err;
    }
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('check-slide')
  checkSlide(@Req() req: { user: AuthUserPayload }, @Body() body: CheckSlideDto) {
    return this.runWithToken(
      req.user.id,
      TOKEN_COSTS.SLIDE_CHECK,
      'AI_SLIDE_CHECK',
      'ตรวจความตรงสไลด์ด้วย AI',
      async () => {
        const res = (await this.geminiService.checkSlide(body)) as { summary?: string };
        if (!res || typeof res.summary !== 'string' || !res.summary.trim()) {
          throw new BadGatewayException('AI ไม่สามารถสรุปสไลด์หน้านี้ได้ กรุณาลองใหม่');
        }
        return res;
      },
    );
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('qa/generate')
  generateQa(@Req() req: { user: AuthUserPayload }, @Body() body: QaGenerateDto) {
    return this.runWithToken(
      req.user.id,
      TOKEN_COSTS.QA_GENERATE,
      'AI_QA',
      'สร้างชุดคำถาม Q&A',
      async () => {
        const res = (await this.geminiService.generateQa(body)) as { questions?: unknown[] };
        if (!Array.isArray(res?.questions) || res.questions.length === 0) {
          throw new BadGatewayException('AI ไม่สามารถสร้างชุดคำถามได้ กรุณาลองใหม่');
        }
        return res;
      },
    );
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('qa/interrupt')
  generateInterrupt(@Req() req: { user: AuthUserPayload }, @Body() body: InterruptQuestionDto) {
    return this.runWithToken(
      req.user.id,
      TOKEN_COSTS.INTERRUPT,
      'AI_QA',
      'สร้างคำถามแทรกระหว่างซ้อม',
      async () => {
        const res = (await this.geminiService.generateInterruptQuestion(body)) as { question?: string };
        if (!res || typeof res.question !== 'string' || !res.question.trim()) {
          throw new BadGatewayException('AI ไม่สามารถสร้างคำถามแทรกได้ กรุณาลองใหม่');
        }
        return res;
      },
    );
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('qa/evaluate')
  evaluateQa(@Req() req: { user: AuthUserPayload }, @Body() body: QaEvaluateDto) {
    return this.runWithToken(
      req.user.id,
      TOKEN_COSTS.QA_EVALUATE,
      'AI_QA',
      'ประเมินคำตอบ Q&A',
      async () => {
        const res = (await this.geminiService.evaluateQa(body)) as {
          directness?: string;
          feedback?: string;
        };
        if (!res || (!res.directness && !res.feedback)) {
          throw new BadGatewayException('AI ไม่สามารถประเมินคำตอบได้ กรุณาลองใหม่');
        }
        return res;
      },
    );
  }

  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @Post('analyze-summary')
  analyzeSummary(@Req() req: { user: AuthUserPayload }, @Body() body: SummaryAnalyzeDto) {
    return this.runWithToken(
      req.user.id,
      TOKEN_COSTS.SUMMARY_ANALYZE,
      'AI_SUMMARY',
      'วิเคราะห์สรุปผลการซ้อมทั้งหมด',
      async () => {
        const res = (await this.geminiService.analyzeSummary(body)) as { listenerSummary?: string };
        if (!res || typeof res.listenerSummary !== 'string' || !res.listenerSummary.trim()) {
          throw new BadGatewayException('AI ไม่สามารถวิเคราะห์สรุปผลได้ กรุณาลองใหม่');
        }
        return res;
      },
    );
  }

  @Throttle({ default: { limit: 6, ttl: 60000 } })
  @Post('compare-rounds')
  compareRounds(@Req() req: { user: AuthUserPayload }, @Body() body: CompareRoundsDto) {
    return this.runWithToken(
      req.user.id,
      TOKEN_COSTS.ROUND_COMPARE,
      'AI_COMPARE',
      'วิเคราะห์เปรียบเทียบพัฒนาการระหว่างรอบ',
      async () => {
        const res = (await this.geminiService.compareRounds(body)) as { headline?: string };
        if (!res || typeof res.headline !== 'string' || !res.headline.trim()) {
          throw new BadGatewayException('AI ไม่สามารถวิเคราะห์เปรียบเทียบได้ กรุณาลองใหม่');
        }
        return res;
      },
    );
  }

  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @Post('tts')
  synthesizeSpeech(@Req() req: { user: AuthUserPayload }, @Body() body: TtsDto) {
    const cost = this.geminiService.hasCachedTts(body.text) ? 0 : TOKEN_COSTS.TTS;
    return this.runWithToken(
      req.user.id,
      cost,
      'AI_TTS',
      'สร้างเสียงอ่านคำถาม Gemini TTS',
      async () => {
        const res = (await this.geminiService.synthesizeSpeech(body.text)) as {
          audioDataUrl?: string;
        };
        if (!res || typeof res.audioDataUrl !== 'string' || !res.audioDataUrl) {
          throw new BadGatewayException('AI ไม่สามารถสร้างเสียงอ่านได้ กรุณาลองใหม่');
        }
        return res;
      },
    );
  }
}
