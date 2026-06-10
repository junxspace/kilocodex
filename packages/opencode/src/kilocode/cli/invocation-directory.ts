import path from "path"

export function invocationDirectory(dir?: string, env = process.env.KILO_ORIG_CWD, cwd = process.cwd()) {
  const base = env ?? cwd
  if (dir) return path.resolve(base, dir)
  return base
}
