import type { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import type { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { TotpService } from '../auth/totp/totp.service.js';
import type { OutboxService } from '../outbox/outbox.service.js';
import { BeneficiariesService, isActive } from './beneficiaries.service.js';

const owner = '0199c1a0-0000-7000-8000-000000000001';
const id = '0199c1a0-0000-7000-8000-0000000000b1';

const pending = {
  id,
  ownerUserId: owner,
  label: 'Cold',
  currency: 'BTC',
  address: 'bc1qtest',
  network: 'bitcoin',
  status: 'pending_confirmation',
  confirmedAt: null,
  activeAt: null,
  revokedAt: null,
  createdAt: new Date('2026-10-16T10:00:00Z'),
};

describe('isActive', () => {
  it('is false until activeAt and confirmed', () => {
    expect(isActive(pending)).toBe(false);
    expect(
      isActive(
        {
          ...pending,
          status: 'confirmed',
          activeAt: new Date('2026-10-17T10:00:00Z'),
        },
        new Date('2026-10-16T12:00:00Z'),
      ),
    ).toBe(false);
  });

  it('is true after delay', () => {
    expect(
      isActive(
        {
          status: 'confirmed',
          activeAt: new Date('2026-10-16T10:00:00Z'),
          revokedAt: null,
        },
        new Date('2026-10-17T10:00:00Z'),
      ),
    ).toBe(true);
  });
});

describe('BeneficiariesService', () => {
  let beneficiary: Record<string, ReturnType<typeof vi.fn>>;
  let withTx: ReturnType<typeof vi.fn>;
  let totp: {
    isEnabled: ReturnType<typeof vi.fn>;
    verify: ReturnType<typeof vi.fn>;
  };
  let outbox: { enqueue: ReturnType<typeof vi.fn> };
  let service: BeneficiariesService;

  beforeEach(() => {
    beneficiary = {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    };
    withTx = vi.fn((fn: (t: unknown) => unknown) => fn({ beneficiary }));
    totp = { isEnabled: vi.fn(), verify: vi.fn() };
    outbox = { enqueue: vi.fn().mockResolvedValue('ob1') };
    const config = {
      get: vi.fn().mockReturnValue(24),
    };
    service = new BeneficiariesService(
      { beneficiary, withTx } as unknown as PrismaService,
      totp as unknown as TotpService,
      outbox as unknown as OutboxService,
      config as unknown as ConfigService<EnvironmentVariables, true>,
    );
  });

  it('creates a pending beneficiary', async () => {
    beneficiary.create.mockResolvedValue(pending);
    const dto = await service.create(owner, {
      label: ' Cold ',
      currency: 'BTC',
      address: ' bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh ',
      network: 'Bitcoin',
    });
    expect(dto.status).toBe('pending_confirmation');
    expect(dto.active).toBe(false);
    expect(beneficiary.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        label: 'Cold',
        address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
        network: 'bitcoin',
        status: 'pending_confirmation',
      }),
    });
  });

  it('stores a valid base58 address and a bank reference', async () => {
    beneficiary.create.mockResolvedValue(pending);
    await service.create(owner, {
      label: 'Genesis',
      currency: 'BTC',
      address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
      network: 'bitcoin',
    });
    await service.create(owner, {
      label: 'Bank',
      currency: 'AED',
      address: 'AE070331234567890123456',
      network: 'bank_aed',
    });
    expect(beneficiary.create).toHaveBeenCalledTimes(2);
  });

  it('rejects a bad checksum and does not store the row', async () => {
    await expect(
      service.create(owner, {
        label: 'Cold',
        currency: 'BTC',
        address: 'bc1qyx2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
        network: 'bitcoin',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ADDRESS', statusCode: 422 });
    await expect(
      service.create(owner, {
        label: 'Cold',
        currency: 'BTC',
        address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNb',
        network: 'bitcoin',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ADDRESS', statusCode: 422 });
    expect(beneficiary.create).not.toHaveBeenCalled();
  });

  it('rejects duplicate address', async () => {
    beneficiary.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    await expect(
      service.create(owner, {
        label: 'x',
        currency: 'BTC',
        address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
        network: 'bitcoin',
      }),
    ).rejects.toMatchObject({ code: 'BENEFICIARY_DUPLICATE' });
  });

  it('confirms with TOTP and sets activeAt = now + delay', async () => {
    totp.isEnabled.mockResolvedValue(true);
    totp.verify.mockResolvedValue(true);
    beneficiary.findFirst.mockResolvedValue(pending);
    const confirmedAt = new Date('2026-10-16T12:00:00Z');
    vi.setSystemTime(confirmedAt);
    beneficiary.update.mockResolvedValue({
      ...pending,
      status: 'confirmed',
      confirmedAt,
      activeAt: new Date('2026-10-17T12:00:00Z'),
    });

    const dto = await service.confirm(owner, id, '123456');
    expect(dto.status).toBe('confirmed');
    expect(dto.activeAt).toBe('2026-10-17T12:00:00.000Z');
    expect(outbox.enqueue).toHaveBeenCalledWith(
      expect.anything(),
      'withdrawals',
      expect.objectContaining({
        type: 'beneficiary.confirmed',
        beneficiaryId: id,
      }),
    );
    vi.useRealTimers();
  });

  it('requires enabled TOTP', async () => {
    totp.isEnabled.mockResolvedValue(false);
    await expect(service.confirm(owner, id, '123456')).rejects.toMatchObject({
      code: 'TOTP_REQUIRED',
    });
  });

  it('rejects wrong TOTP', async () => {
    totp.isEnabled.mockResolvedValue(true);
    totp.verify.mockResolvedValue(false);
    await expect(service.confirm(owner, id, '000000')).rejects.toMatchObject({
      code: 'INVALID_TOTP',
    });
  });
});
