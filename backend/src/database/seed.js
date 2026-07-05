require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { getDatabase, initDatabase } = require('./init');
const bcrypt = require('bcryptjs');

async function seed() {
  await initDatabase();
  const db = getDatabase();

  // ==================== 用户 ====================
  const adminHash = bcrypt.hashSync('admin123', 10);
  const existingAdmin = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (!existingAdmin) {
    db.prepare("INSERT INTO users (username, email, password_hash, role, status) VALUES (?, ?, ?, ?, ?)")
      .run('admin', 'admin@example.com', adminHash, 'admin', 'active');
    const admin = db.prepare("SELECT id FROM users WHERE username = ?").get('admin');
    db.prepare("INSERT OR IGNORE INTO wallets (user_id, recharge_balance, gift_balance, quota_balance, gift_quota) VALUES (?, ?, ?, ?, ?)")
      .run(admin.id, 100.00, 0, 100.00, 0);
    console.log('✅ 管理员: admin / admin123');
  }

  const userHash = bcrypt.hashSync('user123', 10);
  const existingUser = db.prepare("SELECT id FROM users WHERE username = ?").get('testuser');
  if (!existingUser) {
    db.prepare("INSERT INTO users (username, email, password_hash, role, status) VALUES (?, ?, ?, ?, ?)")
      .run('testuser', 'user@example.com', userHash, 'user', 'active');
    const user = db.prepare("SELECT id FROM users WHERE username = ?").get('testuser');
    db.prepare("INSERT OR IGNORE INTO wallets (user_id, recharge_balance, gift_balance, quota_balance, gift_quota) VALUES (?, ?, ?, ?, ?)")
      .run(user.id, 10.00, 1.00, 10.00, 1.00);
    console.log('✅ 测试用户: testuser / user123');
  }

  // ==================== 渠道（模型提供方） ====================
  const channels = [
    { cn: 'openai',      bu: 'https://api.openai.com/v1',           ak: 'sk-your-openai-key-here' },
    { cn: 'deepseek',    bu: 'https://api.deepseek.com/v1',         ak: 'sk-your-deepseek-key-here' },
    { cn: 'anthropic',   bu: 'https://api.anthropic.com/v1',        ak: 'sk-ant-your-anthropic-key-here' },
    { cn: 'google',      bu: 'https://generativelanguage.googleapis.com/v1beta', ak: 'your-google-api-key-here' },
    { cn: 'qwen',        bu: 'https://dashscope.aliyuncs.com/compatible-mode/v1', ak: 'sk-your-qwen-key-here' },
    { cn: 'zhipu',       bu: 'https://open.bigmodel.cn/api/paas/v4', ak: 'your-zhipu-api-key-here' },
    { cn: 'moonshot',    bu: 'https://api.moonshot.cn/v1',          ak: 'sk-your-moonshot-key-here' },
    { cn: 'baidu',       bu: 'https://qianfan.baidubce.com/v2',      ak: 'your-baidu-access-token-here' },
    { cn: 'minimax',     bu: 'https://api.minimax.chat/v1',         ak: 'your-minimax-api-key-here' },
    { cn: 'doubao',      bu: 'https://ark.cn-beijing.volces.com/api/v3', ak: 'your-doubao-api-key-here' },
    { cn: 'siliconflow', bu: 'https://api.siliconflow.cn/v1',       ak: 'sk-your-siliconflow-key-here' },
    { cn: 'together',    bu: 'https://api.together.xyz/v1',          ak: 'your-together-api-key-here' },
    { cn: 'azure',       bu: 'https://YOUR-RESOURCE.openai.azure.com', ak: 'your-azure-api-key-here' },
    { cn: 'openrouter',  bu: 'https://openrouter.ai/api/v1',        ak: 'sk-or-your-openrouter-key-here' },
    { cn: 'stepfun',     bu: 'https://api.stepfun.com/v1',          ak: 'sk-your-stepfun-key-here' },
  ];

  for (const c of channels) {
    const exists = db.prepare('SELECT id FROM upstream_channels WHERE channel_name = ?').get(c.cn);
    if (!exists) {
      db.prepare('INSERT INTO upstream_channels (channel_name, base_url, api_key, priority, status) VALUES (?,?,?,?,?)')
        .run(c.cn, c.bu, c.ak, 1, c.cn === 'openai' ? 'active' : 'active');
      console.log(`✅ 渠道已创建: ${c.cn}`);
    }
  }

  // ==================== 模型数据 ====================
  const models = [
    // OpenAI
    { mc: 'gpt-4o',           mn: 'GPT-4o',              um: 'gpt-4o',                mt: 'llm',       cl: 128000, im: 1, d: 'OpenAI 多模态旗舰模型',                               bip: 0.0025, bop: 0.01,    di: 1.5, dx: 1.5, bi: 1.5, bx: 1.5, so: 1,   ch: 'openai' },
    { mc: 'gpt-4o-mini',      mn: 'GPT-4o Mini',         um: 'gpt-4o-mini',           mt: 'llm',       cl: 128000, im: 1, d: 'OpenAI 轻量级多模态模型',                           bip: 0.00015, bop: 0.0006, di: 2.0, dx: 2.0, bi: 2.0, bx: 2.0, so: 2,   ch: 'openai' },
    { mc: 'gpt-4-turbo',      mn: 'GPT-4 Turbo',         um: 'gpt-4-turbo',           mt: 'llm',       cl: 128000, im: 1, d: 'OpenAI GPT-4 Turbo',                                 bip: 0.01,   bop: 0.03,   di: 1.5, dx: 1.5, bi: 1.5, bx: 1.5, so: 3,   ch: 'openai' },
    { mc: 'gpt-3.5-turbo',    mn: 'GPT-3.5 Turbo',       um: 'gpt-3.5-turbo',         mt: 'llm',       cl: 16385,  im: 0, d: 'OpenAI 经典高性价比模型',                            bip: 0.0005, bop: 0.0015, di: 3.0, dx: 3.0, bi: 3.0, bx: 3.0, so: 4,   ch: 'openai' },
    { mc: 'o1-mini',          mn: 'o1 Mini',             um: 'o1-mini',               mt: 'llm',       cl: 128000, im: 0, d: 'OpenAI 推理模型（轻量）',                           bip: 0.003,  bop: 0.012,  di: 2.0, dx: 2.0, bi: 2.0, bx: 2.0, so: 5,   ch: 'openai' },
    { mc: 'text-embedding-3-small', mn: 'Embedding 3 Small', um: 'text-embedding-3-small', mt: 'embedding', cl: 8192, im: 0, d: 'OpenAI 文本嵌入模型',                               bip: 0.00002, bop: 0,       di: 5.0, dx: 5.0, bi: 5.0, bx: 5.0, so: 6,   ch: 'openai' },
    // DeepSeek
    { mc: 'deepseek-chat',    mn: 'DeepSeek Chat',       um: 'deepseek-chat',         mt: 'llm',       cl: 131072, im: 0, d: 'DeepSeek 旗舰对话模型',                               bip: 0.00014, bop: 0.00028, di: 2.5, dx: 2.5, bi: 2.5, bx: 2.5, so: 7,   ch: 'deepseek' },
    { mc: 'deepseek-reasoner', mn: 'DeepSeek Reasoner',  um: 'deepseek-reasoner',     mt: 'llm',       cl: 131072, im: 0, d: 'DeepSeek 推理增强模型（R1）',                        bip: 0.00055, bop: 0.00219, di: 2.0, dx: 2.0, bi: 2.0, bx: 2.0, so: 8,   ch: 'deepseek' },
    // Anthropic
    { mc: 'claude-3.5-sonnet', mn: 'Claude 3.5 Sonnet',  um: 'claude-3-5-sonnet-20241022', mt: 'llm', cl: 200000, im: 1, d: 'Anthropic 高性能模型（推荐）',                        bip: 0.003,  bop: 0.015,  di: 1.8, dx: 1.8, bi: 1.8, bx: 1.8, so: 9,   ch: 'anthropic' },
    { mc: 'claude-3-opus',    mn: 'Claude 3 Opus',       um: 'claude-3-opus-20240229', mt: 'llm',     cl: 200000, im: 1, d: 'Anthropic 最强模型',                                  bip: 0.015,  bop: 0.075,  di: 1.5, dx: 1.5, bi: 1.5, bx: 1.5, so: 10,  ch: 'anthropic' },
    { mc: 'claude-3-haiku',   mn: 'Claude 3 Haiku',      um: 'claude-3-haiku-20240307', mt: 'llm',    cl: 200000, im: 1, d: 'Anthropic 快速轻量模型',                                bip: 0.00025, bop: 0.00125, di: 2.5, dx: 2.5, bi: 2.5, bx: 2.5, so: 11, ch: 'anthropic' },
    // Google
    { mc: 'gemini-2.0-flash', mn: 'Gemini 2.0 Flash',    um: 'gemini-2.0-flash',      mt: 'llm',       cl: 1048576, im: 1, d: 'Google Gemini 2.0 快速多模态模型',                  bip: 0.0001,  bop: 0.0004, di: 2.5, dx: 2.5, bi: 2.5, bx: 2.5, so: 12, ch: 'google' },
    { mc: 'gemini-1.5-pro',   mn: 'Gemini 1.5 Pro',      um: 'gemini-1.5-pro',        mt: 'llm',       cl: 1048576, im: 1, d: 'Google Gemini 1.5 Pro 多模态',                      bip: 0.00125, bop: 0.005,  di: 1.8, dx: 1.8, bi: 1.8, bx: 1.8, so: 13, ch: 'google' },
    // 通义千问
    { mc: 'qwen-max',         mn: 'Qwen Max',            um: 'qwen-max',              mt: 'llm',       cl: 131072, im: 0, d: '通义千问 旗舰模型',                                   bip: 0.0028, bop: 0.0112,  di: 1.5, dx: 1.5, bi: 1.5, bx: 1.5, so: 14, ch: 'qwen' },
    { mc: 'qwen-plus',        mn: 'Qwen Plus',           um: 'qwen-plus',             mt: 'llm',       cl: 131072, im: 0, d: '通义千问 增强版',                                     bip: 0.0005, bop: 0.002,   di: 2.0, dx: 2.0, bi: 2.0, bx: 2.0, so: 15, ch: 'qwen' },
    { mc: 'qwen-turbo',       mn: 'Qwen Turbo',          um: 'qwen-turbo',            mt: 'llm',       cl: 131072, im: 0, d: '通义千问 高性价比模型',                               bip: 0.00015, bop: 0.0006, di: 3.0, dx: 3.0, bi: 3.0, bx: 3.0, so: 16, ch: 'qwen' },
    { mc: 'qwen-vl-max',      mn: 'Qwen VL Max',         um: 'qwen-vl-max',           mt: 'llm',       cl: 32768,  im: 1, d: '通义千问 视觉理解旗舰',                               bip: 0.003,  bop: 0.012,  di: 1.5, dx: 1.5, bi: 1.5, bx: 1.5, so: 17, ch: 'qwen' },
    // 智谱
    { mc: 'glm-4-plus',       mn: 'GLM-4 Plus',          um: 'glm-4-plus',            mt: 'llm',       cl: 128000, im: 1, d: '智谱 GLM-4 Plus 旗舰模型',                            bip: 0.007,  bop: 0.007,  di: 1.8, dx: 1.8, bi: 1.8, bx: 1.8, so: 18, ch: 'zhipu' },
    { mc: 'glm-4-flash',      mn: 'GLM-4 Flash',         um: 'glm-4-flash',           mt: 'llm',       cl: 128000, im: 1, d: '智谱 GLM-4 Flash 免费快速模型',                      bip: 0,      bop: 0,      di: 100, dx: 100, bi: 0,   bx: 0,   so: 19, ch: 'zhipu' },
    // Moonshot
    { mc: 'moonshot-v1-8k',   mn: 'Moonshot v1 8K',      um: 'moonshot-v1-8k',        mt: 'llm',       cl: 8192,   im: 0, d: 'Kimi Moonshot 8K 模型',                                bip: 0.003,  bop: 0.003,  di: 2.0, dx: 2.0, bi: 2.0, bx: 2.0, so: 20, ch: 'moonshot' },
    { mc: 'moonshot-v1-128k', mn: 'Moonshot v1 128K',    um: 'moonshot-v1-128k',      mt: 'llm',       cl: 131072, im: 0, d: 'Kimi Moonshot 128K 长上下文模型',                     bip: 0.006,  bop: 0.006,  di: 1.8, dx: 1.8, bi: 1.8, bx: 1.8, so: 21, ch: 'moonshot' },
    // 百度文心
    { mc: 'ernie-4.0-turbo',  mn: 'ERNIE 4.0 Turbo',     um: 'ernie-4.0-turbo-128k',  mt: 'llm',       cl: 131072, im: 0, d: '百度文心 4.0 Turbo 旗舰',                              bip: 0.008,  bop: 0.008,  di: 1.5, dx: 1.5, bi: 1.5, bx: 1.5, so: 22, ch: 'baidu' },
    { mc: 'ernie-speed',      mn: 'ERNIE Speed',         um: 'ernie-speed-128k',      mt: 'llm',       cl: 131072, im: 0, d: '百度文心 快速轻量模型',                               bip: 0,      bop: 0,      di: 100, dx: 100, bi: 0,   bx: 0,   so: 23, ch: 'baidu' },
    // MiniMax
    { mc: 'abab6.5s-chat',    mn: 'ABAB 6.5s Chat',      um: 'abab6.5s-chat',         mt: 'llm',       cl: 245760, im: 0, d: 'MiniMax ABAB 6.5s 旗舰模型',                          bip: 0.001,  bop: 0.001,  di: 2.0, dx: 2.0, bi: 2.0, bx: 2.0, so: 24, ch: 'minimax' },
    // 豆包
    { mc: 'doubao-pro-128k',  mn: '豆包 Pro 128K',       um: 'ep-2024-pro',           mt: 'llm',       cl: 131072, im: 0, d: '字节豆包 Pro 128K 模型',                              bip: 0.0005, bop: 0.0015, di: 2.0, dx: 2.0, bi: 2.0, bx: 2.0, so: 25, ch: 'doubao' },
    { mc: 'doubao-lite-128k', mn: '豆包 Lite 128K',      um: 'ep-2024-lite',          mt: 'llm',       cl: 131072, im: 0, d: '字节豆包 Lite 轻量模型',                              bip: 0.00015, bop: 0.0006, di: 3.0, dx: 3.0, bi: 3.0, bx: 3.0, so: 26, ch: 'doubao' },
    // SiliconFlow (聚合平台)
    { mc: 'Qwen/Qwen2.5-7B-Instruct', mn: 'Qwen2.5 7B',  um: 'Qwen/Qwen2.5-7B-Instruct', mt: 'llm',    cl: 32768,  im: 0, d: 'SiliconFlow 通义千问 2.5 7B',                           bip: 0.00005, bop: 0.00005, di: 5.0, dx: 5.0, bi: 5.0, bx: 5.0, so: 27, ch: 'siliconflow' },
    { mc: 'deepseek-ai/DeepSeek-V3', mn: 'DeepSeek V3 (SF)', um: 'deepseek-ai/DeepSeek-V3', mt: 'llm', cl: 131072, im: 0, d: 'SiliconFlow DeepSeek V3',                             bip: 0.00014, bop: 0.00028, di: 2.5, dx: 2.5, bi: 2.5, bx: 2.5, so: 28, ch: 'siliconflow' },
    // Together
    { mc: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', mn: 'Llama 3.3 70B', um: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', mt: 'llm', cl: 131072, im: 0, d: 'Together Meta Llama 3.3 70B', bip: 0.00008, bop: 0.00008, di: 5.0, dx: 5.0, bi: 5.0, bx: 5.0, so: 29, ch: 'together' },
    { mc: 'mistralai/Mixtral-8x22B-Instruct-v0.1', mn: 'Mixtral 8x22B', um: 'mistralai/Mixtral-8x22B-Instruct-v0.1', mt: 'llm', cl: 65536, im: 0, d: 'Together Mistral Mixtral 8x22B', bip: 0.0001, bop: 0.0004, di: 4.0, dx: 4.0, bi: 4.0, bx: 4.0, so: 30, ch: 'together' },
    // StepFun
    { mc: 'step-2-16k',       mn: 'Step-2 16K',          um: 'step-2-16k',            mt: 'llm',       cl: 16384,  im: 1, d: '阶跃星辰 Step-2 多模态模型',                         bip: 0.002,  bop: 0.008,  di: 2.0, dx: 2.0, bi: 2.0, bx: 2.0, so: 31, ch: 'stepfun' },
  ];

  for (const m of models) {
    // 查找 channel_id
    const channel = db.prepare('SELECT id FROM upstream_channels WHERE channel_name = ?').get(m.ch);
    const channelId = channel ? channel.id : null;

    db.prepare(`INSERT OR IGNORE INTO models (model_code,model_name,upstream_model_name,model_type,context_length,is_multimodal,description,base_input_price,base_output_price,display_multiplier_input,display_multiplier_output,billing_multiplier_input,billing_multiplier_output,channel_id,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(m.mc, m.mn, m.um, m.mt, m.cl, m.im, m.d, m.bip, m.bop, m.di, m.dx, m.bi, m.bx, channelId, m.so);
  }
  console.log(`✅ ${models.length} 个模型数据已插入`);

  // ==================== 默认渠道（兼容已存在数据） ====================
  const existingChannel = db.prepare("SELECT id FROM upstream_channels WHERE channel_name = ?").get('default-openai');
  if (!existingChannel) {
    db.prepare("INSERT INTO upstream_channels (channel_name, base_url, api_key, priority, status) VALUES (?,?,?,?,?)")
      .run('default-openai', 'https://api.openai.com/v1', 'sk-your-upstream-key-here', 1, 'active');
    console.log('✅ 默认渠道已创建（请修改 API Key）');
  }

  console.log('\n🎉 种子数据完成！');
}

seed().catch(console.error);