/** The number a message leaves from (a row of SenderNumber, as the adapter needs it). */
export interface OutboundSender {
  readonly id: string;
  readonly slug: string;
  readonly provider: "meta" | "twilio";
  /** Identifiers and names of secrets, never credentials (spec §10.1). */
  readonly providerConfig: unknown;
}

/** Options offered with a text: a closed question the candidate can answer with a tap (D112). */
export interface OutboundChoices {
  /** The text of the button that opens a list. */
  readonly listButton: string;
  readonly options: readonly { readonly id: string; readonly title: string }[];
}

export interface OutboundText {
  /** The id of our Message row: lets an adapter deduplicate if the provider supports it. */
  readonly clientMessageId: string;
  readonly sender: OutboundSender;
  readonly to: { readonly externalId: string; readonly phoneE164: string };
  readonly text: string;
  /** Sent as buttons or a list when the channel supports them (D115). */
  readonly choices?: OutboundChoices;
  /** A file already uploaded with `uploadDocument`; `text` becomes its caption. Wins over `choices` (R8). */
  readonly document?: { readonly mediaId: string; readonly filename: string };
}

/** A file generated in memory and handed to the provider (R8: the CV). */
export interface OutboundFile {
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly mimeType: "application/pdf";
}

export type SendOutcome =
  | { readonly ok: true; readonly providerMessageId: string }
  /** transient: worth retrying (limits, 5xx); permanent: stop the turn's other messages. */
  | { readonly ok: false; readonly kind: "transient" | "permanent"; readonly code: string };

type SendFailure = Extract<SendOutcome, { ok: false }>;

/** The provider's id of an uploaded file, or the failure, classified as for a send (R8). */
export type UploadOutcome = { readonly ok: true; readonly mediaId: string } | SendFailure;

/**
 * The only module that talks to a messaging provider (CLAUDE.md). Plan 09 implements Meta's
 * Cloud API behind it; here there are a fake and a console one.
 */
export interface ChannelAdapter {
  send(message: OutboundText): Promise<SendOutcome>;
  /** Whether `choices` can be sent as buttons or lists. If not, only the text is sent. */
  readonly supportsInteractive: boolean;
  /**
   * Free-form messages are allowed this long after the contact's last message (Meta: 24 hours);
   * null = no such rule. The runtime checks it before sending (D119).
   */
  readonly freeFormWindowMs: number | null;
  /** Read receipt and "typing" for an inbound message. Best effort: never throws (D121). */
  acknowledge?(providerMessageId: string, sender: OutboundSender): Promise<void>;
  /**
   * Uploads a file to send later as `OutboundText.document` (R8). A channel without it never
   * gets a document to send.
   */
  uploadDocument?(file: OutboundFile, sender: OutboundSender): Promise<UploadOutcome>;
}

/** For tests: a script of outcomes first (failures are not recorded), then success. */
export class FakeChannel implements ChannelAdapter {
  readonly sent: OutboundText[] = [];
  supportsInteractive = true;
  freeFormWindowMs: number | null = null;
  /** The provider ids of the inbound messages acknowledged, in order. */
  readonly acknowledged: string[] = [];
  /** The files uploaded successfully, in order (R8). */
  readonly uploaded: OutboundFile[] = [];
  private readonly script: SendOutcome[];
  private readonly uploadScript: SendFailure[] = [];
  private crash: Error | null = null;

  constructor(script: readonly SendOutcome[] = []) {
    this.script = [...script];
  }

  /** The next send() throws, like an adapter with a broken socket. */
  throwOnNext(error: Error): void {
    this.crash = error;
  }

  acknowledge(providerMessageId: string, _sender: OutboundSender): Promise<void> {
    this.acknowledged.push(providerMessageId);
    return Promise.resolve();
  }

  /** Adds an outcome to the script. */
  enqueueOutcome(outcome: SendOutcome): void {
    this.script.push(outcome);
  }

  /** The next upload fails with this outcome (failures are not recorded). */
  enqueueUploadOutcome(outcome: SendFailure): void {
    this.uploadScript.push(outcome);
  }

  uploadDocument(file: OutboundFile, _sender: OutboundSender): Promise<UploadOutcome> {
    const scripted = this.uploadScript.shift();
    if (scripted) return Promise.resolve(scripted);
    this.uploaded.push(file);
    return Promise.resolve({ ok: true, mediaId: `fake-media-${this.uploaded.length}` });
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
  readonly supportsInteractive = true;
  readonly freeFormWindowMs = null;

  private uploads = 0;

  constructor(private readonly write: (line: string) => void) {}

  /** Nothing leaves the terminal: the file is only named when its message is "sent". */
  uploadDocument(_file: OutboundFile, _sender: OutboundSender): Promise<UploadOutcome> {
    this.uploads += 1;
    return Promise.resolve({ ok: true, mediaId: `console-media-${this.uploads}` });
  }

  send(message: OutboundText): Promise<SendOutcome> {
    this.write(`→ ${message.to.phoneE164}: ${message.text}`);
    if (message.document) {
      this.write(`   [documento ${message.document.filename}]`);
    } else if (message.choices) {
      this.write(`   ${message.choices.options.map((o) => `[${o.title}]`).join(" ")}`);
    }
    // From the message id, not a counter: providerMessageId is unique across worker restarts.
    return Promise.resolve({ ok: true, providerMessageId: `console-${message.clientMessageId}` });
  }
}
