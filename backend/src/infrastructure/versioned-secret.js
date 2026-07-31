const crypto = require('node:crypto');

const ALGORITHM = 'aes-256-gcm';
const NONCE_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const VERSION_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

class SecretIntegrityError extends Error {
  constructor(message = '密钥认证失败') {
    super(message);
    this.name = 'SecretIntegrityError';
  }
}

function base64Url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

function fromBase64Url(value, field) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new SecretIntegrityError(`无效的密钥封装 ${field}`);
  }
  return Buffer.from(value, 'base64url');
}

function normalizeKey(key, version) {
  const normalized = Buffer.isBuffer(key)
    ? Buffer.from(key)
    : typeof key === 'string'
      ? Buffer.from(key, 'base64url')
      : null;
  if (!normalized || normalized.length !== 32) {
    throw new Error(`密钥版本 ${version} 必须是 32 字节 AES-256 密钥`);
  }
  return normalized;
}

function normalizeKeyring(keys) {
  if (!keys || typeof keys !== 'object' || Array.isArray(keys)) {
    throw new Error('必须提供版本化密钥环');
  }
  return new Map(Object.entries(keys).map(([version, key]) => {
    if (!VERSION_PATTERN.test(version)) throw new Error(`无效的密钥版本 ${version}`);
    return [version, normalizeKey(key, version)];
  }));
}

function aadBuffer(aad) {
  return Buffer.from(String(aad || ''), 'utf8');
}

function parseEnvelope(envelope) {
  const parts = String(envelope || '').split('.');
  if (parts.length !== 4 || !VERSION_PATTERN.test(parts[0])) {
    throw new SecretIntegrityError('无效的密钥封装');
  }
  const [, nonceValue, tagValue, ciphertextValue] = parts;
  const nonce = fromBase64Url(nonceValue, 'nonce');
  const tag = fromBase64Url(tagValue, 'tag');
  const ciphertext = fromBase64Url(ciphertextValue, 'ciphertext');
  if (nonce.length !== NONCE_BYTES || tag.length !== AUTH_TAG_BYTES) {
    throw new SecretIntegrityError('无效的密钥封装长度');
  }
  return { version: parts[0], nonce, tag, ciphertext };
}

function createSecretBox({ activeVersion, keys }) {
  if (!VERSION_PATTERN.test(String(activeVersion || ''))) {
    throw new Error('必须指定有效的活动密钥版本');
  }
  const keyring = normalizeKeyring(keys);
  if (!keyring.has(activeVersion)) throw new Error(`活动密钥版本 ${activeVersion} 不在密钥环中`);

  return Object.freeze({
    activeVersion,
    seal(plaintext, { aad = '' } = {}) {
      const nonce = crypto.randomBytes(NONCE_BYTES);
      const cipher = crypto.createCipheriv(ALGORITHM, keyring.get(activeVersion), nonce);
      cipher.setAAD(aadBuffer(aad));
      const ciphertext = Buffer.concat([cipher.update(Buffer.from(String(plaintext), 'utf8')), cipher.final()]);
      return [activeVersion, base64Url(nonce), base64Url(cipher.getAuthTag()), base64Url(ciphertext)].join('.');
    },
    open(envelope, { aad = '' } = {}) {
      const { version, nonce, tag, ciphertext } = parseEnvelope(envelope);
      const key = keyring.get(version);
      if (!key) throw new SecretIntegrityError(`缺少密钥版本 ${version}`);
      try {
        const decipher = crypto.createDecipheriv(ALGORITHM, key, nonce);
        decipher.setAAD(aadBuffer(aad));
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
      } catch (error) {
        throw new SecretIntegrityError();
      }
    },
  });
}

module.exports = {
  AUTH_TAG_BYTES,
  NONCE_BYTES,
  SecretIntegrityError,
  createSecretBox,
};
