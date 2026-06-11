import { describe, expect, test } from "bun:test"
import { devVersion } from "../../src/kilocode/version"

describe("kilocode dev version", () => {
  test("formats package version and git sha", () => {
    expect(devVersion({ version: "7.3.40", sha: "abcdef123456" })).toBe("dev-7.3.40+abcdef1")
  })

  test("uses fallback values", () => {
    expect(devVersion({ version: "", sha: "" })).toBe("dev-unknown+nogit")
  })
})
