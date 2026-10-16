import { ApiProperty } from '@nestjs/swagger';

export class ConsistencyProofDto {
  @ApiProperty({ example: 3 })
  from!: number;

  @ApiProperty({ example: 7 })
  to!: number;

  @ApiProperty()
  fromRootHash!: string;

  @ApiProperty()
  toRootHash!: string;

  @ApiProperty({ type: [String] })
  path!: string[];

  @ApiProperty()
  verified!: boolean;
}
