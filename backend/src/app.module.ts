import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { GeminiModule } from './gemini/gemini.module.js';
import { RemoteModule } from './remote/remote.module.js';

@Module({
  imports: [GeminiModule, RemoteModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
