# Sabha — marketplace catalog

The public **marketplace catalog** for the agentic *generals* — **Argus**
(data-engineer) and **Narada** (messenger) — on top of a shared runtime
(`sabha-core`).

This repo is **catalog-only**: it holds the marketplace manifests, the access
allowlist, and nothing else. All source, build, CI, and publishing live in the
**private monorepo `viveknigam3003/sabha-monorepo`**, which publishes the npm
packages and auto-syncs the manifests here on each release.

## What's here

| File | Role |
| --- | --- |
| `.claude-plugin/marketplace.json`, `.cursor-plugin/marketplace.json` | The marketplace catalog (synced from the monorepo on release). |
| `allowlist.json` | The SHA-256 email allowlist the gate fetches at runtime. |

## Plugins (all installed from npm)

- `sabha` → `@sabhahq/sabha` — umbrella; installs everything at once (`dependencies: ["sabha-core", "argus", "narada"]`)
- `sabha-core` → `@sabhahq/core` — shared runtime (identity, gate, telemetry, auto-update)
- `argus` → `@sabhahq/argus`, `dependencies: ["sabha-core"]`
- `narada` → `@sabhahq/narada`, `dependencies: ["sabha-core"]`

## How a friend installs

```text
/plugin marketplace add viveknigam3003/sabha
/plugin install sabha@sabha               # everything; or `argus@sabha` for just one
npx @sabhahq/core auth you@example.com     # one-time identity (gate + telemetry)
```

> Use `npx @sabhahq/core auth …`, **not** `npx sabha …` — the bare `sabha` name
> belongs to an unrelated npm package. (If you'd rather have `sabha` directly,
> `npm i -g @sabhahq/core`.)

Updates are one step: `/plugin marketplace update` + restart. A daily
`sessionStart` hint fires when a newer version is published.

## Identity & gate

- **Identity:** your **email**, stored once at `~/.config/sabha/identity.json`
  by `sabha auth`. Read by every general for the allowlist gate and as the
  PostHog `distinct_id`.
- **Gate fails closed:** privileged tools refuse unless your email's SHA-256
  hash is in `allowlist.json` (fetched + cached, with offline grace). Setup/help
  tools (`sabha auth`, each general's `doctor`) are never gated.

The gate fetches `allowlist.json` from this repo's raw URL
(`https://raw.githubusercontent.com/viveknigam3003/sabha/main/allowlist.json`),
so grant/revoke is just a commit here — no release needed.

## Granting / revoking access

`allowlist.json` stores only SHA-256 hashes of `email.trim().toLowerCase()`.
Compute a hash and add/remove it from the `hashes` array, then commit + push:

```bash
node -e "console.log(require('crypto').createHash('sha256').update(process.argv[1].trim().toLowerCase()).digest('hex'))" "person@example.com"
```

(The monorepo also ships `pnpm allowlist add <email>` / `pnpm gen-hash` helpers.)
