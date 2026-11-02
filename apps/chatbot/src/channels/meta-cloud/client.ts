import { z } from "zod";
import type { ChannelAdapter, OutboundSender, OutboundText, SendOutcome } from "../channel";
import { MetaProviderConfigSchema } from "../provider-config";
import { classifyError } from "./errors";
import { acknowledgeBody, sendBody } from "./requests";

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface MetaChannelOptions {
  /** Graph API version, e.g. "v23.0" (META_GRAPH_VERSION). */
  readonly graphVersion: string;
  /** Value of the secret NAMED in the number's configuration; undefined when not set. */
  readonly secret: (name: string) => string | undefined;
  /** Injected by tests: they never reach Meta. */
  readonly fetch?: FetchLike;
  readonly timeoutMs?: number;
}

const ResponseSchema = z.object({
  messages: z.array(z.object({ id: z.string().min(1) })).min(1),
});

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 10_000;
const ACK_TIMEOUT_MS = 3_000;

type Failure = Extract<SendOutcome, { ok: false }>;

interface Endpoint {
  readonly ok: true;
  readonly url: string;
  readonly token: string;
}

/** The Meta Cloud API behind the channel interface (D115, D119). The token never leaves here. */
export function createMetaCloudChannel(options: MetaChannelOptions): ChannelAdapter {
  const fetchImpl: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));

  /** The endpoint and token of a number; a broken configuration is a permanent failure (D119). */
  function prepare(sender: OutboundSender): Endpoint | Failure {
    const config = MetaProviderConfigSchema.safeParse(sender.providerConfig);
    if (!config.success) return { ok: false, kind: "permanent", code: "bad_sender_config" };
    const token = options.secret(config.data.accessTokenSecret);
    if (!token) return { ok: false, kind: "permanent", code: "missing_secret" };
    return {
      ok: true,
      token,
      url: `https://graph.facebook.com/${options.graphVersion}/${config.data.phoneNumberId}/messages`,
    };
  }

  function post(endpoint: Endpoint, body: unknown, timeoutMs: number): Promise<Response> {
    return fetchImpl(endpoint.url, {
      method: "POST",
      headers: { authorization: `Bearer ${endpoint.token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  }

  return {
    supportsInteractive: true,
    freeFormWindowMs: DAY_MS,

    async send(message: OutboundText): Promise<SendOutcome> {
      const endpoint = prepare(message.sender);
      if (!endpoint.ok) return endpoint;
      let response: Response;
      try {
        response = await post(endpoint, sendBody(message), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      } catch (error: unknown) {
        const timeout =
          error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
        return { ok: false, kind: "transient", code: timeout ? "timeout" : "network" };
      }
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      if (!response.ok) return classifyError(response.status, payload);
      const parsed = ResponseSchema.safeParse(payload);
      const id = parsed.success ? parsed.data.messages[0]?.id : undefined;
      if (!id) return { ok: false, kind: "transient", code: "invalid_response" };
      return { ok: true, providerMessageId: id };
    },

    async acknowledge(providerMessageId: string, sender: OutboundSender): Promise<void> {
      const endpoint = prepare(sender);
      if (!endpoint.ok) return;
      try {
        await post(endpoint, acknowledgeBody(providerMessageId), ACK_TIMEOUT_MS);
      } catch {
        // Best effort (D121): a missing read receipt must never stop a conversation.
      }
    },
  };
}
