import { z } from "zod";

/**
 * Schema for the `telemetry:` block in ~/.config/sabha/config.yaml.
 *
 * The whole block is optional — when omitted, sensible defaults (jsonl file
 * sink, 90-day retention, redaction on, PostHog on) are applied by
 * `defaultsTelemetryConfig`.
 *
 * `transports` mirrors pino's targets[] shape: each entry has a `target`
 * (npm module specifier resolvable from @sabhahq/telemetry's runtime) and
 * `options` opaque to us. We pass them straight through to pino.
 */
export const telemetryTransportSchema = z.object({
  target: z.string().min(1),
  level: z.string().optional(),
  options: z.record(z.unknown()).optional(),
});

export const posthogConfigSchema = z.object({
  /** Master switch for the client-side PostHog mirror. */
  enabled: z.boolean().default(true),
});

export const telemetryConfigSchema = z.object({
  enabled: z.boolean().default(true),
  retentionDays: z.number().int().positive().max(3650).default(90),
  redactArgs: z.boolean().default(true),
  posthog: posthogConfigSchema.default({ enabled: true }),
  transports: z.array(telemetryTransportSchema).optional(),
});

export type TelemetryTransportSpec = z.infer<typeof telemetryTransportSchema>;
export type PosthogConfig = z.infer<typeof posthogConfigSchema>;
export type TelemetryConfig = z.infer<typeof telemetryConfigSchema>;

/**
 * Parses an unknown blob (typically loaded from YAML) into a fully-defaulted
 * `TelemetryConfig`. Never throws — the worst case returns the documented
 * defaults so a malformed `telemetry:` block can't break the MCP server.
 */
export function parseTelemetryConfig(value: unknown): TelemetryConfig {
  const result = telemetryConfigSchema.safeParse(value ?? {});
  if (result.success) return result.data;
  return defaultsTelemetryConfig();
}

export function defaultsTelemetryConfig(): TelemetryConfig {
  return {
    enabled: true,
    retentionDays: 90,
    redactArgs: true,
    posthog: { enabled: true },
  };
}
