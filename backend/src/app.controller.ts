import { Body, Controller, Get, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AppService } from './app.service.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('api/rtc/ice-servers')
  getRtcIceServers() {
    return this.appService.getRtcIceServers();
  }

  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Post('api/tts/free')
  synthesizeFreeSpeech(@Body() body: { text?: string }) {
    return this.appService.synthesizeEdgeSpeech(body?.text || '');
  }
}
