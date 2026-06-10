import { GlobalBus, type GlobalEvent } from "@/bus/global"
import { Session } from "@/session/session"
import { Permission } from "@/permission/index"
import { Question } from "@/question/index"
import { Config, type Interface as ConfigService } from "@/config/config"
import * as Log from "@opencode-ai/core/util/log"
import { Database as StorageDatabase } from "@/storage/db" // kilocode_change
import { Database } from "bun:sqlite"
import { readlinkSync } from "fs"
import path from "path"

const log = Log.create({ service: "notification" })

function terminalName(): string {
  try {
    const link = readlinkSync("/dev/fd/2")
    return path.basename(link)
  } catch (err) {
    log.debug("failed to read terminal name", { err })
    return ""
  }
}

function dbFile(): string {
  return StorageDatabase.getChannelPath()
}

function sessionTitle(sessionID: string): string {
  try {
    const db = new Database(dbFile(), { readonly: true })
    const row = db.query("SELECT title FROM session WHERE id = $id").get({ $id: sessionID }) as { title: string } | null
    db.close()
    if (row?.title && row.title !== "New Session") return row.title
  } catch (err) {
    log.debug("failed to read session title", { err, sessionID })
  }
  return ""
}

function userMessage(sessionID: string): string {
  try {
    const db = new Database(dbFile(), { readonly: true })
    const row = db.query(`SELECT p.data FROM part p JOIN message m ON p.message_id = m.id WHERE m.session_id = $id AND json_extract(m.data, '$.role') = 'user' ORDER BY p.time_created DESC LIMIT 1`).get({ $id: sessionID }) as { data: string } | null
    db.close()
    if (row?.data) {
      const data = JSON.parse(row.data) as Record<string, unknown>
      const text = typeof data?.text === "string" ? data.text : ""
      if (text) return text.length > 80 ? text.slice(0, 80) + "..." : text
    }
  } catch (err) {
    log.debug("failed to read user message", { err, sessionID })
  }
  return ""
}

export type NotificationEvent =
  | "task_completed"
  | "task_error"
  | "task_interrupted"
  | "permission_required"
  | "question_required"
  | "session_error"

export type NotifyAction = "webhook"

export interface NotificationConfig {
  webhookUrl: string
  enabled: boolean
  action: NotifyAction
  enabledEvents?: string[]
  disabledEvents?: string[]
}

const DEFAULT_EVENTS = new Set<NotificationEvent>([
  "task_completed",
  "task_error",
  "permission_required",
  "question_required",
  "session_error",
])

const VALID_EVENTS = new Set<NotificationEvent>([
  "task_completed",
  "task_error",
  "task_interrupted",
  "permission_required",
  "question_required",
  "session_error",
])

const STATUS_LABEL: Record<string, string> = {
  completed: "任务完成",
  interrupted: "执行中断",
  error: "执行中断",
  waiting: "等待确认",
  session_error: "会话异常",
}

const STATUS_EMOJI: Record<string, string> = {
  completed: "✅",
  interrupted: "❌",
  error: "❌",
  waiting: "⏸️",
  session_error: "❌",
}

function projectName(directory: string): string {
  return path.basename(directory)
}

function formatTime(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19)
}

const inflight = new Set<Promise<unknown>>()
const pending = new Map<string, { timer: ReturnType<typeof setTimeout>; status: string; directory: string }>()
const TERMINAL_DELAY_MS = 1000

export function resolveTerminalStatus(current: string | undefined, next: string): string | null {
  if (current === "interrupted") return null
  if (current === "session_error" && next === "completed") return null
  if (current === "completed" && next === "session_error") return null
  return next
}

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

export function shouldNotify(cfg: Pick<NotificationConfig, "enabledEvents" | "disabledEvents">, event: NotificationEvent) {
  if (cfg.disabledEvents?.includes(event)) return false
  const base = cfg.enabledEvents ? new Set(cfg.enabledEvents.filter((item) => VALID_EVENTS.has(item as NotificationEvent))) : DEFAULT_EVENTS
  return base.has(event)
}

function terminal(status: string) {
  return status === "completed" || status === "interrupted" || status === "error" || status === "session_error"
}

function statusEvent(status: string): NotificationEvent | null {
  if (status === "completed") return "task_completed"
  if (status === "error") return "task_error"
  if (status === "interrupted") return "task_interrupted"
  if (status === "session_error") return "session_error"
  return null
}

async function sendWebhook(
  url: string,
  status: string,
  sessionID: string,
  directory: string,
): Promise<void> {
  const emoji = STATUS_EMOJI[status] ?? "✅"
  const label = STATUS_LABEL[status] ?? "通知"
  const title = sessionTitle(sessionID)
  const msg = userMessage(sessionID)
  const tty = terminalName()

  const lines = [`${emoji} Kilox ${label}`]
  lines.push(`项目: ${projectName(directory)}`)
  if (tty) lines.push(`终端: ${tty}`)
  if (title) lines.push(`标题: ${title}`)
  if (msg) lines.push(`消息: ${msg}`)
  lines.push(`时间: ${formatTime()}`)

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ msg_type: "text", content: { text: lines.join("\n") } }),
    })
    if (!response.ok) {
      log.error("notification send failed", { status: response.status, sessionID })
      return
    }
    log.info("notification sent", { status: response.status, sessionID })
  } catch (err) {
    log.error("notification send error", { error: String(err), sessionID })
  }
}

function send(cfg: NotificationConfig, sessionID: string, event: NotificationEvent, status: string, directory: string) {
  if (!shouldNotify(cfg, event)) {
    log.info("notification skipped", { reason: "event_disabled", event, sessionID, status, directory })
    return
  }
  if (!cfg.webhookUrl) {
    log.info("notification skipped", { reason: "missing_webhook", event, sessionID, status, directory })
    return
  }

  const dedupKey = `${sessionID}:${status}`
  if (dedupRecent.has(dedupKey)) {
    log.info("notification skipped", { reason: "deduped", event, sessionID, status, directory })
    return
  }
  dedupRecent.add(dedupKey)
  setTimeout(() => dedupRecent.delete(dedupKey), 5000)

  log.info("notification dispatch", { action: cfg.action, event, sessionID, status, directory })
  const p = (() => {
    if (cfg.action === "webhook") return sendWebhook(cfg.webhookUrl, status, sessionID, directory)
    return Promise.resolve()
  })()
  inflight.add(p)
  p.finally(() => inflight.delete(p))
}

function dispatch(cfg: NotificationConfig, sessionID: string, event: NotificationEvent, status: string, directory: string) {
  if (!terminal(status)) {
    send(cfg, sessionID, event, status, directory)
    return
  }

  const item = pending.get(sessionID)
  const next = resolveTerminalStatus(item?.status, status)
  if (item) clearTimeout(item.timer)
  if (!next) {
    pending.delete(sessionID)
    log.info("notification skipped", { reason: "interrupted", sessionID, status, directory })
    return
  }

  const timer = setTimeout(() => {
    pending.delete(sessionID)
    const evt = statusEvent(next)
    if (!evt) return
    send(cfg, sessionID, evt, next, directory)
  }, TERMINAL_DELAY_MS)
  pending.set(sessionID, { timer, status: next, directory })
}

const dedupRecent = new Set<string>()

async function getConfig(): Promise<NotificationConfig | null> {
  try {
    const { AppRuntime } = await import("@/effect/app-runtime")
    const cfg = await AppRuntime.runPromise(Config.Service.use((svc: ConfigService) => svc.getGlobal()))
    const notif = cfg.notification
    if (!notif || typeof notif !== "object") return null
    return {
      webhookUrl: notif.webhookUrl ?? "",
      enabled: notif.enabled !== false,
      action: notif.notify_action ?? "webhook",
      enabledEvents: notif.enabled_events,
      disabledEvents: notif.disabled_events,
    }
  } catch (err) {
    log.error("notification config error", { error: String(err) })
    return null
  }
}

async function handle(evt: GlobalEvent) {
  const directory = evt.directory
  const payload = evt.payload
  if (!payload || !directory) return
  const type = payload.type
  const props = (payload.properties ?? {}) as Record<string, unknown>
  const sessionID = typeof props.sessionID === "string" ? props.sessionID : ""
  if (!sessionID) {
    log.info("notification skipped", { reason: "missing_session", type, directory })
    return
  }

  const item = notificationEvent(type, props)
  if (!item) return

  log.info("notification event received", { type, event: item.event, sessionID, status: item.status, directory })
  const cfg = await getConfig()
  if (!cfg) {
    log.info("notification skipped", { reason: "missing_config", sessionID, status: item.status, directory })
    return
  }
  if (!cfg.enabled) {
    log.info("notification skipped", { reason: "disabled", sessionID, status: item.status, directory })
    return
  }
  dispatch(cfg, sessionID, item.event, item.status, directory)
}

let initialized = false

export async function setupNotification(): Promise<void> {
  if (initialized) return
  initialized = true
  log.info("notification listener enabled")
  GlobalBus.on("event", (evt: GlobalEvent) => {
    const p = handle(evt)
    inflight.add(p)
    p.finally(() => inflight.delete(p))
  })
}
