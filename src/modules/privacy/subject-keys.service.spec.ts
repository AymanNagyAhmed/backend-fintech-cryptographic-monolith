import { SubjectKeysService } from './subject-keys.service.js';

describe('SubjectKeysService', () => {
  const userId = '11111111-1111-1111-1111-111111111111';
  const config = {
    get: (k: string) =>
      ({ BAO_ADDR: 'http://bao:8200', BAO_TOKEN: 't'.repeat(32) })[k],
  };

  it('names keys as subject-<uuid>', () => {
    const svc = new SubjectKeysService(config as never);
    expect(svc.keyName(userId)).toBe(`subject-${userId}`);
  });

  it('encrypts via transit/encrypt after ensuring the key', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => 'not found',
      }) // readKey miss
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) }) // create
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) }) // allowDeletion
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { ciphertext: 'vault:v1:abc' } }),
      });
    const svc = new SubjectKeysService(config as never);
    svc.useFetch(fetchFn as never);
    await expect(svc.encrypt(userId, 'alice@example.com')).resolves.toBe(
      'vault:v1:abc',
    );
  });

  it('returns null from decrypt when the key is gone', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'encryption key not found',
    });
    const svc = new SubjectKeysService(config as never);
    svc.useFetch(fetchFn as never);
    await expect(svc.decrypt(userId, 'vault:v1:x')).resolves.toBeNull();
  });
});
