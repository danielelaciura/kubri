import type { MakeDataStoreRecord, MakeListResponse } from "./types";

const DEFAULT_BASE_URL = "https://eu1.make.com/api/v2";
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

export class MakeApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "MakeApiError";
  }
}

export class MakeRateLimitError extends MakeApiError {
  constructor(message = "Rate limit exceeded") {
    super(message, 429);
    this.name = "MakeRateLimitError";
  }
}

export class MakeNotFoundError extends MakeApiError {
  constructor(message = "Record not found") {
    super(message, 404);
    this.name = "MakeNotFoundError";
  }
}

function getBaseUrl(): string {
  return process.env["MAKE_API_BASE_URL"] ?? DEFAULT_BASE_URL;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class MakeApiClient {
  private readonly datastoreId: string;
  private readonly apiToken: string;

  constructor(datastoreId: string, apiToken: string) {
    this.datastoreId = datastoreId;
    this.apiToken = apiToken;
  }

  private get headers(): Record<string, string> {
    return {
      Authorization: `Token ${this.apiToken}`,
      "Content-Type": "application/json",
    };
  }

  private async fetchWithRetry(url: string): Promise<Response> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const response = await fetch(url, { headers: this.headers });

      if (response.status === 429) {
        if (attempt < MAX_RETRIES) {
          const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
          await sleep(backoff);
          lastError = new MakeRateLimitError();
          continue;
        }
        throw new MakeRateLimitError();
      }

      if (response.status === 404) {
        throw new MakeNotFoundError();
      }

      if (!response.ok) {
        const body = await response.text();
        throw new MakeApiError(
          body || `Make.com API error: ${response.statusText}`,
          response.status,
        );
      }

      return response;
    }

    throw lastError ?? new MakeApiError("Max retries exceeded", 429);
  }

  async listRecords(params?: {
    limit?: number;
    offset?: number;
  }): Promise<MakeListResponse> {
    const baseUrl = getBaseUrl();
    const url = new URL(
      `${baseUrl}/data-stores/${this.datastoreId}/data`,
    );

    if (params?.limit !== undefined) {
      url.searchParams.set("pg[limit]", String(params.limit));
    }
    if (params?.offset !== undefined) {
      url.searchParams.set("pg[offset]", String(params.offset));
    }

    const response = await this.fetchWithRetry(url.toString());
    const data: unknown = await response.json();
    return data as MakeListResponse;
  }

  async getRecord(recordId: string): Promise<MakeDataStoreRecord> {
    const baseUrl = getBaseUrl();
    const url = `${baseUrl}/data-stores/${this.datastoreId}/data/${recordId}`;

    const response = await this.fetchWithRetry(url);
    const data: unknown = await response.json();
    return data as MakeDataStoreRecord;
  }
}
