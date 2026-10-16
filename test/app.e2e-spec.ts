import {
  Body,
  Controller,
  Get,
  INestApplication,
  NotFoundException,
  Post,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Type } from 'class-transformer';
import { IsString, Matches, ValidateNested } from 'class-validator';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { setupApp } from './../src/app.setup.js';
import { Public } from './../src/common/decorators/public.decorator.js';
import { ResponseMessage } from './../src/common/decorators/response-message.decorator.js';
import { DomainException } from './../src/common/exceptions/domain.exception.js';

class CounterpartyDto {
  @IsString()
  walletId: string;
}

class TransferDto {
  @Matches(/^\d+(\.\d+)?$/)
  amount: string;

  @ValidateNested()
  @Type(() => CounterpartyDto)
  to: CounterpartyDto;
}

@Public()
@Controller('envelope-test')
class EnvelopeTestController {
  @Post('transfer')
  transfer(@Body() dto: TransferDto) {
    return dto;
  }

  @Get('message')
  @ResponseMessage('Transfer completed successfully')
  message() {
    return { amount: '1500.00' };
  }

  @Get('domain')
  domain() {
    throw new DomainException(
      'INSUFFICIENT_FUNDS',
      'Not enough balance.',
      422,
      [{ field: 'amount', issue: 'exceeds available balance' }],
    );
  }

  @Get('not-found')
  notFound() {
    throw new NotFoundException('Wallet not found');
  }

  @Get('crash')
  crash() {
    throw new Error('SELECT * FROM secret_table failed');
  }
}

describe('Response envelope (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [EnvelopeTestController],
    }).compile();

    app = moduleFixture.createNestApplication({ logger: false });
    setupApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('wraps a success with the default message and echoes the request id', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1')
      .set('x-request-id', 'test-req-0001')
      .expect(200);
    expect(res.headers['x-request-id']).toBe('test-req-0001');
    expect(res.body).toEqual({
      success: true,
      statusCode: 200,
      message: 'OK',
      data: 'Hello World!',
      meta: { requestId: 'test-req-0001' },
    });
  });

  it('uses @ResponseMessage()', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/envelope-test/message')
      .expect(200);
    expect(res.body.message).toBe('Transfer completed successfully');
    expect(res.body.data).toEqual({ amount: '1500.00' });
    expect(res.body.meta.requestId).toMatch(/^req_[0-9a-f]{24}$/);
  });

  it('turns an unknown route into a 404 envelope', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/does-not-exist')
      .expect(404);
    expect(res.body).toMatchObject({
      success: false,
      statusCode: 404,
      error: { code: 'NOT_FOUND' },
    });
    expect(res.body.meta.requestId).toBe(res.headers['x-request-id']);
  });

  it('keeps the message of a 4xx HttpException', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/envelope-test/not-found')
      .expect(404);
    expect(res.body.error).toEqual({
      code: 'NOT_FOUND',
      message: 'Wallet not found',
    });
  });

  it('maps a DomainException to its code, status and details', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/envelope-test/domain')
      .expect(422);
    expect(res.body.error).toEqual({
      code: 'INSUFFICIENT_FUNDS',
      message: 'Not enough balance.',
      details: [{ field: 'amount', issue: 'exceeds available balance' }],
    });
  });

  it('accepts a valid body', async () => {
    const body = { amount: '10.50', to: { walletId: 'w1' } };
    const res = await request(app.getHttpServer())
      .post('/v1/envelope-test/transfer')
      .send(body)
      .expect(201);
    expect(res.body).toMatchObject({
      success: true,
      statusCode: 201,
      data: body,
    });
  });

  it('returns VALIDATION_FAILED with field details, including nested and unknown fields', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/envelope-test/transfer')
      .send({ amount: 10.5, to: {}, password: 'hunter2-should-not-echo' })
      .expect(400);
    expect(res.body).toMatchObject({
      success: false,
      statusCode: 400,
      error: { code: 'VALIDATION_FAILED' },
    });
    const fields = res.body.error.details.map(
      (d: { field: string }) => d.field,
    );
    expect(fields).toEqual(
      expect.arrayContaining(['amount', 'to.walletId', 'password']),
    );
    expect(JSON.stringify(res.body)).not.toContain('hunter2');
  });

  it('GET /v1/health/live is 200 in the envelope', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/health/live')
      .expect(200);
    expect(res.body).toMatchObject({
      success: true,
      message: 'Service is live',
      data: { status: 'ok' },
    });
  });

  // Needs the dev dependencies running: `make up` (postgres, redis, openbao)
  it('GET /v1/health/ready reports database, redis and openbao up', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/health/ready')
      .expect(200);
    expect(Object.keys(res.body.data.info).sort()).toEqual([
      'database',
      'openbao',
      'redis',
    ]);
  });

  it('hides internals of unexpected errors behind a generic 500', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/envelope-test/crash')
      .expect(500);
    expect(res.body.error).toEqual({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred. Our team has been notified.',
    });
    expect(JSON.stringify(res.body)).not.toContain('secret_table');
  });
});
