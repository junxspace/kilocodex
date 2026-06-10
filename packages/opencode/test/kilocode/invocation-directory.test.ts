import path from "path"
import { describe, expect, test } from "bun:test"
import { invocationDirectory } from "../../src/kilocode/cli/invocation-directory"

describe("invocationDirectory", () => {
  test("prefers original wrapper cwd", () => {
    expect(invocationDirectory(undefined, "/worktree", "/repo/packages/opencode")).toBe("/worktree")
  })

  test("resolves relative directories from original wrapper cwd", () => {
    expect(invocationDirectory("app", "/worktree", "/repo/packages/opencode")).toBe(path.resolve("/worktree/app"))
  })

  test("falls back to process cwd", () => {
    const orig = process.env.KILO_ORIG_CWD
    delete process.env.KILO_ORIG_CWD
    try {
      expect(invocationDirectory()).toBe(process.cwd())
    } finally {
      if (orig === undefined) delete process.env.KILO_ORIG_CWD
      if (orig !== undefined) process.env.KILO_ORIG_CWD = orig
    }
  })
})
