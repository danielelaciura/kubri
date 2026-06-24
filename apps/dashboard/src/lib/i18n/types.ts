import type { it } from "./dictionaries/it";

export type Locale = "it" | "en";

// DeepStringify maps every leaf string literal to `string`,
// so `en` can satisfy Dictionary without being forced to use Italian values.
type DeepStringify<T> = {
  [K in keyof T]: T[K] extends string
    ? string
    : T[K] extends object
      ? DeepStringify<T[K]>
      : T[K];
};

// `it` is the canonical shape every dictionary must match (structure, not values).
export type Dictionary = DeepStringify<typeof it>;
