import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  createGate,
  getRemoteContext,
  runWithRemoteContext,
} from "@sabhahq/core";
import { initTelemetry, setPosthogEmailResolver } from "@sabhahq/telemetry";
import {
  registerTools as registerArgusTools,
  makeDeps as makeArgusDeps,
} from "@argus/mcp";
import {
  registerTools as registerNaradaTools,
  makeDeps as makeNaradaDeps,
} from "@narada/mcp";
import { extractBearerToken, resolveEmail } from "./auth.js";
import { buildRequestContext } from "./requestContext.js";
import { emitServerEvent } from "./telemetry.js";

const SERVER_NAME = "sabha";
const SERVER_VERSION = "0.1.0";

/**
 * Creates a fresh McpServer with both argus and narada tools registered for
 * the current request. Called inside runWithRemoteContext() so that gate +
 * deps can read per-request context from AsyncLocalStorage.
 *
 * A new McpServer is created per request because WebStandardStreamableHTTP in
 * stateless mode cannot be reused across requests (the SDK enforces this).
 */
function createMcpServerForRequest(): McpServer {
  const mcp = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  // Gate reads the email from AsyncLocalStorage (set in the calling
  // runWithRemoteContext() — no global state involved).
  const gate = createGate({
    getEmail: () => getRemoteContext()?.email,
  });

  const argusDeps = makeArgusDeps();
  const naradaDeps = makeNaradaDeps();

  registerArgusTools(mcp, argusDeps, gate);
  registerNaradaTools(mcp, naradaDeps, gate);

  return mcp;
}

export async function startServer(): Promise<void> {
  // Server-side telemetry: JSONL is NOT written server-side (that stays
  // client-side for the audit skill). Disable the pino JSONL transport by
  // passing enabled: false; PostHog events are sent directly via captureEvent.
  initTelemetry({
    source: "mcp-server" as const,
    agent: "sabha",
    config: { enabled: false, retentionDays: 90, redactArgs: true, posthog: { enabled: true } },
  });

  // Wire per-request email into PostHog attribution: whenever a tool handler
  // calls emitEvent() inside a request, PostHog identifies by the request's
  // resolved email instead of a local identity file (which doesn't exist on server).
  setPosthogEmailResolver(() => getRemoteContext()?.email);

  const port = parseInt(process.env.PORT ?? "3000", 10);
  const app = new Hono();

  // ── Health / readiness probe ─────────────────────────────────────────────
  app.get("/health", (c) =>
    c.json({ ok: true, service: "sabha-mcp-server", version: SERVER_VERSION }),
  );

  // ── MCP endpoint ─────────────────────────────────────────────────────────
  // Handles POST (tool calls), GET (SSE stream), DELETE (session teardown).
  // Stateless: new McpServer + transport per request.
  app.all("/mcp", async (c) => {
    // Step 1: Auth — resolve bearer token → email.
    const authHeader = c.req.header("authorization");
    const token = extractBearerToken(authHeader);
    if (!token) {
      return c.json(
        {
          error: "SABHA_UNAUTHORIZED",
          message: "Missing Authorization: Bearer <key>",
        },
        401,
      );
    }
    const email = resolveEmail(token);
    if (!email) {
      return c.json(
        { error: "SABHA_UNAUTHORIZED", message: "Unknown API key" },
        401,
      );
    }

    // Step 2: Build per-request context (email + provider creds from headers).
    // Headers are lowercased by the Fetch API; we forward them as-is.
    const headerMap: Record<string, string> = {};
    c.req.raw.headers.forEach((value, key) => {
      headerMap[key] = value;
    });
    const ctx = buildRequestContext(email, headerMap);

    // Step 3: Run the full MCP request inside the AsyncLocalStorage context.
    //         gate.getEmail() + deps path helpers read from this context.
    return runWithRemoteContext(ctx, async () => {
      emitServerEvent("request.start", email);
      try {
        const mcp = createMcpServerForRequest();
        // Stateless mode: omit sessionIdGenerator entirely (undefined default
        // means no session ID is generated or tracked).
        const transport = new WebStandardStreamableHTTPServerTransport({});
        await mcp.connect(transport);
        return transport.handleRequest(c.req.raw);
      } finally {
        emitServerEvent("request.end", email);
      }
    });
  });

  console.log(
    `[sabha-mcp-server] Listening on port ${port}`,
  );
  serve({ fetch: app.fetch, port });
}
