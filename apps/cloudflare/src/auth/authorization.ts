export interface AuthSubject {
  userId: string;
  deviceId: string;
  tokenId: string;
}

export type AuthResult = { ok: true; subject: AuthSubject } | { ok: false; status: 401 | 403; message: string };

export interface AuthTokenVerifier {
  verify(token: string): Promise<AuthSubject | undefined>;
}

export class MemoryAuthTokenVerifier implements AuthTokenVerifier {
  constructor(private readonly subjectsByToken = new Map<string, AuthSubject>()) {}

  async verify(token: string): Promise<AuthSubject | undefined> {
    return this.subjectsByToken.get(token);
  }

  add(token: string, subject: AuthSubject): void {
    this.subjectsByToken.set(token, subject);
  }
}

const BEARER_PATTERN = /^Bearer\s+([A-Za-z0-9._~=-]{16,256})$/;

export async function authorizeRequest(request: Request, verifier: AuthTokenVerifier): Promise<AuthResult> {
  const authorization = request.headers.get("authorization") ?? "";
  const match = BEARER_PATTERN.exec(authorization);
  if (!match?.[1]) {
    return { ok: false, status: 401, message: "A valid RecallBase bearer token is required." };
  }

  const subject = await verifier.verify(match[1]);
  if (!subject) {
    return { ok: false, status: 403, message: "RecallBase bearer token is invalid or expired." };
  }

  return {
    ok: true,
    subject
  };
}

export function scopedObjectKey(subject: AuthSubject, id: string): string {
  return `users/${subject.userId}/devices/${subject.deviceId}/${id}`;
}

export class Sha256TokenVerifier implements AuthTokenVerifier {
  constructor(
    private readonly expectedSha256Hex: string,
    private readonly subject: AuthSubject
  ) {}

  async verify(token: string): Promise<AuthSubject | undefined> {
    return (await sha256Hex(token)) === this.expectedSha256Hex ? this.subject : undefined;
  }
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
