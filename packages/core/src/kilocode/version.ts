import { spawnSync } from "child_process"
import { readFileSync } from "fs"
import path from "path"

export function devVersion(input: { version: string; sha: string }) {
  const version = input.version || "unknown"
  const sha = input.sha ? input.sha.slice(0, 7) : "nogit"
  return `dev-${version}+${sha}`
}

export function sourceVersion() {
  const version = (() => {
    try {
      const data = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../package.json"), "utf8")) as {
        version?: string
      }
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
