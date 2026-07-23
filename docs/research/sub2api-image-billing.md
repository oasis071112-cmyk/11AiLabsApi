# Sub2API 自动生图与计费调研（2026-07-19）

## 调研边界

仅采用 Sub2API 官方 GitHub 源码。以下链接固定到本次核对的官方提交 `d4b9797ff72024960a035cf22fdd8f213e149169`；结论针对该版本，后续版本可能改变。

本调研回答三个问题：图像生成入口/自动调用如何处理、系统怎样识别实际生图模型、以及生图与聊天成本是否被拆成两笔独立流水。

## 已确认的实现

### 1. 同时支持专用生图端点和 Responses 原生工具

- 路由分类把 `/v1/images/generations`（以及 `/images/generations`、编辑端点）识别为专用图像生成端点。[官方端点分类](https://github.com/Wei-Shaw/sub2api/blob/d4b9797ff72024960a035cf22fdd8f213e149169/backend/internal/handler/endpoint.go)
- 对 `/v1/responses`，`IsExplicitImageGenerationIntent` 将以下任一情况认定为生图意图：专用生图端点、`gpt-image-*` 模型、`tools` 中原生 `image_generation`，或 `tool_choice` 显式选择该工具。它刻意不把 Codex 被动声明的 `image_gen` namespace 当作显式生图，避免所有 Codex 请求都被错误限流或拒绝。[官方意图判定](https://github.com/Wei-Shaw/sub2api/blob/d4b9797ff72024960a035cf22fdd8f213e149169/backend/internal/service/image_generation_intent.go#L39-L124)
- 因而 Sub2API 的“检测”主要依据**请求中已经声明/选择的工具或图片模型**，以及随后返回的图片结果；不是凭用户自然语言“帮我画一张”推断。

### 2. 仅 Codex/OpenAI 路径有可选的自动工具桥接

- 配置 `gateway.codex_image_generation_bridge_enabled` 默认 `false`；注释明确说明它会为 Codex `/v1/responses` 自动注入 `image_generation` 工具和桥接指令，默认关闭以免改写纯文本请求。[官方配置](https://github.com/Wei-Shaw/sub2api/blob/d4b9797ff72024960a035cf22fdd8f213e149169/backend/internal/config/config.go#L810-L815) [默认值](https://github.com/Wei-Shaw/sub2api/blob/d4b9797ff72024960a035cf22fdd8f213e149169/backend/internal/config/config.go#L2054-L2061)
- 启用条件限定为 Codex CLI、非 Responses Lite、分组允许生图、未设置 strip 策略且开关有效；满足时才注入原生工具/桥接指令。[官方转发条件与注入](https://github.com/Wei-Shaw/sub2api/blob/d4b9797ff72024960a035cf22fdd8f213e149169/backend/internal/service/openai_gateway_forward.go#L211-L217) [注入调用](https://github.com/Wei-Shaw/sub2api/blob/d4b9797ff72024960a035cf22fdd8f213e149169/backend/internal/service/openai_gateway_forward.go#L289-L299)
- 本次核对未发现对应的 Anthropic/Claude 自动生图工具注入实现；因此这部分只能作为 **OpenAI/Codex 参考**，不能直接推断 Claude Opus 已具备同一流程。

### 3. 实际生图模型和张数由 Responses 处理链带入最终结果

- WebSocket Responses 入站会在判定为生图意图后，从请求体解析图片的计费模型、尺寸层级与输入尺寸；这些值传入转发链。[官方入站解析](https://github.com/Wei-Shaw/sub2api/blob/d4b9797ff72024960a035cf22fdd8f213e149169/backend/internal/service/openai_ws_forwarder_ingress.go#L312-L323)
- 解析采用第一个原生 `image_generation` 工具的 `model` 和 `size`；工具没有 `model` 时默认 `gpt-image-2`，再不满足才回退请求模型。[官方模型/尺寸解析](https://github.com/Wei-Shaw/sub2api/blob/d4b9797ff72024960a035cf22fdd8f213e149169/backend/internal/service/image_generation_intent.go#L422-L505)
- 转发链扫描响应事件、累计真实图片输出项；当张数大于零时，把 `ImageCount`、尺寸和 `BillingModel` 写回同一个 `OpenAIForwardResult`。[官方响应归集](https://github.com/Wei-Shaw/sub2api/blob/d4b9797ff72024960a035cf22fdd8f213e149169/backend/internal/service/openai_ws_http_bridge.go#L284-L310)
- 非 WebSocket Responses 的完成事件同样从 `response.output` 内的 `image_generation_call` 读取非空结果并计数，且读取 `response.tool_usage.image_gen` 作为图片工具用量。[官方 Responses 图片解析](https://github.com/Wei-Shaw/sub2api/blob/d4b9797ff72024960a035cf22fdd8f213e149169/backend/internal/service/openai_images_responses.go#L426-L469)
- 官方测试覆盖主模型 `gpt-5.4` 请求中指定 `tools:[{type:image_generation, model:gpt-image-2}]` 的情形，断言最终结果为 1 张、`BillingModel=gpt-image-2`；这正是“从主模型工具调用识别生图模型”的直接参考。[官方测试](https://github.com/Wei-Shaw/sub2api/blob/d4b9797ff72024960a035cf22fdd8f213e149169/backend/internal/service/openai_ws_forwarder_success_test.go#L368-L378)

### 4. 生图可按图/尺寸计费并记录明细，但一次 Responses 调用只形成一条用量流水

- `RecordUsage` 先依据 `result.BillingModel` 选择计费模型，构造 Token 和 image token 桶，再将 `ImageCount`、图片输入/输出 token、图片尺寸等写入一条 `UsageLog`。[官方 OpenAI 用量记录](https://github.com/Wei-Shaw/sub2api/blob/d4b9797ff72024960a035cf22fdd8f213e149169/backend/internal/service/openai_gateway_usage.go#L113-L209) [同一日志的字段赋值](https://github.com/Wei-Shaw/sub2api/blob/d4b9797ff72024960a035cf22fdd8f213e149169/backend/internal/service/openai_gateway_usage.go#L249-L305)
- 费用选择是互斥的：若有图片产出且渠道没有明确配置 `token` 模式，走“图片模型 + 标准化尺寸层级 + 图片数量 + 图片倍率”的 `CalculateImageCost`；只有渠道明确 `token` 计费时才继续走 token 成本路径。[官方分支](https://github.com/Wei-Shaw/sub2api/blob/d4b9797ff72024960a035cf22fdd8f213e149169/backend/internal/service/openai_gateway_usage.go#L389-L447) [官方图片计费调用](https://github.com/Wei-Shaw/sub2api/blob/d4b9797ff72024960a035cf22fdd8f213e149169/backend/internal/service/openai_gateway_usage.go#L512-L524)
- `UsageLog` 本身有普通 token 成本、图片 token 成本、`image_count`、尺寸/来源/明细和总成本字段。[官方用量日志结构](https://github.com/Wei-Shaw/sub2api/blob/d4b9797ff72024960a035cf22fdd8f213e149169/backend/internal/service/usage_log.go#L136-L180)
- 因此 Sub2API 在该路径的账务表现是：**一次上游 Responses 请求，一条聚合使用流水与一个总扣费**；默认生图是图片成本路径，并不额外生成 GPT 主模型 token 的第二笔借记。它也不接收模型 tool call 后再自行发起第二个 `/images` 请求，而是把一个带原生工具的 Responses 请求转给上游，由上游在该请求中执行工具。并不是“主聊天调用一条扣费流水 + 工具生图调用再独立一条扣费流水，再由父任务汇总”。通用写入流程也以单个 `UsageLog` 调用 `applyUsageBilling` 后保存为准。[官方计费与写入流程](https://github.com/Wei-Shaw/sub2api/blob/d4b9797ff72024960a035cf22fdd8f213e149169/backend/internal/service/gateway_usage_billing.go#L636-L756)

## 对 11AiLabs 方案的可借鉴点与边界

1. 借鉴“**请求预判 + 响应证实**”：请求阶段只用于能力授权、预估/预留和路由；只有从工具配置/响应中解析到实际 image model 且出现真实图片输出后，才创建实际图片成本，防止自然语言误判和失败请求误扣。
2. 记录 `parent_request_id`/`task_id`，在同一用户任务下新增两条不可变子流水：`chat`（主模型 token）和 `image`（实际图像模型、张数、尺寸、质量、可选 image token）；任务表或聚合查询保存两者总额。这个比 Sub2API 的单行聚合更符合“拆两笔、最终汇总”的目标。
3. 生图模型必须来自协议层的最终证据（如 OpenAI Responses 原生工具的 `tools[].model` 与 `image_generation_call`/输出事件），并存储来源与置信度；不要从“GPT-5.5/Claude Opus”名称静态推导。
4. OpenAI/Codex 与 Anthropic 分别适配：Sub2API 的自动桥接只给 Codex/OpenAI 参考，Claude Opus 需要根据实际接入协议明确其工具声明、工具结果、真实上游请求以及结算回调，不能直接复制 OpenAI 的字段解析。

## 资料版本

- 官方仓库：[`Wei-Shaw/sub2api`](https://github.com/Wei-Shaw/sub2api/tree/d4b9797ff72024960a035cf22fdd8f213e149169)
- 本次核对提交：`d4b9797ff72024960a035cf22fdd8f213e149169`
