import { Prisma } from "../generated/prisma/client";

/**
 * Values that reach a Json column come from Zod-parsed JSON or from codecs built on it, so they
 * are JSON by construction; Prisma's input type cannot see that through `unknown`.
 */
export function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

/** For a nullable Json column: `null` / `undefined` become SQL NULL's JSON counterpart. */
export function toNullableJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value === null || value === undefined ? Prisma.JsonNull : asJson(value);
}
