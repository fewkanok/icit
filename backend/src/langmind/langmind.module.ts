import { Module } from '@nestjs/common';
import { LangmindController } from './langmind.controller.js';

@Module({
  controllers: [LangmindController],
})
export class LangmindModule {}
