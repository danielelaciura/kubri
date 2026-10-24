import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { toPgConnectionString } from "./connection-string";

export type Database = PrismaClient;

export function createDatabase(databaseUrl: string): Database {
  const adapter = new PrismaPg({ connectionString: toPgConnectionString(databaseUrl) });
  return new PrismaClient({ adapter });
}
