import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SupabaseAuthGuard, type AuthUserPayload } from '../auth/auth.guard.js';
import { TOKEN_COSTS, TokensService } from '../tokens/tokens.service.js';
import {
  CheckSlideDto,
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
  ): Promise<Record<string, unknown> & { tokenBalance: number }> {
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
      () => this.geminiService.checkSlide(body),
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
      () => this.geminiService.generateQa(body),
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
      () => this.geminiService.generateInterruptQuestion(body),
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
      () => this.geminiService.evaluateQa(body),
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
      () => this.geminiService.analyzeSummary(body),
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
      () => this.geminiService.synthesizeSpeech(body.text),
    );
  }
}
