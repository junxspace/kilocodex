# Kilo 特有功能实现文档

> 本文档记录从 git commit 8b446465dbf94d2a6ca23460479ac914e597be8d 到最新提交的所有 Kilo 特有功能实现(代码目录：~/Workspace/opensource/kilocodex)，用于在 opencode 源码中重新实现这些功能。

---

## 1. 交互式 Commit 命令

### 功能名称
CLI `kilo commit` 命令 - 基于 AI 生成 Conventional Commit 消息

### 涉及的文件路径

| 文件路径 | 状态 | 说明 |
|---------|------|------|
| `packages/opencode/src/kilocode/cli/cmd/commit.ts` | 新增 | Commit 命令主实现 |
| `packages/opencode/src/kilocode/cli/invocation-directory.ts` | 新增 | 解析命令调用目录 |
| `packages/opencode/src/kilocode/commit-message/generate.ts` | 新增 | AI 生成 commit 消息逻辑 |
| `packages/opencode/src/kilocode/commit-message/types.ts` | 新增 | 类型定义 |
| `packages/opencode/src/kilocode/commit-message/git-context.ts` | 新增 | Git 上下文获取 |
| `packages/opencode/src/kilocode/config/config.ts` | 新增 | `commit_message.model` 配置项 |
| `packages/opencode/src/kilocode/commands.ts` | 修改 | 注册 commit 命令 |
| `packages/opencode/src/index.ts` | 修改 | 导入 commit 命令 |
| `packages/opencode/src/cli/effect-cmd.ts` | 修改 | 使用 `invocationDirectory()` |

### 实现要点

#### 1.1 核心工作流程

```typescript
// packages/opencode/src/kilocode/cli/cmd/commit.ts

// 1. 解析 git status 获取变更状态
export function parseStatus(text: string): Status {
  const staged = new Set<string>()
  const unstaged = new Set<string>()
  const untracked = new Set<string>()
  for (const line of text.split("\n")) {
    if (!line) continue
    const code = line.slice(0, 2)
    const path = line.slice(3)
    if (!path) continue
    if (code === "??") {
      untracked.add(path)
      continue
    }
    if (code[0] !== " ") staged.add(path)
    if (code[1] !== " ") unstaged.add(path)
  }
  return { staged: [...staged], unstaged: [...unstaged], untracked: [...untracked] }
}

// 2. 分析 commit 意图
async function analyze(input: { path: string; status: Status }): Promise<IntentResult> {
  const ctx = await getGitContext(input.path)
  return {
    intents: [{
      files: ctx.files.map((file) => file.path),
      description: "commit related changes",
    }],
  }
}

// 3. 生成 commit 消息
const result = await gen({ 
  path: root, 
  selectedFiles: intent.files, 
  previousMessage: prev, 
  prompt: args.prompt, 
  intent 
})
```

#### 1.2 关键特性

- **Intent-based staging**: 分析变更意图，按文件路径精确 staging
- **Push confirmation**: 无变更时提示是否 push 当前分支
- **`--yes` flag**: 自动确认，无需交互
- **`--dry-run` flag**: 只显示消息，不创建 commit
- **自定义模型配置**: `commit_message.model` 支持指定生成模型

#### 1.3 配置扩展

```typescript
// packages/opencode/src/kilocode/config/config.ts

export const CommitMessageSchema = Schema.optional(
  Schema.Struct({
    prompt: Schema.optional(Schema.String),
    model: Schema.optional(Schema.String), // provider/model 格式
  }),
)
```

#### 1.4 调用目录解析

```typescript
// packages/opencode/src/kilocode/cli/invocation-directory.ts

export function invocationDirectory(dir?: string, env = process.env.KILO_ORIG_CWD, cwd = process.cwd()) {
  const base = env ?? cwd
  if (dir) return path.resolve(base, dir)
  return base
}
```

---

## 2. TUI Commit 插件

### 功能名称
TUI 内置 `/commit` 命令 - 在 TUI 中直接调用 commit 功能

### 涉及的文件路径

| 文件路径 | 状态 | 说明 |
|---------|------|------|
| `packages/opencode/src/kilocode/plugins/commit.tsx` | 新增 | TUI commit 插件实现 |
| `packages/opencode/src/cli/cmd/tui/plugin/internal.ts` | 修改 | 注册 KiloCommit 插件 |

### 实现要点

```typescript
// packages/opencode/src/kilocode/plugins/commit.tsx

const tui: TuiPlugin = async (api) => {
  const [busy, setBusy] = createSignal(false)
  api.keymap.registerLayer({
    commands: [{
      name: "kilo.commit",
      title: "Commit changes",
      desc: "Generate a commit message and commit changes",
      category: "Git",
      namespace: "palette",
      slashName: "commit",
      enabled: () => !busy(),
      run() {
        if (busy()) return
        setBusy(true)
        void run(api)
          .then(() => api.ui.dialog.clear())
          .catch((err) => api.ui.toast({ variant: "error", message: message(err) }))
          .finally(() => setBusy(false))
      },
    }],
    bindings: api.tuiConfig.keybinds.gather("kilo.commit", ["kilo.commit"]),
  })
}
```

### 关键 API 使用

- `api.ui.dialog.replace()` - 替换对话框内容
- `api.ui.dialog.clear()` - 清除对话框
- `api.ui.toast()` - 显示提示消息
- `api.ui.DialogSelect()` - 选择对话框
- `api.ui.DialogPrompt()` - 输入对话框
- `api.ui.DialogConfirm()` - 确认对话框

---

## 3. 终端状态重置工具

### 功能名称
Terminal Reset Utilities - 确保 TUI 退出后终端状态正确恢复

### 涉及的文件路径

| 文件路径 | 状态 | 说明 |
|---------|------|------|
| `packages/opencode/src/kilocode/cli/cmd/tui/util/terminal.ts` | 新增 | 终端工具函数 |
| `packages/opencode/src/cli/cmd/tui/app.tsx` | 修改 | Exit 处理添加 reset |
| `packages/opencode/src/cli/cmd/tui/context/exit.tsx` | 修改 | Exit handler 添加 reset |

### 实现要点

```typescript
// packages/opencode/src/kilocode/cli/cmd/tui/util/terminal.ts

// 1. 终端序列重置
export function sequences() {
  return [
    "\x1b[?9l",      // disable X10 mouse tracking
    "\x1b[?1000l",   // disable normal mouse tracking
    "\x1b[?1002l",   // disable button-event mouse tracking
    "\x1b[?1003l",   // disable any-event mouse tracking
    "\x1b[?2004l",   // disable bracketed paste
    "\x1b[?2026l",   // disable synchronized output mode
    "\x1b[?1049l",   // disable alternate screen buffer
    "\x1b[?25h",     // show cursor
    "\x1b[0m",       // reset text attributes
  ]
}

// 2. 重置终端状态
export function resetTerminalState() {
  try {
    fs.writeSync(process.stdout.fd, sequences().join(""))
    flushTerminalInput()
  } catch (err) {
    console.error("resetTerminalState failed", err)
  }
}

// 3. 包装器确保函数执行后重置
export async function withReset<T>(fn: () => Promise<T>, reset = resetTerminalState) {
  try {
    return await fn()
  } finally {
    reset()
  }
}

// 4. 刷新终端输入缓冲
export function flushTerminalInput(input: Input = process.stdin, flush?: Tcflush) {
  if (process.platform !== "darwin" && process.platform !== "linux") return
  if (!input.isTTY) return
  // 使用 FFI 调用 tcflush
  const tcflush = flush ?? (() => {
    handle ??= lib()
    return handle.symbols.tcflush
  })()
  tcflush(input.fd, TCIFLUSH)
}
```

### 退出处理集成

```typescript
// packages/opencode/src/cli/cmd/tui/context/exit.tsx

const exit: Exit = (reason?: unknown) => {
  // ...
  resetTerminalState()  // 在 destroy 前重置
  await withReset(async () => renderer.destroy())
  // ...
}
```

---

## 4. 无效工具修复

### 功能名称
Invalid Tool Repair - 自动修复 LLM 生成的无效工具调用

### 涉及的文件路径

| 文件路径 | 状态 | 说明 |
|---------|------|------|
| `packages/opencode/src/session/llm.ts` | 修改 | 添加 invalidToolRepair |

### 实现要点

```typescript
// packages/opencode/src/session/llm.ts

export const invalidToolRepair = (toolName: string, message: string) => ({
  input: JSON.stringify({
    tool: toolName,
    error: message,
  }),
  toolName: "invalid" as const,
})

// 在 streamText 配置中使用
const result = streamText({
  // ...
  async experimental_repairToolCall(failed) {
    const lower = failed.toolCall.toolName.toLowerCase()
    if (lower !== failed.toolCall.toolName && sortedTools[lower]) {
      return {
        ...failed.toolCall,
        toolName: lower,
      }
    }
    return {
      ...failed.toolCall,
      ...invalidToolRepair(failed.toolCall.toolName, failed.error.message),
    }
  },
})
```

---

## 5. Dev 版本回退

### 功能名称
Source Version Fallback - 开发环境版本号生成

### 涉及的文件路径

| 文件路径 | 状态 | 说明 |
|---------|------|------|
| `packages/core/src/kilocode/version.ts` | 新增 | dev 版本生成 |
| `packages/core/src/installation/version.ts` | 修改 | 使用 sourceVersion 回退 |

### 实现要点

```typescript
// packages/core/src/kilocode/version.ts

export function devVersion(input: { version: string; sha: string }) {
  const version = input.version || "unknown"
  const sha = input.sha ? input.sha.slice(0, 7) : "nogit"
  return `dev-${version}+${sha}`
}

export function sourceVersion() {
  const version = (() => {
    try {
      const data = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../package.json"), "utf8"))
      return data.version ?? ""
    } catch {
      return ""
    }
  })()

  const sha = (() => {
    const result = spawnSync("git", ["rev-parse", "--short=7", "HEAD"], {
      cwd: path.resolve(import.meta.dirname, "../../.."),
      encoding: "utf8",
    })
    if (result.status !== 0) return ""
    return result.stdout.trim()
  })()

  return devVersion({ version, sha })
}

// packages/core/src/installation/version.ts

export const InstallationVersion = typeof KILO_VERSION === "string" ? KILO_VERSION : sourceVersion()
```

---

## 6. 通知系统

### 功能名称
Notification System - Webhook 通知支持

### 涉及的文件路径

| 文件路径 | 状态 | 说明 |
|---------|------|------|
| `packages/opencode/src/kilocode/notification.ts` | 新增 | 通知系统实现 |

### 实现要点

```typescript
// packages/opencode/src/kilocode/notification.ts

export type NotificationEvent =
  | "task_completed"
  | "task_error"
  | "task_interrupted"
  | "permission_required"
  | "question_required"
  | "session_error"

// 跳过子会话的终端事件通知
export function shouldSkipTerminalSession(event: NotificationEvent, session: { parentID?: string | null } | null) {
  if (!session?.parentID) return false
  return event === "task_completed" || event === "task_error" || event === "task_interrupted"
}

// 事件映射
export function notificationEvent(type: string, props: Record<string, unknown>): { event: NotificationEvent; status: string } | null {
  if (type === Session.Event.TurnClose.type) {
    const reason = props.reason
    if (reason === "completed") return { event: "task_completed", status: "completed" }
    if (reason === "error") return { event: "task_error", status: "error" }
    return { event: "task_interrupted", status: "interrupted" }
  }
  if (type === Permission.Event.Asked.type) return { event: "permission_required", status: "waiting" }
  if (type === Question.Event.Asked.type) return { event: "question_required", status: "waiting" }
  if (type === Session.Event.Error.type) return { event: "session_error", status: "session_error" }
  return null
}

// 初始化
export async function setupNotification(): Promise<void> {
  if (initialized) return
  initialized = true
  GlobalBus.on("event", (evt: GlobalEvent) => {
    const p = handle(evt)
    inflight.add(p)
    p.finally(() => inflight.delete(p))
  })
}
```

---

## 按模块分组总结

### packages/opencode/src/kilocode/

| 目录/文件 | 功能 | 状态 |
|----------|------|------|
| `cli/cmd/commit.ts` | CLI commit 命令 | 新增 |
| `cli/cmd/tui/util/terminal.ts` | 终端工具函数 | 新增 |
| `cli/invocation-directory.ts` | 调用目录解析 | 新增 |
| `commit-message/generate.ts` | AI commit 消息生成 | 新增 |
| `commit-message/types.ts` | 类型定义 | 新增 |
| `commit-message/git-context.ts` | Git 上下文获取 | 新增 |
| `config/config.ts` | Kilo 配置扩展 | 新增 |
| `notification.ts` | 通知系统 | 新增 |
| `plugins/commit.tsx` | TUI commit 插件 | 新增 |
| `commands.ts` | 命令注册 | 修改 |

### packages/core/src/kilocode/

| 目录/文件 | 功能 | 状态 |
|----------|------|------|
| `version.ts` | Dev 版本生成 | 新增 |

### 修改的上游文件 (含 kilocode_change 标记)

| 文件路径 | 修改内容 |
|---------|---------|
| `packages/opencode/src/session/llm.ts` | 添加 `invalidToolRepair` 函数 |
| `packages/opencode/src/cli/effect-cmd.ts` | 使用 `invocationDirectory()` |
| `packages/opencode/src/cli/cmd/tui/app.tsx` | 添加终端重置、错误处理 |
| `packages/opencode/src/cli/cmd/tui/context/exit.tsx` | Exit handler 添加 reset |
| `packages/opencode/src/cli/cmd/tui/plugin/internal.ts` | 注册 Kilo 插件 |
| `packages/opencode/src/index.ts` | 导入 commit 命令 |
| `packages/core/src/installation/version.ts` | 使用 `sourceVersion()` 回退 |

---

## 测试文件列表

| 文件路径 | 说明 |
|---------|------|
| `packages/opencode/test/kilocode/commit-command.test.ts` | Commit 命令测试 |
| `packages/opencode/test/kilocode/terminal.test.ts` | 终端工具测试 |
| `packages/opencode/test/kilocode/invocation-directory.test.ts` | 调用目录测试 |
| `packages/opencode/test/kilocode/commit-message/generate.test.ts` | Commit 消息生成测试 |
| `packages/opencode/test/kilocode/notification.test.ts` | 通知系统测试 |
| `packages/opencode/test/kilocode/tui-commit-plugin.test.ts` | TUI commit 插件测试 |
| `packages/core/test/kilocode/version.test.ts` | 版本生成测试 |
| `packages/opencode/test/session/llm.test.ts` | LLM 测试 (含 invalidToolRepair) |
