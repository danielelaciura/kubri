import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { CliError } from "../../src/cli/deps";
import { runCli, SENDER_ADD_ARGS, seedViaCli } from "./helpers/cli";
import { createTestDatabase, resetBotSchema } from "./helpers/database";

const db = createTestDatabase();

beforeEach(async () => {
  await resetBotSchema(db);
});

afterAll(async () => {
  await db.$disconnect();
});

describe("orgs add", () => {
  it("creates an organization", async () => {
    const { stdout, error } = await runCli(db, ["orgs", "add", "kubri", "--name", "Kubri S.r.l."]);

    expect(error).toBeUndefined();
    expect(stdout[0]).toMatch(/^✓ organization kubri created/);
    expect(await db.organization.count()).toBe(1);
  });

  it("refuses a duplicate slug", async () => {
    await runCli(db, ["orgs", "add", "kubri", "--name", "Kubri"]);

    const { error } = await runCli(db, ["orgs", "add", "kubri", "--name", "Kubri again"]);

    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).message).toMatch(/already exists/);
  });

  it("refuses a slug that is not kebab-case", async () => {
    const { error } = await runCli(db, ["orgs", "add", "Kubri_SRL", "--name", "Kubri"]);

    expect(error).toBeInstanceOf(CliError);
    expect(await db.organization.count()).toBe(0);
  });
});

describe("senders add", () => {
  it("creates a Meta sender number linked to its organization", async () => {
    await seedViaCli(db);

    const sender = await db.senderNumber.findUniqueOrThrow({
      where: { slug: "kubri-main" },
      include: { organization: true },
    });
    expect(sender.organization?.slug).toBe("kubri");
    expect(sender.status).toBe("active");
    expect(sender.providerConfig).toEqual({
      phoneNumberId: "123456789012345",
      wabaId: "987654321098765",
      accessTokenSecret: "META_TOKEN_KUBRI_MAIN",
    });
  });

  it("refuses something that looks like a token instead of a secret name", async () => {
    await runCli(db, ["orgs", "add", "kubri", "--name", "Kubri"]);
    const args = [...SENDER_ADD_ARGS.slice(0, -1), "EAAGm0PX4ZCpsBAabc123"];

    const { error } = await runCli(db, args);

    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).message).toMatch(/accessTokenSecret/);
    expect(await db.senderNumber.count()).toBe(0);
  });

  it("refuses an unknown organization", async () => {
    const { error } = await runCli(db, SENDER_ADD_ARGS);

    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).message).toMatch(/Organization "kubri" does not exist/);
  });

  it("refuses a phone number already registered", async () => {
    await seedViaCli(db);
    const args = SENDER_ADD_ARGS.map((arg) => (arg === "kubri-main" ? "kubri-bis" : arg));

    const { error } = await runCli(db, args);

    expect((error as CliError).message).toMatch(/already registered/);
  });
});
