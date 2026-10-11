import { Controller, Get, INestApplication, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { setupApp } from './../src/app.setup.js';
import { ResponseMessage } from './../src/common/decorators/response-message.decorator.js';
import { DomainException } from './../src/common/exceptions/domain.exception.js';

@Controller('envelope-test')
class EnvelopeTestController {
  @Get('message')
  @ResponseMessage('Transfer completed successfully')
  message() {
    return { amount: '1500.00' };
  }

  @Get('domain')
  domain() {
    throw new DomainException('INSUFFICIENT_FUNDS', 'Not enough balance.', 422, [
      { field: 'amount', issue: 'exceeds available balance' },
    ]);
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
    const res = await request(app.getHttpServer()).get('/v1').set('x-request-id', 'test-req-0001').expect(200);
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
    const res = await request(app.getHttpServer()).get('/v1/envelope-test/message').expect(200);
    expect(res.body.message).toBe('Transfer completed successfully');
    expect(res.body.data).toEqual({ amount: '1500.00' });
    expect(res.body.meta.requestId).toMatch(/^req_[0-9a-f]{24}$/);
  });

  it('turns an unknown route into a 404 envelope', async () => {
    const res = await request(app.getHttpServer()).get('/v1/does-not-exist').expect(404);
    expect(res.body).toMatchObject({ success: false, statusCode: 404, error: { code: 'NOT_FOUND' } });
    expect(res.body.meta.requestId).toBe(res.headers['x-request-id']);
  });

  it('keeps the message of a 4xx HttpException', async () => {
    const res = await request(app.getHttpServer()).get('/v1/envelope-test/not-found').expect(404);
    expect(res.body.error).toEqual({ code: 'NOT_FOUND', message: 'Wallet not found' });
  });

  it('maps a DomainException to its code, status and details', async () => {
    const res = await request(app.getHttpServer()).get('/v1/envelope-test/domain').expect(422);
    expect(res.body.error).toEqual({
      code: 'INSUFFICIENT_FUNDS',
      message: 'Not enough balance.',
      details: [{ field: 'amount', issue: 'exceeds available balance' }],
    });
  });

  it('hides internals of unexpected errors behind a generic 500', async () => {
    const res = await request(app.getHttpServer()).get('/v1/envelope-test/crash').expect(500);
    expect(res.body.error).toEqual({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred. Our team has been notified.',
    });
    expect(JSON.stringify(res.body)).not.toContain('secret_table');
  });
});
