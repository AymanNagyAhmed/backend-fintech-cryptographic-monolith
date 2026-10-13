import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppService } from './app.service.js';
import { Public } from './common/decorators/public.decorator.js';

@ApiTags('Health')
@Public()
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOperation({
    operationId: 'app.root',
    summary: 'API root (answers without dependencies)',
  })
  getHello(): string {
    return this.appService.getHello();
  }
}
