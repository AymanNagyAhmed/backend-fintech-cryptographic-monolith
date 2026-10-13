import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, ValidateIf } from 'class-validator';
import {
  WALLET_LABEL_INPUT_MAX,
  WALLET_LABEL_MAX_LENGTH,
} from '../wallet-label.js';

export class UpdateWalletDto {
  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Travel',
    maxLength: WALLET_LABEL_MAX_LENGTH,
    description:
      'Required key: a new label (trimmed, 1-50 characters) or null to clear it.',
  })
  // null clears the label; a missing key fails IsString
  @ValidateIf((dto: UpdateWalletDto) => dto.label !== null)
  @IsString()
  @MaxLength(WALLET_LABEL_INPUT_MAX)
  label: string | null;
}
