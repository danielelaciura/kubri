import { pino } from "pino";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { processContact } from "../../src/runtime/process-contact";
import { sendMessages } from "../../src/runtime/send-messages";
import { createTestDatabase, resetBotSchema } from "./helpers/database";
import {
  CANDIDATE_ANSWERS,
  answerFor,
  makeHarness,
  replies,
  say,
  seedScenario,
} from "./helpers/runtime";

const db = createTestDatabase();

beforeEach(async () => {
  await resetBotSchema(db);
});

afterAll(async () => {
  await db.$disconnect();
});

const PRIVACY_URL = "https://kubri.it/privacy";

/**
 * The proof that does not belong to any single piece: a whole interview on the standard
 * campaign through ingress, turn and sending, with the naive interpreter and the fake channel.
 * In Italian the consent texts are curated (no link); in English the fake translator makes them
 * uncurated, so the official link is shown and recorded (D74, D111d).
 */
describe("a whole interview through ingress, turn and sending", () => {
  it.each([
    { language: "italiano", code: "it", linkShown: null },
    { language: "english", code: "en", linkShown: PRIVACY_URL },
  ])(
    "completes in $language, sends in order, saves the profile, logs no personal data",
    async ({ language, code, linkShown }) => {
      const lines: string[] = [];
      // Plain pino, without the production redaction: the runtime itself must log ids only.
      const logger = pino({ level: "debug" }, { write: (line: string) => lines.push(line) });
      const scenario = await seedScenario(db);
      const h = makeHarness(scenario);
      const deps = { ...h.deps, logger };
      const sendDeps = { ...h.sendDeps, logger };
      const campaign = scenario.campaign;
      if (!campaign) throw new Error("no campaign");
      const said: string[] = [];
      const turn = async (text: string) => {
        said.push(text);
        await say(h, text);
        await processContact(deps, h.key);
        await sendMessages(sendDeps, h.key);
      };

      await turn("ciao");
      for (let i = 0; i < 80; i += 1) {
        const current = await db.session.findFirstOrThrow();
        if (current.status === "completed") break;
        await turn(await answerFor(db, campaign.definition, current.id, language));
      }

      const session = await db.session.findFirstOrThrow();
      expect(session.status, `last answers: ${said.slice(-3).join(" | ")}`).toBe("completed");
      expect(session.language).toBe(code);
      expect(session.engineState).toMatchObject({
        phase: "post_completion",
        consentsAccepted: true,
      });

      // What the candidate was sent is what the engine produced, in order, each once.
      expect(h.channel.sent.map((m) => m.text)).toEqual(await replies(db));
      expect(
        await db.message.count({ where: { direction: "outbound", status: { not: "sent" } } }),
      ).toBe(0);
      expect(await db.message.count({ where: { direction: "inbound", status: "received" } })).toBe(
        0,
      );

      // The profile holds what was said.
      const profile = await db.candidateProfile.findUniqueOrThrow({
        where: { sessionId: session.id },
      });
      expect(profile.standard).toMatchObject({
        firstName: CANDIDATE_ANSWERS["firstName"],
        lastName: CANDIDATE_ANSWERS["lastName"],
        birthday: "1990-05-12",
        email: CANDIDATE_ANSWERS["email"],
        country: "MA",
        address: CANDIDATE_ANSWERS["address"],
      });
      expect(profile.completedAt).not.toBeNull();
      expect(profile.sharedWithGlobal).toBe(true);
      expect(await db.profileChange.count()).toBeGreaterThan(10);

      // Consents: what was read, in which language, with the link when one was shown.
      const consents = await db.consent.findMany({ orderBy: { createdAt: "asc" } });
      expect(consents.map((c) => [c.consentKey, c.outcome, c.language])).toEqual([
        ["privacy_interview", "accepted", code],
        ["kubri_global", "accepted", code],
      ]);
      for (const consent of consents) {
        expect(consent.linkShown).toBe(linkShown);
        expect(consent.contactHash).toMatch(/^[0-9a-f]{64}$/);
        expect(consent.contactHash).not.toContain(scenario.externalId);
        expect(consent.sessionId).toBe(session.id);
        expect(consent.textShown.length).toBeGreaterThan(0);
      }

      // The Kubri platform hears about it only on the significant events (spec §12.1).
      const webhookEvents = h.queue
        .named("kubri-webhook")
        .map((j) => (j.payload as { event: string }).event);
      expect(webhookEvents[0]).toBe("consents.accepted");
      expect(webhookEvents).toContain("block.completed");
      expect(webhookEvents.at(-1)).toBe("interview.completed");
      expect(webhookEvents).not.toContain("profile.updated");
      expect(h.queue.named("kubri-webhook").every((j) => j.inTransaction)).toBe(true);
      expect(h.queue.named("cv")).toHaveLength(1);
      expect(h.queue.named("geocoding").length).toBeGreaterThanOrEqual(1);

      // CLAUDE.md, privacy rule 3: ids in the logs, never the candidate's words.
      const logged = lines.join("\n");
      // At least the "turn done" line of every turn.
      expect(lines.length).toBeGreaterThanOrEqual(said.length);
      const secrets = [
        ...Object.values(CANDIDATE_ANSWERS).filter((v) => v.length > 3),
        "1990-05-12",
        scenario.externalId,
        scenario.phone,
      ];
      for (const secret of secrets) {
        expect(logged, `"${secret}" reached the logs`).not.toContain(secret);
      }
      // No message body either, in either direction.
      for (const body of h.channel.sent.map((m) => m.text)) {
        expect(logged).not.toContain(body.slice(0, 40));
      }
      for (const line of lines) {
        const entry = JSON.parse(line) as Record<string, unknown>;
        expect(entry).not.toHaveProperty("text");
        expect(entry).not.toHaveProperty("body");
      }
    },
  );
});
