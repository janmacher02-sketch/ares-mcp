import express, { Request, Response, NextFunction } from "express";
import { Unkey } from "@unkey/api";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerTools } from "./tools.js";

const app = express();
app.use(express.json());

const unkey = new Unkey({ rootKey: process.env.UNKEY_ROOT_KEY! });
const UNKEY_API_ID = process.env.UNKEY_API_ID!;

const freeCalls = new Map<string, { count: number; resetAt: number }>();
const FREE_LIMIT = 10;

async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers["authorization"] ?? "";
  const apiKey = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : (req.headers["x-api-key"] as string ?? "");

  if (apiKey) {
    const { result, error } = await unkey.keys.verifyKey({ key: apiKey, apiId: UNKEY_API_ID });
    if (error || !result?.valid) {
      res.status(401).json({ error: "Invalid API key.", message: "Get your free API key at https://aresdata.janmacher.dev" });
      return;
    }
    if (result.ratelimit && result.remaining === 0) {
      res.status(429).json({ error: "Rate limit exceeded.", message: "Upgrade to Pro: https://aresdata.janmacher.dev" });
      return;
    }
    next(); return;
  }

  const ip = (req.headers["x-forwarded-for"] as string ?? req.socket.remoteAddress ?? "unknown").split(",")[0].trim();
  const now = Date.now();
  const entry = freeCalls.get(ip);
  if (!entry || entry.resetAt < now) { freeCalls.set(ip, { count: 1, resetAt: now + 86400000 }); next(); return; }
  if (entry.count >= FREE_LIMIT) {
    res.status(429).json({ error: `Free tier limit (${FREE_LIMIT}/day).`, message: "Get API key: https://aresdata.janmacher.dev" });
    return;
  }
  entry.count++; next();
}

app.get("/", (_req, res) => res.json({ name: "ares-mcp", version: "1.0.0", status: "ok" }));

app.post("/mcp", authMiddleware, async (req, res) => {
  const server = new McpServer({ name: "ares-mcp", version: "1.0.0" });
  registerTools(server);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => console.log(`ARES MCP running on port ${PORT}`));
