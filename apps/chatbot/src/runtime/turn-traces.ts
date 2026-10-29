import type { NluTraceRecord, NluTraceSink } from "../nlu/trace";

/**
 * The NLU traces of one turn (D110): collected in memory and written with insertTraces inside
 * the turn transaction. Frozen when the turn stops waiting for the NLU: an interpreter past
 * its deadline keeps running, and what it writes later must never reach the database outside
 * the turn (it is dropped and only counted).
 */
export class TurnTraces implements NluTraceSink {
  private readonly records: NluTraceRecord[] = [];
  private frozen = false;
  dropped = 0;

  write(record: NluTraceRecord): Promise<void> {
    if (this.frozen) this.dropped += 1;
    else this.records.push(record);
    return Promise.resolve();
  }

  /** Stops collecting; returns what was collected (the same list on every call). */
  freeze(): readonly NluTraceRecord[] {
    this.frozen = true;
    return [...this.records];
  }
}
