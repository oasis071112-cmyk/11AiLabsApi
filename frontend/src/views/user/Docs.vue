<template>
<div class="page-container" style="max-width:900px"><h2 class="card-title mb-16"><BookOpen :size="22"/> API 接入文档</h2>
<el-card>
<h3>1. 获取 API Key</h3><p>在 <el-link type="primary" @click="$router.push('/keys')">API Key 管理</el-link> 页面创建密钥。</p>
<h3 style="margin-top:24px">2. 调用方式</h3><p>兼容 OpenAI API 格式，修改 base_url 和 api_key：</p>
<div style="background:#1e1e1e;color:#d4d4d4;padding:16px;border-radius:8px;font-family:monospace;font-size:13px;margin:12px 0">
<div><span style="color:#6a9955"># Base URL</span></div><div><span style="color:#ce9178">http://localhost:3000</span></div><br/>
<div><span style="color:#6a9955"># API Key (Bearer Token)</span></div><div><span style="color:#ce9178">sk-your-api-key-here</span></div>
</div>
<h3 style="margin-top:24px">3. cURL 示例</h3>
<div style="background:#1e1e1e;color:#d4d4d4;padding:16px;border-radius:8px;font-family:monospace;font-size:13px;overflow-x:auto"><pre style="margin:0">curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-your-api-key" \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"Hello!"}]}'</pre></div>
<h4 style="margin-top:16px">Python</h4>
<div style="background:#1e1e1e;color:#d4d4d4;padding:16px;border-radius:8px;font-family:monospace;font-size:13px;overflow-x:auto"><pre style="margin:0">from openai import OpenAI
client = OpenAI(base_url="http://localhost:3000/v1", api_key="sk-your-api-key")
response = client.chat.completions.create(model="gpt-4o-mini", messages=[{"role":"user","content":"Hello!"}])
print(response.choices[0].message.content)</pre></div>
<h4 style="margin-top:16px">Node.js</h4>
<div style="background:#1e1e1e;color:#d4d4d4;padding:16px;border-radius:8px;font-family:monospace;font-size:13px;overflow-x:auto"><pre style="margin:0">import OpenAI from "openai";
const client = new OpenAI({ baseURL: "http://localhost:3000/v1", apiKey: "sk-your-api-key" });
const r = await client.chat.completions.create({ model: "gpt-4o-mini", messages: [{role:"user",content:"Hello!"}] });
console.log(r.choices[0].message.content);</pre></div>
<h3 style="margin-top:24px">4. 计费说明</h3><p>费用 = (输入Token/1000 × 基础价 × 输入倍率) + (输出Token/1000 × 基础价 × 输出倍率)</p><p>具体倍率查看 <el-link type="primary" @click="$router.push('/models')">模型列表</el-link>。</p>
</el-card>
</div>
</template>

<script setup>
import { BookOpen } from '@lucide/vue'
</script>
