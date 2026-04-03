import type { NextAuthConfig } from "next-auth";
import type { Role } from "@/generated/prisma/client";

/**
 * Auth configuration shared between the full auth module and the edge middleware.
 * This file must NOT import any Node.js-only modules (Prisma, bcrypt, etc.)
 * because it runs in the Edge Runtime for middleware.
 * Type-only imports (like Role) are safe — they are erased at compile time.
 */
export const authConfig: NextAuthConfig = {
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.userId = user.id as string;
        token.organizationId = (user as unknown as Record<string, unknown>).organizationId as string;
        token.role = (user as unknown as Record<string, unknown>).role as Role;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.userId as string;
      session.user.organizationId = token.organizationId as string;
      session.user.role = token.role as Role;
      return session;
    },
  },
};
