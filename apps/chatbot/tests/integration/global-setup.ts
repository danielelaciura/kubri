import { execSync } from "node:child_process";
import { config } from "dotenv";

// Applies all migrations to the test database once per run.
export default function setup(): void {
  config({ path: ".env.test", override: true });
  execSync("pnpm exec prisma migrate deploy", { stdio: "inherit", env: process.env });
}
