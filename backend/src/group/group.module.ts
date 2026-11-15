import { Module } from '@nestjs/common';
import { GroupController } from './group.controller.js';
import { GroupGateway } from './group.gateway.js';

@Module({
  controllers: [GroupController],
  providers: [GroupGateway],
})
export class GroupModule {}
