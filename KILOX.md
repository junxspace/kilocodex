# Kilox - Kilo CLI Fork 使用文档

Kilox 是 [Kilo CLI](https://kilo.ai) 的 fork 版本，保留了 Kilo 的全部功能，同时增加了以下定制化特性。

## 安装

```bash
git clone <repo-url> && cd kilocodex
./install-kilox.sh
```

脚本会自动完成：安装依赖 → 创建 `kilox` 命令 → 链接到 `~/bin/kilox` → 验证。

修改代码后重新运行 `./install-kilox.sh` 即可生效。

## 命令

| 命令 | 说明 |
|---|---|
| `kilox` | 启动 TUI |
| `kilox run "message"` | 非交互模式执行任务 |
| `kilox commit` | 交互式生成 commit message 并提交 |
| `kilox serve` | 启动 HTTP 服务 |
| `kilox --version` | 查看版本 |
| `kilox --help` | 查看帮助 |

---

## 功能一：kilox.json 配置文件

支持 `kilox.json` / `kilox.jsonc` 配置文件，优先级高于 `kilo.json`。

### 配置文件优先级（从高到低）

| 优先级 | 文件 | 作用域 |
|---|---|---|
| 1 | `kilox.jsonc` | 项目/全局 |
| 2 | `kilox.json` | 项目/全局 |
| 3 | `kilo.jsonc` | 项目/全局 |
| 4 | `kilo.json` | 项目/全局 |
| 5 | `opencode.jsonc` | 项目/全局（兼容） |
| 6 | `opencode.json` | 项目/全局（兼容） |

全局配置路径：`~/.config/kilo/kilox.json`

### 使用场景

在 fork 项目中独占配置，不污染原版 `kilo.json`：

```json
{
  "notification": {
    "enabled": true,
    "webhookUrl": "https://open.feishu.cn/open-apis/bot/v2/hook/xxx"
  },
  "provider": {
    "xunfei": {
      "options": {
        "maxRetryAttempts": 3,
        "retryBackoffMs": 5000
      }
    }
  }
}
```

---

## 功能二：通知机制

代码级实现的通知系统，监听 LLM 会话、权限、问题等事件，并按配置执行通知动作。目前支持飞书 Webhook，后续可扩展脚本等其他动作。

### 配置

在 `kilox.json`（或 `kilo.json`）中添加：

```json
{
  "notification": {
    "enabled": true,
    "notify_action": "webhook",
    "webhookUrl": "https://open.feishu.cn/open-apis/bot/v2/hook/your-webhook-id",
    "enabled_events": ["task_completed", "task_error", "permission_required", "question_required", "session_error"],
    "disabled_events": ["task_interrupted"]
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `enabled` | boolean | 否 | 默认 true，设为 false 关闭通知 |
| `notify_action` | `"webhook"` | 否 | 通知执行方式，默认 `webhook`，后续可扩展脚本等执行方式 |
| `webhookUrl` | string | 是 | 飞书自定义机器人 Webhook 地址 |
| `enabled_events` | string[] | 否 | 允许发送的通知事件，默认发送除 `task_interrupted` 外的所有事件 |
| `disabled_events` | string[] | 否 | 禁止发送的通知事件，优先级高于 `enabled_events` |

可配置事件：`task_completed`、`task_error`、`task_interrupted`、`permission_required`、`question_required`、`session_error`。

### 通知事件

配置使用用户可读事件名，不直接暴露内部 Bus 事件。通知模块先把底层事件映射成用户事件，再按 `(enabled_events ?? 默认事件集) - disabled_events` 过滤；当同一轮次出现多个终态事件时，先合并终态，再按最终事件过滤。`disabled_events` 优先级最高。

默认事件集：`task_completed`、`task_error`、`permission_required`、`question_required`、`session_error`。默认不发送 `task_interrupted`，需要时可显式加入 `enabled_events`。

| 用户事件 | 底层事件 | Webhook 状态 | 通知文案 | 触发条件 | 发送策略 |
|---|---|---|---|---|---|
| `task_completed` | `session.turn.close` (`reason: "completed"`) | `completed` | ✅ Kilox 任务完成 | LLM 对话轮次正常结束，用户可以继续输入 prompt | 延迟 1 秒发送，用于和同轮终态事件合并 |
| `task_error` | `session.turn.close` (`reason: "error"`) | `error` | ❌ Kilox 执行中断 | 对话轮次以错误状态结束 | 延迟 1 秒发送 |
| `task_interrupted` | `session.turn.close` (`reason: "interrupted"`) | `interrupted` | ❌ Kilox 执行中断 | 用户主动打断或新 prompt 接管当前轮次 | 默认不发送；显式启用后延迟 1 秒发送 |
| `permission_required` | `permission.asked` | `waiting` | ⏸️ Kilox 等待确认 | 需要用户批准命令执行、文件写入等权限 | 立即发送 |
| `question_required` | `question.asked` | `waiting` | ⏸️ Kilox 等待确认 | AI 主动向用户提问，等待用户回答 | 立即发送 |
| `session_error` | `session.error` | `session_error` | ❌ Kilox 会话异常 | API 错误、Provider 错误、上下文溢出等会话级异常 | 延迟 1 秒发送 |
| 合并规则 | `session.error` + `session.turn.close` (`reason: "completed"`) | 不发送 | 不发送 | 用户主动打断时可能出现的事件组合 | 合并后视为中断并跳过，避免重复通知 |

### 通知格式示例

```
✅ Kilox 任务完成
项目: my-project
任务: 帮我修复登录bug
时间: 2026-06-09 09:05:00
```

### 发送合并与去重

终态事件（完成、错误、中断、会话异常）会延迟 1 秒发送，用于合并同一轮次内可能连续出现的终态事件。相同会话和相同状态的通知会在 5 秒窗口内去重，避免多 turn 或重复事件产生多条重复通知。

### 相关代码

| 文件 | 说明 |
|---|---|
| `src/kilocode/notification.ts` | 通知模块，监听 Bus 事件并发送 Webhook |
| `src/config/config.ts` | `notification` schema 定义 |
| `src/cli/cmd/serve.ts` | daemon/serve 进程中初始化通知监听 |
| `src/cli/cmd/tui/worker.ts` | TUI embedded server 中初始化通知监听 |

---

## 功能三：Provider 级别 API 重试配置

为每个 Provider 配置会话级别的重试策略，遇到 API 错误时自动重试，而非直接终止任务。

### 配置

在 `kilox.json` 的 `provider` 下配置：

```json
{
  "provider": {
    "xunfei": {
      "options": {
        "maxRetryAttempts": 3,
        "retryBackoffMs": 5000
      }
    },
    "deepseek": {
      "options": {
        "maxRetryAttempts": 5,
        "retryBackoffMs": 3000
      }
    }
  }
}
```

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `maxRetryAttempts` | positive int | `KILO_SESSION_RETRY_LIMIT` 或 undefined（不重试） | 会话级最大重试次数 |
| `retryBackoffMs` | positive int | 2000 | 首次重试间隔（毫秒），指数退避（每次翻倍） |

### 与 AI SDK 内置重试（`retries`）的关系

两者是**串联关系**，不冲突：

```
用户请求
  └─ Session Processor（会话层）
       ├─ Effect.retry(SessionRetry.policy)  ← maxRetryAttempts 控制这里
       │    └─ LLM.stream()（AI SDK 层）
       │         └─ maxRetries: retries ?? 0  ← retries 控制这里
       │              └─ HTTP 请求 → Provider API
       └─ 如果 AI SDK 重试耗尽仍失败 → 上抛给 Session 层
            └─ Session 层判断 retryable() → 决定是否 Session 级重试
```

| 维度 | `retries` (AI SDK) | `maxRetryAttempts` (Session) |
|---|---|---|
| 层级 | HTTP 请求级 | 业务/会话级 |
| 作用 | 重试网络错误、5xx | 重试 Provider 特定错误（如 Xunfei EngineInternalError） |
| 重试内容 | 重新发送同一个 HTTP 请求 | 重新发起整个 LLM stream（含 tool call 循环） |
| 退避策略 | 固定间隔 | 指数退避，可配置初始值 |
| 配置方式 | 代码内硬编码（标题生成 retries:2，主对话 retries:0） | `kilox.json` 按 Provider 配置 |
| 错误识别 | HTTP 状态码 | 正则匹配错误消息模式 |

实际总重试次数 = `retries` × `maxRetryAttempts`（最坏情况）。

### 离线检测与自动恢复

当检测到网络断开时（DNS 失败、`ENOTFOUND` 等），会话不会直接终止，而是显示"离线，等待网络恢复…"状态并阻塞等待。网络恢复后自动继续重试，不丢失上下文。

实现位于 `src/kilocode/session/processor.ts` 的 `handleOffline()`，集成在 `policy()` 的 `offline` 钩子中。

### 空 tool_calls 守卫

修复了 LLM 返回 `finish_reason: "tool-calls"` 但实际没有 tool parts 的死循环（参见上游 #7756）。`guardEmptyToolCalls()` 会主动抛错终止此类异常轮次。

### 自动识别为可重试的错误

以下错误模式会被自动识别为可重试（即使 `isRetryable=false`）。仅纳入真正的传输层 / 5xx 故障；4xx 客户端错误（如 `Bad Request`、`Unknown description`）**不会**重试，避免 TUI 假死：

| 错误模式 | 示例 Provider |
|---|---|
| `Xunfei request failed.*code:` | 讯飞 |
| `EngineInternalError` | 讯飞 |
| `NotEnoughCvError` | 讯飞 |
| `Internal Server Error` | 通用 |
| `Service Unavailable` | 通用 |
| `Gateway Timeout` / `Bad Gateway` | 通用 |
| `Connection reset` / `ECONNRESET` | 通用 |
| `ETIMEDOUT` / `socket hang up` | 通用 |
| `Temporary Failure` | 通用 |

此外，所有 5xx 状态码和 `isRetryable=true` 的错误默认可重试。Kilo 认证错误（`KiloAuth*`）被显式排除，不会触发重试。

### 退避计算

```
等待时间 = min(retryBackoffMs × 2^(attempt-1), 30s)
```

示例（`retryBackoffMs=5000`）：

| 重试次数 | 等待时间 |
|---|---|
| 第 1 次 | 5s |
| 第 2 次 | 10s |
| 第 3 次 | 20s |
| 第 4 次 | 30s（封顶） |

如果响应头包含 `retry-after-ms` 或 `retry-after`，会优先使用服务端建议的等待时间。

### 相关代码

| 文件 | 说明 |
|---|---|
| `src/config/provider.ts` | `maxRetryAttempts` / `retryBackoffMs` schema 定义 |
| `src/session/retry.ts` | `retryable()` 函数、`PROVIDER_TRANSIENT_PATTERNS`、`delay()` 支持 `base` 参数 |
| `src/kilocode/session/processor.ts` | `retryOpts()` 从 provider 配置读取重试参数 |
| `src/session/processor.ts` | 调用 `retryOpts` 时传递 provider 配置 |

---

## 功能四：遥测数据写入本地数据库

遥测数据同时写入本地 SQLite 数据库，PostHog 远程上报已禁用（`client.ts` 中 `identify`/`alias`/`shutdown` 均为 no-op）。所有事件仅落本地，不出网。

### 数据库位置

```
~/.local/share/kilo/kilox.db
```

> Kilox 使用独立的数据库文件 `kilox.db`，不影响原版 `kilo.db`。两者可以并存。

### telemetry 表结构

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | INTEGER PK | 自增 ID |
| `event` | TEXT | 事件名称（如 `CLI Start`、`LLM Completion`、`Tool Used`） |
| `distinct_id` | TEXT | 用户标识（已登录为 email，未登录为机器 UUID） |
| `properties` | TEXT | JSON 格式事件属性 |
| `time_created` | INTEGER | 创建时间戳（毫秒） |

### 事件目录

事件名定义在 `packages/kilo-telemetry/src/events.ts`，使用带空格的可读字符串：

| 类别 | 事件名 |
|---|---|
| 生命周期 | `CLI Start`、`CLI Exit` |
| 会话 | `Session Start`、`Session End`、`Session Message` |
| LLM | `LLM Completion`（含 tokens / cost / duration） |
| 功能使用 | `Command Used`、`Tool Used`、`Agent Used`、`Plan Followup`、`Suggestion Shown`、`Suggestion Accepted` |
| 索引 | `Indexing Started`、`Indexing Completed`、`Indexing File Count`、`Indexing Batch Retry`、`Indexing Error` |
| 分享 | `Share Created`、`Share Deleted` |
| MCP | `MCP Server Connected`、`MCP Server Error` |
| 远程 / Auth | `Remote Connection Opened`、`Auth Success`、`Auth Logout` |
| 反馈 / 错误 | `Feedback Submitted`、`Error` |

### 开关控制

| 优先级 | 方式 | 说明 |
|---|---|---|
| 1 | 环境变量 `KILO_TELEMETRY_LEVEL=off` | 强制关闭（设为 `all` 强制开启） |
| 2 | `kilox.json` 中 `experimental.openTelemetry: false` | 配置关闭 |
| 默认 | 开启 | 数据只写本地，无远程上报 |

### 查询示例

```bash
# 总记录数
sqlite3 ~/.local/share/kilo/kilox.db "SELECT COUNT(*) FROM telemetry;"

# 事件频次分布
sqlite3 ~/.local/share/kilo/kilox.db \
  "SELECT event, COUNT(*) AS n FROM telemetry GROUP BY event ORDER BY n DESC;"

# 按日统计
sqlite3 ~/.local/share/kilo/kilox.db \
  "SELECT date(time_created/1000,'unixepoch','localtime') AS day, COUNT(*) AS n
   FROM telemetry GROUP BY day ORDER BY day;"

# 最近 20 条
sqlite3 ~/.local/share/kilo/kilox.db \
  "SELECT id, event, datetime(time_created/1000,'unixepoch','localtime') AS ts,
          substr(properties,1,160) AS props
   FROM telemetry ORDER BY time_created DESC LIMIT 20;"

# 模型用量汇总（tokens / 费用）
sqlite3 ~/.local/share/kilo/kilox.db "
  SELECT json_extract(properties,'\$.modelId')      AS model,
         json_extract(properties,'\$.apiProvider')  AS provider,
         COUNT(*)                                    AS calls,
         SUM(json_extract(properties,'\$.inputTokens'))  AS in_tok,
         SUM(json_extract(properties,'\$.outputTokens')) AS out_tok,
         ROUND(SUM(json_extract(properties,'\$.cost')), 4) AS cost
  FROM telemetry WHERE event='LLM Completion'
  GROUP BY model, provider ORDER BY cost DESC;"

# 工具使用排行
sqlite3 ~/.local/share/kilo/kilox.db "
  SELECT json_extract(properties,'\$.tool') AS tool, COUNT(*) AS n
  FROM telemetry WHERE event='Tool Used'
  GROUP BY tool ORDER BY n DESC;"

# CLI 启动 vs 退出（startup 与 exit 数量差 = 异常退出/未走清理路径的次数）
sqlite3 ~/.local/share/kilo/kilox.db "
  SELECT event, COUNT(*) FROM telemetry
  WHERE event IN ('CLI Start','CLI Exit') GROUP BY event;"

# 错误事件
sqlite3 ~/.local/share/kilo/kilox.db "
  SELECT datetime(time_created/1000,'unixepoch','localtime') AS ts,
         json_extract(properties,'\$.context') AS ctx,
         json_extract(properties,'\$.error')   AS err
  FROM telemetry WHERE event='Error' ORDER BY time_created DESC LIMIT 50;"
```

### 维护

```bash
# 备份
cp ~/.local/share/kilo/kilox.db ~/kilox-telemetry-$(date +%Y%m%d).db

# 清理 30 天前数据
sqlite3 ~/.local/share/kilo/kilox.db \
  "DELETE FROM telemetry WHERE time_created < (strftime('%s','now','-30 days')*1000);
   VACUUM;"

# 完全清空（保留表结构）
sqlite3 ~/.local/share/kilo/kilox.db "DELETE FROM telemetry; VACUUM;"
```

### 相关代码

| 文件 | 说明 |
|---|---|
| `packages/kilo-telemetry/src/events.ts` | 事件枚举（22 个） |
| `packages/kilo-telemetry/src/telemetry.ts` | `Telemetry` 命名空间，所有 `trackXxx()` 函数 |
| `packages/kilo-telemetry/src/client.ts` | PostHog 已禁用，仅调用本地 captureHandler |
| `packages/kilo-telemetry/src/identity.ts` | distinct_id 来源（email / 机器 UUID） |
| `src/storage/telemetry.sql.ts` | Drizzle ORM schema |
| `src/storage/db.ts` | 数据库路径定义（`kilox.db`） |
| `src/index.ts` | 初始化 Telemetry 并注册本地 SQLite CaptureHandler |
| `src/kilocode/server/httpapi/handlers/telemetry.ts` | HTTP `/telemetry/capture` 接口，供 webview / SDK 转发 |

---

## 功能五：品牌定制

所有用户可见的品牌标识已从 "Kilo" 改为 "Kilox"：

| 位置 | 原值 | 新值 |
|---|---|---|
| TUI 标题 | Kilo CLI | Kilox CLI |
| 命令名称 | kilo | kilox |
| Footer 版本 | Kilo local | Kilox dev |
| LOGO | KILO | KILOX |
| 状态对话框 | Kilo v... | Kilox v... |

### 隐藏 IDX Disabled

当 codebase indexing 处于 Disabled 状态时，TUI 底部不显示 "IDX Disabled"，空间完全释放给其他内容。

相关代码：
- `src/kilocode/indexing-label.ts` - "Disabled" 状态返回空字符串
- `src/kilocode/components/session-indexing.tsx` - `Show when={enabled() && label()}`
- `src/cli/cmd/tui/routes/session/footer.tsx` - footer 同样条件控制

---

## 功能六：建议（suggest）工具

LLM 完成任务后可主动列出后续可执行的操作，用户一键即可触发。建议以非阻塞卡片渲染在输入框上方，新输入到来时自动消失。

### 工作原理

| 步骤 | 说明 |
|---|---|
| 1 | LLM 调用 `suggest` 工具，传入 `suggest` 描述 + 1~2 个 `actions` |
| 2 | TUI 顶部出现建议卡片，列出 action label |
| 3 | 用户按数字键或点击 → action.prompt 注入为新一轮用户消息 |
| 4 | 卡片自动 dismiss |

### 使用约束

- 仅在 ≥90% 确信工作真正完成时建议代码审查（`/local-review` 或 `/local-review-uncommitted`），不在每次小修小补后弹出。
- 不用于建议提交、推送、跑测试等其他动作。
- 同一会话内不重复建议同一次审查。

相关代码：
- `src/kilocode/suggestion/index.ts` / `tool.ts` - 工具实现
- `src/kilocode/suggestion/tui/` - 卡片 UI

---

## 功能七：本地代码审查（/local-review）

内置 slash 命令将当前分支（或工作树）的 diff 交给一个独立子会话做多轴 review：正确性、可读性、安全性、测试覆盖等。

| 命令 | 适用范围 |
|---|---|
| `/local-review` | 已提交到当前分支的差异（对比 base 分支：main/master/dev/develop 自动探测） |
| `/local-review-uncommitted` | 工作区未提交变更（staged + unstaged + untracked） |

特点：
- 自动 worktree diff，避免污染当前会话上下文
- 审查 prompt 与命令共置：`src/kilocode/review/local-review.txt`
- 审查结果通过 ReviewTelemetry 单独统计，便于后续度量

相关代码：
- `src/kilocode/review/command.ts` - 命令注册
- `src/kilocode/review/review.ts` - 主流程
- `src/kilocode/review/worktree-diff.ts` - 隔离 diff 生成

---

## 功能八：Plan 模式与计划交接

Plan agent 完成方案后通过 `plan_exit` 工具退出，自动生成：

1. 计划文件（默认写入 `.kilo/plans/`，路径可在配置中自定义 — #10952）
2. 给实现 agent 的 handover 摘要
3. 后续 followup prompt，供下一轮直接接续

修复要点（最近几次发布）：
- `#10991` 新会话不再复制 Plan 模式中可见的对话历史，防止上下文污染
- `#11000` 子 agent fork 时的隔离恢复，子会话状态不再串流回父会话
- 自动恢复会话标题（commit `a59b255b`），plan 完成后会话名不再丢失

相关代码：
- `src/kilocode/plan-followup.ts` - followup / handover 生成
- `src/kilocode/plan-file.ts` - 计划文件读写
- `src/kilocode/tool/plan.ts` - `plan_exit` 工具

---

## 功能九：Skill slash 命令

`.kilo/skills/*/SKILL.md` 和全局 `~/.agents/skills/*` 中的 skill 会在 TUI slash 命令补全里以 badge 形式列出，敲 `/` 即可看到与项目相关的可用 skill 并直接调用。

CLI 二进制中内置了一个 `kilo-config` skill（参见 `src/kilocode/skills/kilo-config.md`），首次运行无需额外配置即可介绍 Kilo 自身的配置体系。

补全去歧逻辑见 `2099feba9b`，避免同名 skill 与内置命令冲突。

相关代码：
- `src/kilocode/skills/builtin.ts` - 内置 skill 注册
- `src/kilocode/skills/kilo-config.md` - 内置 kilo-config skill 内容
- `test/kilocode/skill-command-autocomplete.test.ts` - 补全测试

---

## 功能十：KiloClaw 内置聊天

通过 `/kiloclaw`（或 `/claw`）打开 Kilo Gateway 团队聊天面板。需要已登录 Kilo Gateway 账号并选定 team。

相关命令：
- `/profile` - Kilo Gateway profile 查看 / 切换
- `/teams` - team 选择
- `/kiloclaw`、`/claw` - 进入聊天

相关代码：
- `src/kilocode/claw/` - 客户端、UI、事件流
- `src/kilocode/cli/cmd/profile.ts` - profile 命令
- `src/kilocode/kilo-commands.tsx` - 命令注册

---

## 功能十一：交互式 Git 提交

`kilox commit` 提供完整的交互式提交流程：展示 staged / unstaged / untracked 文件列表，分析变更是否属于同一提交意图，按意图用明确文件路径暂存相关文件，生成 commit message，确认或编辑后执行 `git commit -m`。

### 基本使用

```bash
kilox commit
```

执行流程：

1. 展示 staged、unstaged、untracked 文件列表。
2. 运行 `git diff` 和 `git diff --staged` 审查变更内容。
3. 分析所有变更是否属于同一个提交意图；如果存在多个独立意图，按意图拆分为多个 commit。
4. 对每个意图先执行 `git reset` 清理暂存区，再用 `git add <明确文件路径>` 暂存该意图相关文件。
5. 使用 `commit_message.model`、`small_model` 或默认模型生成 Conventional Commits 风格的 commit message。
6. 展示生成结果，允许选择 commit、edit、regenerate 或 cancel。
7. 确认后执行 `git commit -m <message>`。
8. 如果没有任何代码可提交，会询问是否执行 `git push`。

### 常用参数

| 参数 | 说明 |
|---|---|
| `--all` | 兼容参数；当前提交流程会按意图分析并用明确文件路径暂存 |
| `--include-untracked` | 兼容参数；untracked files 会参与意图分析，是否暂存取决于所属意图 |
| `--message "fix: ..."` | 跳过 AI 生成，直接使用指定 commit message |
| `--previous "..."` | 重新生成时避开指定的上一条 message |
| `--yes` | 跳过确认，自动同意提交或无变更时的 push |
| `--dry-run` | 只展示生成结果，不执行 `git reset`、`git add` 或 `git commit` |
| `--dir <path>` | 在指定目录中执行 |

### 示例

```bash
# 分析当前所有变更，按意图暂存并提交
kilox commit

# 自动同意所有确认；无变更时自动执行 git push
kilox commit --yes

# 使用指定 message，跳过 AI 生成
kilox commit --message "fix(cli): handle commit flow"

# 预览生成结果，不修改 Git 状态
kilox commit --dry-run
```

### commit_message 配置

Commit message 生成支持项目或全局 Kilo 配置中的 `commit_message`：

```jsonc
{
  "commit_message": {
    "prompt": "使用中文生成简洁的 Conventional Commit message。",
    "model": "kilo/kilo-auto/small"
  }
}
```

字段说明：

| 字段 | 说明 |
|---|---|
| `commit_message.prompt` | 自定义 commit message 生成的 system prompt；设置后会替代默认 Conventional Commits prompt |
| `commit_message.model` | 指定 commit message 生成模型，格式与顶层 `model` / `small_model` 相同，均为 `provider/model` |

模型选择优先级：

1. `commit_message.model`
2. `small_model`
3. 当前默认 provider 的可用小模型
4. 默认模型

如果只想全局配置便宜、快速的小模型，也可以继续使用顶层 `small_model`：

```json
{
  "small_model": "kilo/kilo-auto/small"
}
```

### 安全行为

- 每次提交前都会展示 staged、unstaged、untracked 文件列表，并运行 `git diff` / `git diff --staged`。
- 不使用 `git add .`，也不使用交互式暂存命令。
- 暂存时只使用 `git add <明确文件路径>`，并按分析出的提交意图暂存相关文件。
- 多个独立意图会拆成多个 commit。
- `--yes` 只自动确认命令判断，不会改变按意图拆分和明确暂存文件的规则。
- `--dry-run` 不执行 `git reset`、`git add` 或 `git commit`。

相关代码：
- `src/kilocode/cli/cmd/commit.ts` - 交互式提交命令
- `src/kilocode/commit-message/generate.ts` - commit message 生成主流程
- `src/kilocode/commit-message/git-context.ts` - Git 上下文采集

---

## 功能十二：会话导出（暂时禁用）

会话导出能力（worker 异步打包 → Zstd 压缩 → 敏感信息 scrub → 推送云端）已实现完整链路，代码位于 `src/kilocode/session-export/`。

**当前状态：临时关闭**（`189f251866`：`fix(cli): temporarily disable session export`）。等待上游决策后再启用。代码与测试保留可随时打开。

---

## 附：Kilo 命名空间下的其他模块

`src/kilocode/` 下还包含若干较小的辅助模块（仅列举，未在上文展开）：

| 模块 | 说明 |
|---|---|
| `daemon/` | 后台 daemon 进程客户端/服务端 |
| `console/`、`cli/cmd/console.ts` | 控制台模式 UI |
| `cli/cmd/roll-call.ts` | 设备/会话点名 |
| `agent-manager/` | 与 VS Code Agent Manager 协同 |
| `snapshot/` | 文件变更快照与 full diff |
| `indexing-worker*` | 后台 worker 化的代码索引 |
| `migrators` (modes/rules/workflows/mcp/ignore) | 配置迁移 |
| `permission/` | 外部目录、配置路径、ENV 等扩展权限规则 |
| `tool/` 各扩展工具 | semantic-search、xlsx、docx、notebook、encoded-io、background-process、task、agent-manager 等 |
| `worktree-cleanup.ts` / `worktree-family.ts` | git worktree 协助 |
| `global-stamp.ts` | 全局配置时间戳，多进程间热重载同步 |
