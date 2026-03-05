# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install dependencies
npm install

# Run the MCP server (bash)
API_BASE_URL=http://your-server/api API_VERSION=v1 API_TOKEN=your-token node index.js

# Run the MCP server (PowerShell)
$env:API_BASE_URL="http://your-server/api"; $env:API_VERSION="v1"; $env:API_TOKEN="your-token"; node index.js
```

There are no tests or lint scripts defined.

## Architecture

Single-file MCP server ([index.js](index.js)) using `@modelcontextprotocol/sdk`. The project uses ES modules (`"type": "module"`).

**Request flow:**
1. MCP host connects via stdio (`StdioServerTransport`)
2. `ListToolsRequestSchema` handler returns the static `TOOLS` array
3. `CallToolRequestSchema` handler dispatches `params.name` to one of four async handler functions
4. Each handler calls `apiFetch(endpoint, params)` which builds a URL against `${API_BASE_URL}/${API_VERSION}/${endpoint}?apiToken=...`
5. Results are returned as `{ content: [{ type: "text", text }] }`

**API shape assumption:** The upstream API returns `{ events: [ { Id, Properties: [{ Name, Value }] } ] }`. `flattenProps` converts the `Properties` array into a plain object keyed by `Name`.

**Domain vocabulary:**
- Burners are referenced as `Q1`, `Q2`, etc. in property names
- Fault properties contain `"Fallas"` in their name
- Flame states: `"Alta Amarilla"`, `"Azul"`, `"Flama Baja"`, `"Encendido"`

**Configuration** (env vars, all required for real usage):
- `API_BASE_URL` — base URL of the events API
- `API_VERSION` — API version segment (default `v1`)
- `API_TOKEN` — passed as `apiToken` query param on every request
