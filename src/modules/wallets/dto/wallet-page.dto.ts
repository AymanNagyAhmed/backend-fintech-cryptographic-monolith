import { ApiProperty } from '@nestjs/swagger';
import { WalletDto } from './wallet.dto.js';

export class WalletPageDto {
  @ApiProperty({ type: [WalletDto] })
  items: WalletDto[];

  @ApiProperty({
    type: String,
    nullable: true,
    format: 'uuid',
    example: '019a1b2c-3d4e-7f60-8a9b-0c1d2e3f4a5b',
    description: 'Pass as `cursor` for the next page; null on the last page',
  })
  nextCursor: string | null;
}
