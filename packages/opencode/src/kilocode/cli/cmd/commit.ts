import type { Argv } from "yargs"
import path from "path"
import * as prompts from "@clack/prompts"
import { Effect } from "effect"
import { effectCmd } from "../../../cli/effect-cmd"
import { UI } from "../../../cli/ui"
import { Config } from "../../../config/config"
import { generateCommitMessage } from "../../commit-message"

export type Status = {
  staged: string[]
  unstaged: string[]
  untracked: string[]
}

type GitResult = {
  code: number
  stdout: string
  stderr: string
}

type Action = "commit" | "edit" | "regenerate" | "cancel"
type Stage = "tracked" | "all" | "cancel"

type Args = {
  dir?: string
  all?: boolean
  includeUntracked?: boolean
  message?: string
  yes?: boolean
  dryRun?: boolean
  previous?: string
  prompt?: string
  git?: (args: string[], cwd: string) => GitResult
  generate?: typeof generateCommitMessage
  selectStage?: (status: Status) => Promise<Stage>
  selectAction?: (message: string) => Promise<Action>
  edit?: (message: string) => Promise<string | undefined>
  output?: (text: string) => void
  error?: (text: string) => void
  exit?: (code: number) => void
}

type CliArgs = {
  dir?: string
  all?: boolean
  "include-untracked"?: boolean
  message?: string
  previous?: string
  yes?: boolean
  "dry-run"?: boolean
}

function git(args: string[], cwd: string): GitResult {
  const result = Bun.spawnSync(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
  })
  return {
    code: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  }
}

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
  return {
    staged: [...staged],
    unstaged: [...unstaged],
    untracked: [...untracked],
  }
}

function format(title: string, files: string[]) {
  if (files.length === 0) return `${title}:\n  none`
  return `${title}:\n${files.map((file) => `  ${file}`).join("\n")}`
}

function empty(status: Status) {
  return status.staged.length === 0 && status.unstaged.length === 0 && status.untracked.length === 0
}

function check(result: GitResult, error: (text: string) => void, exit: (code: number) => void) {
  if (result.code === 0) return true
  error(result.stderr.trim() || result.stdout.trim() || "git command failed")
  exit(result.code || 1)
  return false
}

async function selectStage(status: Status): Promise<Stage> {
  const options = [
    ...(status.unstaged.length > 0 ? [{ value: "tracked", label: "Stage tracked changes" }] : []),
    ...(status.untracked.length > 0 ? [{ value: "all", label: "Stage all changes" }] : []),
    { value: "cancel", label: "Cancel" },
  ]
  const result = await prompts.select({
    message: "No staged changes found. What do you want to stage?",
    options,
  })
  if (prompts.isCancel(result)) return "cancel"
  return result as Stage
}

async function selectAction(message: string): Promise<Action> {
  const result = await prompts.select({
    message: `Generated commit message:\n\n${message}\n\nCommit with this message?`,
    options: [
      { value: "commit", label: "Commit" },
      { value: "edit", label: "Edit" },
      { value: "regenerate", label: "Regenerate" },
      { value: "cancel", label: "Cancel" },
    ],
  })
  if (prompts.isCancel(result)) return "cancel"
  return result as Action
}

async function edit(message: string) {
  const result = await prompts.text({
    message: "Edit commit message",
    initialValue: message,
  })
  if (prompts.isCancel(result)) return undefined
  return String(result).trim()
}

export async function handle(args: Args) {
  const cwd = args.dir ? path.resolve(process.cwd(), args.dir) : process.cwd()
  const run = args.git ?? git
  const out = args.output ?? ((text: string) => process.stdout.write(text + "\n"))
  const error = args.error ?? UI.error
  const exit = args.exit ?? ((code: number) => (process.exitCode = code))
  const statusResult = run(["status", "--porcelain"], cwd)
  if (!check(statusResult, error, exit)) return

  let status = parseStatus(statusResult.stdout)
  out(format("Staged changes", status.staged))
  out(format("Unstaged changes", status.unstaged))
  out(format("Untracked files", status.untracked))

  if (empty(status)) {
    error("No changes found")
    exit(1)
    return
  }

  if (status.staged.length === 0) {
    if (args.dryRun) {
      error("No staged changes found")
      exit(1)
      return
    }
    const stage = args.all ? "tracked" : args.includeUntracked ? "all" : await (args.selectStage ?? selectStage)(status)
    if (stage === "cancel") {
      out("Cancelled")
      return
    }
    const stageResult = run(stage === "all" ? ["add", "-A"] : ["add", "-u"], cwd)
    if (!check(stageResult, error, exit)) return
    const next = run(["status", "--porcelain"], cwd)
    if (!check(next, error, exit)) return
    status = parseStatus(next.stdout)
    if (status.staged.length === 0) {
      error("No staged changes found")
      exit(1)
      return
    }
  }

  const gen = args.generate ?? generateCommitMessage
  let msg = args.message
  let prev = args.previous
  if (!msg) {
    const result = await gen({ path: cwd, previousMessage: prev, prompt: args.prompt })
    msg = result.message
  }
  if (!msg) {
    error("Commit message is empty")
    exit(1)
    return
  }

  while (true) {
    if (!msg.trim()) {
      error("Commit message is empty")
      exit(1)
      return
    }

    out("Generated commit message:\n\n" + msg)

    const action = args.yes ? "commit" : await (args.selectAction ?? selectAction)(msg)
    if (action === "cancel") {
      out("Cancelled")
      return
    }
    if (action === "edit") {
      const next = await (args.edit ?? edit)(msg)
      if (!next) {
        out("Cancelled")
        return
      }
      msg = next
      continue
    }
    if (action === "regenerate") {
      prev = msg
      const result = await gen({ path: cwd, previousMessage: prev, prompt: args.prompt })
      msg = result.message
      continue
    }

    const diff = run(["diff", "--cached", "--quiet"], cwd)
    if (diff.code === 0) {
      error("No staged changes found")
      exit(1)
      return
    }
    if (diff.code !== 1) {
      check(diff, error, exit)
      return
    }

    if (args.dryRun) {
      out("Dry run: commit not created")
      return
    }

    const result = run(["commit", "-m", msg], cwd)
    if (!check(result, error, exit)) return
    out(result.stdout.trim() || "Committed")
    return
  }
}

export const CommitCommand = effectCmd<CliArgs, void>({
  command: "commit",
  describe: "generate a commit message and commit staged changes",
  directory: (args) => (args.dir ? path.resolve(process.cwd(), args.dir) : process.cwd()),
  builder: (yargs: Argv) =>
    yargs
      .option("dir", {
        type: "string",
        describe: "directory to run in",
      })
      .option("all", {
        type: "boolean",
        describe: "stage tracked changes when nothing is staged",
      })
      .option("include-untracked", {
        type: "boolean",
        describe: "stage all changes, including untracked files, when nothing is staged",
      })
      .option("message", {
        type: "string",
        describe: "commit with this message instead of generating one",
      })
      .option("previous", {
        type: "string",
        describe: "previous generated message to avoid when regenerating",
      })
      .option("yes", {
        type: "boolean",
        describe: "commit without confirmation",
      })
      .option("dry-run", {
        type: "boolean",
        describe: "show message without creating a commit",
      }),
  handler: Effect.fn("Cli.commit")(function* (args) {
    const cfg = yield* Config.Service.use((svc) => svc.get())
    yield* Effect.promise(() =>
      handle({
        dir: args.dir,
        all: args.all,
        includeUntracked: args["include-untracked"],
        message: args.message,
        previous: args.previous,
        yes: args.yes,
        dryRun: args["dry-run"],
        prompt: cfg.commit_message?.prompt || undefined,
      }),
    )
  }),
})
