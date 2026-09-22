import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { z } from "zod";
import type { TrustedBusinessContext } from "@agentos/shared";
import { accounts, sessions, users, verifications } from "@agentos/database";

export const accountStateSchema = z.enum(["ACTIVE", "DISABLED"]);
export const agencyRoleSchema = z.enum(["SUPER_ADMIN", "ADMIN", "SUPPORT", "DEVELOPER"]);
export const businessRoleSchema = z.enum(["OWNER", "ADMIN", "STAFF", "VIEWER"]);

export const roleCapabilities = {
  agency: {
    SUPER_ADMIN: ["agency.manage", "business.manage", "agent.manage", "run.read", "run.execute"],
    ADMIN: ["business.manage", "agent.manage", "run.read", "run.execute"],
    SUPPORT: ["business.read", "run.read"],
    DEVELOPER: ["business.read", "agent.manage", "run.read", "run.execute"],
  },
  business: {
    OWNER: ["business.manage", "member.manage", "agent.manage", "run.read", "run.execute"],
    ADMIN: ["member.manage", "agent.manage", "run.read", "run.execute"],
    STAFF: ["conversation.read", "memory.manage", "run.read", "run.execute"],
    VIEWER: ["conversation.read", "run.read"],
  },
} as const;

export interface AuthenticatedPrincipal {
  userId: string;
  sessionId: string;
  accountState: z.infer<typeof accountStateSchema>;
}

export interface SessionAuthenticator {
  authenticate(headers: Headers): Promise<AuthenticatedPrincipal | null>;
}

export interface TrustedContextAuthorizer {
  authorize(principal: AuthenticatedPrincipal, businessId: string, capability: string): Promise<TrustedBusinessContext>;
}

export interface RealtimeScopeAuthorizer {
  canSubscribe(principal: AuthenticatedPrincipal, scope: { businessId: string; conversationId?: string; runId?: string }): Promise<boolean>;
}

export function createBetterAuth(db: Parameters<typeof drizzleAdapter>[0], secret: string, baseURL: string) {
  if (secret.length < 32) throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters");
  return betterAuth({
    database: drizzleAdapter(db, { provider: "pg", schema: { user: users, session: sessions, account: accounts, verification: verifications } }),
    secret,
    baseURL,
    emailAndPassword: { enabled: true, requireEmailVerification: false },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24, cookieCache: { enabled: false } },
    advanced: { useSecureCookies: baseURL.startsWith("https://") },
  });
}
