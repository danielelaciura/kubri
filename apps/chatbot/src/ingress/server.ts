import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { pingDatabase } from "../store/health";
import { handleVerification, handleWebhook, type HttpReply, type WebhookDeps } from "./webhook";

const WEBHOOK_PATH = "/webhooks/whatsapp";
/** A WhatsApp payload is a few KB; anything near this is not one. */
const MAX_BODY_BYTES = 1_000_000;

class BodyTooLarge extends Error {}

/**
 * The raw body (the signature covers its exact bytes). Past the limit the rest is drained and
 * dropped, not kept, so the client still reads the 413 instead of a reset connection.
 */
function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = Number(req.headers["content-length"] ?? 0) > MAX_BODY_BYTES;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) tooLarge = true;
      if (!tooLarge) chunks.push(chunk);
    });
    req.on("end", () => {
      if (tooLarge) reject(new BodyTooLarge());
      else resolve(Buffer.concat(chunks));
    });
    req.on("error", reject);
  });
}

function send(res: ServerResponse, reply: HttpReply, contentType = "text/plain"): void {
  res.writeHead(reply.status, { "content-type": contentType });
  res.end(reply.body);
}

async function route(deps: WebhookDeps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  try {
    if (req.method === "GET" && url.pathname === "/health") {
      try {
        await pingDatabase(deps.db);
        send(res, { status: 200, body: JSON.stringify({ status: "ok" }) }, "application/json");
      } catch {
        send(
          res,
          { status: 503, body: JSON.stringify({ status: "database unavailable" }) },
          "application/json",
        );
      }
      return;
    }
    if (req.method === "GET" && url.pathname === WEBHOOK_PATH) {
      send(res, handleVerification(deps, url.searchParams));
      return;
    }
    if (req.method === "POST" && url.pathname === WEBHOOK_PATH) {
      const signature = req.headers["x-hub-signature-256"];
      send(
        res,
        await handleWebhook(
          deps,
          await readBody(req),
          typeof signature === "string" ? signature : undefined,
        ),
      );
      return;
    }
    send(res, { status: 404, body: "not found" });
  } catch (error: unknown) {
    if (error instanceof BodyTooLarge) {
      send(res, { status: 413, body: "payload too large" });
      return;
    }
    // Ours to fix and safe to retry: Meta will deliver the same message again.
    deps.logger.error(
      { errorName: error instanceof Error ? error.name : "unknown" },
      "webhook failed",
    );
    send(res, { status: 500, body: "error" });
  }
}

export function createWebhookServer(deps: WebhookDeps): Server {
  return createServer((req, res) => {
    void route(deps, req, res);
  });
}
