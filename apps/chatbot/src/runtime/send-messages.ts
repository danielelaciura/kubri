import type { Logger } from "pino";
import type { ChannelAdapter, OutboundSender } from "../channels/channel";
import type { Database } from "../store/db";
import type { JobQueue } from "../store/queue";
import type { RuntimeConfig } from "./config";

export interface SendDeps {
  readonly db: Database;
  readonly config: RuntimeConfig;
  readonly logger: Logger;
  readonly queue: JobQueue;
  readonly channelFor: (provider: OutboundSender["provider"]) => ChannelAdapter;
  readonly now: () => Date;
}
