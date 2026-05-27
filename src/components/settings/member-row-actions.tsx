"use client";

import { useTransition } from "react";
import type { Role } from "@/generated/prisma/client";
import { strings } from "@/lib/i18n/strings";
import { DeleteMemberButton } from "@/components/settings/delete-member-button";

interface Props {
  memberId: string;
  memberName: string;
  memberEmail: string;
  memberRole: Role;
  isPending: boolean;
  removeAction: (formData: FormData) => Promise<void>;
  changeRoleAction: (formData: FormData) => Promise<void>;
  resendInviteAction: (formData: FormData) => Promise<void>;
}

export function MemberRowActions({
  memberId,
  memberName,
  memberEmail,
  memberRole,
  isPending,
  removeAction,
  changeRoleAction,
  resendInviteAction,
}: Props) {
  const [transitionPending, startTransition] = useTransition();
  const newRole = memberRole === ("ORG_ADMIN" as Role) ? "ORG_MEMBER" : "ORG_ADMIN";
  const newRoleLabel =
    memberRole === ("ORG_ADMIN" as Role)
      ? strings.roles.ORG_MEMBER
      : strings.roles.ORG_ADMIN;

  return (
    <div className="flex items-center justify-end gap-1">
      {isPending && (
        <form action={resendInviteAction}>
          <input type="hidden" name="userId" value={memberId} />
          <button
            type="submit"
            disabled={transitionPending}
            className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {strings.members.resendInvite}
          </button>
        </form>
      )}
      {memberRole !== ("ADMIN_KUBRI" as Role) && (
        <form action={(fd) => startTransition(() => changeRoleAction(fd))}>
          <input type="hidden" name="userId" value={memberId} />
          <input type="hidden" name="role" value={newRole} />
          <button
            type="submit"
            className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {newRoleLabel}
          </button>
        </form>
      )}
      <DeleteMemberButton
        memberId={memberId}
        memberName={memberName}
        memberEmail={memberEmail}
        removeAction={removeAction}
      />
    </div>
  );
}
