# Sub2API 渠道与分组管理调研（2026-07-15）

## 调研边界

仅采用 Sub2API 官方 GitHub 仓库及其公开源码。以下链接固定到本次核对的官方提交 `d515c3045ce838976ebedab87846aaaf893dbbf6`，避免后续版本变化造成结论漂移。

## 已确认的 Sub2API 设计

### 1. “渠道”不是单个上游 URL，而是面向分组的计费、模型映射与可见模型策略

- Sub2API 的 `Channel` 包含名称、启用状态、关联分组、模型定价、模型映射、限制模型开关与计费模型来源；它并不存放一个上游 URL 或 API Key。上游凭证在独立的 `Account` 实体中管理。[官方 Channel 定义](https://github.com/Wei-Shaw/sub2api/blob/d515c3045ce838976ebedab87846aaaf893dbbf6/backend/internal/service/channel.go) [官方 Account 定义](https://github.com/Wei-Shaw/sub2api/blob/d515c3045ce838976ebedab87846aaaf893dbbf6/backend/ent/schema/account.go)
- 创建渠道需要唯一名称；可选填写关联分组、模型定价、模型映射、是否限制模型及功能配置。创建后默认启用，并立即重建渠道缓存。[官方创建逻辑](https://github.com/Wei-Shaw/sub2api/blob/d515c3045ce838976ebedab87846aaaf893dbbf6/backend/internal/service/channel_service.go) [官方管理接口入参](https://github.com/Wei-Shaw/sub2api/blob/d515c3045ce838976ebedab87846aaaf893dbbf6/backend/internal/handler/admin/channel_handler.go)

### 2. 分组是调度边界；账号可多归属，渠道与分组是一对一归属

- `Group` 自身包含平台、状态、倍率、模型路由、可见模型列表配置和后备分组等策略；账号与分组通过 `account_groups` 建立多对多关系，因此一个账号可以加入多个分组。[官方 Group 定义](https://github.com/Wei-Shaw/sub2api/blob/d515c3045ce838976ebedab87846aaaf893dbbf6/backend/ent/schema/group.go) [官方 Account–Group 关系](https://github.com/Wei-Shaw/sub2api/blob/d515c3045ce838976ebedab87846aaaf893dbbf6/backend/ent/schema/account.go)
- 一个分组不能同时归属于多个渠道：创建/更新渠道时会检查该分组是否已在其他渠道；渠道缓存也采用 `groupID → channel` 的映射。[官方冲突校验与缓存结构](https://github.com/Wei-Shaw/sub2api/blob/d515c3045ce838976ebedab87846aaaf893dbbf6/backend/internal/service/channel_service.go)
- API Key 绑定一个分组；请求依据该分组解析渠道映射/限制，再从该分组内可调度账号选择上游。该分组也可配置“无效请求时的后备分组”。[官方网关选择入口](https://github.com/Wei-Shaw/sub2api/blob/d515c3045ce838976ebedab87846aaaf893dbbf6/backend/internal/service/gateway_scheduling.go) [官方分组后备字段](https://github.com/Wei-Shaw/sub2api/blob/d515c3045ce838976ebedab87846aaaf893dbbf6/backend/ent/schema/group.go)

### 3. 模型权限、展示与实际转发分层处理

- 该系统以“分组 + 平台 + 模型”查找渠道模型定价和映射，支持精确模型名与尾部通配符；只在同平台内匹配，避免跨平台同名模型误配。[官方缓存与查找实现](https://github.com/Wei-Shaw/sub2api/blob/d515c3045ce838976ebedab87846aaaf893dbbf6/backend/internal/service/channel_service.go)
- 渠道可启用“限制模型”；未被该分组渠道定价覆盖的模型会在调度前被拒绝。`models_list_config` 只控制 `/v1/models` 的展示，不改变实际调度。[官方限制与映射逻辑](https://github.com/Wei-Shaw/sub2api/blob/d515c3045ce838976ebedab87846aaaf893dbbf6/backend/internal/service/channel_service.go) [官方展示列表字段说明](https://github.com/Wei-Shaw/sub2api/blob/d515c3045ce838976ebedab87846aaaf893dbbf6/backend/ent/schema/group.go)

### 4. 调度、优先级与故障回退均在“账号池”层完成

- 账号持有平台、凭证、并发、优先级、可调度状态、限流/过载/临时不可调度时间等字段。优先级数值越小越优先。[官方账号字段](https://github.com/Wei-Shaw/sub2api/blob/d515c3045ce838976ebedab87846aaaf893dbbf6/backend/ent/schema/account.go)
- 对同一组内候选账号，网关先过滤不可调度、平台不符、模型不支持、模型限流和配额/RPM 不满足者；再按优先级、负载率、最后使用时间排序，且支持粘性会话。模型路由规则可以在普通选择前优先指定账号集合。[官方选择与排序实现](https://github.com/Wei-Shaw/sub2api/blob/d515c3045ce838976ebedab87846aaaf893dbbf6/backend/internal/service/gateway_scheduling.go)
- 账号可保存 `rate_limit_reset_at`、`overload_until` 与临时不可调度原因，使 429、过载等异常在冷却期内自动避开该账号，而不是永久删除渠道。[官方状态字段](https://github.com/Wei-Shaw/sub2api/blob/d515c3045ce838976ebedab87846aaaf893dbbf6/backend/ent/schema/account.go) [官方 README 的 401/403/429 行为说明](https://github.com/Wei-Shaw/sub2api/blob/d515c3045ce838976ebedab87846aaaf893dbbf6/README.md#L783-L784)

### 5. 健康监控独立于请求调度

- Sub2API 另有独立 `ChannelMonitor`：配置一个 provider、endpoint、加密 API Key、主/附加探测模型、分组名、检测周期和最近检测时间；探测结果保存状态、延迟、消息和时间，可计算 7/15/30 天可用率。这是监控/展示数据模型，不等同于网关选择的账号池。[官方监控配置定义](https://github.com/Wei-Shaw/sub2api/blob/d515c3045ce838976ebedab87846aaaf893dbbf6/backend/ent/schema/channel_monitor.go) [官方监控结果与可用率定义](https://github.com/Wei-Shaw/sub2api/blob/d515c3045ce838976ebedab87846aaaf893dbbf6/backend/internal/service/channel_monitor_types.go)

## 与 11AiLabs 当前架构的高层对照

- 当前项目已把“上游 URL + Key + 优先级 + 权重 + 健康分 + 熔断状态”放在 `upstream_channels`，每个模型通过 `models.channel_id` 指向单一上游；用户 API Key 再通过 `api_key_permissions` 按模型授权。[当前初始化结构](../../backend/src/database/init.js)
- 因此不能机械复制 Sub2API 的“渠道=计费产品、账号=真正上游”命名，否则会把现有 `upstream_channels` 的含义弄混。可借鉴的是其职责拆分：**上游渠道/账号池**、**路由分组**、**模型目录与授权**、**独立质量监控**。
- 当前已有 `priority`、`weight`、`health_score`、失败统计及断路器，适合作为“上游渠道”层的调度能力；新增“分组”时应只决定：哪些上游渠道进入池、模型对用户的别名/可见性、默认/后备路由与授权范围，不应复制上游 API Key。

## 对后续方案的约束建议（调研结论，不是实施）

1. 管理界面改用三个清晰对象：**路由分组** → **上游渠道** → **模型规则**。新建上游渠道时先选/新建分组；一个渠道可加入多个分组，分组内可以有多个渠道。
2. 保留当前渠道的 URL、Key、健康检测、优先级、权重、熔断字段；将这些统称为“上游渠道配置”。不要将 Sub2API 的 Channel 表直接照搬。
3. 分组应提供模型白名单/别名和默认回退分组；用户 API Key 可被授予一个或多个分组，而不再逐项依赖原始渠道名称。
4. 自定义渠道应以“协议类型”而不是“厂商名称”建模：首版可支持 OpenAI-compatible；后续增加 Anthropic/Gemini/DeepSeek 原生适配器。名称只用于展示与分组。
5. 官方价格的手动输入保持独立模型层：录入价格来源、币种、计费单位和手动锁定标记；分组/渠道变更不能改写已完成调用的价格快照。

## 资料版本

- 官方仓库：[`Wei-Shaw/sub2api`](https://github.com/Wei-Shaw/sub2api/tree/d515c3045ce838976ebedab87846aaaf893dbbf6)
- 调研时 HEAD：`d515c3045ce838976ebedab87846aaaf893dbbf6`
