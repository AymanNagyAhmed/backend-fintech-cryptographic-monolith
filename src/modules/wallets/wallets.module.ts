import { Module } from '@nestjs/common';
import { WalletsController } from './wallets.controller.js';
import { WalletsService } from './wallets.service.js';

// PrismaService comes from the global DatabaseModule
@Module({
  controllers: [WalletsController],
  providers: [WalletsService],
  exports: [WalletsService],
})
export class WalletsModule {}
