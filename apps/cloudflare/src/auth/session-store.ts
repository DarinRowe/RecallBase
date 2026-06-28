import { sha256Hex, type AuthSubject, type AuthTokenVerifier } from "./authorization";

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}

export interface D1Result<T = unknown> {
  results?: T[];
  success: boolean;
  meta?: { changes?: number };
}

export interface GoogleIdentity {
  sub: string;
  email?: string;
  emailVerified?: boolean;
  name?: string;
  picture?: string;
}

export interface CliLoginStart {
  attemptId: string;
  pollToken: string;
  oauthState: string;
  authorizationUrl: string;
  expiresAt: string;
}

export type CliLoginPollResult =
  | { state: "waiting"; expiresAt: string }
  | { state: "expired" | "denied" | "cancelled" | "relogin_required" }
  | { state: "succeeded"; accessToken: string; userId: string; deviceId: string; expiresAt: string };

export interface WebSessionResult {
  sessionId: string;
  userId: string;
  expiresAt: string;
}

export interface HostedAuthStore extends AuthTokenVerifier {
  createCliLoginAttempt(input: { authorizationUrl: string; deviceName?: string }): Promise<CliLoginStart>;
  completeCliLoginAttempt(oauthState: string, identity: GoogleIdentity): Promise<"completed" | "not_found" | "expired" | "consumed">;
  cancelCliLoginAttempt(oauthState: string, state: "denied" | "cancelled"): Promise<void>;
  pollCliLoginAttempt(attemptId: string, pollToken: string): Promise<CliLoginPollResult>;
  createWebOAuthState(): Promise<{ oauthState: string; expiresAt: string }>;
  completeWebLogin(oauthState: string, identity: GoogleIdentity): Promise<WebSessionResult | undefined>;
  verifyWebSession(sessionId: string): Promise<AuthSubject | undefined>;
  revokeWebSession(sessionId: string): Promise<void>;
}

const CLI_ATTEMPT_TTL_MS = 10 * 60 * 1000;
const CLI_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const WEB_STATE_TTL_MS = 10 * 60 * 1000;
const WEB_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export class MemoryHostedAuthStore implements HostedAuthStore {
  private readonly attempts = new Map<string, MemoryCliAttempt>();
  private readonly webStates = new Map<string, { expiresAt: string }>();
  private readonly tokenSubjects = new Map<string, AuthSubject & { expiresAt: string }>();
  private readonly webSessions = new Map<string, AuthSubject & { expiresAt: string }>();
  private readonly usersByGoogleSub = new Map<string, string>();

  async createCliLoginAttempt(input: { authorizationUrl: string; deviceName?: string }): Promise<CliLoginStart> {
    const attemptId = randomId("attempt");
    const pollToken = randomToken("rb_poll");
    const oauthState = randomToken("rb_state");
    const expiresAt = iso(Date.now() + CLI_ATTEMPT_TTL_MS);
    this.attempts.set(attemptId, {
      attemptId,
      pollTokenHash: await sha256Hex(pollToken),
      oauthStateHash: await sha256Hex(oauthState),
      deviceId: randomId("device"),
      status: "pending",
      expiresAt
    });
    return {
      attemptId,
      pollToken,
      oauthState,
      authorizationUrl: input.authorizationUrl,
      expiresAt
    };
  }

  async completeCliLoginAttempt(oauthState: string, identity: GoogleIdentity): Promise<"completed" | "not_found" | "expired" | "consumed"> {
    const stateHash = await sha256Hex(oauthState);
    const attempt = [...this.attempts.values()].find((candidate) => candidate.oauthStateHash === stateHash);
    if (!attempt) return "not_found";
    if (Date.parse(attempt.expiresAt) <= Date.now()) {
      attempt.status = "expired";
      return "expired";
    }
    if (attempt.status === "consumed") return "consumed";
    if (attempt.status !== "pending") return attempt.status === "completed" ? "completed" : "not_found";
    attempt.userId = await this.upsertUser(identity);
    attempt.status = "completed";
    attempt.completedAt = new Date().toISOString();
    return "completed";
  }

  async cancelCliLoginAttempt(oauthState: string, state: "denied" | "cancelled"): Promise<void> {
    const stateHash = await sha256Hex(oauthState);
    const attempt = [...this.attempts.values()].find((candidate) => candidate.oauthStateHash === stateHash);
    if (attempt && attempt.status === "pending") attempt.status = state;
  }

  async pollCliLoginAttempt(attemptId: string, pollToken: string): Promise<CliLoginPollResult> {
    const attempt = this.attempts.get(attemptId);
    if (!attempt || attempt.pollTokenHash !== await sha256Hex(pollToken)) return { state: "relogin_required" };
    if (Date.parse(attempt.expiresAt) <= Date.now()) {
      attempt.status = "expired";
      return { state: "expired" };
    }
    if (attempt.status === "pending") return { state: "waiting", expiresAt: attempt.expiresAt };
    if (attempt.status === "consumed") return { state: "relogin_required" };
    if (attempt.status !== "completed" || !attempt.userId) {
      return { state: attempt.status === "expired" || attempt.status === "denied" || attempt.status === "cancelled" ? attempt.status : "relogin_required" };
    }

    const accessToken = randomToken("rb_live");
    const tokenId = randomId("token");
    const expiresAt = iso(Date.now() + CLI_TOKEN_TTL_MS);
    this.tokenSubjects.set(await sha256Hex(accessToken), {
      userId: attempt.userId,
      deviceId: attempt.deviceId,
      tokenId,
      expiresAt
    });
    attempt.status = "consumed";
    attempt.consumedAt = new Date().toISOString();
    return { state: "succeeded", accessToken, userId: attempt.userId, deviceId: attempt.deviceId, expiresAt };
  }

  async createWebOAuthState(): Promise<{ oauthState: string; expiresAt: string }> {
    const oauthState = randomToken("rb_web_state");
    const expiresAt = iso(Date.now() + WEB_STATE_TTL_MS);
    this.webStates.set(await sha256Hex(oauthState), { expiresAt });
    return { oauthState, expiresAt };
  }

  async completeWebLogin(oauthState: string, identity: GoogleIdentity): Promise<WebSessionResult | undefined> {
    const stateHash = await sha256Hex(oauthState);
    const state = this.webStates.get(stateHash);
    if (!state || Date.parse(state.expiresAt) <= Date.now()) return undefined;
    this.webStates.delete(stateHash);
    const userId = await this.upsertUser(identity);
    const sessionId = randomToken("rb_session");
    const expiresAt = iso(Date.now() + WEB_SESSION_TTL_MS);
    this.webSessions.set(await sha256Hex(sessionId), { userId, deviceId: "web", tokenId: `session:${randomId("web").slice(0, 16)}`, expiresAt });
    return { sessionId, userId, expiresAt };
  }

  async verify(token: string): Promise<AuthSubject | undefined> {
    const subject = this.tokenSubjects.get(await sha256Hex(token));
    if (!subject || Date.parse(subject.expiresAt) <= Date.now()) return undefined;
    return { userId: subject.userId, deviceId: subject.deviceId, tokenId: subject.tokenId };
  }

  async verifyWebSession(sessionId: string): Promise<AuthSubject | undefined> {
    const subject = this.webSessions.get(await sha256Hex(sessionId));
    if (!subject || Date.parse(subject.expiresAt) <= Date.now()) return undefined;
    return { userId: subject.userId, deviceId: subject.deviceId, tokenId: subject.tokenId };
  }

  async revokeWebSession(sessionId: string): Promise<void> {
    this.webSessions.delete(await sha256Hex(sessionId));
  }

  private async upsertUser(identity: GoogleIdentity): Promise<string> {
    const existing = this.usersByGoogleSub.get(identity.sub);
    if (existing) return existing;
    const userId = `user_${(await sha256Hex(`google:${identity.sub}`)).slice(0, 24)}`;
    this.usersByGoogleSub.set(identity.sub, userId);
    return userId;
  }
}

export class D1HostedAuthStore implements HostedAuthStore {
  constructor(private readonly db: D1Database) {}

  async createCliLoginAttempt(input: { authorizationUrl: string; deviceName?: string }): Promise<CliLoginStart> {
    const attemptId = randomId("attempt");
    const pollToken = randomToken("rb_poll");
    const oauthState = randomToken("rb_state");
    const now = new Date().toISOString();
    const expiresAt = iso(Date.now() + CLI_ATTEMPT_TTL_MS);
    await this.db
      .prepare(
        `INSERT INTO cli_login_attempts
         (attempt_id, poll_token_sha256, oauth_state_sha256, device_id, device_name, status, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`
      )
      .bind(attemptId, await sha256Hex(pollToken), await sha256Hex(oauthState), randomId("device"), input.deviceName ?? null, now, expiresAt)
      .run();
    return { attemptId, pollToken, oauthState, authorizationUrl: input.authorizationUrl, expiresAt };
  }

  async completeCliLoginAttempt(oauthState: string, identity: GoogleIdentity): Promise<"completed" | "not_found" | "expired" | "consumed"> {
    const now = new Date().toISOString();
    const attempt = await this.db
      .prepare("SELECT * FROM cli_login_attempts WHERE oauth_state_sha256 = ? LIMIT 1")
      .bind(await sha256Hex(oauthState))
      .first<CliLoginAttemptRow>();
    if (!attempt) return "not_found";
    if (attempt.consumed_at || attempt.status === "consumed") return "consumed";
    if (Date.parse(attempt.expires_at) <= Date.now()) {
      await this.setAttemptStatus(attempt.attempt_id, "expired");
      return "expired";
    }
    if (attempt.status === "completed") return "completed";
    if (attempt.status !== "pending") return "not_found";
    const userId = await this.upsertUser(identity);
    await this.db
      .prepare("UPDATE cli_login_attempts SET status = 'completed', user_id = ?, completed_at = ? WHERE attempt_id = ?")
      .bind(userId, now, attempt.attempt_id)
      .run();
    return "completed";
  }

  async cancelCliLoginAttempt(oauthState: string, state: "denied" | "cancelled"): Promise<void> {
    await this.db
      .prepare("UPDATE cli_login_attempts SET status = ? WHERE oauth_state_sha256 = ? AND status = 'pending'")
      .bind(state, await sha256Hex(oauthState))
      .run();
  }

  async pollCliLoginAttempt(attemptId: string, pollToken: string): Promise<CliLoginPollResult> {
    const attempt = await this.db
      .prepare("SELECT * FROM cli_login_attempts WHERE attempt_id = ? AND poll_token_sha256 = ? LIMIT 1")
      .bind(attemptId, await sha256Hex(pollToken))
      .first<CliLoginAttemptRow>();
    if (!attempt) return { state: "relogin_required" };
    if (Date.parse(attempt.expires_at) <= Date.now()) {
      await this.setAttemptStatus(attempt.attempt_id, "expired");
      return { state: "expired" };
    }
    if (attempt.status === "pending") return { state: "waiting", expiresAt: attempt.expires_at };
    if (attempt.status === "consumed" || attempt.consumed_at) return { state: "relogin_required" };
    if (attempt.status !== "completed" || !attempt.user_id) return { state: loginStateFromStoredStatus(attempt.status) };

    const accessToken = randomToken("rb_live");
    const tokenId = randomId("token");
    const expiresAt = iso(Date.now() + CLI_TOKEN_TTL_MS);
    const now = new Date().toISOString();
    const consumedResult = await this.db
      .prepare("UPDATE cli_login_attempts SET status = 'consumed', consumed_at = ? WHERE attempt_id = ? AND consumed_at IS NULL AND status = 'completed'")
      .bind(now, attemptId)
      .run();
    if (consumedResult.meta?.changes !== undefined && consumedResult.meta.changes !== 1) return { state: "relogin_required" };
    await this.db
      .prepare(
        `INSERT INTO cli_device_tokens
         (token_id, user_id, device_id, token_sha256, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(tokenId, attempt.user_id, attempt.device_id, await sha256Hex(accessToken), now, expiresAt)
      .run();
    return { state: "succeeded", accessToken, userId: attempt.user_id, deviceId: attempt.device_id, expiresAt };
  }

  async createWebOAuthState(): Promise<{ oauthState: string; expiresAt: string }> {
    const oauthState = randomToken("rb_web_state");
    const expiresAt = iso(Date.now() + WEB_STATE_TTL_MS);
    await this.db
      .prepare("INSERT INTO web_oauth_states (state_sha256, created_at, expires_at) VALUES (?, ?, ?)")
      .bind(await sha256Hex(oauthState), new Date().toISOString(), expiresAt)
      .run();
    return { oauthState, expiresAt };
  }

  async completeWebLogin(oauthState: string, identity: GoogleIdentity): Promise<WebSessionResult | undefined> {
    const stateHash = await sha256Hex(oauthState);
    const state = await this.db
      .prepare("SELECT * FROM web_oauth_states WHERE state_sha256 = ? LIMIT 1")
      .bind(stateHash)
      .first<{ state_sha256: string; expires_at: string; consumed_at: string | null }>();
    if (!state || state.consumed_at || Date.parse(state.expires_at) <= Date.now()) return undefined;
    const now = new Date().toISOString();
    const consumed = await this.db
      .prepare("UPDATE web_oauth_states SET consumed_at = ? WHERE state_sha256 = ? AND consumed_at IS NULL")
      .bind(now, stateHash)
      .run();
    if (consumed.meta?.changes !== undefined && consumed.meta.changes !== 1) return undefined;

    const userId = await this.upsertUser(identity);
    const sessionId = randomToken("rb_session");
    const sessionIdHash = await sha256Hex(sessionId);
    const expiresAt = iso(Date.now() + WEB_SESSION_TTL_MS);
    await this.db.batch([
      this.db
        .prepare("INSERT INTO web_sessions (session_id_sha256, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
        .bind(sessionIdHash, userId, now, expiresAt)
    ]);
    return { sessionId, userId, expiresAt };
  }

  async verify(token: string): Promise<AuthSubject | undefined> {
    const row = await this.db
      .prepare(
        `SELECT token_id, user_id, device_id FROM cli_device_tokens
         WHERE token_sha256 = ? AND revoked_at IS NULL AND expires_at > ? LIMIT 1`
      )
      .bind(await sha256Hex(token), new Date().toISOString())
      .first<{ token_id: string; user_id: string; device_id: string }>();
    return row ? { userId: row.user_id, deviceId: row.device_id, tokenId: row.token_id } : undefined;
  }

  async verifyWebSession(sessionId: string): Promise<AuthSubject | undefined> {
    const row = await this.db
      .prepare(
        `SELECT session_id_sha256, user_id FROM web_sessions
         WHERE session_id_sha256 = ? AND revoked_at IS NULL AND expires_at > ? LIMIT 1`
      )
      .bind(await sha256Hex(sessionId), new Date().toISOString())
      .first<{ session_id_sha256: string; user_id: string }>();
    return row ? { userId: row.user_id, deviceId: "web", tokenId: `session:${row.session_id_sha256.slice(0, 12)}` } : undefined;
  }

  async revokeWebSession(sessionId: string): Promise<void> {
    await this.db
      .prepare("UPDATE web_sessions SET revoked_at = ? WHERE session_id_sha256 = ?")
      .bind(new Date().toISOString(), await sha256Hex(sessionId))
      .run();
  }

  private async upsertUser(identity: GoogleIdentity): Promise<string> {
    const existing = await this.db
      .prepare("SELECT user_id FROM google_identities WHERE google_sub = ? LIMIT 1")
      .bind(identity.sub)
      .first<{ user_id: string }>();
    const userId = existing?.user_id ?? `user_${(await sha256Hex(`google:${identity.sub}`)).slice(0, 24)}`;
    const now = new Date().toISOString();
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO auth_users (user_id, email, email_verified, name, picture_url, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id) DO UPDATE SET
             email = excluded.email,
             email_verified = excluded.email_verified,
             name = excluded.name,
             picture_url = excluded.picture_url,
             updated_at = excluded.updated_at`
        )
        .bind(userId, identity.email ?? null, identity.emailVerified ? 1 : 0, identity.name ?? null, identity.picture ?? null, now, now),
      this.db
        .prepare(
          `INSERT INTO google_identities (google_sub, user_id, email, email_verified, name, picture_url, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(google_sub) DO UPDATE SET
             user_id = excluded.user_id,
             email = excluded.email,
             email_verified = excluded.email_verified,
             name = excluded.name,
             picture_url = excluded.picture_url,
             updated_at = excluded.updated_at`
        )
        .bind(identity.sub, userId, identity.email ?? null, identity.emailVerified ? 1 : 0, identity.name ?? null, identity.picture ?? null, now, now)
    ]);
    return userId;
  }

  private async setAttemptStatus(attemptId: string, status: string): Promise<void> {
    await this.db.prepare("UPDATE cli_login_attempts SET status = ? WHERE attempt_id = ?").bind(status, attemptId).run();
  }
}

interface MemoryCliAttempt {
  attemptId: string;
  pollTokenHash: string;
  oauthStateHash: string;
  deviceId: string;
  status: "pending" | "completed" | "consumed" | "expired" | "denied" | "cancelled";
  expiresAt: string;
  userId?: string;
  completedAt?: string;
  consumedAt?: string;
}

interface CliLoginAttemptRow {
  attempt_id: string;
  poll_token_sha256: string;
  oauth_state_sha256: string;
  device_id: string;
  status: string;
  expires_at: string;
  user_id: string | null;
  consumed_at: string | null;
}

function randomToken(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "")}`;
}

function loginStateFromStoredStatus(status: string): "expired" | "denied" | "cancelled" | "relogin_required" {
  return status === "expired" || status === "denied" || status === "cancelled" ? status : "relogin_required";
}

function randomId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}
