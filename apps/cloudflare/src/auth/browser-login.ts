import type { LoginResult } from "@recallbase/contracts";

export interface BrowserLoginRequest {
  clientId: string;
  redirectUri: string;
  authorizationEndpoint: string;
  state: string;
  codeChallenge?: string;
  scope?: string;
}

export function createBrowserLoginUrl(input: BrowserLoginRequest): LoginResult {
  const url = new URL(input.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  if (input.codeChallenge) {
    url.searchParams.set("code_challenge", input.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
  }
  if (input.scope) url.searchParams.set("scope", input.scope);

  return {
    state: "opening_browser",
    authorizationUrl: url.toString()
  };
}

export function validateLoginCallback(expectedState: string, callbackUrl: string): { ok: true; code: string } | LoginResult {
  const url = new URL(callbackUrl);
  if (url.searchParams.get("state") !== expectedState) {
    return { state: "callback_state_mismatch" };
  }
  if (url.searchParams.get("error")) {
    return { state: "denied" };
  }
  const code = url.searchParams.get("code");
  if (!code) {
    return { state: "cancelled" };
  }
  return { ok: true, code };
}
