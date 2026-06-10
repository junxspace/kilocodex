import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core"
import { Timestamps } from "./schema.sql"

export const TelemetryTable = sqliteTable("telemetry", {
  id: integer().primaryKey({ autoIncrement: true }),
  event: text().notNull(),
  distinct_id: text(),
  properties: text(),
  time_created: integer().notNull().$default(() => Date.now()),
})
