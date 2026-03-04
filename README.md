# MCP Server for Industrial Events API

This repository provides a lightweight Model Context Protocol (MCP) server that exposes a small set of tools for querying an Industrial Events API. The server is implemented in Node.js and is intended to be run as an MCP server (e.g., connected to Claude Desktop or another MCP-compatible host).

**Files Provided**
- `package.json` — Node package metadata and binary entry.
- `index.js` — MCP server implementation and tool handlers.



**Configuration / Environment Variables**
- `API_BASE_URL` — Base URL of your events API (default: `http://your-server/api`).
- `API_VERSION` — API version path (default: `v1`).
- `API_TOKEN` — API token for authentication (default: `your-token`).

**Setup & Usage**
1. Install dependencies:

```bash
npm install
```

2. Run the MCP server (POSIX example):

```bash
API_BASE_URL=http://your-server/api \
API_VERSION=v1 \
API_TOKEN=your-token \
node index.js
```

On Windows PowerShell you can set env vars inline like:

```powershell
$env:API_BASE_URL = "http://your-server/api";
$env:API_VERSION = "v1";
$env:API_TOKEN = "your-token";
node index.js
```

**Add to Claude Desktop (example `claude_desktop_config.json`)**
```json
{
  "mcpServers": {
    "industrial-events": {
      "command": "node",
      "args": ["/path/to/mcp-events-server/index.js"],
      "env": {
        "API_BASE_URL": "http://your-server/api",
        "API_VERSION": "v1",
        "API_TOKEN": "your-token"
      }
    }
  }
}
```

**Tools Exposed (summary)**
- `get_events` — Retrieve events with optional filters: `limit`, `startTime`, `endTime`, `eventType`.
- `get_event_by_id` — Retrieve a single event by its numeric `id`.
- `summarize_burner_faults` — Aggregate fault (`Fallas`) durations per burner.
- `summarize_flame_states` — Aggregate flame-state durations (`Alta Amarilla`, `Azul`, `Flama Baja`, `Encendido`) optionally filtered by `burner`.

**Examples**
- "Show me the last 20 events" — call `get_events` with `limit=20`.
- "Which burner had the most faults?" — call `summarize_burner_faults` and inspect totals.
- "Summarize Q3 flame states for today" — call `summarize_flame_states` with `burner=3` and a `startTime`.

**Notes**
- This server communicates with your Industrial Events API using simple query parameters and expects the API to return JSON in the shape used by the handlers. Adjust `apiFetch` or the helper parsers if your API differs.
- For production usage, secure your `API_TOKEN` and consider running the server as a service or under a process manager.

---

File: [index.js](index.js)
