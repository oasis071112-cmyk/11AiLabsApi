// 渠道 API 文档配置
// 定义每个渠道的协议类型和代码模板

/**
 * 协议类型说明:
 *   openai        — OpenAI Chat Completions 兼容 (大多数渠道)
 *   anthropic     — Anthropic Messages API
 *   gemini        — Google Gemini API
 *   baidu         — 百度文心 API
 */

const PROTOCOLS = {
  openai: {
    type: 'openai',
    label: 'OpenAI 兼容',
    authHeader: (key) => `Bearer ${key}`,
    endpoint: '/v1/chat/completions',
    curl: (baseUrl, model, keyPrefix) =>
`curl ${baseUrl}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${keyPrefix}..." \\
  -d '{
    "model": "${model}",
    "messages": [
      {"role": "user", "content": "你好，请介绍一下你自己"}
    ],
    "stream": false
  }'`,
    python: (baseUrl, model, keyPrefix) =>
`from openai import OpenAI

client = OpenAI(
    base_url="${baseUrl}/v1",
    api_key="${keyPrefix}..."  # 替换为你的完整 API Key
)

response = client.chat.completions.create(
    model="${model}",
    messages=[
        {"role": "user", "content": "你好，请介绍一下你自己"}
    ]
)
print(response.choices[0].message.content)`,
    nodejs: (baseUrl, model, keyPrefix) =>
`import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${baseUrl}/v1",
  apiKey: "${keyPrefix}..."  // 替换为你的完整 API Key
});

const response = await client.chat.completions.create({
  model: "${model}",
  messages: [
    { role: "user", content: "你好，请介绍一下你自己" }
  ]
});
console.log(response.choices[0].message.content);`
  },

  anthropic: {
    type: 'anthropic',
    label: 'Anthropic Messages',
    authHeader: (key) => key,
    endpoint: '/v1/messages',
    curl: (baseUrl, model, keyPrefix) =>
`curl ${baseUrl}/v1/messages \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: ${keyPrefix}..." \\
  -H "anthropic-version: 2023-06-01" \\
  -d '{
    "model": "${model}",
    "max_tokens": 1024,
    "messages": [
      {"role": "user", "content": "你好，请介绍一下你自己"}
    ]
  }'`,
    python: (baseUrl, model, keyPrefix) =>
`import anthropic

client = anthropic.Anthropic(
    base_url="${baseUrl}/v1",
    api_key="${keyPrefix}..."  # 替换为你的完整 API Key
)

message = client.messages.create(
    model="${model}",
    max_tokens=1024,
    messages=[
        {"role": "user", "content": "你好，请介绍一下你自己"}
    ]
)
print(message.content[0].text)`,
    nodejs: (baseUrl, model, keyPrefix) =>
`import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  baseURL: "${baseUrl}/v1",
  apiKey: "${keyPrefix}..."  // 替换为你的完整 API Key
});

const message = await client.messages.create({
  model: "${model}",
  max_tokens: 1024,
  messages: [
    { role: "user", content: "你好，请介绍一下你自己" }
  ]
});
console.log(message.content[0].text);`
  },

  gemini: {
    type: 'gemini',
    label: 'Google Gemini',
    authHeader: () => '',
    endpoint: '/v1beta/models/{model}:generateContent',
    // Gemini 使用 query param 传 key
    curl: (baseUrl, model, keyPrefix) =>
`curl "${baseUrl}/v1beta/models/${model}:generateContent?key=${keyPrefix}..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "contents": [
      {
        "parts": [{"text": "你好，请介绍一下你自己"}]
      }
    ]
  }'`,
    python: (baseUrl, model, keyPrefix) =>
`import google.generativeai as genai

genai.configure(
    api_key="${keyPrefix}..."  # 替换为你的完整 API Key
)

model = genai.GenerativeModel("${model}")
response = model.generate_content("你好，请介绍一下你自己")
print(response.text)

# 或者通过中转站代理地址
# genai.configure(
#     api_key="${keyPrefix}...",
#     client_options={"api_endpoint": "${baseUrl}"}
# )`,
    nodejs: (baseUrl, model, keyPrefix) =>
`import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI("${keyPrefix}...");
// 替换为你的完整 API Key ↑

const model = genAI.getGenerativeModel({ model: "${model}" });
const result = await model.generateContent("你好，请介绍一下你自己");
console.log(result.response.text());`
  },

  baidu: {
    type: 'baidu',
    label: '百度文心',
    authHeader: () => '',
    // 百度 OAuth access_token 方式
    endpoint: '/v2/chat/completions',
    curl: (baseUrl, model, keyPrefix) =>
`# 百度文心使用 access_token 鉴权
curl "${baseUrl}/v2/chat/completions?access_token=${keyPrefix}..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${model}",
    "messages": [
      {"role": "user", "content": "你好，请介绍一下你自己"}
    ],
    "stream": false
  }'`,
    python: (baseUrl, model, keyPrefix) =>
`import requests
import json

url = "${baseUrl}/v2/chat/completions"
params = {"access_token": "${keyPrefix}..."}  # 替换为你的完整 Access Token
payload = {
    "model": "${model}",
    "messages": [
        {"role": "user", "content": "你好，请介绍一下你自己"}
    ]
}
response = requests.post(url, params=params, json=payload)
print(response.json()["result"])`,
    nodejs: (baseUrl, model, keyPrefix) =>
`const response = await fetch(
  \`${baseUrl}/v2/chat/completions?access_token=${keyPrefix}...\`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "${model}",
      messages: [
        { role: "user", content: "你好，请介绍一下你自己" }
      ]
    })
  }
);
const data = await response.json();
console.log(data.result);`
  }
};

// 渠道名 → 协议映射
const CHANNEL_PROTOCOL_MAP = {
  openai:      'openai',
  deepseek:    'openai',
  qwen:        'openai',
  zhipu:       'openai',   // 智谱 v4 API 是 OpenAI 兼容的
  moonshot:    'openai',
  minimax:     'openai',
  doubao:      'openai',   // 火山 Ark 是 OpenAI 兼容的
  siliconflow: 'openai',
  together:    'openai',
  openrouter:  'openai',
  stepfun:     'openai',
  azure:       'openai',
  anthropic:   'anthropic',
  google:      'gemini',
  baidu:       'baidu',
};

/**
 * 根据渠道名获取协议配置
 */
function getProtocol(channelName) {
  const protocolType = CHANNEL_PROTOCOL_MAP[channelName];
  if (!protocolType) return PROTOCOLS.openai; // fallback
  return PROTOCOLS[protocolType];
}

/**
 * 生成某渠道下某 API Key 的完整文档数据
 */
function generateDocs(baseUrl, channelName, keyPrefix, models) {
  const protocol = getProtocol(channelName);
  const sampleModel = models.length > 0 ? models[0].model_code : 'your-model';

  return {
    protocol_type: protocol.type,
    protocol_label: protocol.label,
    endpoint: protocol.endpoint.replace('{model}', sampleModel),
    curl: protocol.curl(baseUrl, sampleModel, keyPrefix),
    python: protocol.python(baseUrl, sampleModel, keyPrefix),
    nodejs: protocol.nodejs(baseUrl, sampleModel, keyPrefix),
  };
}

module.exports = { PROTOCOLS, CHANNEL_PROTOCOL_MAP, getProtocol, generateDocs };
