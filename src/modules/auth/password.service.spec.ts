import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const service = new PasswordService();

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
