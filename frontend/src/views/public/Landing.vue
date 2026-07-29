<template>
  <div id="top" class="public-landing">
    <a class="landing-skip-link" href="#landing-main">跳到主要内容</a>

    <header class="landing-header">
      <div class="landing-header__inner">
        <a class="landing-brand" href="#top" aria-label="IonAiLabs 首页">
          <span class="landing-logo-mark landing-logo-mark--header" aria-hidden="true">
            <img src="/logo-icon.svg?v=ionailabs-20260726" alt="">
          </span>
          <span>IonAiLabs</span>
        </a>

        <nav class="landing-nav" aria-label="页面导航">
          <a href="#models">支持模型</a>
          <a href="#first-key">创建密钥</a>
          <a href="#api-guide">API 使用</a>
          <a href="#contact">联系</a>
        </nav>

        <button class="landing-console-button" type="button" @click="goToConsole">
          <span>进入控制台</span>
          <ArrowRight aria-hidden="true" />
        </button>
      </div>
    </header>

    <main id="landing-main">
      <section class="landing-hero" aria-labelledby="landing-hero-title">
        <div class="landing-hero__inner">
          <div class="landing-hero__copy">
            <div class="landing-hero__identity">
              <span class="landing-logo-mark landing-logo-mark--hero">
                <img src="/logo-icon.svg?v=ionailabs-20260726" alt="IonAiLabs 品牌标志">
              </span>
              <span>IonAiLabs</span>
            </div>
            <h1 id="landing-hero-title">拥抱 AI，开启未来。</h1>
            <p>用一个清晰入口，连接主流模型、API Key 与稳定调用。</p>
            <div class="landing-endpoint" aria-label="API 基础地址">
              <Terminal aria-hidden="true" />
              <span>API Base URL</span>
              <code>https://ionailabs.cn/v1</code>
            </div>
          </div>

          <FadeContent class="landing-hero__artifact" :duration="0.45" :delay="0.08">
            <article class="request-artifact" aria-label="真实 API 请求示例">
              <header class="request-artifact__header">
                <div>
                  <span>API 请求</span>
                  <strong>chat.completions</strong>
                </div>
                <span class="request-artifact__method">POST</span>
              </header>
              <div class="request-artifact__body">
                <div class="request-artifact__path">
                  <span>ionailabs.cn</span><strong>/v1/chat/completions</strong>
                </div>
                <pre><code><span class="code-key">"model"</span>: <span class="code-string">"gpt-5.4"</span>,
<span class="code-key">"messages"</span>: [
  { <span class="code-key">"role"</span>: <span class="code-string">"user"</span>, <span class="code-key">"content"</span>: <span class="code-string">"Hello"</span> }
]</code></pre>
              </div>
              <footer class="request-artifact__footer">
                <span>OpenAI 兼容</span>
                <span>Anthropic 兼容</span>
                <span>HTTPS</span>
              </footer>
            </article>
          </FadeContent>
        </div>
      </section>

      <section id="models" class="landing-section landing-models" aria-labelledby="models-title">
        <div class="landing-container">
          <header class="landing-section-heading">
            <h2 id="models-title">该站支持的模型</h2>
            <p>依据专属分组文档整理，重复模型只展示一次，共 {{ uniqueModelCount }} 个。</p>
          </header>

          <div class="model-browser">
            <div class="model-tabs" role="tablist" aria-label="模型分类">
              <button
                v-for="group in modelGroups"
                :id="`model-tab-${group.id}`"
                :key="group.id"
                class="model-tab"
                :class="{ 'is-active': activeModelGroup === group.id }"
                type="button"
                role="tab"
                :aria-selected="activeModelGroup === group.id"
                :aria-controls="`model-panel-${group.id}`"
                :tabindex="activeModelGroup === group.id ? 0 : -1"
                @click="activeModelGroup = group.id"
                @keydown="handleModelTabKeydown($event, group.id)"
              >
                <span>{{ group.label }}</span>
                <small>{{ group.models.length }}</small>
              </button>
            </div>

            <section
              :id="`model-panel-${activeGroup.id}`"
              class="model-panel"
              role="tabpanel"
              :aria-labelledby="`model-tab-${activeGroup.id}`"
              tabindex="0"
            >
              <header class="model-panel__header">
                <div class="model-panel__mark" aria-hidden="true">{{ activeGroup.shortLabel }}</div>
                <div>
                  <h3>{{ activeGroup.label }}</h3>
                  <p>{{ activeGroup.description }}</p>
                </div>
              </header>
              <ul class="model-list" :class="{ 'model-list--compact': activeGroup.id === 'image' }">
                <li v-for="model in activeGroup.models" :key="model">
                  <code>{{ model }}</code>
                </li>
              </ul>
            </section>
          </div>
        </div>
      </section>

      <section id="first-key" class="landing-section landing-onboarding" aria-labelledby="first-key-title">
        <div class="landing-container">
          <header class="landing-section-heading landing-section-heading--narrow">
            <h2 id="first-key-title">首次创建 API Key</h2>
            <p>从登录到完成第一次调用，只需要四步。</p>
          </header>

          <ol class="onboarding-steps">
            <li>
              <span class="onboarding-step__number">01</span>
              <h3>进入控制台</h3>
              <p>点击页面右上角按钮，未登录时会先进入登录页。</p>
            </li>
            <li>
              <span class="onboarding-step__number">02</span>
              <h3>打开 API Key</h3>
              <p>在侧边栏进入 API Key 页面，查看已有密钥或创建新密钥。</p>
            </li>
            <li>
              <span class="onboarding-step__number">03</span>
              <h3>创建并妥善保存</h3>
              <p>设置名称与可用模型，创建后立即复制并安全保管。</p>
            </li>
            <li>
              <span class="onboarding-step__number">04</span>
              <h3>发起第一次请求</h3>
              <p>把密钥写入请求头，使用下方示例验证接入。</p>
            </li>
          </ol>
        </div>
      </section>

      <section id="api-guide" class="landing-section landing-guide" aria-labelledby="api-guide-title">
        <div class="landing-container landing-guide__grid">
          <div class="landing-guide__intro">
            <header class="landing-section-heading">
              <h2 id="api-guide-title">API Key 使用说明</h2>
              <p>兼容常用请求格式，只需替换基础地址、密钥和模型标识。</p>
            </header>

            <dl class="api-facts">
              <div>
                <dt>身份验证</dt>
                <dd>通过请求头携带 API Key，不要把密钥写入公开代码。</dd>
              </div>
              <div>
                <dt>OpenAI Base URL</dt>
                <dd><code>https://ionailabs.cn/v1</code></dd>
              </div>
              <div>
                <dt>Anthropic Base URL</dt>
                <dd><code>https://ionailabs.cn</code></dd>
              </div>
            </dl>
          </div>

          <article class="code-example" aria-labelledby="code-example-title">
            <header class="code-example__header">
              <div>
                <span id="code-example-title">请求示例</span>
                <small>{{ activeProtocolMeta.description }}</small>
              </div>
              <button
                class="code-copy-button"
                type="button"
                :aria-label="copied ? '代码已复制' : '复制代码'"
                @click="copyCode"
              >
                <Check v-if="copied" aria-hidden="true" />
                <Copy v-else aria-hidden="true" />
                <span>{{ copied ? '已复制' : '复制' }}</span>
              </button>
            </header>

            <div class="protocol-tabs" role="tablist" aria-label="API 协议">
              <button
                v-for="protocol in protocols"
                :id="`protocol-tab-${protocol.id}`"
                :key="protocol.id"
                type="button"
                role="tab"
                :aria-selected="activeProtocol === protocol.id"
                :aria-controls="`protocol-panel-${protocol.id}`"
                :tabindex="activeProtocol === protocol.id ? 0 : -1"
                :class="{ 'is-active': activeProtocol === protocol.id }"
                @click="setProtocol(protocol.id)"
                @keydown="handleProtocolTabKeydown($event, protocol.id)"
              >
                {{ protocol.label }}
              </button>
            </div>

            <pre
              :id="`protocol-panel-${activeProtocol}`"
              class="code-example__pre"
              role="tabpanel"
              :aria-labelledby="`protocol-tab-${activeProtocol}`"
              tabindex="0"
            ><code>{{ activeCode }}</code></pre>
            <p class="sr-only" aria-live="polite">{{ copied ? '代码已复制到剪贴板' : '' }}</p>
          </article>
        </div>
      </section>

      <section id="contact" class="landing-contact" aria-labelledby="contact-title">
        <div class="landing-container">
          <a
            v-if="customerServiceUrl"
            class="contact-row"
            :href="customerServiceUrl"
            :target="isExternalCustomerServiceUrl ? '_blank' : undefined"
            :rel="isExternalCustomerServiceUrl ? 'noopener noreferrer' : undefined"
          >
            <div>
              <UsersRound aria-hidden="true" />
              <span>
                <strong id="contact-title">联系客服 / 加入社群</strong>
                <small>{{ customerServiceText || '获取客服与社群联系方式' }}</small>
              </span>
            </div>
            <ArrowRight aria-hidden="true" />
          </a>

          <div v-else class="contact-row contact-row--static">
            <div>
              <UsersRound aria-hidden="true" />
              <span>
                <strong id="contact-title">联系客服 / 加入社群</strong>
                <small>{{ customerServiceText || '客服联系方式待配置' }}</small>
              </span>
            </div>
            <span class="contact-row__status">上线前补充</span>
          </div>
        </div>
      </section>
    </main>

    <footer class="landing-footer">
      <div class="landing-container">
        <div class="landing-footer__brand">
          <span class="landing-logo-mark landing-logo-mark--footer" aria-hidden="true">
            <img src="/logo-icon.svg?v=ionailabs-20260726" alt="">
          </span>
          <span>IonAiLabs</span>
        </div>
        <p>统一、清晰地使用 AI 模型服务。</p>
      </div>
    </footer>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowRight, Check, Copy, Terminal, UsersRound } from '@lucide/vue'
import FadeContent from '@/components/public/FadeContent.vue'
import modelGroups from '@/data/landing-models.json'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import '@/styles/landing.css'

const router = useRouter()
const appStore = useAppStore()
const authStore = useAuthStore()
const activeModelGroup = ref(modelGroups[0].id)
const activeProtocol = ref('openai')
const copied = ref(false)
let copiedTimer = null
let previousTitle = ''

const protocols = [
  { id: 'openai', label: 'OpenAI', description: 'Chat Completions' },
  { id: 'anthropic', label: 'Anthropic', description: 'Messages API' }
]

const codeExamples = {
  openai: `curl https://ionailabs.cn/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk-your-api-key" \\
  -d '{
    "model": "gpt-5.4",
    "messages": [
      { "role": "user", "content": "Hello" }
    ]
  }'`,
  anthropic: `curl https://ionailabs.cn/v1/messages \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: sk-your-api-key" \\
  -H "anthropic-version: 2023-06-01" \\
  -d '{
    "model": "claude-sonnet-5",
    "max_tokens": 1024,
    "messages": [
      { "role": "user", "content": "Hello" }
    ]
  }'`
}

const activeGroup = computed(() => modelGroups.find(group => group.id === activeModelGroup.value) || modelGroups[0])
const uniqueModelCount = computed(() => new Set(modelGroups.flatMap(group => group.models)).size)
const activeProtocolMeta = computed(() => protocols.find(protocol => protocol.id === activeProtocol.value) || protocols[0])
const activeCode = computed(() => codeExamples[activeProtocol.value])
const customerServiceText = computed(() => appStore.platformInfo.customer_service_text || '')
const customerServiceUrl = computed(() => appStore.platformInfo.customer_service_url || '')
const isExternalCustomerServiceUrl = computed(() => /^https?:\/\//i.test(customerServiceUrl.value))

function goToConsole() {
  if (!authStore.token) {
    router.push('/login')
    return
  }
  const role = authStore.user?.role || localStorage.getItem('userRole')
  router.push(role && role !== 'user' ? '/admin' : '/console')
}

function focusTab(prefix, id) {
  requestAnimationFrame(() => document.getElementById(`${prefix}-${id}`)?.focus())
}

function selectAdjacent(items, currentId, direction) {
  const index = items.findIndex(item => item.id === currentId)
  const nextIndex = (index + direction + items.length) % items.length
  return items[nextIndex].id
}

function handleModelTabKeydown(event, currentId) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const nextId = event.key === 'Home'
    ? modelGroups[0].id
    : event.key === 'End'
      ? modelGroups.at(-1).id
      : selectAdjacent(modelGroups, currentId, event.key === 'ArrowRight' ? 1 : -1)
  activeModelGroup.value = nextId
  focusTab('model-tab', nextId)
}

function setProtocol(id) {
  activeProtocol.value = id
  copied.value = false
}

function handleProtocolTabKeydown(event, currentId) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const nextId = event.key === 'Home'
    ? protocols[0].id
    : event.key === 'End'
      ? protocols.at(-1).id
      : selectAdjacent(protocols, currentId, event.key === 'ArrowRight' ? 1 : -1)
  setProtocol(nextId)
  focusTab('protocol-tab', nextId)
}

async function writeClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  const textArea = document.createElement('textarea')
  textArea.value = text
  textArea.style.position = 'fixed'
  textArea.style.opacity = '0'
  document.body.appendChild(textArea)
  textArea.select()
  document.execCommand('copy')
  textArea.remove()
}

async function copyCode() {
  await writeClipboard(activeCode.value)
  copied.value = true
  window.clearTimeout(copiedTimer)
  copiedTimer = window.setTimeout(() => {
    copied.value = false
  }, 1800)
}

onMounted(() => {
  previousTitle = document.title
  document.title = 'IonAiLabs | 拥抱 AI，开启未来'
  appStore.fetchPlatformInfo()
})

onBeforeUnmount(() => {
  window.clearTimeout(copiedTimer)
  document.title = previousTitle || 'IonAiLabs'
})
</script>
