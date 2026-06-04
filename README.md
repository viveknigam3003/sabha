# Sabha

One marketplace for the agentic *generals* — **Argus** (data-engineer) and
**Narada** (messenger) today — on top of a shared runtime (`sabha-core`).

Stage 1 ships these to friends with **per-user observability** and **one-step
auto-updates**, gated by a hashed email allowlist. **No hosted backend.**

## Packages

| Package | What it is |
| --- | --- |
| `@sabhahq/telemetry` | One consolidated telemetry stream at `~/.local/share/sabha/telemetry`. Every event carries a first-class `agent` property. Ships the `sabha-telemetry` hook recorder + the shared `withTelemetry` MCP middleware + a redacted, client-side PostHog mirror. |
| `@sabhahq/core` | The `sabha-core` plugin: shared rules, the `_sabha_owner` hooks set, the one-time `sabha auth <email>` identity, the SHA-256 email-allowlist gate, and the daily auto-update hint. |

The marketplace (`.claude-plugin/marketplace.json` + `.cursor-plugin/marketplace.json`)
lists three plugins, all installed from npm:

- `sabha-core` → `@sabhahq/core`
- `argus` → `@sabhahq/argus` (built from [`viveknigam3003/argus`](https://github.com/viveknigam3003/argus)), `dependencies: ["sabha-core"]`
- `narada` → `@sabhahq/narada` (built from [`viveknigam3003/narada`](https://github.com/viveknigam3003/narada)), `dependencies: ["sabha-core"]`

## How a friend installs

```text
/plugin marketplace add viveknigam3003/sabha
/plugin install argus@sabha        # pulls sabha-core automatically
sabha auth you@example.com         # one-time identity (gate + telemetry)
```

Updates are one step: `/plugin marketplace update` + restart. A daily
`sessionStart` hint fires when a newer version is published.

## Identity, gate, telemetry (the two auth layers — don't conflate)

- **Sabha → user (new, shared):** your **email**, stored once at
  `~/.config/sabha/identity.json` by `sabha auth`. Read by every general for the
  allowlist gate and as the PostHog `distinct_id`.
- **Sabha → services (unchanged, local):** provider creds stay where they are
  today (Argus's `~/.config/argus/`, Narada's Slack MCP). Vault centralization is
  Stage 3.

The **gate fails closed**: privileged tools refuse unless your email's SHA-256
hash is on the maintainer's allowlist (fetched + cached, with offline grace).
Setup/help tools (`sabha auth`, each general's `doctor`) are never gated.

> Stage 1 is a **soft deterrent by design** — public npm means the code is open
> and patchable. Hard enforcement arrives at Stage 2 (remote MCP).

## Local development

```bash
pnpm install
pnpm -r build
pnpm -r test
node scripts/validate.mjs
```

### Configuration via `.env`

All `SABHA_*` knobs can be set as real shell env vars **or** in a `.env` file —
loaded at MCP/CLI startup by `loadSabhaEnv()`. Precedence (highest first):

```text
real shell env  >  $SABHA_ENV_FILE  >  ~/.config/sabha/.env
                >  $CLAUDE_PLUGIN_ROOT/.env  >  <cwd>/.env
```

Real exports always win; `.env` files only fill gaps, and only `SABHA_*` (plus
`XDG_*`/`HOME`) keys are applied. Copy `.env.example` to get started; per-user
runtime config belongs in `~/.config/sabha/.env`. `sabha doctor` reports which
files were loaded.

Useful env switches:

| Env var | Effect |
| --- | --- |
| `SABHA_GATE_DISABLED=1` | Bypass the allowlist gate (maintainer/dev only). |
| `SABHA_ALLOWLIST_URL` | Override the allowlist source. |
| `SABHA_POSTHOG_KEY` / `SABHA_POSTHOG_HOST` | Override the bundled PostHog target. |
| `SABHA_POSTHOG_DISABLED=1` | Disable the PostHog mirror (local JSONL still written). |
| `SABHA_MARKETPLACE_URL` | Override the update-check manifest source. |

## Publishing

`@sabhahq/core` + `@sabhahq/telemetry` publish from this repo via
`.github/workflows/publish.yml` on a GitHub Release (needs an `NPM_TOKEN`
secret for the `sabha` npm org). `@sabhahq/argus` + `@sabhahq/narada` publish from
their own repos (each bundles its built MCP `dist/`).

Before the first publish you must:

1. Use the `@sabhahq` npm org (already created).
2. Set a real PostHog project key (replace the bundled placeholder, or rely on
   the `SABHA_POSTHOG_KEY` env at runtime — the placeholder fails closed and
   never sends).
3. Maintain the allowlist with `pnpm allowlist add <email>` (writes
   `./allowlist.json`, hashes only) and commit it — the gate's default
   `SABHA_ALLOWLIST_URL` is this repo's raw `allowlist.json`, so granting/
   revoking access is just a push (no release).
