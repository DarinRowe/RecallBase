import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LoginPage } from "../src/pages/login";
import { createRecallBaseClient } from "../src";

describe("web auth states", () => {
  test("login page uses Google and does not point users to CLI login", () => {
    const html = renderToStaticMarkup(<LoginPage state="expired" />);

    expect(html).toContain("Continue with Google");
    expect(html).toContain("/auth/google/start");
    expect(html).not.toContain("Log in again from the CLI");
  });

  test("API client uses session cookies and maps auth expiry to Google recovery", async () => {
    const originalFetch = globalThis.fetch;
    let credentials: RequestCredentials | undefined;
    globalThis.fetch = (async (_input, init) => {
      credentials = init?.credentials;
      return new Response("not json", { status: 401 });
    }) as typeof fetch;

    try {
      const result = await createRecallBaseClient().status();
      expect(credentials).toBe("include");
      expect(result.ok).toBeFalse();
      if (!result.ok) expect(result.error.message).toContain("Continue with Google");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
