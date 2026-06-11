// TEMPORARY SHIM — re-exports the Italian dictionary so existing
// `import { strings } from "@/lib/i18n/strings"` call sites keep compiling
// while they are migrated to getDictionary()/useT(). Deleted in the final task.
import { it } from "./dictionaries/it";

export const strings = it;
