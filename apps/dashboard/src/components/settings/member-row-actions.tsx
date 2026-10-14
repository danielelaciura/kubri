"use client";

import type { Role } from "@/generated/prisma/client";
import { useT } from "@/lib/i18n/provider";
import { DeleteMemberButton } from "@/components/settings/delete-member-button";
import { SubmitButton } from "@/components/shared/loading-button";

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
  const t = useT();
  const newRole = memberRole === ("ORG_ADMIN" as Role) ? "ORG_MEMBER" : "ORG_ADMIN";
  const newRoleLabel =
    memberRole === ("ORG_ADMIN" as Role)
      ? t.roles.ORG_MEMBER
      : t.roles.ORG_ADMIN;

  return (
    <div className="flex items-center justify-end gap-1">
      {isPending && (
        <form action={resendInviteAction}>
          <input type="hidden" name="userId" value={memberId} />
          <SubmitButton
            variant="ghost"
            size="xs"
            className="text-muted-foreground"
          >
            {t.members.resendInvite}
          </SubmitButton>
        </form>
      )}
      {memberRole !== ("ADMIN_KUBRI" as Role) && (
        <form action={changeRoleAction}>
          <input type="hidden" name="userId" value={memberId} />
          <input type="hidden" name="role" value={newRole} />
          <SubmitButton
            variant="ghost"
            size="xs"
            className="text-muted-foreground"
          >
            {newRoleLabel}
          </SubmitButton>
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
