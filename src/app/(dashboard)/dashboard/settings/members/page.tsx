import { permanentRedirect } from "next/navigation";

// Legacy route — renamed to /dashboard/users. Kept here as a permanent
// redirect so existing links (audit logs, bookmarks, in-flight invites)
// don't 404.
export default function LegacyMembersRedirect(): never {
  permanentRedirect("/dashboard/users");
}
