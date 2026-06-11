import { describe, expect, test } from "bun:test"
import { Config } from "../../src/config/config"
import { Permission } from "../../src/permission"
import { Question } from "../../src/question"
import { Session } from "../../src/session/session"
import {
  notificationEvent,
  resolveTerminalStatus,
  shouldNotify,
  shouldSkipTerminalSession,
  type NotificationConfig,
} from "../../src/kilocode/notification"

const cfg = (input: Partial<NotificationConfig> = {}): NotificationConfig => ({
  webhookUrl: "https://example.com/webhook",
  enabled: true,
  action: "webhook",
  ...input,
})

describe("notification terminal status", () => {
  test("drops user interrupt terminal pairs", () => {
    expect(resolveTerminalStatus("session_error", "completed")).toBeNull()
    expect(resolveTerminalStatus("completed", "session_error")).toBeNull()
  })

  test("keeps real terminal statuses", () => {
    expect(resolveTerminalStatus(undefined, "completed")).toBe("completed")
    expect(resolveTerminalStatus(undefined, "interrupted")).toBe("interrupted")
    expect(resolveTerminalStatus(undefined, "session_error")).toBe("session_error")
    expect(resolveTerminalStatus(undefined, "error")).toBe("error")
  })
})

describe("notification events", () => {
  test("skips terminal child session notifications", () => {
    expect(shouldSkipTerminalSession("task_completed", { parentID: "ses_parent" })).toBe(true)
    expect(shouldSkipTerminalSession("task_error", { parentID: "ses_parent" })).toBe(true)
    expect(shouldSkipTerminalSession("task_interrupted", { parentID: "ses_parent" })).toBe(true)
    expect(shouldSkipTerminalSession("permission_required", { parentID: "ses_parent" })).toBe(false)
    expect(shouldSkipTerminalSession("task_completed", { parentID: undefined })).toBe(false)
  })

  test("maps bus events to user events", () => {
    expect(notificationEvent(Session.Event.TurnClose.type, { reason: "completed" })).toEqual({
      event: "task_completed",
      status: "completed",
    })
    expect(notificationEvent(Session.Event.TurnClose.type, { reason: "error" })).toEqual({
      event: "task_error",
      status: "error",
    })
    expect(notificationEvent(Session.Event.TurnClose.type, { reason: "interrupted" })).toEqual({
      event: "task_interrupted",
      status: "interrupted",
    })
    expect(notificationEvent(Permission.Event.Asked.type, {})).toEqual({
      event: "permission_required",
      status: "waiting",
    })
    expect(notificationEvent(Question.Event.Asked.type, {})).toEqual({
      event: "question_required",
      status: "waiting",
    })
    expect(notificationEvent(Session.Event.Error.type, {})).toEqual({
      event: "session_error",
      status: "session_error",
    })
  })

  test("uses default event set", () => {
    expect(shouldNotify(cfg(), "task_completed")).toBe(true)
    expect(shouldNotify(cfg(), "task_error")).toBe(true)
    expect(shouldNotify(cfg(), "permission_required")).toBe(true)
    expect(shouldNotify(cfg(), "question_required")).toBe(true)
    expect(shouldNotify(cfg(), "session_error")).toBe(true)
    expect(shouldNotify(cfg(), "task_interrupted")).toBe(false)
  })

  test("supports enabled_events allowlist", () => {
    const item = cfg({ enabledEvents: ["task_completed"] })

    expect(shouldNotify(item, "task_completed")).toBe(true)
    expect(shouldNotify(item, "task_error")).toBe(false)
  })

  test("supports empty enabled_events", () => {
    expect(shouldNotify(cfg({ enabledEvents: [] }), "task_completed")).toBe(false)
  })

  test("disabled_events wins over enabled_events", () => {
    const item = cfg({ enabledEvents: ["task_completed", "task_error"], disabledEvents: ["task_completed"] })

    expect(shouldNotify(item, "task_completed")).toBe(false)
    expect(shouldNotify(item, "task_error")).toBe(true)
  })
})

describe("notification config", () => {
  test("accepts notify_action and event lists", () => {
    const parsed = Config.Info.zod.parse({
      notification: {
        enabled: true,
        notify_action: "webhook",
        webhookUrl: "https://example.com/webhook",
        enabled_events: ["task_completed", "task_error"],
        disabled_events: ["task_interrupted"],
      },
    })

    expect(parsed.notification?.notify_action).toBe("webhook")
    expect(parsed.notification?.enabled_events).toEqual(["task_completed", "task_error"])
    expect(parsed.notification?.disabled_events).toEqual(["task_interrupted"])
  })

  test("rejects unknown notify_action", () => {
    expect(() =>
      Config.Info.zod.parse({
        notification: {
          notify_action: "script",
        },
      }),
    ).toThrow()
  })

  test("rejects unknown notification events", () => {
    expect(() =>
      Config.Info.zod.parse({
        notification: {
          enabled_events: ["unknown_event"],
        },
      }),
    ).toThrow()
  })
})
