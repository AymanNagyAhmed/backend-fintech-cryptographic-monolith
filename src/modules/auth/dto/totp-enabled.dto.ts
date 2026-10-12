import { ApiProperty } from '@nestjs/swagger';

export class TotpEnabledDto {
  @ApiProperty({ example: true })
  totpEnabled: true;
}
