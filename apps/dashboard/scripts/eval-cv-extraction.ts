/**
 * Manual quality check for the CV extraction prompt. NOT run in CI.
 *
 * Put anonymized CVs in a folder, each with an optional sibling
 * "<name>.expected.json" holding a partial CandidateFields object.
 *
 * Run: set -a && source .env.local && set +a && pnpm tsx scripts/eval-cv-extraction.ts <dir>
 *
 * Sends the files' text to Mistral (EU). Use anonymized CVs only.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { detectDocumentKind } from "@/lib/documents/detect";
import { extractDocumentText } from "@/lib/documents/extract-text";
import { extractCandidateDraft } from "@/lib/candidates/cv-extraction";

function norm(v: unknown): string {
  return JSON.stringify(v ?? null).toLowerCase().replace(/\s+/g, " ");
}

async function main() {
  const dir = process.argv[2];
  if (!dir) throw new Error("usage: eval-cv-extraction.ts <dir>");
  const files = (await readdir(dir)).filter((f) => !f.endsWith(".json"));
  let checked = 0;
  let matched = 0;

  for (const file of files) {
    try {
      const bytes = new Uint8Array(await readFile(path.join(dir, file)));
      const kind = detectDocumentKind(bytes);
      if (!kind) {
        console.log(`SKIP ${file}: unsupported type`);
        continue;
      }
      const started = Date.now();
      const text = await extractDocumentText(bytes, kind);
      const draft = await extractCandidateDraft(text.text);
      console.log(`\n== ${file} (${text.method}, ${Date.now() - started} ms, isCv=${draft.isCv})`);
      console.log(`uncertain: ${draft.uncertain.join(", ") || "-"}`);

      const expectedPath = path.join(dir, `${path.parse(file).name}.expected.json`);
      let expected: Record<string, unknown> | null = null;
      try {
        expected = JSON.parse(await readFile(expectedPath, "utf8")) as Record<string, unknown>;
      } catch {
        console.log(JSON.stringify(draft.fields, null, 2));
        continue;
      }
      for (const [key, want] of Object.entries(expected)) {
        const got = (draft.fields as Record<string, unknown>)[key];
        const ok = norm(got) === norm(want);
        checked++;
        if (ok) matched++;
        console.log(`${ok ? "OK  " : "DIFF"} ${key}: got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
      }
    } catch (e) {
      console.log(`FAIL ${file}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (checked > 0) console.log(`\nfield accuracy: ${matched}/${checked}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
