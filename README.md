# SurgeSignal

B2B intent data MCP server that delivers Bombora-equivalent Company Surge scores from public signals. Aggregates Reddit discussions, GitHub issue activity, job listings, news articles, G2 reviews, and LinkedIn posts into a composite 0–100 intent score per company per topic.

There is no bundled web UI; clients connect via MCP (e.g. AI tools, CTX Protocol) or by calling the HTTP endpoints below.

## What it does

- **Ingest** — Background cron jobs fetch signals from 6 upstream sources (Reddit, GitHub, NewsData.io, Adzuna, G2, LinkedIn), extract company domains, score relevance, and store normalized signals in Redis with automatic in-memory fallback.
- **Score** — Fuses per-source signals into a composite 0–100 surge score using weighted averaging, exponential recency decay (48h half-life), and volume bonuses. Scores ≥60 indicate active buying intent, mirroring Bombora's threshold.
- **Serve** — Express app with MCP SSE transport on `/sse`, plus a JSON-RPC endpoint on `/mcp` exposing `lookup_surge`, `scan_topic`, and `explain_signals` tools with full `outputSchema` and `structuredContent`.
- **Resolve** — Canonical company identity resolver maps domain variants, LinkedIn slugs, GitHub orgs, and name variations to a single entity, solving the deduplication problem across sources.

## Tools

| Tool              | Description                                                   |
| ----------------- | ------------------------------------------------------------- |
| `lookup_surge`    | Get the 0–100 intent score for a company domain + B2B topic   |
| `scan_topic`      | Ranked list of companies showing buying intent for a category |
| `explain_signals` | Full transparent breakdown of every signal behind a score     |

## Covered Topics

50 B2B software categories including CRM, marketing automation, data warehouse, monitoring, security operations, payment processing, and more. Full list in `src/constants.ts`.

## Requirements

- Node.js 18+
- Redis (optional — falls back to in-memory store)

## Setup

```
npm install
```

Create a `.env` file (not committed):

```
NEWSDATA_API_KEY=your_key
GITHUB_TOKEN=your_token
ADZUNA_APP_ID=your_id
ADZUNA_APP_KEY=your_key
APIFY_API_TOKEN=your_token
REDIS_URL=redis://localhost:6379
PORT=3000
```

Required keys: `NEWSDATA_API_KEY`, `GITHUB_TOKEN`, `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`

Optional keys: `APIFY_API_TOKEN` (enables LinkedIn ingestion), `REDIS_URL` (defaults to localhost)

## Run the server

```
npm run build
npm start
```

- Health: `GET /health`
- MCP SSE: `GET /sse`
- MCP Messages: `POST /messages`
- MCP JSON-RPC: `POST /mcp`

Default port: `3000`, or `PORT` from the environment.

On startup, the server runs a full ingestion cycle across all sources, stores signals in Redis, then starts serving requests. Cron jobs refresh data automatically: Reddit every 2h, GitHub every 4h, News every 1h, Jobs every 6h, LinkedIn every 4h, G2 every 6h.

## Test locally

```
# List available tools
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'

# Look up a company
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"lookup_surge","arguments":{"domain":"salesforce.com","topic":"crm"}},"id":2}'

# Scan a topic
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"scan_topic","arguments":{"topic":"monitoring","limit":5}},"id":3}'
```

## Data Sources

| Source      | Method               | Cost            | Refresh  |
| ----------- | -------------------- | --------------- | -------- |
| Reddit      | Public JSON endpoint | Free            | Every 2h |
| GitHub      | Official API         | Free            | Every 4h |
| NewsData.io | REST API             | Free tier       | Every 1h |
| Adzuna      | REST API             | Free tier       | Every 6h |
| G2          | Direct scraper       | Free            | Every 6h |
| LinkedIn    | Apify actor          | Paid (optional) | Every 4h |

## Deploy (e.g. Railway)

- Build: `npm run build`
- Start: `npm start`
- Add a Redis service and set `REDIS_URL`
- Set all API keys as environment variables

## Pricing

- Execute mode: $0.005 per tool call
- Query mode: $0.10 per response (CTX handles orchestration)

## License

MIT
