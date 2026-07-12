import { describe, it, expect, beforeAll } from 'vitest';
import { initDatabase, getDatabase } from '../src/database/init.js';

process.env.DB_PATH = './data/test-proxy.db';

// 直接测试 deductBalance 逻辑
function deductBalance(db, userId, amount) {
  const wallet = db.prepare('SELECT * FROM wallets WHERE user_id=?').get(userId);
  if (!wallet) throw new Error('钱包不存在');
  const qb = wallet.quota_balance || wallet.recharge_balance || 0;
  const gq = wallet.gift_quota || wallet.gift_balance || 0;
  const available = qb + gq - (wallet.frozen_balance || 0);
  if (available < amount) throw new Error('额度不足');
  let remaining = amount;
  if (gq > 0) {
    const dg = Math.min(gq, remaining);
    db.prepare('UPDATE wallets SET gift_quota=COALESCE(gift_quota,gift_balance,0)-?, updated_at=CURRENT_TIMESTAMP WHERE user_id=?').run(dg, userId);
    remaining -= dg;
  }
  if (remaining > 0) {
    db.prepare('UPDATE wallets SET quota_balance=COALESCE(quota_balance,recharge_balance,0)-?, total_spent=total_spent+?, updated_at=CURRENT_TIMESTAMP WHERE user_id=?').run(remaining, remaining, userId);
  }
}

describe('扣费模块', () => {
  let userId;
  beforeAll(async () => {
    await initDatabase();
    const db = getDatabase();
    const exists = db.prepare("SELECT id FROM users WHERE username='billtest'").get();
    if (!exists) {
      db.prepare("INSERT INTO users (username,password_hash,role,status) VALUES (?,?,?,?)")
        .run('billtest', '$2a$10$dummy', 'user', 'active');
    }
    const user = db.prepare("SELECT id FROM users WHERE username='billtest'").get();
    userId = user.id;
    if (!db.prepare('SELECT id FROM wallets WHERE user_id=?').get(userId)) {
      db.prepare('INSERT INTO wallets (user_id,quota_balance,gift_quota) VALUES (?,0,0)').run(userId);
    }
  });

  it('应优先扣赠送额度再扣充值额度', () => {
    const db = getDatabase();
    db.prepare('UPDATE wallets SET quota_balance=100, gift_quota=50, frozen_balance=0 WHERE user_id=?').run(userId);
    deductBalance(db, userId, 80);
    const wallet = db.prepare('SELECT * FROM wallets WHERE user_id=?').get(userId);
    expect(wallet.gift_quota).toBe(0);      // 50 赠送全扣
    expect(wallet.quota_balance).toBe(70);   // 剩余 30 从充值扣
  });

  it('额度不足应抛出异常', () => {
    const db = getDatabase();
    db.prepare('UPDATE wallets SET quota_balance=5, gift_quota=0, frozen_balance=0 WHERE user_id=?').run(userId);
    expect(() => deductBalance(db, userId, 100)).toThrow('额度不足');
  });

  it('赠送额度足够时不应扣充值额度', () => {
    const db = getDatabase();
    db.prepare('UPDATE wallets SET quota_balance=100, gift_quota=60, frozen_balance=0 WHERE user_id=?').run(userId);
    deductBalance(db, userId, 40);
    const wallet = db.prepare('SELECT * FROM wallets WHERE user_id=?').get(userId);
    expect(wallet.gift_quota).toBe(20);      // 只扣了40
    expect(wallet.quota_balance).toBe(100);  // 充值未动
  });

  it('扣费后累计消费应增加', () => {
    const db = getDatabase();
    db.prepare('UPDATE wallets SET quota_balance=50, gift_quota=0, frozen_balance=0, total_spent=0 WHERE user_id=?').run(userId);
    deductBalance(db, userId, 30);
    const wallet = db.prepare('SELECT * FROM wallets WHERE user_id=?').get(userId);
    expect(wallet.quota_balance).toBe(20);
    expect(wallet.total_spent).toBe(30);
  });
});
