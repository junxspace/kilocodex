import { PostHog } from "posthog-node"
import { Identity } from "./identity.js"
import { TelemetryEvent } from "./events.js"

const POSTHOG_API_KEY = "phc_GK2Pxl0HPj5ZPfwhLRjXrtdz8eD7e9MKnXiFrOqnB6z"
const POSTHOG_HOST = "https://us.i.posthog.com"

export type CaptureHandler = (event: TelemetryEvent, distinctId: string, properties?: Record<string, unknown>) => void

export namespace Client {
  let client: PostHog | null = null
  let enabled = true
  let captureHandler: CaptureHandler | null = null

  export function init() {
    client = new PostHog(POSTHOG_API_KEY, {
      host: POSTHOG_HOST,
      disableGeoip: false,
    })
  }

  export function setCaptureHandler(handler: CaptureHandler | null) {
    captureHandler = handler
  }

  export function getClient(): PostHog | null {
    return client
  }

  export function setEnabled(value: boolean) {
    enabled = value
    if (!client) return
    if (value) client.optIn()
    else client.optOut()
  }

  export function isEnabled(): boolean {
    return enabled && client !== null
  }

  export function capture(event: TelemetryEvent, properties?: Record<string, unknown>) {
    if (!enabled) return

    const distinctId = Identity.getDistinctId()
    const orgId = Identity.getOrganizationId()

    const props = {
      ...properties,
      ...(orgId && { kilocodeOrganizationId: orgId }),
    }

    // Write to local database if handler is set
    if (captureHandler) {
      captureHandler(event, distinctId, props)
    }
  }

  export function identify(distinctId: string, properties?: Record<string, unknown>) {
    if (!enabled) return
    // Local only - PostHog disabled
  }

  export function alias(distinctId: string, aliasId: string) {
    if (!enabled) return
    // Local only - PostHog disabled
  }

  export async function shutdown(): Promise<void> {
    // PostHog disabled - no flush needed
  }
}
