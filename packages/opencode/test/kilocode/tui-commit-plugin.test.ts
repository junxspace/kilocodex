import { expect, test } from "bun:test"
import CommitPlugin from "../../src/kilocode/plugins/commit"
import { createTuiPluginApi } from "../fixture/tui-plugin"

test("commit plugin registers slash command", async () => {
  const layers: Array<{ commands?: Array<Record<string, unknown>> }> = []
  const api = createTuiPluginApi({
    keymap: {
      registerLayer(layer) {
        layers.push(layer as { commands?: Array<Record<string, unknown>> })
        return () => {}
      },
    } as NonNullable<Parameters<typeof createTuiPluginApi>[0]>["keymap"],
  })

  await CommitPlugin.tui(api, undefined, {
    id: "internal:kilo-commit",
    source: "internal",
    spec: "internal:kilo-commit",
    target: "internal:kilo-commit",
    first_time: 0,
    last_time: 0,
    time_changed: 0,
    load_count: 1,
    fingerprint: "test",
    state: "same",
  })

  const command = layers.flatMap((layer) => layer.commands ?? []).find((item) => item.name === "kilo.commit")
  expect(command).toMatchObject({
    title: "Commit changes",
    category: "Git",
    namespace: "palette",
    slashName: "commit",
  })
})
