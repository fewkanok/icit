import { Global, Module } from '@nestjs/common';
import { TokensController } from './tokens.controller.js';
import { TokensService } from './tokens.service.js';

@Global()
@Module({
  controllers: [TokensController],
  providers: [TokensService],
  exports: [TokensService],
})
export class TokensModule {}
