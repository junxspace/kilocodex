import { $ } from "bun"
import path from "path"
import { describe, expect, test } from "bun:test"
import { handle, parseStatus } from "../../src/kilocode/cli/cmd/commit"
import { tmpdir } from "../fixture/fixture"

async function log(dir: string) {
  const result = await $`git log -1 --pretty=%B`.cwd(dir).quiet()
  return result.stdout.toString().trim()
}

async function tracked(dir: string) {
  const result = await $`git ls-files`.cwd(dir).quiet()
  return result.stdout.toString().trim().split("\n").filter(Boolean)
}

describe("commit command", () => {
  test("parseStatus separates staged, unstaged, and untracked files", () => {
    const status = parseStatus("M  staged.ts\n M unstaged.ts\nA  added.ts\n?? new.ts\nMM both.ts\n")
    expect(status.staged).toEqual(["staged.ts", "added.ts", "both.ts"])
    expect(status.unstaged).toEqual(["unstaged.ts", "both.ts"])
    expect(status.untracked).toEqual(["new.ts"])
  })

  test("commits staged changes with a generated message after confirmation", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(path.join(tmp.path, "file.txt"), "hello\n")
    await $`git add file.txt`.cwd(tmp.path).quiet()

    const out: string[] = []
    await handle({
      dir: tmp.path,
      generate: async () => ({ message: "feat: add file" }),
      selectAction: async () => "commit",
      output: (text) => out.push(text),
    })

    expect(await log(tmp.path)).toBe("feat: add file")
    expect(out.join("\n")).toContain("Staged changes:")
    expect(out.join("\n")).toContain("file.txt")
  })

  test("stages tracked changes with --all when nothing is staged", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, "file.txt"), "hello\n")
        await $`git add file.txt`.cwd(dir).quiet()
        await $`git commit -m "add file"`.cwd(dir).quiet()
      },
    })
    await Bun.write(path.join(tmp.path, "file.txt"), "hello\nworld\n")

    await handle({
      dir: tmp.path,
      all: true,
      generate: async () => ({ message: "fix: update file" }),
      selectAction: async () => "commit",
      output: () => {},
    })

    expect(await log(tmp.path)).toBe("fix: update file")
  })

  test("does not include untracked files with --all", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, "file.txt"), "hello\n")
        await $`git add file.txt`.cwd(dir).quiet()
        await $`git commit -m "add file"`.cwd(dir).quiet()
      },
    })
    await Bun.write(path.join(tmp.path, "file.txt"), "hello\nworld\n")
    await Bun.write(path.join(tmp.path, "new.txt"), "secret\n")

    await handle({
      dir: tmp.path,
      all: true,
      generate: async () => ({ message: "fix: update tracked file" }),
      selectAction: async () => "commit",
      output: () => {},
    })

    expect(await tracked(tmp.path)).not.toContain("new.txt")
  })

  test("dry run does not stage tracked changes", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, "file.txt"), "hello\n")
        await $`git add file.txt`.cwd(dir).quiet()
        await $`git commit -m "add file"`.cwd(dir).quiet()
      },
    })
    await Bun.write(path.join(tmp.path, "file.txt"), "hello\nworld\n")
    const errors: string[] = []

    await handle({
      dir: tmp.path,
      all: true,
      dryRun: true,
      generate: async () => ({ message: "fix: update file" }),
      output: () => {},
      error: (text) => errors.push(text),
      exit: () => {},
    })

    const status = await $`git status --porcelain`.cwd(tmp.path).quiet()
    expect(status.stdout.toString()).toBe(" M file.txt\n")
    expect(errors).toContain("No staged changes found")
  })

  test("includes untracked files with --include-untracked", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(path.join(tmp.path, "new.txt"), "hello\n")

    await handle({
      dir: tmp.path,
      includeUntracked: true,
      generate: async () => ({ message: "feat: add new file" }),
      selectAction: async () => "commit",
      output: () => {},
    })

    expect(await log(tmp.path)).toBe("feat: add new file")
    expect(await tracked(tmp.path)).toContain("new.txt")
  })

  test("CLI command loads project context before reading config", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(path.join(tmp.path, "file.txt"), "hello\n")

    const result = await $`bun run --conditions=browser src/index.ts commit --dir ${tmp.path} --dry-run`
      .cwd(path.join(import.meta.dir, "../.."))
      .quiet()
      .nothrow()
    const text = result.stdout.toString() + result.stderr.toString()

    expect(result.exitCode).toBe(1)
    expect(text).toContain("No staged changes found")
    expect(text).not.toContain("No context found for instance")
  })

  test("regenerates with previous message", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(path.join(tmp.path, "file.txt"), "hello\n")
    await $`git add file.txt`.cwd(tmp.path).quiet()
    const previous: Array<string | undefined> = []
    const actions: Array<"regenerate" | "commit"> = ["regenerate", "commit"]

    await handle({
      dir: tmp.path,
      generate: async (input) => {
        previous.push(input.previousMessage)
        return { message: input.previousMessage ? "feat: add regenerated file" : "feat: add file" }
      },
      selectAction: async () => actions.shift() ?? "commit",
      output: () => {},
    })

    expect(previous).toEqual([undefined, "feat: add file"])
    expect(await log(tmp.path)).toBe("feat: add regenerated file")
  })
})
