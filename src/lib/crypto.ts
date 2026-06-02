import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { getConfig } from '@/lib/config';

function key(): Buffer {
  return Buffer.from(
    hkdfSync(
      'sha256',
      getConfig().SESSION_SECRET,
      Buffer.alloc(0),
      'pteron-plugin-secret',
      32,
    ),
  );
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${iv.toString('base64')}.${tag.toString('base64')}.${ciphertext.toString('base64')}`;
}

export function decryptSecret(enc: string): string {
  const [iv, tag, ciphertext] = enc.split('.');
  if (!iv || !tag || !ciphertext) {
    throw new Error('Malformed ciphertext');
  }

  const decipher = createDecipheriv(
    'aes-256-gcm',
    key(),
    Buffer.from(iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(tag, 'base64'));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
