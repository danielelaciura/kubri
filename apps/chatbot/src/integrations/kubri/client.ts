import type { ChatbotCandidateWebhook } from "@kubri/contracts";
import type { KubriConfig } from "../config";

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type KubriFailure = {
  readonly ok: false;
  /** transient: try again later; permanent: the same payload would fail the same way (D126). */
  readonly kind: "transient" | "permanent";
  /** The dashboard's `error` code for a 4xx, else `http_<status>`, `timeout` or `network`. */
  readonly code: string;
  readonly status?: number;
};

export type KubriResult =
  | {
      readonly ok: true;
      /** The dashboard kept a newer profile and wrote nothing (`stale`, D125). */
      readonly skipped?: string;
    }
  | KubriFailure;

/** The only module that calls Kubri's dashboard (CLAUDE.md, module boundaries). */
export interface KubriClient {
  send(body: ChatbotCandidateWebhook): Promise<KubriResult>;
}

export const KUBRI_ENDPOINT = "/api/webhooks/chatbot/candidate";
/** The dashboard may call Google to geocode before it answers (R6, D124). */
export const KUBRI_TIMEOUT_MS = 15_000;

/** A machine code such as `unknown_pool`: anything else in the body is never repeated. */
const CODE = /^[a-z][a-z0-9_]{0,63}$/;

function codeOf(value: unknown, key: "error" | "skipped"): string | undefined {
  if (typeof value !== "object" || value === null || !(key in value)) return undefined;
  const code: unknown = (value as Record<string, unknown>)[key];
  return typeof code === "string" && CODE.test(code) ? code : undefined;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function classify(status: number, body: unknown): KubriFailure {
  if (status >= 500 || status === 429 || status === 408) {
    return { ok: false, kind: "transient", code: `http_${String(status)}`, status };
  }
  return {
    ok: false,
    kind: "permanent",
    code: codeOf(body, "error") ?? `http_${String(status)}`,
    status,
  };
}

export interface KubriClientOptions {
  readonly fetch?: FetchLike;
  readonly timeoutMs?: number;
}

/**
 * R6: `POST {baseUrl}/api/webhooks/chatbot/candidate` with the bearer secret. 2xx is done
 * (`skipped` too); 5xx, 429, 408, a timeout or a network error are transient; any other 4xx is
 * permanent, with the dashboard's code. Results carry codes only: never the secret or the body.
 */
export function createKubriClient(
  config: KubriConfig,
  options: KubriClientOptions = {},
): KubriClient {
  const fetchImpl = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? KUBRI_TIMEOUT_MS;
  return {
    async send(body) {
      try {
        const response = await fetchImpl(`${config.baseUrl}${KUBRI_ENDPOINT}`, {
          method: "POST",
          headers: { authorization: `Bearer ${config.secret}`, "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
        // Read in full to release the connection; only a machine code is ever kept from it.
        const answer = parseJson(await response.text());
        if (!response.ok) return classify(response.status, answer);
        const skipped = codeOf(answer, "skipped");
        return skipped === undefined ? { ok: true } : { ok: true, skipped };
      } catch (error: unknown) {
        const timeout =
          error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
        return { ok: false, kind: "transient", code: timeout ? "timeout" : "network" };
      }
    },
  };
}

/** For tests: a script of results first (failures are not recorded), then success. */
export class FakeKubriClient implements KubriClient {
  readonly sent: ChatbotCandidateWebhook[] = [];
  private readonly script: KubriResult[];

  constructor(script: readonly KubriResult[] = []) {
    this.script = [...script];
  }

  /** Adds a result to the script. */
  enqueueResult(result: KubriResult): void {
    this.script.push(result);
  }

  send(body: ChatbotCandidateWebhook): Promise<KubriResult> {
    const scripted = this.script.shift();
    if (scripted && !scripted.ok) return Promise.resolve(scripted);
    this.sent.push(body);
    return Promise.resolve(scripted ?? { ok: true });
  }
}
