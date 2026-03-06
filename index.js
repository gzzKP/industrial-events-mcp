#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// ── Structured Logger ─────────────────────────────────────────────────────────
const log = {
  info:  (msg, data = {}) => console.error(JSON.stringify({ level: "info",  time: new Date().toISOString(), msg, ...data })),
  warn:  (msg, data = {}) => console.error(JSON.stringify({ level: "warn",  time: new Date().toISOString(), msg, ...data })),
  error: (msg, data = {}) => console.error(JSON.stringify({ level: "error", time: new Date().toISOString(), msg, ...data })),
  fatal: (msg, data = {}) => console.error(JSON.stringify({ level: "fatal", time: new Date().toISOString(), msg, ...data })),
};

// ── Config Validation ─────────────────────────────────────────────────────────
const API_BASE_URL = process.env.API_BASE_URL;
const API_VERSION  = process.env.API_VERSION ?? "v1";
const API_TOKEN    = process.env.API_TOKEN;

for (const [key, val] of Object.entries({ API_BASE_URL, API_TOKEN })) {
  if (!val) {
    log.fatal("Missing required environment variable", { key });
    process.exit(1);
  }
}

const BASE           = `${API_BASE_URL}/${API_VERSION}`;
const FETCH_TIMEOUT  = 10_000;
const MAX_LIMIT      = 500;

// ── Helpers ───────────────────────────────────────────────────────────────────
async function apiFetch(endpoint, params = {}) {
  const url = new URL(`${BASE}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) {
    if (v != null) url.searchParams.set(k, v);
  }

  const start = Date.now();
  let res;
  try {
    res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${API_TOKEN}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    });
  } catch (err) {
    if (err.name === "TimeoutError") {
      log.error("API request timed out", { endpoint, timeoutMs: FETCH_TIMEOUT });
      throw new Error(`API request timed out after ${FETCH_TIMEOUT}ms`);
    }
    log.error("API request failed", { endpoint, error: err.message });
    throw err;
  }

  const durationMs = Date.now() - start;
  if (!res.ok) {
    const body = await res.text();
    log.error("API error response", { endpoint, status: res.status, durationMs });
    throw new Error(`API ${res.status}: ${body}`);
  }

  log.info("API request completed", { endpoint, status: res.status, durationMs });
  return res.json();
}

function flattenProps(event) {
  const props = {};
  for (const p of event.Properties ?? []) props[p.Name] = p.Value;
  return { ...event, Properties: props };
}

// ── Input Validation ──────────────────────────────────────────────────────────
function validateLimit(value, defaultVal) {
  if (value == null) return defaultVal;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error("limit must be a positive integer");
  if (n > MAX_LIMIT) throw new Error(`limit must not exceed ${MAX_LIMIT}`);
  return n;
}

function validateIso8601(value, name) {
  if (value == null) return undefined;
  if (typeof value !== "string" || isNaN(Date.parse(value)))
    throw new Error(`${name} must be a valid ISO 8601 datetime string`);
  return value;
}

function validateId(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error("id must be a positive integer");
  return n;
}

function validateBurner(value) {
  if (value == null) return undefined;
  if (typeof value !== "string" || !/^\d+$/.test(value))
    throw new Error("burner must be a numeric string, e.g. '1'");
  return value;
}

// ── Tools ─────────────────────────────────────────────────────────────────────
const TOOLS = [
  {
    name: "get_events",
    description: "Retrieve events from the API with optional filters.",
    inputSchema: {
      type: "object",
      properties: {
        limit:     { type: "number", description: `Max events to return (default 10, max ${MAX_LIMIT})` },
        startTime: { type: "string", description: "ISO 8601 start datetime" },
        endTime:   { type: "string", description: "ISO 8601 end datetime" },
        eventType: { type: "string", description: "Filter by event type" }
      }
    }
  },
  {
    name: "get_event_by_id",
    description: "Retrieve a single event by its numeric ID.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: { id: { type: "number" } }
    }
  },
  {
    name: "summarize_burner_faults",
    description: "Total fault durations (Fallas) per burner across events.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number", default: 50 } }
    }
  },
  {
    name: "summarize_flame_states",
    description: "Total flame state durations per burner.",
    inputSchema: {
      type: "object",
      properties: {
        limit:  { type: "number", default: 50 },
        burner: { type: "string", description: "Burner number, e.g. '1' for Q1" }
      }
    }
  }
];

// ── Handlers ──────────────────────────────────────────────────────────────────
async function getEvents({ limit, startTime, endTime, eventType } = {}) {
  const data = await apiFetch("getEvents", {
    limit:     validateLimit(limit, 10),
    startTime: validateIso8601(startTime, "startTime"),
    endTime:   validateIso8601(endTime, "endTime"),
    eventType,
  });
  return JSON.stringify((data.events ?? []).map(flattenProps), null, 2);
}

async function getEventById({ id }) {
  const validId = validateId(id);
  const data = await apiFetch("getEvents", { id: validId });
  const events = (data.events ?? []).map(flattenProps);
  const event = events.find(e => e.Id === validId) ?? events[0];
  return event ? JSON.stringify(event, null, 2) : `No event found with ID ${validId}`;
}

async function summarizeFaults({ limit } = {}) {
  const { events = [] } = await apiFetch("getEvents", { limit: validateLimit(limit, 50) });
  const totals = {};
  for (const ev of events)
    for (const p of ev.Properties ?? [])
      if (p.Name.includes("Fallas"))
        totals[p.Name] = (totals[p.Name] ?? 0) + (p.Value ?? 0);

  if (!Object.keys(totals).length) return "No fault data found.";

  return "Fault Totals:\n" +
    Object.entries(totals)
      .sort()
      .map(([n, v]) => `  ${n}: ${v.toFixed(3)}s`)
      .join("\n");
}

async function summarizeFlameStates({ limit, burner } = {}) {
  const { events = [] } = await apiFetch("getEvents", { limit: validateLimit(limit, 50) });
  const validBurner = validateBurner(burner);
  const STATES = ["Alta Amarilla", "Azul", "Flama Baja", "Encendido"];
  const totals = {};

  for (const ev of events)
    for (const p of ev.Properties ?? []) {
      const isState  = STATES.some(s => p.Name.includes(s));
      const isBurner = validBurner ? p.Name.startsWith(`Q${validBurner} `) : true;
      if (isState && isBurner)
        totals[p.Name] = (totals[p.Name] ?? 0) + (p.Value ?? 0);
    }

  if (!Object.keys(totals).length) return "No flame state data found.";

  return "Flame State Totals:\n" +
    Object.entries(totals)
      .sort()
      .map(([n, v]) => `  ${n}: ${v.toFixed(3)}s`)
      .join("\n");
}

// ── Server ────────────────────────────────────────────────────────────────────
const server = new Server(
  { name: "industrial-events-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  const start = Date.now();
  try {
    const handlers = {
      get_events:              getEvents,
      get_event_by_id:         getEventById,
      summarize_burner_faults: summarizeFaults,
      summarize_flame_states:  summarizeFlameStates,
    };
    const fn = handlers[params.name];
    if (!fn) throw new Error(`Unknown tool: ${params.name}`);
    const text = await fn(params.arguments ?? {});
    log.info("Tool call succeeded", { tool: params.name, durationMs: Date.now() - start });
    return { content: [{ type: "text", text }] };
  } catch (err) {
    log.error("Tool call failed", { tool: params.name, error: err.message, durationMs: Date.now() - start });
    return {
      content: [{ type: "text", text: `Error: ${err.message}` }],
      isError: true,
    };
  }
});

// ── Graceful Shutdown ─────────────────────────────────────────────────────────
async function shutdown(signal) {
  log.info("Shutting down", { signal });
  await server.close();
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));

// ── Start ─────────────────────────────────────────────────────────────────────
await server.connect(new StdioServerTransport());
log.info("Industrial Events MCP running", { apiBase: BASE });
