/**
 * 更新模型数据 — 只保留 openai / deepseek / anthropic 三个渠道的最新模型
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { initDatabase, getDatabase, saveDatabase } = require('./init');

const MODELS = [
  // ==================== OpenAI ====================
  { mc:'o4',               mn:'o4',                um:'o4',               mt:'llm',      cl:200000, im:1, d:'OpenAI 最强推理模型',                bip:0.01,   bop:0.04,  di:1.2, dx:1.2, bi:1.2, bx:1.2, ch:'openai' },
  { mc:'o4-mini',          mn:'o4-mini',            um:'o4-mini',          mt:'llm',      cl:200000, im:1, d:'OpenAI 轻量推理模型',                bip:0.0011, bop:0.0044,di:1.5, dx:1.5, bi:1.5, bx:1.5, ch:'openai' },
  { mc:'o3',               mn:'o3',                 um:'o3',               mt:'llm',      cl:200000, im:1, d:'OpenAI o3 推理模型',                bip:0.005,  bop:0.02,  di:1.3, dx:1.3, bi:1.3, bx:1.3, ch:'openai' },
  { mc:'o3-mini',          mn:'o3-mini',            um:'o3-mini',          mt:'llm',      cl:200000, im:1, d:'OpenAI o3-mini 推理轻量',            bip:0.0011, bop:0.0044,di:1.8, dx:1.8, bi:1.8, bx:1.8, ch:'openai' },
  { mc:'gpt-4.1',          mn:'GPT-4.1',             um:'gpt-4.1',          mt:'llm',      cl:1048576,im:1, d:'OpenAI GPT-4.1 旗舰（1M上下文）',    bip:0.002,  bop:0.008, di:1.0, dx:1.0, bi:1.0, bx:1.0, ch:'openai' },
  { mc:'gpt-4.1-mini',     mn:'GPT-4.1-mini',        um:'gpt-4.1-mini',     mt:'llm',      cl:1048576,im:1, d:'OpenAI GPT-4.1 性价比',              bip:0.0004, bop:0.0016,di:1.5, dx:1.5, bi:1.5, bx:1.5, ch:'openai' },
  { mc:'gpt-4.1-nano',     mn:'GPT-4.1-nano',        um:'gpt-4.1-nano',     mt:'llm',      cl:1048576,im:1, d:'OpenAI GPT-4.1 极速轻量',            bip:0.0001, bop:0.0004,di:2.0, dx:2.0, bi:2.0, bx:2.0, ch:'openai' },
  { mc:'gpt-4o',           mn:'GPT-4o',              um:'gpt-4o',           mt:'llm',      cl:128000, im:1, d:'OpenAI 多模态旗舰',              bip:0.0025, bop:0.01,  di:1.5, dx:1.5, bi:1.5, bx:1.5, ch:'openai' },
  { mc:'gpt-4o-mini',      mn:'GPT-4o Mini',         um:'gpt-4o-mini',      mt:'llm',      cl:128000, im:1, d:'OpenAI 轻量多模态',              bip:0.00015,bop:0.0006,di:2.0, dx:2.0, bi:2.0, bx:2.0, ch:'openai' },
  { mc:'gpt-4-turbo',      mn:'GPT-4 Turbo',         um:'gpt-4-turbo',      mt:'llm',      cl:128000, im:1, d:'OpenAI GPT-4 Turbo',            bip:0.01,  bop:0.03,  di:1.5, dx:1.5, bi:1.5, bx:1.5, ch:'openai' },
  { mc:'o1',               mn:'o1',                  um:'o1',               mt:'llm',      cl:200000, im:1, d:'OpenAI o1 推理模型',                bip:0.015,  bop:0.06,  di:1.3, dx:1.3, bi:1.3, bx:1.3, ch:'openai' },
  { mc:'o1-mini',          mn:'o1 Mini',             um:'o1-mini',          mt:'llm',      cl:128000, im:0, d:'OpenAI o1-mini 推理轻量',          bip:0.003,  bop:0.012, di:2.0, dx:2.0, bi:2.0, bx:2.0, ch:'openai' },
  { mc:'gpt-4o-realtime',  mn:'GPT-4o Realtime',     um:'gpt-4o-realtime-preview',mt:'llm',cl:128000,im:1,d:'OpenAI 实时对话模型',          bip:0.005,  bop:0.02,  di:1.8, dx:1.8, bi:1.8, bx:1.8, ch:'openai' },
  { mc:'text-embedding-3-large',mn:'Embedding 3 Large',um:'text-embedding-3-large',mt:'embedding',cl:8192,im:0,d:'OpenAI 高精度嵌入',         bip:0.00013,bop:0,     di:5.0, dx:5.0, bi:5.0, bx:5.0, ch:'openai' },
  { mc:'text-embedding-3-small',mn:'Embedding 3 Small',um:'text-embedding-3-small',mt:'embedding',cl:8192,im:0,d:'OpenAI 轻量嵌入',         bip:0.00002,bop:0,     di:5.0, dx:5.0, bi:5.0, bx:5.0, ch:'openai' },
  { mc:'dall-e-3',         mn:'DALL·E 3',            um:'dall-e-3',         mt:'image',    cl:0,im:1,d:'OpenAI 图像生成',              bip:0.04,  bop:0,     di:2.0, dx:2.0, bi:2.0, bx:2.0, ch:'openai' },
  { mc:'tts-1',            mn:'TTS-1',               um:'tts-1',            mt:'audio',    cl:0,im:0,d:'OpenAI 文本转语音',              bip:0.015, bop:0,     di:2.0, dx:2.0, bi:2.0, bx:2.0, ch:'openai' },
  { mc:'whisper-1',        mn:'Whisper-1',           um:'whisper-1',        mt:'audio',    cl:0,im:0,d:'OpenAI 语音转文字',              bip:0.006, bop:0,     di:2.0, dx:2.0, bi:2.0, bx:2.0, ch:'openai' },

  // ==================== DeepSeek ====================
  { mc:'deepseek-v4-pro',   mn:'DeepSeek V4 Pro',      um:'deepseek-v4-pro',  mt:'llm',     cl:131072, im:0, d:'DeepSeek V4 Pro 旗舰',          bip:0.0005, bop:0.0015, di:1.5, dx:1.5, bi:1.5, bx:1.5, ch:'deepseek' },
  { mc:'deepseek-v4-flash', mn:'DeepSeek V4 Flash',    um:'deepseek-v4-flash',mt:'llm',     cl:131072, im:0, d:'DeepSeek V4 Flash 快速',        bip:0.0001, bop:0.0003, di:2.0, dx:2.0, bi:2.0, bx:2.0, ch:'deepseek' },
  { mc:'deepseek-chat',     mn:'DeepSeek Chat',        um:'deepseek-chat',    mt:'llm',     cl:131072, im:0, d:'DeepSeek 对话模型（即将废弃）',  bip:0.00014,bop:0.00028,di:2.5, dx:2.5, bi:2.5, bx:2.5, ch:'deepseek' },
  { mc:'deepseek-reasoner', mn:'DeepSeek Reasoner',    um:'deepseek-reasoner',mt:'llm',     cl:131072, im:0, d:'DeepSeek 推理（即将废弃）',      bip:0.00055,bop:0.00219,di:2.0, dx:2.0, bi:2.0, bx:2.0, ch:'deepseek' },
  { mc:'deepseek-v3',       mn:'DeepSeek V3',          um:'deepseek-chat',    mt:'llm',     cl:131072, im:0, d:'DeepSeek V3 通用模型（旧版）',   bip:0.00014,bop:0.00028,di:2.5, dx:2.5, bi:2.5, bx:2.5, ch:'deepseek' },
  { mc:'deepseek-r1',       mn:'DeepSeek R1',          um:'deepseek-reasoner',mt:'llm',     cl:131072, im:0, d:'DeepSeek R1 推理（旧版）',       bip:0.00055,bop:0.00219,di:2.0, dx:2.0, bi:2.0, bx:2.0, ch:'deepseek' },

  // ==================== Anthropic ====================
  { mc:'claude-4-opus',     mn:'Claude 4 Opus',         um:'claude-4-opus-20260514',   mt:'llm', cl:200000, im:1, d:'Anthropic 最强旗舰',            bip:0.015, bop:0.075,  di:1.2, dx:1.2, bi:1.2, bx:1.2, ch:'anthropic' },
  { mc:'claude-4-sonnet',   mn:'Claude 4 Sonnet',      um:'claude-4-sonnet-20260514', mt:'llm', cl:200000, im:1, d:'Anthropic 高性能旗舰（推荐）',  bip:0.003, bop:0.015,  di:1.5, dx:1.5, bi:1.5, bx:1.5, ch:'anthropic' },
  { mc:'claude-3.5-haiku',  mn:'Claude 3.5 Haiku',     um:'claude-3-5-haiku-20241022',mt:'llm', cl:200000, im:1, d:'Anthropic 快速轻量',            bip:0.0008,bop:0.004,  di:2.0, dx:2.0, bi:2.0, bx:2.0, ch:'anthropic' },
  { mc:'claude-3.5-sonnet', mn:'Claude 3.5 Sonnet',    um:'claude-3-5-sonnet-20241022',mt:'llm',cl:200000, im:1, d:'Anthropic 上代旗舰',            bip:0.003, bop:0.015,  di:1.8, dx:1.8, bi:1.8, bx:1.8, ch:'anthropic' },
  { mc:'claude-3-opus',     mn:'Claude 3 Opus',        um:'claude-3-opus-20240229',   mt:'llm', cl:200000, im:1, d:'Anthropic 上代最强',            bip:0.015, bop:0.075,  di:1.5, dx:1.5, bi:1.5, bx:1.5, ch:'anthropic' },
  { mc:'claude-3-haiku',    mn:'Claude 3 Haiku',       um:'claude-3-haiku-20240307',  mt:'llm', cl:200000, im:1, d:'Anthropic 经典轻量',            bip:0.00025,bop:0.00125,di:2.5, dx:2.5, bi:2.5, bx:2.5, ch:'anthropic' },
];

async function seed() {
  await initDatabase();
  const db = getDatabase();

  // 获取渠道 ID
  const channels = {};
  for (const name of ['openai','deepseek','anthropic']) {
    const r = db.prepare('SELECT id FROM upstream_channels WHERE channel_name=?').get(name);
    if (r) channels[name] = r.id;
  }

  if (Object.keys(channels).length < 3) {
    console.error('❌ 渠道数据不完整，请先运行 seed.js');
    process.exit(1);
  }

  // 清空旧模型（只保留三个渠道的）
  db.prepare('DELETE FROM api_key_permissions').run();
  db.prepare('DELETE FROM models').run();

  // 插入新模型
  let sort = 0;
  for (const m of MODELS) {
    sort++;
    const channelId = channels[m.ch];
    db.prepare(`INSERT INTO models (model_code,model_name,upstream_model_name,model_type,context_length,is_multimodal,description,base_input_price,base_output_price,display_multiplier_input,display_multiplier_output,billing_multiplier_input,billing_multiplier_output,channel_id,sort_order)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(m.mc,m.mn,m.um,m.mt,m.cl,m.im,m.d,m.bip,m.bop,m.di,m.dx,m.bi,m.bx,channelId,sort);
  }

  // 为每个渠道的 active api_key 重新授权所有模型
  const keys = db.prepare("SELECT id, channel_id FROM api_keys WHERE status='active'").all();
  for (const k of keys) {
    const channelModels = MODELS.filter(m => channels[m.ch] === k.channel_id);
    for (const m of channelModels) {
      db.prepare("INSERT OR IGNORE INTO api_key_permissions (api_key_id,model_code) VALUES (?,?)").run(k.id, m.mc);
    }
  }

  saveDatabase();
  console.log(`✅ ${MODELS.length} 个模型已更新（openai ${MODELS.filter(m=>m.ch==='openai').length} / deepseek ${MODELS.filter(m=>m.ch==='deepseek').length} / anthropic ${MODELS.filter(m=>m.ch==='anthropic').length}）`);
}

seed().catch(e => { console.error(e); process.exit(1); });
