import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@kilocode/plugin/tui"
import { createSignal, type JSX } from "solid-js"
import { handle } from "../cli/cmd/commit"

type Action = "commit" | "edit" | "regenerate" | "cancel"
type PushAction = "push" | "cancel"
type Intent = {
  files: string[]
  description: string
}

type Item = {
  title: string
  value: Action
  description?: string
}

const id = "internal:kilo-commit"

function message(err: unknown) {
  if (err instanceof Error) return err.message
  return String(err)
}

function prompt(api: TuiPluginApi, title: string, opts?: { value?: string; placeholder?: string; description?: () => JSX.Element }) {
  return new Promise<string | null>((resolve) => {
    let done = false
    api.ui.dialog.replace(
      () =>
        api.ui.DialogPrompt({
          title,
          value: opts?.value,
          placeholder: opts?.placeholder,
          description: opts?.description,
          onConfirm(value) {
            done = true
            api.ui.dialog.clear()
            resolve(value)
          },
          onCancel() {
            done = true
            api.ui.dialog.clear()
            resolve(null)
          },
        }),
      () => {
        if (done) return
        done = true
        resolve(null)
      },
    )
  })
}

function confirm(api: TuiPluginApi, title: string, text: string) {
  return new Promise<boolean>((resolve) => {
    let done = false
    api.ui.dialog.replace(
      () =>
        api.ui.DialogConfirm({
          title,
          message: text,
          onConfirm() {
            done = true
            api.ui.dialog.clear()
            resolve(true)
          },
          onCancel() {
            done = true
            api.ui.dialog.clear()
            resolve(false)
          },
        }),
      () => {
        if (done) return
        done = true
        resolve(false)
      },
    )
  })
}

function select(api: TuiPluginApi, msg: string, intent?: Intent) {
  const options: Item[] = [
    { title: "Commit", value: "commit", description: "Create the commit" },
    { title: "Edit", value: "edit", description: "Edit the generated message" },
    { title: "Regenerate", value: "regenerate", description: "Generate a different message" },
    { title: "Cancel", value: "cancel" },
  ]
  return new Promise<Action>((resolve) => {
    let done = false
    api.ui.dialog.replace(
      () =>
        api.ui.DialogSelect({
          title: "Commit this change?",
          options,
          onSelect(item) {
            done = true
            api.ui.dialog.clear()
            resolve(item.value)
          },
        }),
      () => {
        if (done) return
        done = true
        resolve("cancel")
      },
    )
    api.ui.toast({ variant: "info", message: preview(msg, intent), duration: 10_000 })
  })
}

function preview(msg: string, intent?: Intent) {
  const files = intent?.files.length ? `\nFiles: ${intent.files.join(", ")}` : ""
  return `Commit message: ${msg.split("\n")[0]}${files}`
}

async function run(api: TuiPluginApi) {
  const dir = api.state.path.directory || process.cwd()
  const output = (text: string) => {
    if (!text.trim()) return
    api.ui.toast({ variant: "info", message: text, duration: 3000 })
  }

  await handle({
    dir,
    yes: false,
    output,
    error: (text) => api.ui.toast({ variant: "error", message: text }),
    exit: () => {},
    selectPush: async (): Promise<PushAction> => {
      const ok = await confirm(api, "Push current branch?", "No changes found. Push current branch?")
      return ok ? "push" : "cancel"
    },
    selectAction: (msg, intent) => select(api, msg, intent),
    edit: (msg) => prompt(api, "Edit commit message", { value: msg, placeholder: "Commit message" }).then((value) => value?.trim()),
  })
}

const tui: TuiPlugin = async (api) => {
  const [busy, setBusy] = createSignal(false)
  api.keymap.registerLayer({
    commands: [
      {
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
            .then(() => {
              api.ui.dialog.clear()
            })
            .catch((err) => {
              api.ui.toast({ variant: "error", message: message(err) })
            })
            .finally(() => {
              setBusy(false)
            })
        },
      },
    ],
    bindings: api.tuiConfig.keybinds.gather("kilo.commit", ["kilo.commit"]),
  })
}

const plugin: TuiPluginModule & { id: string } = { id, tui }

export default plugin
