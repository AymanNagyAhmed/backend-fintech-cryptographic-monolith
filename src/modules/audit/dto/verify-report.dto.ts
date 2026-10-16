import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class BrokenAtDto {
  @ApiProperty({ example: '1' })
  partition!: string;

  @ApiProperty({ example: '42', description: 'seq as decimal string' })
  seq!: string;
}

export class VerifyReportDto {
  @ApiProperty({ example: true })
  ok!: boolean;

  @ApiProperty({ example: 2 })
  partitionsChecked!: number;

  @ApiProperty({ example: 100 })
  eventsChecked!: number;

  @ApiPropertyOptional({ type: BrokenAtDto, nullable: true })
  brokenAt!: BrokenAtDto | null;

  @ApiProperty({ type: [BrokenAtDto] })
  gaps!: BrokenAtDto[];

  @ApiProperty({ type: [BrokenAtDto] })
  duplicates!: BrokenAtDto[];
}
