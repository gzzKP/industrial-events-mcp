#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// ── Config (set via env vars) ─────────────────────────────────────────────────
const API_BASE_URL = process.env.API_BASE_URL || "http://your-server/api";
const API_VERSION  = process.env.API_VERSION  || "v1";
const API_TOKEN    = process.env.API_TOKEN    || "your-token";
const BASE = `${API_BASE_URL}/${API_VERSION}`;

// ── Helpers ───────────────────────────────────────────────────────────────────
async function apiFetch(endpoint, params = {}) {
  const url = new URL(`${BASE}/${endpoint}`);
  url.searchParams.set("apiToken", API_TOKEN);
  for (const [k, v] of Object.entries(params)) {
    if (v != null) url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

function flattenProps(event) {
  const props = {};
  for (const p of event.Properties ?? []) props[p.Name] = p.Value;
  return { ...event, Properties: props };
}

// ── Tools ─────────────────────────────────────────────────────────────────────
const TOOLS = [
  {
    name: "get_events",
    description: "Retrieve events from the API with optional filters.",
    inputSchema: {
      type: "object",
      properties: {
        limit:      { type: "number", description: "Max events to return (default 10)" },
        startTime:  { type: "string", description: "ISO 8601 start datetime" },
        endTime:    { type: "string", description: "ISO 8601 end datetime" },
        eventType:  { type: "string", description: "Filter by event type" }
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
async function getEvents({ limit = 10, startTime, endTime, eventType } = {}) {
  const data = await apiFetch("getEvents", { limit, startTime, endTime, eventType });
  return JSON.stringify((data.events ?? []).map(flattenProps), null, 2);
}

async function getEventById({ id }) {
  const data = await apiFetch("getEvents", { id });
  const events = (data.events ?? []).map(flattenProps);
  const event = events.find(e => e.Id === id) ?? events[0];
  return event ? JSON.stringify(event, null, 2) : `No event found with ID ${id}`;
}

async function summarizeFaults({ limit = 50 } = {}) {
  const { events = [] } = await apiFetch("getEvents", { limit });
  const totals = {};
  for (const ev of events)
    for (const p of ev.Properties ?? [])
      if (p.Name.includes("Fallas"))
        totals[p.Name] = (totals[p.Name] ?? 0) + (p.Value ?? 0);

  if (!Object.keys(totals).length) return "No fault data found.";

  return `Fault Totals:\n` +
    Object.entries(totals)
      .sort()
      .map(([n,v]) => `  ${n}: ${v.toFixed(3)}s`)
      .join("\n");
}

async function summarizeFlameStates({ limit = 50, burner } = {}) {
  const { events = [] } = await apiFetch("getEvents", { limit });
  const STATES = ["Alta Amarilla", "Azul", "Flama Baja", "Encendido"];
  const totals = {};

  for (const ev of events)
    for (const p of ev.Properties ?? []) {
      const isState  = STATES.some(s => p.Name.includes(s));
      const isBurner = burner ? p.Name.startsWith(`Q${burner} `) : true;
      if (isState && isBurner)
        totals[p.Name] = (totals[p.Name] ?? 0) + (p.Value ?? 0);
    }

  if (!Object.keys(totals).length) return "No flame state data found.";

  return `Flame State Totals:\n` +
    Object.entries(totals)
      .sort()
      .map(([n,v]) => `  ${n}: ${v.toFixed(3)}s`)
      .join("\n");
}

// ── Server ────────────────────────────────────────────────────────────────────
const server = new Server(
  { name: "industrial-events-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  try {
    const handlers = {
      get_events: getEvents,
      get_event_by_id: getEventById,
      summarize_burner_faults: summarizeFaults,
      summarize_flame_states: summarizeFlameStates
    };
    const fn = handlers[params.name];
    if (!fn) throw new Error(`Unknown tool: ${params.name}`);
    const text = await fn(params.arguments ?? {});
    return { content: [{ type: "text", text }] };
  } catch (err) {
    return {
      content: [{ type: "text", text: `Error: ${err.message}` }],
      isError: true
    };
  }
});

await server.connect(new StdioServerTransport());
console.error("Industrial Events MCP running.");