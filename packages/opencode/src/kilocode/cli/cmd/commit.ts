import type { Argv } from "yargs"
import path from "path"
import * as prompts from "@clack/prompts"
import { Effect } from "effect"
import { effectCmd } from "../../../cli/effect-cmd"
import { UI } from "../../../cli/ui"
import { Config } from "../../../config/config"
import { invocationDirectory } from "../invocation-directory"
import { generateCommitMessage } from "../../commit-message"
import { getGitContext } from "../../commit-message/git-context"

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
type PushAction = "push" | "cancel"
type Intent = {
  files: string[]
  description: string
}
type IntentResult = {
  intents: Intent[]
}

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
  analyzeIntent?: (input: { path: string; status: Status }) => Promise<IntentResult>
  selectAction?: (message: string, intent?: Intent) => Promise<Action>
  selectPush?: () => Promise<PushAction>
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

function files(status: Status) {
  return [...new Set([...status.staged, ...status.unstaged, ...status.untracked])]
}

async function analyze(input: { path: string; status: Status }): Promise<IntentResult> {
  const ctx = await getGitContext(input.path)
  return {
    intents: [
      {
        files: ctx.files.map((file) => file.path),
        description: "commit related changes",
      },
    ],
  }
}

function needsAdd(intent: Intent, status: Status) {
  return intent.files.some((file) => status.unstaged.includes(file) || status.untracked.includes(file))
}

function check(result: GitResult, error: (text: string) => void, exit: (code: number) => void) {
  if (result.code === 0) return true
  error(result.stderr.trim() || result.stdout.trim() || "git command failed")
  exit(result.code || 1)
  return false
}

async function selectPush(): Promise<PushAction> {
  const result = await prompts.select({
    message: "No changes found. Push current branch?",
    options: [
      { value: "push", label: "Push" },
      { value: "cancel", label: "Cancel" },
    ],
  })
  if (prompts.isCancel(result)) return "cancel"
  return result as PushAction
}

function section(title: string, body: string) {
  return `${UI.Style.TEXT_WARNING_BOLD}${title}${UI.Style.TEXT_NORMAL}\n${body}`
}

function preview(message: string, intent?: Intent) {
  const [subject = "", ...body] = message.trim().split("\n")
  const parts = [
    section(
      "Commit message",
      [`  ${UI.Style.TEXT_SUCCESS_BOLD}${subject}${UI.Style.TEXT_NORMAL}`, ...body.map((line) => `  ${UI.Style.TEXT_DIM}${line}${UI.Style.TEXT_NORMAL}`)].join("\n"),
    ),
  ]
  if (intent) {
    parts.push(
      section(
        "Files to commit",
        intent.files.map((file) => `  ${UI.Style.TEXT_DIM}${file}${UI.Style.TEXT_NORMAL}`).join("\n"),
      ),
    )
    parts.push(
      section(
        "Action",
        [
          `  ${UI.Style.TEXT_DIM}git reset${UI.Style.TEXT_NORMAL}`,
          `  ${UI.Style.TEXT_DIM}git add ${intent.files.join(" ")}${UI.Style.TEXT_NORMAL}`,
          `  ${UI.Style.TEXT_DIM}git commit -m <message>${UI.Style.TEXT_NORMAL}`,
        ].join("\n"),
      ),
    )
  }
  return parts.join("\n\n")
}

async function selectAction(message: string, intent?: Intent): Promise<Action> {
  prompts.note(preview(message, intent), "Commit preview")
  const result = await prompts.select({
    message: "Commit this change?",
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
  const root = invocationDirectory(args.dir)
  const run = args.git ?? git
  const out = args.output ?? ((text: string) => process.stdout.write(text + "\n"))
  const error = args.error ?? UI.error
  const exit = args.exit ?? ((code: number) => (process.exitCode = code))
  const statusResult = run(["status", "--porcelain"], root)
  if (!check(statusResult, error, exit)) return

  let status = parseStatus(statusResult.stdout)
  out(format("Staged changes", status.staged))
  out(format("Unstaged changes", status.unstaged))
  out(format("Untracked files", status.untracked))

  if (empty(status)) {
    out("No changes found")
    const action = args.yes ? "push" : await (args.selectPush ?? selectPush)()
    if (action === "cancel") {
      out("Cancelled")
      return
    }
    const result = run(["push"], root)
    if (!check(result, error, exit)) return
    out(result.stdout.trim() || "Pushed")
    return
  }

  const unstaged = run(["diff"], root)
  if (!check(unstaged, error, exit)) return
  const staged = run(["diff", "--staged"], root)
  if (!check(staged, error, exit)) return

  const analysis = await (args.analyzeIntent ?? analyze)({ path: root, status })
  const intents = analysis.intents.filter((intent) => intent.files.length > 0)
  if (intents.length === 0) {
    error("No committable intent found")
    exit(1)
    return
  }

  if (!args.dryRun) {
    const reset = run(["reset"], root)
    if (!check(reset, error, exit)) return
  }

  const gen = args.generate ?? generateCommitMessage
  for (const intent of intents) {
    const known = new Set(files(status))
    const invalid = intent.files.filter((file) => !known.has(file))
    if (invalid.length > 0) {
      error(`Intent references files that are not changed: ${invalid.join(", ")}`)
      exit(1)
      return
    }

    if (!args.dryRun) {
      const result = run(["add", ...intent.files], root)
      if (!check(result, error, exit)) return
    }

    let msg = args.message ?? intent.description
    let prev = args.previous
    if (!args.message) {
      const result = await gen({ path: root, selectedFiles: intent.files, previousMessage: prev, prompt: args.prompt, intent })
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

      if (args.yes || args.dryRun) out("Generated commit message:\n\n" + msg)

      const action = args.yes || args.dryRun ? "commit" : await (args.selectAction ?? selectAction)(msg, intent)
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
        const result = await gen({ path: root, selectedFiles: intent.files, previousMessage: prev, prompt: args.prompt, intent })
        msg = result.message
        continue
      }

      if (args.dryRun) {
        out("Dry run: commit not created")
        break
      }

      const diff = run(["diff", "--cached", "--quiet"], root)
      if (diff.code === 0) {
        error("No staged changes found")
        exit(1)
        return
      }
      if (diff.code !== 1) {
        check(diff, error, exit)
        return
      }

      const result = run(["commit", "-m", msg], root)
      if (!check(result, error, exit)) return
      out(result.stdout.trim() || "Committed")
      break
    }
  }
}

export const CommitCommand = effectCmd<CliArgs, void>({
  command: "commit",
  describe: "generate a commit message and commit staged changes",
  directory: (args) => invocationDirectory(args.dir),
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
