import { deviceActivationHash, generateDeviceActivationCode, normalizeDeviceActivationCode } from './device-activation-code';

describe('Device activation codes', () => {
  it('generates human-readable codes with 100 bits of randomness', () => {
    const codes = Array.from({ length: 100 }, generateDeviceActivationCode);
    expect(new Set(codes).size).toBe(100);
    for (const code of codes) {
      expect(code).toMatch(/^HRS(?:-[0-9A-HJKMNP-TV-Z]{4}){5}$/);
      const normalized = normalizeDeviceActivationCode(code);
      expect(normalized).toHaveLength(23);
      expect(normalizeDeviceActivationCode(code.toLowerCase().replace(/-/g, ' '))).toBe(normalized);
      expect(deviceActivationHash(normalized)).toHaveLength(64);
    }
  });
  it('rejects serial numbers, device tokens and malformed codes', () => {
    for (const code of ['HEROS-TEST-001', 'hdv_secret', 'HRS-XXXX', 'HRS-OOOO-OOOO-OOOO-OOOO-OOOO']) {
      expect(normalizeDeviceActivationCode(code)).toBeNull();
    }
  });
});
