import { ApiProperty } from '@nestjs/swagger';
import { WalletDto } from './wallet.dto.js';

export class WalletPageDto {
  @ApiProperty({ type: [WalletDto] })
  items: WalletDto[];

  @ApiProperty({
    type: String,
    nullable: true,
    format: 'uuid',
    description: 'Pass as `cursor` for the next page; null on the last page',
  })
  nextCursor: string | null;
}
