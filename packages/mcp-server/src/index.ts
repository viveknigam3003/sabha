import { startServer } from "./server.js";

startServer().catch((err: unknown) => {
  console.error("[sabha-mcp-server] Fatal startup error:", err);
  process.exit(1);
});
