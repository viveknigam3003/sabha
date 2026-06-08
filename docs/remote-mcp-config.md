# Sabha Stage 2a — Remote MCP Client Configuration

## Overview

After Stage 2a, the Sabha MCP tools (argus + narada) run on a **remote Railway server**
instead of as a local stdio process. The gate enforcement is now server-side and
un-patchable — no local code to disable.

## Cursor MCP configuration

Replace the old local stdio config with the remote URL in your Cursor MCP settings
(`~/.cursor/mcp.json` or via Settings → MCP):

```json
{
  "mcpServers": {
    "sabha": {
      "url": "https://sabha-mcp-server.up.railway.app/mcp",
      "headers": {
        "Authorization": "Bearer <your-sabha-api-key>",
        "X-NR-API-KEY": "<your-new-relic-api-key>",
        "X-NR-ACCOUNT-ID": "<your-nr-account-id>",
        "X-REDASH-URL": "<your-redash-instance-url>",
        "X-REDASH-API-KEY": "<your-redash-api-key>"
      }
    }
  }
}
```

**Only include the headers you need.** If you don't use Redash, omit the Redash
headers. The server ignores unknown headers.

## Migration from Stage 1 (local stdio)

Remove the old argus + narada stdio entries:

```json
{
  "mcpServers": {
    "argus": {
      "command": "node",
      "args": ["..."]
    },
    "narada": {
      "command": "node",
      "args": ["..."]
    }
  }
}
```

And replace with the single `sabha` remote entry above.

## Onboarding your data on the server

After switching to remote, your tools will need to re-initialize because the server
uses a per-user data directory (not your local `~/.config/argus/`).

1. **Argus**: call `argus__install` with your connector details. This writes config to
   the server's per-user directory.

2. **Narada**: call `narada__install` with your connector details. This writes registry
   + config to the server's per-user directory.

Your local Stage 1 config (`~/.config/argus/`, `~/.config/narada/`) is no longer
read by the remote server. You can keep it as a backup.

## Header reference

| Header | Purpose | Example |
|--------|---------|---------|
| `Authorization` | Your Sabha API key (required) | `Bearer sk-abc123…` |
| `X-NR-API-KEY` | New Relic user API key | `NRAK-…` |
| `X-NR-ACCOUNT-ID` | Default NR account ID | `12345678` |
| `X-REDASH-URL` | Redash instance URL | `https://redash.example.com` |
| `X-REDASH-API-KEY` | Redash API key | `your-redash-key` |

Headers are used in server memory for the duration of the request and **never
logged or persisted**.
