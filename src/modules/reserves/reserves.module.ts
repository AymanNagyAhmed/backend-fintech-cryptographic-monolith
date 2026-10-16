import { Module } from '@nestjs/common';
import { WalletsModule } from '../wallets/wallets.module.js';
import { ReservesController } from './reserves.controller.js';
import { ReservesService } from './reserves.service.js';

// PrismaService comes from the global DatabaseModule; balances come from WalletsService
@Module({
  imports: [WalletsModule],
  controllers: [ReservesController],
  providers: [ReservesService],
  exports: [ReservesService],
})
export class ReservesModule {}
