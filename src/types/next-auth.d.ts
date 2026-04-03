import type { Role } from "@/generated/prisma/client";
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      organizationId: string;
      role: Role;
    } & DefaultSession["user"];
  }

  interface User {
    organizationId: string;
    role: Role;
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    userId: string;
    organizationId: string;
    role: Role;
  }
}
