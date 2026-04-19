import "dotenv/config";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import { createContextMiddleware } from "@ctxprotocol/sdk";
import { seedCompanies } from "./services/company-resolver.js";
import { runFullIngestion, startCronSchedule } from "./services/signal-store.js";
import { handleLookupSurge } from "./tools/lookup-surge.js";
import { handleScanTopic } from "./tools/scan-topic.js";
import { handleExplainSignals } from "./tools/explain-signals.js";
import { COVERED_TOPICS } from "./constants.js";

seedCompanies();

const TOOLS = [
  {
    name: "lookup_surge",
    description: "Get the intent surge score (0-100) for a specific company domain and B2B software topic. Scores ≥60 indicate active buying intent. Returns full per-source signal breakdown with evidence.",
    inputSchema: {
      type: "object" as const,
      properties: {
        domain: {
          type: "string",
          description: "Company domain to look up",
          default: "salesforce.com",
          examples: ["stripe.com", "datadog.com", "hubspot.com"],
        },
        topic: {
          type: "string",
          description: "B2B software category to check intent for",
          default: "crm",
          enum: [...COVERED_TOPICS],
        },
      },
      required: ["domain", "topic"],
    },
    outputSchema: {
      type: "object" as const,
      properties: {
        domain: { type: "string" },
        company_name: { type: "string" },
        topic: { type: "string" },
        surge_score: { type: "number" },
        is_surging: { type: "boolean" },
        data_freshness: { type: "string", enum: ["fresh", "stale"] },
        freshness_secs: { type: "number" },
        signal_breakdown: { type: "array" },
        total_signals: { type: "number" },
        scored_at: { type: "string" },
      },
      required: ["domain", "topic", "surge_score", "is_surging"],
    },
    _meta: {
      surface: "both",
      queryEligible: true,
      latencyClass: "instant",
      pricing: { executeUsd: "0.00" },
    },
  },
  {
    name: "scan_topic",
    description: "Find the top companies showing buying intent for a specific B2B software category. Returns a ranked list of companies by surge score. Use min_score=60 to see only actively surging companies.",
    inputSchema: {
      type: "object" as const,
      properties: {
        topic: {
          type: "string",
          description: "B2B software category to scan",
          default: "crm",
          enum: [...COVERED_TOPICS],
        },
        min_score: {
          type: "number",
          description: "Minimum surge score to include",
          default: 0,
          examples: [0, 60],
        },
        limit: {
          type: "number",
          description: "Max companies to return",
          default: 20,
        },
        offset: {
          type: "number",
          description: "Pagination offset",
          default: 0,
        },
      },
      required: ["topic"],
    },
    outputSchema: {
      type: "object" as const,
      properties: {
        topic: { type: "string" },
        total: { type: "number" },
        count: { type: "number" },
        offset: { type: "number" },
        has_more: { type: "boolean" },
        companies: { type: "array" },
      },
      required: ["topic", "total", "companies"],
    },
    _meta: {
      surface: "both",
      queryEligible: true,
      latencyClass: "instant",
      pricing: { executeUsd: "0.00" },
    },
  },
  {
    name: "explain_signals",
    description: "Get the full transparent breakdown of all individual signals behind a company's surge score for a given topic. Shows every Reddit post, GitHub issue, job listing, and news article with timestamps, evidence URLs, and per-source weights.",
    inputSchema: {
      type: "object" as const,
      properties: {
        domain: {
          type: "string",
          description: "Company domain to explain signals for",
          default: "salesforce.com",
          examples: ["stripe.com", "datadog.com"],
        },
        topic: {
          type: "string",
          description: "B2B software category",
          default: "crm",
          enum: [...COVERED_TOPICS],
        },
      },
      required: ["domain", "topic"],
    },
    outputSchema: {
      type: "object" as const,
      properties: {
        domain: { type: "string" },
        company_name: { type: "string" },
        topic: { type: "string" },
        surge_score: { type: "number" },
        is_surging: { type: "boolean" },
        signals: { type: "array" },
        signal_count_by_source: { type: "object" },
        scoring_formula: { type: "string" },
      },
      required: ["domain", "topic", "surge_score", "signals", "scoring_formula"],
    },
    _meta: {
      surface: "both",
      queryEligible: true,
      latencyClass: "instant",
      pricing: { executeUsd: "0.00" },
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>) {
  switch (name) {
    case "lookup_surge":
      return await handleLookupSurge(args as unknown as Parameters<typeof handleLookupSurge>[0]);
    case "scan_topic":
      return await handleScanTopic(args as unknown as Parameters<typeof handleScanTopic>[0]);
    case "explain_signals":
      return await handleExplainSignals(args as unknown as Parameters<typeof handleExplainSignals>[0]);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function handleJsonRpc(method: string, params: Record<string, unknown> | undefined, id: unknown) {
  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "surgesignal-mcp-server", version: "1.0.0" },
      },
      id,
    };
  }

  if (method === "notifications/initialized") {
    return { jsonrpc: "2.0", result: {}, id };
  }

  if (method === "tools/list") {
    return { jsonrpc: "2.0", result: { tools: TOOLS }, id };
  }

  if (method === "tools/call") {
    try {
      const p = params as { name: string; arguments?: Record<string, unknown> };
      const data = await callTool(p.name, p.arguments || {});
      return {
        jsonrpc: "2.0",
        result: {
          content: [{ type: "text", text: JSON.stringify(data) }],
          structuredContent: data,
        },
        id,
      };
    } catch (err) {
      return {
        jsonrpc: "2.0",
        result: {
          content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
          isError: true,
        },
        id,
      };
    }
  }

  return { jsonrpc: "2.0", error: { code: -32601, message: "Method not found" }, id };
}

const app = express();
app.use(express.json());

app.use("/mcp", createContextMiddleware());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", server: "surgesignal-mcp-server", version: "1.0.0" });
});

const sseTransports = new Map<string, SSEServerTransport>();

app.get("/sse", async (_req, res) => {
  const s = new Server(
    { name: "surgesignal-mcp-server", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  s.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  s.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const data = await callTool(name, args as Record<string, unknown>);
      return {
        content: [{ type: "text", text: JSON.stringify(data) }],
        structuredContent: data,
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  });

  const t = new SSEServerTransport("/messages", res);
  sseTransports.set(t.sessionId, t);
  res.on("close", () => sseTransports.delete(t.sessionId));
  await s.connect(t);
});

app.post("/messages", async (req, res) => {
  const sessionId = req.query.sessionId as string;
  const t = sseTransports.get(sessionId);
  if (t) {
    await t.handlePostMessage(req, res);
  } else {
    res.status(400).json({ error: "No active SSE connection for this session" });
  }
});

app.post("/sse", async (req, res) => {
  const { method, params, id } = req.body;
  const result = await handleJsonRpc(method, params, id);
  res.json(result);
});

app.post("/mcp", async (req, res) => {
  const { method, params, id } = req.body;
  const result = await handleJsonRpc(method, params, id);
  res.json(result);
});

function startKeepAlive() {
  const url = process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || "3000"}`;
  setInterval(async () => {
    try {
      await fetch(`${url}/health`);
    } catch {}
  }, 10 * 60 * 1000);
}

const INGESTION_TIMEOUT_MS = 6 * 60 * 1000;

const port = parseInt(process.env.PORT || "3000");
app.listen(port, () => {
  console.error(`SurgeSignal MCP server running on http://localhost:${port}`);
  console.error("Running initial data ingestion (4 min timeout)...");

  const ingestionPromise = runFullIngestion()
    .then((result) => {
      console.error(`Ingestion succeeded: ${result.total} signals`);
    })
    .catch((err) => {
      console.error(`Ingestion error: ${(err as Error).message}`);
    });

  const timeoutPromise = new Promise<void>((resolve) => {
    setTimeout(() => {
      console.error("Ingestion timeout reached (4 min) — server ready with partial data");
      resolve();
    }, INGESTION_TIMEOUT_MS);
  });

  Promise.race([ingestionPromise, timeoutPromise]).then(() => {
    startCronSchedule();
    startKeepAlive();
    console.error("Ready to serve requests.");
  });
});