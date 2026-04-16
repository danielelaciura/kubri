import { newStemmer } from "snowball-stemmers";

const italianStemmer = newStemmer("italian");

const STOPWORDS_IT = new Set([
  "il","lo","la","i","gli","le","un","uno","una","di","a","da","in","con","su","per","tra","fra",
  "e","o","ma","che","chi","cui","non","si","ne","ci","vi","ho","hai","ha","abbiamo","avete","hanno",
  "sono","sei","è","siamo","siete","essere","stato","stata","stati","state",
  "questo","questa","questi","queste","quel","quello","quella","quelli","quelle",
  "se","come","più","meno","molto","poco","anche","solo","già","ancora","mai","sempre","ogni",
  "altro","altra","altri","altre","stesso","stessa","stessi","stesse","tutto","tutta","tutti","tutte",
  "del","dello","della","dei","degli","delle","al","allo","alla","ai","agli","alle",
  "dal","dallo","dalla","dai","dagli","dalle","nel","nello","nella","nei","negli","nelle",
  "sul","sullo","sulla","sui","sugli","sulle","col","coi",
]);

export function normalize(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(input: string): string[] {
  const norm = normalize(input);
  if (!norm) return [];
  return norm
    .split(" ")
    .filter((t) => t.length >= 2)
    .filter((t) => !STOPWORDS_IT.has(t));
}

export function stem(word: string): string {
  return italianStemmer.stem(word);
}

export function tokenSet(input: string): Set<string> {
  return new Set(tokenize(input).map(stem));
}
