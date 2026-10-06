import { Injectable } from '@nestjs/common';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const KEY_LENGTH = 64;
const HASH_PREFIX = 'scrypt';

@Injectable()
export class PasswordService {
  async hash(password: string) {
    const salt = randomBytes(16);
    const derivedKey = await this.derive(password, salt, KEY_LENGTH);
    return `${HASH_PREFIX}:${salt.toString('base64url')}:${derivedKey.toString('base64url')}`;
  }

  async verify(password: string, encodedHash?: string) {
    if (!encodedHash) return false;
    if (/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(encodedHash)) {
      const [salt, key] = encodedHash.split(':');
      try {
        const actual = await new Promise<Buffer>((resolve, reject) =>
          scrypt(
            password,
            salt,
            KEY_LENGTH,
            { N: 131072, r: 8, p: 1, maxmem: 160 * 1024 * 1024 },
            (error, result) => (error ? reject(error) : resolve(result))
          )
        );
        return timingSafeEqual(actual, Buffer.from(key, 'hex'));
      } catch {
        return false;
      }
    }
    const [prefix, encodedSalt, encodedKey, ...extra] = encodedHash.split(':');
    if (prefix !== HASH_PREFIX || !encodedSalt || !encodedKey || extra.length) {
      return false;
    }

    try {
      const salt = Buffer.from(encodedSalt, 'base64url');
      const expectedKey = Buffer.from(encodedKey, 'base64url');
      if (!salt.length || expectedKey.length !== KEY_LENGTH) return false;
      const actualKey = await this.derive(password, salt, expectedKey.length);
      return timingSafeEqual(actualKey, expectedKey);
    } catch {
      return false;
    }
  }

  private derive(password: string, salt: Buffer, keyLength: number) {
    return new Promise<Buffer>((resolve, reject) => {
      scrypt(password, salt, keyLength, (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey);
      });
    });
  }
}
