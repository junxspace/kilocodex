import { describe, expect, test } from "bun:test"
import path from "path"
import { Flag } from "@opencode-ai/core/flag/flag" // kilocode_change
import { Global } from "@opencode-ai/core/global"
import { xdgData } from "xdg-basedir" // kilocode_change
import { Database } from "@/storage/db"

describe("Database.Path", () => {
  test("returns database path for the current channel", () => {
    // kilocode_change start — test preload sets KILO_DB=:memory:
    if (Flag.KILO_DB) {
      const expected =
        Flag.KILO_DB === ":memory:" || path.isAbsolute(Flag.KILO_DB)
          ? Flag.KILO_DB
          : path.join(Global.Path.data, Flag.KILO_DB)
      expect(Database.Path).toBe(expected)
      return
    }
    // kilocode_change end
    // kilocode_change start - default database remains at legacy kilo path
    const root = xdgData?.replace(/[\r\n]+/g, "") ?? path.join(Global.Path.home, ".local", "share")
    expect(Database.getChannelPath()).toBe(path.join(root, "kilo", "kilo.db"))
    // kilocode_change end
  })
})
