#!/usr/bin/env node
const { randomUUID } = require('node:crypto');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { createPostgresPool, withTransaction } = require('../src/infrastructure/postgres');

const RELEASE_OVERRIDE_PROFILE = 'gpt-image-2-tiered-031-v1';
const APPLY_CONFIRMATION = 'apply-gpt-image-2-tiered-031';

function releaseOverridePlan() {
  return {
    profile: RELEASE_OVERRIDE_PROFILE,
    accountKey: 'Uozi-openai',
    modelCode: 'gpt-image-2',
    requiredCapabilities: ['image_edits'],
    supportsImageInput: true,
    currency: 'USD',
    imagePricesUsd: { '1K': 0.031, '2K': 0.0465, '4K': 0.062 },
  };
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function readTarget(client, plan, { lock = false } = {}) {
  const { rows } = await client.query(`SELECT ua.account_key,ua.capabilities,
      am.supports_image_input,
      jsonb_build_object('1K',am.configuration->'image_price_1k','2K',am.configuration->'image_price_2k',
        '4K',am.configuration->'image_price_4k') AS mapping_image_prices,
      m.official_currency,
      COALESCE(m.metadata->'official_image_prices','{}'::jsonb) AS official_image_prices
    FROM upstream_accounts ua
    JOIN account_models am ON am.account_id=ua.id AND am.model_code=$2
    JOIN models m ON m.model_code=am.model_code
    WHERE ua.account_key=$1${lock ? ' FOR UPDATE OF ua,am,m' : ''}`, [plan.accountKey, plan.modelCode]);
  if (rows.length !== 1) {
    throw new Error(`发布覆盖目标必须唯一存在: ${plan.accountKey}/${plan.modelCode}`);
  }
  return rows[0];
}

function assertVerified(row, plan, expectedCapabilities) {
  if (!sameJson(row.capabilities, expectedCapabilities)) throw new Error('发布覆盖核对失败: capabilities');
  if (row.supports_image_input !== true) throw new Error('发布覆盖核对失败: supports_image_input');
  for (const tier of Object.keys(plan.imagePricesUsd)) {
    if (row.mapping_image_prices?.[tier] !== null && row.mapping_image_prices?.[tier] !== undefined) {
      throw new Error(`发布覆盖核对失败: account_models.image_price_${tier.toLowerCase()} 应保持未覆盖`);
    }
  }
  if (String(row.official_currency || '').toUpperCase() !== 'USD') throw new Error('发布覆盖核对失败: official_currency');
  if (!sameJson(row.official_image_prices, plan.imagePricesUsd)) throw new Error('发布覆盖核对失败: official_image_prices');
}

async function applyReleaseControlPlaneOverrides(client, { actor = 'production-release' } = {}) {
  const plan = releaseOverridePlan();
  const before = await readTarget(client, plan, { lock: true });
  const expectedCapabilities = [...new Set([
    ...(Array.isArray(before.capabilities) ? before.capabilities : []),
    ...plan.requiredCapabilities,
  ])];
  const capabilities = JSON.stringify(expectedCapabilities);
  const imagePrices = JSON.stringify(plan.imagePricesUsd);

  const accountUpdate = await client.query(`UPDATE upstream_accounts
    SET capabilities=$2::jsonb,updated_at=CURRENT_TIMESTAMP
    WHERE account_key=$1`, [plan.accountKey, capabilities]);
  const mappingUpdate = await client.query(`UPDATE account_models am
    SET supports_image_input=TRUE,
      configuration=((COALESCE(am.configuration,'{}'::jsonb) - 'image_price_1k')
        - 'image_price_2k') - 'image_price_4k'
    FROM upstream_accounts ua
    WHERE am.account_id=ua.id AND ua.account_key=$1 AND am.model_code=$2`, [plan.accountKey, plan.modelCode]);
  const modelUpdate = await client.query(`UPDATE models
    SET official_currency='USD',
      metadata=jsonb_set(jsonb_set(metadata,'{official_currency}','"USD"'::jsonb,TRUE),
        '{official_image_prices}',$2::jsonb,TRUE),
      updated_at=CURRENT_TIMESTAMP
    WHERE model_code=$1`, [plan.modelCode, imagePrices]);
  for (const [label, result] of [['account', accountUpdate], ['mapping', mappingUpdate], ['model', modelUpdate]]) {
    if (result.rowCount !== 1) throw new Error(`发布覆盖写入失败: ${label}`);
  }

  const after = await readTarget(client, plan);
  assertVerified(after, plan, expectedCapabilities);
  await client.query(`INSERT INTO audit_logs (audit_key,action,payload)
    VALUES ($1,$2,$3::jsonb)`, [
    randomUUID(),
    'release_control_plane_override',
    JSON.stringify({ profile: RELEASE_OVERRIDE_PROFILE, actor, before, after }),
  ]);
  return { profile: RELEASE_OVERRIDE_PROFILE, verified: true, before, after };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const plan = releaseOverridePlan();
  if (!apply) {
    console.log(JSON.stringify({ dryRun: true, ...plan }, null, 2));
    return;
  }
  if (process.env.RELEASE_CONTROL_PLANE_OVERRIDE_CONFIRM !== APPLY_CONFIRMATION) {
    throw new Error(`拒绝执行发布覆盖：请设置 RELEASE_CONTROL_PLANE_OVERRIDE_CONFIRM=${APPLY_CONFIRMATION}`);
  }
  const pool = createPostgresPool();
  try {
    const result = await withTransaction(pool, client => applyReleaseControlPlaneOverrides(client, {
      actor: process.env.INFRA_IMPORT_ACTOR || 'production-release',
    }));
    console.log(JSON.stringify({ dryRun: false, ...result }, null, 2));
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(`发布控制面覆盖失败: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  APPLY_CONFIRMATION,
  RELEASE_OVERRIDE_PROFILE,
  applyReleaseControlPlaneOverrides,
  assertVerified,
  releaseOverridePlan,
};
