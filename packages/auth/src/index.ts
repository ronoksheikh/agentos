import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { z } from "zod";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { ulid } from "ulid";
import type { TrustedBusinessContext } from "@agentos/shared";
import { accounts, sessions, users, verifications } from "@agentos/database";

export const accountStateSchema = z.enum(["ACTIVE", "DISABLED"]);
export const agencyRoleSchema = z.enum(["SUPER_ADMIN", "ADMIN", "SUPPORT", "DEVELOPER"]);
export const businessRoleSchema = z.enum(["OWNER", "ADMIN", "STAFF", "VIEWER"]);

export const roleCapabilities = {
  agency: {
    SUPER_ADMIN: ["agency.manage", "session.manage", "business.read", "business.manage", "member.manage", "agent.manage", "run.read", "run.execute", "conversation.read", "memory.manage", "audit.read", "feature_flag.manage", "tool_policy.manage"],
    ADMIN: ["business.read", "business.manage", "member.manage", "agent.manage", "run.read", "run.execute", "conversation.read", "memory.manage", "audit.read", "feature_flag.manage", "tool_policy.manage"],
    SUPPORT: ["business.read", "run.read", "conversation.read", "audit.read"],
    DEVELOPER: ["business.read", "agent.manage", "run.read", "run.execute", "conversation.read", "audit.read", "tool_policy.manage"],
  },
  business: {
    OWNER: ["business.manage", "member.manage", "agent.manage", "run.read", "run.execute"],
    ADMIN: ["member.manage", "agent.manage", "run.read", "run.execute"],
    STAFF: ["conversation.read", "memory.manage", "run.read", "run.execute"],
    VIEWER: ["conversation.read", "run.read"],
  },
} as const;

export type AgencyRole = z.infer<typeof agencyRoleSchema>;
export type AgencyCapability = (typeof roleCapabilities.agency)[AgencyRole][number];

export function agencyCapabilities(role: AgencyRole, additions: readonly string[] = []): string[] {
  return [...new Set([...roleCapabilities.agency[role], ...additions])];
}

export function requireAgencyCapability(membership: { role: AgencyRole; capabilities?: readonly string[] } | null, capability: string): void {
  if (!membership || !agencyCapabilities(membership.role, membership.capabilities).includes(capability)) throw new Error("FORBIDDEN");
}

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

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
const passwordHash = (password: string, salt = randomBytes(16).toString("hex")) => `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
const passwordMatches = (password: string, stored: string) => {
  const [salt, expected] = stored.split(":");
  if (!salt || !expected) return false;
  const actual = scryptSync(password, salt, 64);
  const expectedBuffer = Buffer.from(expected, "hex");
  return actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer);
};

export const invitationScopeSchema = z.enum(["AGENCY", "BUSINESS"]);
export const invitationSchema = z.object({
  id: z.string(), email: z.email(), scope: invitationScopeSchema, role: z.string().min(1), businessId: z.string().optional(),
  invitedBy: z.string(), expiresAt: z.iso.datetime({ offset: true }), acceptedAt: z.iso.datetime({ offset: true }).nullable(), createdAt: z.iso.datetime({ offset: true }),
});
export type Invitation = z.infer<typeof invitationSchema>;

type AuthUser = { id: string; name: string; email: string; state: "ACTIVE" | "DISABLED"; passwordHash: string };
type SessionRecord = { id: string; userId: string; tokenHash: string; expiresAt: string; revokedAt: string | null };

/** Deterministic application auth workflows used by API adapters and tests; Better Auth remains the browser cookie/session authority. */
export class AgencyAuthService {
  readonly users = new Map<string, AuthUser>();
  readonly sessions = new Map<string, SessionRecord>();
  readonly invitations = new Map<string, Invitation & { tokenHash: string }>();
  readonly resetTokens = new Map<string, { userId: string; tokenHash: string; expiresAt: string; usedAt: string | null }>();
  readonly memberships = new Map<string, { userId: string; role: AgencyRole; capabilities: string[] }>();

  createUser(input: { id?: string; name: string; email: string; password: string; role?: AgencyRole }) {
    if (input.password.length < 12) throw new Error("PASSWORD_TOO_SHORT");
    const email = input.email.trim().toLowerCase();
    if ([...this.users.values()].some((user) => user.email === email)) throw new Error("EMAIL_EXISTS");
    const user: AuthUser = { id: input.id ?? ulid(), name: input.name, email, state: "ACTIVE", passwordHash: passwordHash(input.password) };
    this.users.set(user.id, user);
    if (input.role) this.memberships.set(user.id, { userId: user.id, role: input.role, capabilities: [] });
    return { id: user.id, name: user.name, email: user.email, state: user.state };
  }

  login(email: string, password: string, now = new Date()) {
    const user = [...this.users.values()].find((candidate) => candidate.email === email.trim().toLowerCase());
    if (!user || user.state !== "ACTIVE" || !passwordMatches(password, user.passwordHash) || !this.memberships.has(user.id)) throw new Error("INVALID_CREDENTIALS");
    const token = randomBytes(32).toString("base64url");
    const session = { id: ulid(), userId: user.id, tokenHash: tokenHash(token), expiresAt: new Date(now.getTime() + 7 * 86_400_000).toISOString(), revokedAt: null };
    this.sessions.set(session.id, session);
    return { token, sessionId: session.id, expiresAt: session.expiresAt };
  }

  authenticateToken(token: string, now = new Date()): AuthenticatedPrincipal | null {
    const hash = tokenHash(token);
    const session = [...this.sessions.values()].find((candidate) => candidate.tokenHash === hash);
    if (!session || session.revokedAt || session.expiresAt <= now.toISOString()) return null;
    const user = this.users.get(session.userId);
    if (!user || user.state !== "ACTIVE") return null;
    return { userId: user.id, sessionId: session.id, accountState: user.state };
  }

  logout(sessionId: string) { const session = this.sessions.get(sessionId); if (session) session.revokedAt = new Date().toISOString(); }
  revokeUserSessions(actor: { role: AgencyRole; capabilities?: string[] }, userId: string) { requireAgencyCapability(actor, "session.manage"); for (const session of this.sessions.values()) if (session.userId === userId) session.revokedAt = new Date().toISOString(); }
  disableUser(actor: { role: AgencyRole; capabilities?: string[] }, userId: string) { requireAgencyCapability(actor, "agency.manage"); const user = this.users.get(userId); if (!user) throw new Error("USER_NOT_FOUND"); user.state = "DISABLED"; this.revokeUserSessions({ role: "SUPER_ADMIN" }, userId); }
  setAgencyMembership(actor: { role: AgencyRole; capabilities?: string[] }, userId: string, role: AgencyRole, capabilities: string[] = []) { requireAgencyCapability(actor, "agency.manage"); if (!this.users.has(userId)) throw new Error("USER_NOT_FOUND"); this.memberships.set(userId, { userId, role: agencyRoleSchema.parse(role), capabilities: [...new Set(capabilities)] }); }
  listAgencyUsers(actor: { role: AgencyRole; capabilities?: string[] }) { requireAgencyCapability(actor, "agency.manage"); return [...this.memberships.values()].map((membership) => { const user = this.users.get(membership.userId)!; return { id: user.id, name: user.name, email: user.email, state: user.state, ...structuredClone(membership) }; }); }

  invite(actor: { userId: string; role: AgencyRole; capabilities?: string[] }, input: { email: string; scope: "AGENCY" | "BUSINESS"; role: string; businessId?: string }, now = new Date()) {
    requireAgencyCapability(actor, input.scope === "AGENCY" ? "agency.manage" : "member.manage");
    if (input.scope === "BUSINESS" && !input.businessId) throw new Error("BUSINESS_REQUIRED");
    const token = randomBytes(32).toString("base64url");
    const invitation = invitationSchema.parse({ id: ulid(), email: input.email.trim().toLowerCase(), scope: input.scope, role: input.role, ...(input.businessId ? { businessId: input.businessId } : {}), invitedBy: actor.userId, expiresAt: new Date(now.getTime() + 72 * 3_600_000).toISOString(), acceptedAt: null, createdAt: now.toISOString() });
    this.invitations.set(invitation.id, { ...invitation, tokenHash: tokenHash(token) });
    return { invitation, token };
  }

  acceptAgencyInvitation(token: string, input: { name: string; password: string }, now = new Date()) {
    const invite = [...this.invitations.values()].find((candidate) => candidate.tokenHash === tokenHash(token));
    if (!invite || invite.scope !== "AGENCY" || invite.acceptedAt || invite.expiresAt <= now.toISOString()) throw new Error("INVITATION_INVALID");
    const user = this.createUser({ name: input.name, email: invite.email, password: input.password, role: agencyRoleSchema.parse(invite.role) });
    invite.acceptedAt = now.toISOString();
    return user;
  }

  requestPasswordReset(email: string, now = new Date()) {
    const user = [...this.users.values()].find((candidate) => candidate.email === email.trim().toLowerCase());
    if (!user) return null;
    const token = randomBytes(32).toString("base64url");
    const id = ulid();
    this.resetTokens.set(id, { userId: user.id, tokenHash: tokenHash(token), expiresAt: new Date(now.getTime() + 3_600_000).toISOString(), usedAt: null });
    return token;
  }

  resetPassword(token: string, password: string, now = new Date()) {
    if (password.length < 12) throw new Error("PASSWORD_TOO_SHORT");
    const record = [...this.resetTokens.values()].find((candidate) => candidate.tokenHash === tokenHash(token));
    if (!record || record.usedAt || record.expiresAt <= now.toISOString()) throw new Error("RESET_INVALID");
    const user = this.users.get(record.userId); if (!user || user.state !== "ACTIVE") throw new Error("RESET_INVALID");
    user.passwordHash = passwordHash(password); record.usedAt = now.toISOString(); this.revokeUserSessions({ role: "SUPER_ADMIN" }, user.id);
  }
}
