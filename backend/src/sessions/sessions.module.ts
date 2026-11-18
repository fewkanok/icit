import { Module } from '@nestjs/common';
import { PublicSessionsController, SessionsController } from './sessions.controller.js';
import { SessionsService } from './sessions.service.js';

@Module({
  controllers: [SessionsController, PublicSessionsController],
  providers: [SessionsService],
})
export class SessionsModule {}
