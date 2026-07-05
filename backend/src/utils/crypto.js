const crypto = require('crypto');

const ALGORITHM = 'aes-256-cbc';

function getKey() {
  const secret = process.env.ENCRYPTION_SECRET || 'ai-proxy-default-aes-key-2026!';
  return crypto.createHash('sha256').update(secret).digest();
}

function encrypt(text) {
  const key = getKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decrypt(encryptedText) {
  const key = getKey();
  const parts = encryptedText.split(':');
  if (parts.length !== 2) throw new Error('Invalid encrypted text format');
  const iv = Buffer.from(parts[0], 'hex');
  const encrypted = parts[1];
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

function desensitize(keyRaw) {
  // sk-xxxxxxxxxxxx  →  sk-xxx****xxxx (前缀3位+后4位)
  if (!keyRaw || keyRaw.length < 11) return keyRaw;
  const prefix = keyRaw.substring(0, 6);          // "sk-XXX"
  const suffix = keyRaw.substring(keyRaw.length - 4);
  return prefix + '****' + suffix;
}

module.exports = { encrypt, decrypt, desensitize };