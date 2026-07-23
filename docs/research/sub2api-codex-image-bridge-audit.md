# Sub2API Codex 图片桥接复核（2026-07-23）

## 结论

当前 Sub2API 的 `codex_image_generation_bridge` 不是把 Anthropic / Claude 的请求转成另一个图片渠道的独立调用。它是 **OpenAI 账号上的 Codex CLI Responses WebSocket 入站请求改写**：向同一份 `response.create` payload 注入 `image_generation` 工具和桥接指令，再把该请求发往原本选定的 OpenAI 上游。

因此，已核对的实现链路是：一轮上游 Responses 调用、一个 `OpenAIForwardResult`、一条 `UsageLog`。图片成功时，这一条日志进入图片计费模式；没有“Claude LLM 调用 + 另一个现有图片模型调用”的两次渠道请求或两条用量记录。

## 直接证据

- [PR #2937](https://github.com/Wei-Shaw/sub2api/pull/2937) 的摘要明确为：为 Codex CLI WebSocket 入站请求注入 `image_generation` 工具与 bridge instructions；对应测试仅覆盖该注入。
- 合并提交 [3ba4a51](https://github.com/Wei-Shaw/sub2api/commit/3ba4a51) 修改的文件只有 `backend/internal/service/openai_ws_forwarder.go` 与其 WebSocket ingress 测试。其路径先判定官方 Codex 客户端、分组图片权限和账号开关，再在同一 payload 上调用 `ensureOpenAIResponsesImageGenerationTool`、规范化工具并追加 instructions，随后继续原有模型映射和上游 WS 转发。
- 该测试的账号是 `PlatformOpenAI` / OAuth，并设置 `Extra["codex_image_generation_bridge"] = true`；测试使用单个上游 WebSocket capture connection。未涉及 Anthropic 账号、图片渠道选择或第二次 HTTP/WS 调用。
- [当前 `RecordUsage` 实现](https://github.com/Wei-Shaw/sub2api/blob/main/backend/internal/service/openai_gateway_usage.go) 先对同一个 `OpenAIForwardResult` 应用图片计费解析，再创建一个 `UsageLog`；图片字段（数量、尺寸）与 `BillingMode=image` 写在这同一条日志中。

## 术语澄清

“Claude 调用图片桥接，继而调用另一套 Codex / GPT Image 服务”可以由客户端插件或另行编写的平台编排器实现，但不是上述 Sub2API 开关在已核对源码中的行为。若 11AiLabs 需要该产品能力，必须新增明确的跨渠道工具执行编排、两次调用的幂等与两笔账单结算；不能把它当作 Sub2API Codex bridge 的现成行为直接移植。
