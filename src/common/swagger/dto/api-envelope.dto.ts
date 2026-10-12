import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ApiMetaDto {
  @ApiProperty({ example: 'req_6ce0eecd9fd7a31fdae9f47b' })
  requestId: string;
}

export class ApiErrorDetailDto {
  @ApiProperty({ example: 'amount' })
  field: string;

  @ApiProperty({ example: 'amount must be a positive decimal string' })
  issue: string;
}

export class ApiErrorDto {
  @ApiProperty({
    example: 'VALIDATION_FAILED',
    description: 'Stable UPPER_SNAKE_CASE code; clients branch on it',
  })
  code: string;

  @ApiProperty({ example: 'The request contains invalid fields.' })
  message: string;

  @ApiPropertyOptional({ type: [ApiErrorDetailDto] })
  details?: ApiErrorDetailDto[];
}

export class ApiFailureDto {
  @ApiProperty({ example: false })
  success: false;

  @ApiProperty({ example: 400 })
  statusCode: number;

  @ApiProperty({ type: ApiErrorDto })
  error: ApiErrorDto;

  @ApiProperty({ type: ApiMetaDto })
  meta: ApiMetaDto;
}

export class ApiSuccessDto {
  @ApiProperty({ example: true })
  success: true;

  @ApiProperty({ example: 200 })
  statusCode: number;

  @ApiProperty({ example: 'OK' })
  message: string;

  @ApiProperty({ type: ApiMetaDto })
  meta: ApiMetaDto;
}

export const ENVELOPE_MODELS = [
  ApiSuccessDto,
  ApiFailureDto,
  ApiErrorDto,
  ApiErrorDetailDto,
  ApiMetaDto,
];
