# Sub2API 图片自动生图：用户调用记录显示的模型

调研版本：`Wei-Shaw/sub2api` `main@ba88cc239cdbe689bc5785dd36238caf6ecb14ef`（2026-07-23）。

## 结论

对于 OpenAI `/responses` 中由 `image_generation` 工具触发、但工具未声明图片模型的调用，Sub2API 的用户端调用记录**既不显示**默认图片计费模型 `gpt-image-2`，也**不显示**价格兜底模型 `gpt-image-1.5` / `gpt-image-1`。

用户端显示的是客户端原始请求模型（典型为发起对话的 GPT 模型），并显示该记录的图片数量、尺寸、计费模式和金额。因此，自动生图的用户可见模型通常仍是 `gpt-5.x`，而非 `gpt-image-*`。

## 证据链

1. 图片工具未声明 `model` 时，内部图片计费模型被设为 `gpt-image-2`；这是内部 `OpenAIResponsesImageBillingConfig.Model`，不是日志展示字段。
   - [image_generation_intent.go:442-459](https://github.com/Wei-Shaw/sub2api/blob/ba88cc239cdbe689bc5785dd36238caf6ecb14ef/backend/internal/service/image_generation_intent.go#L442-L459)
2. 缺少价格时，价格服务顺序查找 `gpt-image-2`、`gpt-image-1.5`、`gpt-image-1`，并只返回匹配的价格对象；代码没有把候选模型回写到调用结果或 `UsageLog`。
   - [pricing_service.go:960-967](https://github.com/Wei-Shaw/sub2api/blob/ba88cc239cdbe689bc5785dd36238caf6ecb14ef/backend/internal/service/pricing_service.go#L960-L967)
3. `OpenAIForwardResult` 区分了用于显示的 `Model` 和仅用于成本计算的 `BillingModel`。
   - [openai_gateway_service.go:221-234](https://github.com/Wei-Shaw/sub2api/blob/ba88cc239cdbe689bc5785dd36238caf6ecb14ef/backend/internal/service/openai_gateway_service.go#L221-L234)
4. 创建账单时，`UsageLog.Model` 取 `result.Model`，`RequestedModel` 保存原始请求模型；日志没有 `BillingModel`、价格兜底模型或图片模型来源字段。
   - [openai_gateway_usage.go:243-272](https://github.com/Wei-Shaw/sub2api/blob/ba88cc239cdbe689bc5785dd36238caf6ecb14ef/backend/internal/service/openai_gateway_usage.go#L243-L272)
   - [usage_log.go:99-193](https://github.com/Wei-Shaw/sub2api/blob/ba88cc239cdbe689bc5785dd36238caf6ecb14ef/backend/internal/service/usage_log.go#L99-L193)
5. 用户 DTO 优先将 `RequestedModel` 序列化为 API 字段 `model`；用户页面的共用表格直接渲染 `row.model`。用户页复用该表格。
   - [mappers.go:595-610](https://github.com/Wei-Shaw/sub2api/blob/ba88cc239cdbe689bc5785dd36238caf6ecb14ef/backend/internal/handler/dto/mappers.go#L595-L610)
   - [UsageTable.vue:55-73](https://github.com/Wei-Shaw/sub2api/blob/ba88cc239cdbe689bc5785dd36238caf6ecb14ef/frontend/src/components/admin/usage/UsageTable.vue#L55-L73)
   - [user UsageView.vue:173-184](https://github.com/Wei-Shaw/sub2api/blob/ba88cc239cdbe689bc5785dd36238caf6ecb14ef/frontend/src/views/user/UsageView.vue#L173-L184)

## 对 11AiLabs 的含义

若要采用 Sub2API 的用户体验，应显示用户发起请求的主模型，并用“图片计费”及图片数量/尺寸/金额说明成本；`gpt-image-2` 默认值和 `gpt-image-1.5/1` 的价格兜底只适合管理端审计字段，不应被当作上游实际模型展示给用户。
