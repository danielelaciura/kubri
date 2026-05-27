import { Suspense } from "react";
import { AcceptInviteForm } from "@/components/auth/accept-invite-form";

export default function AcceptInvitePage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted px-4">
      <Suspense>
        <AcceptInviteForm />
      </Suspense>
    </div>
  );
}
