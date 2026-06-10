// kilocode_change - new file
const yes = new Set(["1", "true", "yes", "on"])
const no = new Set(["0", "false", "no", "off"])

const LOGO_LINES = [
  "▗▖ ▗▖▗▄▄▄▖▗▖    ▗▄▖ ▗▖  ▗▖",
  "▐▌▗▞▘  █  ▐▌   ▐▌ ▐▌ ▝▚▞▘ ",
  "▐▛▚▖   █  ▐▌   ▐▌ ▐▌  ▐▌  ",
  "▐▌ ▐▌▗▄█▄▖▐▙▄▄▖▝▚▄▞▘▗▞▘▝▚▖",
  "                          ",
  "                          ",
]

const LOGO = {
  tui: LOGO_LINES,
  plain: LOGO_LINES,
  exit: LOGO_LINES,
}

function flag(value: string | undefined) {
  const key = value?.toLowerCase()
  if (!key) return
  if (yes.has(key)) return true
  if (no.has(key)) return false
}

function windows(env: NodeJS.ProcessEnv) {
  if (env.WT_SESSION) return true
  if (env.TERM_PROGRAM === "vscode") return true
  if (env.WEZTERM_PANE) return true
  if (env.TERM_PROGRAM === "WezTerm") return true
  return false
}

export function supports(env = process.env, platform = process.platform) {
  const override = flag(env.KILO_UNICODE_LOGO)
  if (override !== undefined) return override
  if (env.TERM === "dumb") return false
  if (platform === "win32") return windows(env)
  if (env.ConEmuPID) return false
  if (env.ANSICON) return false
  return true
}

export function tui(env = process.env, platform = process.platform) {
  return supports(env, platform) ? LOGO.tui : LOGO.plain
}

export function plain(env = process.env, platform = process.platform) {
  return supports(env, platform) ? LOGO.plain : LOGO.plain
}

export function session(
  title: string,
  id: string | undefined,
  dim: string,
  normal: string,
  env = process.env,
  platform = process.platform,
) {
  const lines = supports(env, platform) ? LOGO.exit : LOGO.plain
  const info = id ? `${dim}${title}${normal}  ·  ${dim}kilox -s ${id}${normal}` : `${dim}${title}${normal}`
  return [``, ...lines, info, ""].join("\n")
}
