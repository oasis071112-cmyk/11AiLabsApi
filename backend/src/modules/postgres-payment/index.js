const crypto = require('node:crypto');
const { randomUUID } = require('node:crypto');
const { withTransaction } = require('../../infrastructure/postgres');

class PostgresPaymentError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'PostgresPaymentError';
    this.status = status;
    this.code = code;
  }
}

function asObject(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    return {};
  }
}

function supportedPaymentMethods(config) {
  const configured = asObject(config).enabled_methods;
  const values = Array.isArray(configured) ? configured : (() => {
    try { return JSON.parse(configured || '["alipay"]'); } catch (error) { return ['alipay']; }
  })();
  const methods = [...new Set(values
    .map(value => String(value).trim().toLowerCase())
    .filter(value => value === 'alipay' || value === 'wechat'))];
  return methods.length ? methods : ['alipay'];
}

function parseMoney(value, { allowZero = false } = {}) {
  const text = String(value ?? '').trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  const cents = BigInt(whole) * 100n + BigInt(`${fraction}00`.slice(0, 2));
  if (cents < 0n || (!allowZero && cents === 0n)) return null;
  return { cents, value: `${whole}.${`${fraction}00`.slice(0, 2)}` };
}

function parseStoredOrderMoney(value) {
  const text = String(value ?? '').trim();
  if (!/^\d+(?:\.\d{1,6})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  const six = `${fraction}000000`.slice(0, 6);
  if (six.slice(2) !== '0000') return null;
  return parseMoney(`${whole}.${six.slice(0, 2)}`, { allowZero: true });
}

function moneyFromConfig(value, fallback) {
  const raw = typeof value === 'object' && value !== null && !Array.isArray(value) ? value.value : value;
  return parseMoney(raw) || parseMoney(fallback);
}

function configInteger(value, fallback, { minimum = 1, maximum = 1_000_000 } = {}) {
  const raw = typeof value === 'object' && value !== null && !Array.isArray(value) ? value.value : value;
  const number = Number(raw);
  return Number.isInteger(number) && number >= minimum && number <= maximum ? number : fallback;
}

function positiveInteger(value, fallback, maximum) {
  const text = value === undefined ? String(fallback) : String(value);
  if (!/^\d+$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= maximum ? parsed : null;
}

function configBoolean(value) {
  return value === true || value === 'true' || asObject(value).value === true;
}

function firstSetting(settings, keys) {
  for (const key of keys) {
    if (settings.has(key)) return settings.get(key);
  }
  return undefined;
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

function normalizedBaseUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (!['https:', 'http:'].includes(url.protocol)) return null;
    return url.toString().replace(/\/+$/, '');
  } catch (error) {
    return null;
  }
}

function paymentTypeFor(config, paymentMethod) {
  if (!supportedPaymentMethods(config).includes(paymentMethod)) {
    throw new PostgresPaymentError(400, 'payment_method_unavailable', '当前易支付未启用该支付方式');
  }
  if (paymentMethod === 'alipay') return String(asObject(config).alipay_type || 'alipay');
  if (paymentMethod === 'wechat') return String(asObject(config).wechat_type || 'wxpay');
  throw new PostgresPaymentError(400, 'payment_method_invalid', '暂仅支持支付宝或微信支付');
}

function safeSiteUrl(value) {
  const normalized = normalizedBaseUrl(value);
  return normalized?.startsWith('https://') ? normalized : null;
}

function providerDetails(provider, paymentMethod) {
  const config = asObject(provider.config);
  const baseUrl = normalizedBaseUrl(config.api_base_url);
  const merchantId = String(config.merchant_id || '').trim();
  if (!baseUrl || !merchantId) throw new PostgresPaymentError(503, 'payment_provider_unavailable', '支付服务配置不完整');
  return { baseUrl, config, merchantId, paymentType: paymentTypeFor(config, paymentMethod) };
}

function createPostgresPaymentService({ pool, secretBox, idFactory = randomUUID, now = () => Date.now(), siteUrl } = {}) {
  if (!pool?.query || !pool?.connect) throw new TypeError('PostgreSQL payment pool.query and pool.connect are required');

  async function readSettings() {
    const { rows } = await pool.query(`SELECT config_key,config_value FROM system_config
      WHERE config_key = ANY($1::text[])`, [[
      'payment_enabled', 'payment_minimum', 'payment_maximum',
      'payment_min_amount', 'payment_max_amount', 'payment_pending_limit', 'payment_max_pending_orders',
      'payment_order_timeout_minutes', 'site_url', 'payment_site_url',
    ]]);
    return new Map(rows.map(row => [row.config_key, row.config_value]));
  }

  async function activeProvider() {
    const { rows } = await pool.query(`SELECT id,provider_code,provider_type,config,secret_envelope,status
      FROM payment_providers WHERE provider_type='easypay' AND status='active'
      ORDER BY id ASC LIMIT 1`);
    return rows[0] || null;
  }

  async function getPaymentOptions() {
    const settings = await readSettings();
    const minimum = moneyFromConfig(firstSetting(settings, ['payment_minimum', 'payment_min_amount']), '1.00');
    const maximum = moneyFromConfig(firstSetting(settings, ['payment_maximum', 'payment_max_amount']), '10000.00');
    if (!configBoolean(settings.get('payment_enabled'))) {
      return { enabled: false, methods: [], minimum: Number(minimum.value), maximum: Number(maximum.value) };
    }
    const provider = await activeProvider();
    const enabled = Boolean(provider);
    return {
      enabled,
      methods: enabled ? supportedPaymentMethods(provider.config) : [],
      minimum: Number(minimum.value),
      maximum: Number(maximum.value),
    };
  }

  function createOrderKey() {
    return `EP${String(idFactory()).replace(/[^a-zA-Z0-9]/g, '').slice(0, 24).toUpperCase()}`;
  }

  function createManualOrderKey() {
    return `QPO${String(idFactory()).replace(/[^a-zA-Z0-9]/g, '').slice(0, 24).toUpperCase()}`;
  }

  function openMerchantKey(provider) {
    if (!secretBox?.open || !provider?.secret_envelope) {
      throw new PostgresPaymentError(503, 'payment_provider_unavailable', '支付服务暂不可用');
    }
    try {
      const key = secretBox.open(provider.secret_envelope, { aad: `payment_providers:${provider.provider_code}` });
      if (!key) throw new Error('empty payment key');
      return String(key);
    } catch (error) {
      throw new PostgresPaymentError(503, 'payment_provider_unavailable', '支付服务暂不可用');
    }
  }

  function buildPaymentRequest({ provider, merchantKey, orderKey, amount, paymentMethod, configuredSiteUrl }) {
    const { baseUrl, merchantId, paymentType } = providerDetails(provider, paymentMethod);
    const fields = {
      pid: merchantId,
      type: paymentType,
      out_trade_no: orderKey,
      notify_url: `${configuredSiteUrl}/api/payment/easypay/notify`,
      return_url: `${configuredSiteUrl}/wallet?payment_order=${encodeURIComponent(orderKey)}`,
      name: 'IonAiLabs 额度充值',
      money: amount.value,
    };
    return { method: 'POST', action: `${baseUrl}/submit.php`, fields: { ...fields, sign: signEasyPay(fields, merchantKey), sign_type: 'MD5' } };
  }

  async function createPaymentOrder({ userId, amount, paymentMethod }) {
    const [settings, provider] = await Promise.all([readSettings(), activeProvider()]);
    if (!configBoolean(settings.get('payment_enabled')) || !provider) {
      throw new PostgresPaymentError(403, 'payment_disabled', '在线支付暂未开启');
    }
    const parsedAmount = parseMoney(amount);
    if (!parsedAmount) throw new PostgresPaymentError(400, 'payment_amount_invalid', '充值金额必须是正数，且最多保留两位小数');
    const minimum = moneyFromConfig(firstSetting(settings, ['payment_minimum', 'payment_min_amount']), '1.00');
    const maximum = moneyFromConfig(firstSetting(settings, ['payment_maximum', 'payment_max_amount']), '10000.00');
    if (parsedAmount.cents < minimum.cents || parsedAmount.cents > maximum.cents) {
      throw new PostgresPaymentError(400, 'payment_amount_out_of_range', `充值金额范围为 ${minimum.value} - ${maximum.value}`);
    }
    const method = String(paymentMethod || '').trim().toLowerCase();
    providerDetails(provider, method);
    const configuredSiteUrl = safeSiteUrl(siteUrl || firstSetting(settings, ['site_url', 'payment_site_url']));
    if (!configuredSiteUrl) {
      throw new PostgresPaymentError(409, 'payment_site_url_invalid', '在线支付尚未配置公开 HTTPS 地址');
    }
    const merchantKey = openMerchantKey(provider);
    const timeoutMinutes = configInteger(settings.get('payment_order_timeout_minutes'), 30, { maximum: 24 * 60 });
    const pendingLimit = configInteger(firstSetting(settings, ['payment_pending_limit', 'payment_max_pending_orders']), 3, { maximum: 100 });
    const expiresAt = new Date(now() + timeoutMinutes * 60_000);
    const orderKey = createOrderKey();
    const created = await withTransaction(pool, async client => {
      // Serialize COUNT -> INSERT for a user so concurrent order requests
      // cannot bypass the pending-order ceiling.
      await client.query('SELECT user_id FROM wallets WHERE user_id=$1 FOR UPDATE', [userId]);
      await client.query(`UPDATE quota_orders SET status='expired',updated_at=CURRENT_TIMESTAMP
        WHERE user_id=$1 AND status='pending' AND expires_at<=CURRENT_TIMESTAMP`, [userId]);
      const pending = await client.query(`SELECT COUNT(*) AS count FROM quota_orders
        WHERE user_id=$1 AND payment_provider_id=$2 AND status='pending' AND expires_at>CURRENT_TIMESTAMP`, [userId, provider.id]);
      if (Number(pending.rows[0]?.count || 0) >= pendingLimit) {
        throw new PostgresPaymentError(429, 'payment_pending_limit', '待支付订单数量已达上限，请先完成或等待已有订单过期');
      }
      const inserted = await client.query(`INSERT INTO quota_orders
        (order_key,order_no,user_id,amount,payment_provider_id,payment_method,status,expires_at)
        VALUES ($1,$2,$3,$4::numeric,$5,$6,'pending',$7) RETURNING id,order_key,amount,expires_at`, [
        orderKey, orderKey, userId, parsedAmount.value, provider.id, method, expiresAt,
      ]);
      return inserted.rows[0];
    });
    const paymentRequest = buildPaymentRequest({
      provider, merchantKey, orderKey: created.order_key, amount: parsedAmount, paymentMethod: method,
      configuredSiteUrl,
    });
    return {
      message: '支付订单已创建', order_no: created.order_key, amount: Number(parsedAmount.value),
      payment_method: method, expires_at: created.expires_at, payment_request: paymentRequest,
    };
  }

  async function getPaymentOrder({ userId, orderNo }) {
    await pool.query(`UPDATE quota_orders SET status='expired',updated_at=CURRENT_TIMESTAMP
      WHERE user_id=$1 AND status='pending' AND expires_at<=CURRENT_TIMESTAMP`, [userId]);
    const { rows } = await pool.query(`SELECT id,order_key,amount,status,expires_at,paid_at,granted_at,payment_method
      FROM quota_orders WHERE order_key=$1 AND user_id=$2`, [String(orderNo || ''), userId]);
    const order = rows[0];
    if (!order) throw new PostgresPaymentError(404, 'payment_order_not_found', '支付订单不存在');
    return {
      data: {
        order_no: order.order_key,
        amount: Number(order.amount),
        status: order.status,
        payment_method: order.payment_method || 'easypay',
        expires_at: order.expires_at || null,
        paid_at: order.paid_at || null,
        granted_at: order.granted_at || null,
      },
    };
  }

  async function createManualQuotaOrder({ userId, amount, paymentMethod = 'manual_transfer' }) {
    const parsedAmount = parseMoney(amount);
    if (!parsedAmount) throw new PostgresPaymentError(400, 'quota_amount_invalid', '点数必须是正数，且最多保留两位小数');
    const method = String(paymentMethod || 'manual_transfer').trim() || 'manual_transfer';
    const orderKey = createManualOrderKey();
    await pool.query(`INSERT INTO quota_orders (order_key,order_no,user_id,amount,payment_method,status)
      VALUES ($1,$2,$3,$4::numeric,$5,'pending')`, [orderKey, orderKey, userId, parsedAmount.value, method]);
    return {
      message: '额度包订单已创建，请转账后联系管理员确认发放',
      order_no: orderKey,
      amount: Number(parsedAmount.value),
      payment_method: method,
    };
  }

  async function listQuotaOrders({ userId, page, limit }) {
    const safePage = positiveInteger(page, 1, 1_000_000);
    const safeLimit = positiveInteger(limit, 20, 100);
    if (!safePage || !safeLimit) throw new PostgresPaymentError(400, 'quota_page_invalid', '页码或每页数量无效');
    const offset = (safePage - 1) * safeLimit;
    const [records, total] = await Promise.all([
      pool.query(`SELECT id,order_key AS order_no,user_id,amount,payment_method,status,created_at,paid_at,
        granted_at AS credited_at FROM quota_orders WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3`, [userId, safeLimit, offset]),
      pool.query('SELECT COUNT(*) AS count FROM quota_orders WHERE user_id=$1', [userId]),
    ]);
    return {
      data: records.rows.map(order => ({ ...order, amount: Number(order.amount), payment_proof: order.payment_proof || null, admin_remark: order.admin_remark || null })),
      pagination: { page: safePage, limit: safeLimit, total: Number(total.rows[0]?.count || 0) },
    };
  }

  async function processEasyPayCallback(inputFields) {
    const fields = { ...(inputFields || {}) };
    const orderKey = String(fields.out_trade_no || '').trim();
    const merchantId = String(fields.pid || '').trim();
    const paidAmount = parseMoney(fields.money);
    const tradeNo = String(fields.trade_no || '').trim();
    if (!orderKey || !merchantId || !paidAmount || !tradeNo || String(fields.trade_status || '').toUpperCase() !== 'TRADE_SUCCESS') {
      throw new PostgresPaymentError(400, 'payment_callback_invalid', '支付回调参数无效');
    }
    const result = await withTransaction(pool, async client => {
      const orderResult = await client.query(`SELECT id,order_key,user_id,amount,status,expires_at,payment_provider_id,provider_trade_no
        FROM quota_orders WHERE order_key=$1 FOR UPDATE`, [orderKey]);
      const order = orderResult.rows[0];
      if (!order) throw new PostgresPaymentError(404, 'payment_order_not_found', '支付订单不存在');
      const providerResult = await client.query(`SELECT id,provider_code,provider_type,config,secret_envelope,status
        FROM payment_providers WHERE id=$1 AND provider_type='easypay'`, [order.payment_provider_id]);
      const provider = providerResult.rows[0];
      if (!provider || String(asObject(provider.config).merchant_id || '') !== merchantId) {
        throw new PostgresPaymentError(400, 'payment_callback_invalid', '支付服务商不匹配');
      }
      const merchantKey = openMerchantKey(provider);
      if (!signaturesMatch(fields.sign, signEasyPay(fields, merchantKey))) {
        throw new PostgresPaymentError(400, 'payment_callback_invalid', '支付签名无效');
      }
      const orderAmount = parseStoredOrderMoney(order.amount);
      if (!orderAmount || orderAmount.cents !== paidAmount.cents) {
        throw new PostgresPaymentError(400, 'payment_callback_amount_mismatch', '支付金额不匹配');
      }
      if (order.status === 'granted') return { duplicate: true, orderId: order.id };
      if (order.expires_at && new Date(order.expires_at).getTime() <= now()) {
        await client.query(`UPDATE quota_orders SET status='expired',updated_at=CURRENT_TIMESTAMP
          WHERE id=$1 AND status='pending'`, [order.id]);
        return { expired: true, orderId: order.id };
      }
      if (!['pending', 'paid'].includes(order.status)) {
        throw new PostgresPaymentError(409, 'payment_order_unavailable', '支付订单状态不可处理');
      }
      if (order.provider_trade_no && order.provider_trade_no !== tradeNo) {
        throw new PostgresPaymentError(409, 'payment_trade_conflict', '支付流水号不匹配');
      }
      const existingReceipt = await client.query(`SELECT id FROM wallet_transactions
        WHERE related_order_id=$1 AND transaction_type='purchase' FOR UPDATE`, [order.id]);
      if (existingReceipt.rows[0]) {
        await client.query(`UPDATE quota_orders SET status='granted',granted_at=COALESCE(granted_at,CURRENT_TIMESTAMP),
          updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND status IN ('pending','paid')`, [order.id]);
        return { duplicate: true, orderId: order.id };
      }
      const walletResult = await client.query(`SELECT user_id,quota_balance FROM wallets WHERE user_id=$1 FOR UPDATE`, [order.user_id]);
      const wallet = walletResult.rows[0];
      if (!wallet) throw new PostgresPaymentError(409, 'wallet_not_found', '用户钱包不存在');
      const beforeValue = String(wallet.quota_balance);
      const updatedWallet = await client.query(`UPDATE wallets SET quota_balance=quota_balance+$1::numeric,
        updated_at=CURRENT_TIMESTAMP WHERE user_id=$2 RETURNING quota_balance`, [orderAmount.value, order.user_id]);
      const afterValue = String(updatedWallet.rows[0]?.quota_balance ?? '');
      if (!afterValue) throw new PostgresPaymentError(409, 'wallet_balance_invalid', '钱包余额无效');
      await client.query(`INSERT INTO wallet_transactions
        (transaction_key,user_id,transaction_type,balance_type,amount,balance_after,before_balance,after_balance,related_order_id,remark,metadata)
        VALUES ($1,$2,'purchase','quota',$3::numeric,$4::numeric,$5::numeric,$6::numeric,$7,'易支付自动到账',$8::jsonb)`, [
        `easypay:${order.id}`, order.user_id, orderAmount.value, afterValue, beforeValue, afterValue, order.id,
        JSON.stringify({ payment_provider_id: provider.id, provider_code: provider.provider_code, provider_trade_no: tradeNo }),
      ]);
      await client.query(`UPDATE quota_orders SET status='granted',paid_at=COALESCE(paid_at,CURRENT_TIMESTAMP),
        granted_at=CURRENT_TIMESTAMP,provider_trade_no=$1,paid_amount=$2::numeric,payment_channel=$3,
        updated_at=CURRENT_TIMESTAMP WHERE id=$4 AND status IN ('pending','paid') RETURNING id`, [
        tradeNo, paidAmount.value, String(fields.type || ''), order.id,
      ]);
      return { duplicate: false, orderId: order.id };
    });
    if (result?.expired) {
      throw new PostgresPaymentError(409, 'payment_order_expired', '支付订单已过期');
    }
    return result;
  }

  return {
    createManualQuotaOrder,
    createPaymentOrder,
    getPaymentOptions,
    getPaymentOrder,
    listQuotaOrders,
    processEasyPayCallback,
  };
}

module.exports = {
  PostgresPaymentError,
  createPostgresPaymentService,
  parseMoney,
  parseStoredOrderMoney,
  positiveInteger,
  signaturesMatch,
  signEasyPay,
  supportedPaymentMethods,
};
