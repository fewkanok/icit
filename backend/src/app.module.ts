import { ExecutionContext, Injectable, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

@Injectable()
class HttpThrottlerGuard extends ThrottlerGuard {
  override async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') {
      return true;
    }
    return super.canActivate(context);
  }

  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const user = req.user as { id?: string } | undefined;
    if (user?.id) {
      return `user:${user.id}`;
    }
    return super.getTracker(req);
  }
}
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { GeminiModule } from './gemini/gemini.module.js';
import { GroupModule } from './group/group.module.js';
import { LangmindModule } from './langmind/langmind.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RemoteModule } from './remote/remote.module.js';
import { SessionsModule } from './sessions/sessions.module.js';
import { TokensModule } from './tokens/tokens.module.js';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 15 }]),
    PrismaModule,
    AuthModule,
    TokensModule,
    SessionsModule,
    GeminiModule,
    GroupModule,
    RemoteModule,
    LangmindModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: HttpThrottlerGuard,
    },
  ],
})
export class AppModule {}
