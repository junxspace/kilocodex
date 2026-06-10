import { useRenderer } from "@opentui/solid"
import { createSimpleContext } from "./helper"
import { FormatError, FormatUnknownError } from "@/cli/error"
import { win32FlushInputBuffer } from "../win32"
import { resetTerminalState } from "@/kilocode/cli/cmd/tui/util/terminal" // kilocode_change
import { writeSync } from "node:fs" // kilocode_change
type Exit = ((reason?: unknown) => Promise<void>) & {
  message: {
    set: (value?: string) => () => void
    clear: () => void
    get: () => string | undefined
  }
}

export const { use: useExit, provider: ExitProvider } = createSimpleContext({
  name: "Exit",
  init: (input: { onBeforeExit?: () => Promise<void>; onExit?: () => Promise<void> }) => {
    const renderer = useRenderer()
    let message: string | undefined
    let task: Promise<void> | undefined
    const store = {
      set: (value?: string) => {
        const prev = message
        message = value
        return () => {
          message = prev
        }
      },
      clear: () => {
        message = undefined
      },
      get: () => message,
    }
    const exit: Exit = Object.assign(
      (reason?: unknown) => {
        if (task) return task
        task = (async () => {
          await input.onBeforeExit?.()
          // Reset window title before destroying renderer
          renderer.setTerminalTitle("")
          // kilocode_change start - disable mouse tracking BEFORE renderer.destroy() to prevent
          // the race where setRawMode(false) is called while mouse tracking is still active,
          // causing mouse events to be echoed to the terminal as garbled characters like "$ 51;74;17M"
          resetTerminalState()
          renderer.destroy()
          win32FlushInputBuffer()
          // kilocode_change end
          if (reason) {
            const formatted = FormatError(reason) ?? FormatUnknownError(reason)
            if (formatted) {
              process.stderr.write(formatted + "\n")
            }
          }
          const text = store.get()
          if (text) writeSync(process.stdout.fd, text + "\n") // kilocode_change
          await input.onExit?.()
        })()
        return task
      },
      {
        message: store,
      },
    )
    process.on("SIGHUP", () => exit())
    return exit
  },
})
