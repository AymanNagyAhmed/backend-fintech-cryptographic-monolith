import { PrivacyService } from './privacy.service.js';

describe('PrivacyService', () => {
  it('hashes ciphertext stably', () => {
    expect(PrivacyService.hashCiphertext('vault:v1:x')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('stores encrypted field and returns ciphertextHash', async () => {
    const keys = {
      encrypt: vi.fn().mockResolvedValue('vault:v1:ct'),
    };
    const prisma = {
      subjectPii: { upsert: vi.fn().mockResolvedValue({}) },
    };
    const svc = new PrivacyService(prisma as never, keys as never);
    const out = await svc.storeField(
      '11111111-1111-1111-1111-111111111111',
      'email',
      'a@b.co',
    );
    expect(out.ciphertext).toBe('vault:v1:ct');
    expect(out.ciphertextHash).toBe(
      PrivacyService.hashCiphertext('vault:v1:ct'),
    );
  });
});
