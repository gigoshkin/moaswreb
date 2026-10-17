import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM for data at rest. The key comes from TRIPS_KEY (32 bytes,
 * base64) in the server environment, never from the database or the repo.
 * Stored format: base64(iv | tag | ciphertext).
 */
export class Sealer {
  private readonly key: Buffer;

  constructor(base64Key: string) {
    const key = Buffer.from(base64Key, 'base64');
    if (key.length !== 32) throw new Error('TRIPS_KEY must be 32 bytes, base64 (openssl rand -base64 32)');
    this.key = key;
  }

  seal(value: unknown): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
  }

  open<T>(sealed: string): T {
    const buf = Buffer.from(sealed, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', this.key, buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8')) as T;
  }
}

/**
 * The database stores a hash of the device id, never the id itself, so a
 * leaked database can't be used to act as a device.
 */
export const deviceHash = (deviceId: string): string => createHash('sha256').update(deviceId).digest('hex');
