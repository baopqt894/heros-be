import { PasswordService } from './password.service';
import { scrypt } from 'node:crypto';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('preserves login for imported website hashes with the original scrypt cost', async () => {
    const salt = 'a'.repeat(32);
    const key = await new Promise<Buffer>((resolve, reject) =>
      scrypt(
        'Website@Test123',
        salt,
        64,
        { N: 131072, r: 8, p: 1, maxmem: 160 * 1024 * 1024 },
        (error, result) => (error ? reject(error) : resolve(result))
      )
    );
    const encoded = `${salt}:${key.toString('hex')}`;
    expect(await service.verify('Website@Test123', encoded)).toBe(true);
    expect(await service.verify('wrong-password', encoded)).toBe(false);
  });

  it('hashes and verifies a password', async () => {
    const hash = await service.hash('Heros@Test123');

    expect(hash).not.toContain('Heros@Test123');
    await expect(service.verify('Heros@Test123', hash)).resolves.toBe(true);
    await expect(service.verify('wrong-password', hash)).resolves.toBe(false);
  });

  it('uses a different salt for every hash', async () => {
    const first = await service.hash('Heros@Test123');
    const second = await service.hash('Heros@Test123');

    expect(first).not.toBe(second);
  });

  it('rejects absent or malformed hashes', async () => {
    await expect(service.verify('Heros@Test123')).resolves.toBe(false);
    await expect(service.verify('Heros@Test123', 'invalid')).resolves.toBe(
      false
    );
  });
});
