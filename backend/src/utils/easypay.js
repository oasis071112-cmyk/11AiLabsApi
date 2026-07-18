const crypto = require('crypto');
const { decrypt } = require('./crypto');

function normalizedBaseUrl(value) {
  const url = new URL(String(value || '').trim());
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('易支付 API 地址必须使用 HTTP 或 HTTPS');
  return url.toString().replace(/\/+$/, '');
}

function signedFields(fields) {
  return Object.entries(fields)
    .filter(([name, value]) => name !== 'sign' && name !== 'sign_type' && value !== undefined && value !== null && value !== '')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}=${value}`)
    .join('&');
}

function signEasyPay(fields, merchantKey) {
  return crypto.createHash('md5').update(`${signedFields(fields)}${merchantKey}`, 'utf8').digest('hex');
}

function signaturesMatch(actual, expected) {
  if (!actual || !expected || String(actual).length !== String(expected).length) return false;
  return crypto.timingSafeEqual(Buffer.from(String(actual).toLowerCase()), Buffer.from(String(expected).toLowerCase()));
}

function paymentTypeFor(provider, paymentMethod) {
  if (paymentMethod === 'alipay') return provider.alipay_type || 'alipay';
  if (paymentMethod === 'wechat') return provider.wechat_type || 'wxpay';
  throw new Error('暂仅支持支付宝或微信支付');
}

function buildEasyPayRequest({ provider, orderNo, amount, paymentMethod, siteUrl, productName = '11AiLabs 额度充值' }) {
  const merchantKey = decrypt(provider.merchant_key_encrypted);
  const baseUrl = normalizedBaseUrl(provider.api_base_url);
  const fields = {
    pid: provider.merchant_id,
    type: paymentTypeFor(provider, paymentMethod),
    out_trade_no: orderNo,
    notify_url: `${siteUrl}/api/payment/easypay/notify`,
    return_url: `${siteUrl}/wallet?payment_order=${encodeURIComponent(orderNo)}`,
    name: productName,
    money: Number(amount).toFixed(2),
  };
  return {
    method: 'POST', action: `${baseUrl}/submit.php`,
    fields: { ...fields, sign: signEasyPay(fields, merchantKey), sign_type: 'MD5' },
  };
}

function verifyEasyPayCallback(provider, fields) {
  const merchantKey = decrypt(provider.merchant_key_encrypted);
  return signaturesMatch(fields.sign, signEasyPay(fields, merchantKey));
}

module.exports = { buildEasyPayRequest, normalizedBaseUrl, signEasyPay, verifyEasyPayCallback };
