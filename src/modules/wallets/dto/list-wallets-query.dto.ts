import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export const WALLET_PAGE_DEFAULT = 20;
export const WALLET_PAGE_MAX = 100;

export class ListWalletsQueryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: '`nextCursor` of the previous page; omit for the first page',
  })
  @IsOptional()
  @IsUUID()
  cursor?: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: WALLET_PAGE_MAX,
    default: WALLET_PAGE_DEFAULT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(WALLET_PAGE_MAX)
  limit?: number;
}
