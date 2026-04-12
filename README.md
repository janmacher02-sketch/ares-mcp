# ARES MCP Server

Czech & Slovak business registry MCP server. Works with Claude Desktop, Cursor, and any MCP-compatible AI assistant.

## Tools

| Tool | Description |
|------|-------------|
| `lookup_company_cz` | Full company profile from Czech ARES by IČO |
| `search_companies_cz` | Search Czech companies by name |
| `check_insolvency_cz` | Check insolvency status via ISIR |
| `lookup_company_sk` | Slovak company lookup via ORSR |
| `bulk_lookup_companies_cz` | Look up up to 10 companies at once |

## Data Sources

- **ARES** — Czech Ministry of Finance (ares.gov.cz) — free public API
- **ISIR** — Czech Insolvency Register (isir.justice.cz) — free public
- **ORSR** — Slovak Business Register (orsr.sk) — free public

## Installation (Claude Desktop)

```json
{
  "mcpServers": {
    "ares": {
      "command": "npx",
      "args": ["tsx", "/path/to/ares-mcp/src/index.ts"]
    }
  }
}
```

## Pricing

| Tier | Limit | Price |
|------|-------|-------|
| Free | 10 calls/day | $0 |
| Basic | 1,000 calls/month | [$9/month](https://buy.stripe.com/4gM3cw8Dz28qcAYdHJaEE00) |

[Get API key →](https://buy.stripe.com/4gM3cw8Dz28qcAYdHJaEE00)

## License

MIT
