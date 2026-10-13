import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export const WALLET_PAGE_DEFAULT = 20;
export const WALLET_PAGE_MAX = 100;

export class ListWalletsQueryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    example: '019a1b2c-3d4e-7f60-8a9b-0c1d2e3f4a5b',
    description: '`nextCursor` of the previous page; omit for the first page',
  })
  @IsOptional()
  @IsUUID()
  cursor?: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: WALLET_PAGE_MAX,
    default: WALLET_PAGE_DEFAULT,
    example: WALLET_PAGE_DEFAULT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(WALLET_PAGE_MAX)
  limit?: number;
}
