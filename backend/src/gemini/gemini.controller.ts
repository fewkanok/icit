import { Body, Controller, Post } from '@nestjs/common';
import {
  GeminiService,
  type QaEvaluateInput,
  type QaGenerateInput,
  type SlideCheckInput,
  type SummaryAnalyzeInput,
} from './gemini.service.js';

@Controller('api/gemini')
export class GeminiController {
  constructor(private readonly geminiService: GeminiService) {}

  @Post('check-slide')
  checkSlide(@Body() body: SlideCheckInput) {
    return this.geminiService.checkSlide(body);
  }

  @Post('qa/generate')
  generateQa(@Body() body: QaGenerateInput) {
    return this.geminiService.generateQa(body);
  }

  @Post('qa/interrupt')
  generateInterrupt(@Body() body: SlideCheckInput & { slideNumber?: number }) {
    return this.geminiService.generateInterruptQuestion(body);
  }

  @Post('qa/evaluate')
  evaluateQa(@Body() body: QaEvaluateInput) {
    return this.geminiService.evaluateQa(body);
  }

  @Post('analyze-summary')
  analyzeSummary(@Body() body: SummaryAnalyzeInput) {
    return this.geminiService.analyzeSummary(body);
  }

  @Post('tts')
  synthesizeSpeech(@Body() body: { text: string }) {
    return this.geminiService.synthesizeSpeech(body?.text);
  }
}
