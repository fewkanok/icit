import { Module } from '@nestjs/common';
import { RemoteGateway } from './remote.gateway.js';

@Module({
  providers: [RemoteGateway],
})
export class RemoteModule {}
