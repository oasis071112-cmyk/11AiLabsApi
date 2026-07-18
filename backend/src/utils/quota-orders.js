function quotaOrderError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function grantQuotaOrder(db, orderId, operatorId = null, remark = '额度包发放到账', options = {}) {
  return db.transaction(() => {
    const order = db.prepare('SELECT * FROM quota_orders WHERE id=?').get(orderId);
    if (!order) throw quotaOrderError(404, 'ORDER_NOT_FOUND', '订单不存在');
    if (order.payment_provider_id && !options.allowOnlinePaymentOrder) throw quotaOrderError(409, 'ONLINE_ORDER_CALLBACK_REQUIRED', '在线支付订单只能由验签回调自动发放');
    if (!['pending', 'paid'].includes(order.status)) throw quotaOrderError(409, 'ORDER_ALREADY_PROCESSED', '订单已处理，请勿重复发放');
    const existingGrant = db.prepare("SELECT id FROM wallet_transactions WHERE related_order_id=? AND transaction_type='purchase'").get(orderId);
    if (existingGrant) throw quotaOrderError(409, 'ORDER_ALREADY_GRANTED', '该订单已有到账流水，请勿重复发放');
    const updated = db.prepare("UPDATE quota_orders SET status='granted',granted_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('pending','paid')").run(orderId);
    if (updated.changes !== 1) throw quotaOrderError(409, 'ORDER_ALREADY_PROCESSED', '订单状态已变化，请刷新后重试');
    const wallet = db.prepare('SELECT * FROM wallets WHERE user_id=?').get(order.user_id);
    if (!wallet) throw quotaOrderError(409, 'WALLET_NOT_FOUND', '用户钱包不存在，无法发放');
    const beforeBalance = Number(wallet.quota_balance ?? wallet.recharge_balance ?? 0);
    const afterBalance = beforeBalance + Number(order.amount);
    db.prepare('UPDATE wallets SET quota_balance=?,updated_at=CURRENT_TIMESTAMP WHERE user_id=?').run(afterBalance, order.user_id);
    db.prepare("INSERT INTO wallet_transactions (user_id,transaction_type,balance_type,amount,before_balance,after_balance,related_order_id,remark,operator_id) VALUES (?,'purchase','quota',?,?,?,?,'额度包发放到账',?)")
      .run(order.user_id, Number(order.amount), beforeBalance, afterBalance, orderId, operatorId || null);
    if (remark !== '额度包发放到账') db.prepare('UPDATE wallet_transactions SET remark=? WHERE related_order_id=? AND transaction_type=\'purchase\'').run(remark, orderId);
    return { order, beforeBalance, afterBalance };
  });
}

module.exports = { grantQuotaOrder, quotaOrderError };
