const express = require('express');
const router = express.Router();
const { getDatabase } = require('../database/init');
const { verifyEasyPayCallback } = require('../utils/easypay');
const { grantQuotaOrder } = require('../utils/quota-orders');

function fail(res, status, message) {
  return res.status(status).type('text/plain').send(message || 'fail');
}

router.post('/easypay/notify', (req, res) => {
  const fields = req.body || {};
  const orderNo = String(fields.out_trade_no || '');
  const merchantId = String(fields.pid || '');
  const paidAmount = Number(fields.money);
  if (!orderNo || !merchantId || !Number.isFinite(paidAmount) || paidAmount <= 0) return fail(res, 400);
  if (String(fields.trade_status || '').toUpperCase() !== 'TRADE_SUCCESS') return fail(res, 400);

  const db = getDatabase();
  const order = db.prepare('SELECT * FROM quota_orders WHERE order_no=?').get(orderNo);
  if (!order) return fail(res, 404);
  const provider = db.prepare("SELECT * FROM payment_providers WHERE id=? AND provider_type='easypay' AND merchant_id=?")
    .get(order.payment_provider_id, merchantId);
  if (!provider) return fail(res, 400);
  try {
    if (!verifyEasyPayCallback(provider, fields)) return fail(res, 400);
  } catch (error) { return fail(res, 400); }
  if (Math.abs(Number(order.amount) - paidAmount) > 0.000001) return fail(res, 400);

  // 重复通知是易支付的正常行为；同一笔已发放订单统一返回 success，绝不重复入账。
  if (order.status === 'granted') return res.type('text/plain').send('success');
  if (order.status !== 'pending' && order.status !== 'paid') return fail(res, 409);
  const providerTradeNo = String(fields.trade_no || '');
  if (!providerTradeNo) return fail(res, 400);

  try {
    db.transaction(() => {
      const updated = db.prepare("UPDATE quota_orders SET status='paid',paid_at=CURRENT_TIMESTAMP,provider_trade_no=?,paid_amount=?,payment_channel=? WHERE id=? AND status='pending'")
        .run(providerTradeNo, paidAmount, String(fields.type || ''), order.id);
      if (updated.changes !== 1) {
        const current = db.prepare('SELECT status,provider_trade_no FROM quota_orders WHERE id=?').get(order.id);
        if (current?.status === 'granted' && current.provider_trade_no === providerTradeNo) return;
        throw new Error('订单状态已变化');
      }
      grantQuotaOrder(db, order.id, null, '易支付自动到账');
    });
    return res.type('text/plain').send('success');
  } catch (error) {
    const current = db.prepare('SELECT status,provider_trade_no FROM quota_orders WHERE id=?').get(order.id);
    if (current?.status === 'granted' && current.provider_trade_no === providerTradeNo) return res.type('text/plain').send('success');
    return fail(res, 409);
  }
});

module.exports = router;
