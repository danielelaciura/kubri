/** The number a message leaves from (a row of SenderNumber, as the adapter needs it). */
export interface OutboundSender {
  readonly id: string;
  readonly slug: string;
  readonly provider: "meta" | "twilio";
  /** Identifiers and names of secrets, never credentials (spec §10.1). */
  readonly providerConfig: unknown;
}

export interface OutboundText {
  /** The id of our Message row: lets an adapter deduplicate if the provider supports it. */
  readonly clientMessageId: string;
  readonly sender: OutboundSender;
  readonly to: { readonly externalId: string; readonly phoneE164: string };
  readonly text: string;
}

export type SendOutcome =
  | { readonly ok: true; readonly providerMessageId: string }
  /** transient: worth retrying (limits, 5xx); permanent: stop the turn's other messages. */
  | { readonly ok: false; readonly kind: "transient" | "permanent"; readonly code: string };

/**
 * The only module that talks to a messaging provider (CLAUDE.md). Plan 09 implements Meta's
 * Cloud API behind it; here there are a fake and a console one.
 */
export interface ChannelAdapter {
  send(message: OutboundText): Promise<SendOutcome>;
}

/** For tests: a script of outcomes first (failures are not recorded), then success. */
export class FakeChannel implements ChannelAdapter {
  readonly sent: OutboundText[] = [];
  private readonly script: SendOutcome[];
  private crash: Error | null = null;

  constructor(script: readonly SendOutcome[] = []) {
    this.script = [...script];
  }

  /** The next send() throws, like an adapter with a broken socket. */
  throwOnNext(error: Error): void {
    this.crash = error;
  }

  /** Adds an outcome to the script. */
  enqueueOutcome(outcome: SendOutcome): void {
    this.script.push(outcome);
  }

  send(message: OutboundText): Promise<SendOutcome> {
    if (this.crash) {
      const error = this.crash;
      this.crash = null;
      return Promise.reject(error);
    }
    const scripted = this.script.shift();
    if (scripted && !scripted.ok) return Promise.resolve(scripted);
    this.sent.push(message);
    return Promise.resolve({
      ok: true,
      providerMessageId: scripted?.ok ? scripted.providerMessageId : `fake-${this.sent.length}`,
    });
  }
}

/** For trying the worker by hand: the candidate's "phone" is the terminal. */
export class ConsoleChannel implements ChannelAdapter {
  constructor(private readonly write: (line: string) => void) {}

  send(message: OutboundText): Promise<SendOutcome> {
    this.write(`→ ${message.to.phoneE164}: ${message.text}`);
    // From the message id, not a counter: providerMessageId is unique across worker restarts.
    return Promise.resolve({ ok: true, providerMessageId: `console-${message.clientMessageId}` });
  }
}
