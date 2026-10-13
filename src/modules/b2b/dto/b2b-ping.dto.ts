import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class B2bPingDto {
  @ApiPropertyOptional({ example: 'hello', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  message?: string;
}
