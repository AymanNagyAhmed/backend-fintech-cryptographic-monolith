import { ApiProperty } from '@nestjs/swagger';

export class TotpSetupDto {
  @ApiProperty({
    example:
      'otpauth://totp/Fintech:alice%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Fintech&algorithm=SHA1&digits=6&period=30',
    description: 'Render as a QR code for the authenticator app',
  })
  otpauthUri: string;

  @ApiProperty({
    example: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
    description: 'Base32 secret for manual entry; shown only once',
  })
  secret: string;
}
