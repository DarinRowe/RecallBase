import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { StatusPage } from "../src/pages/status";

describe("web privacy copy", () => {
  test("local-only status says Web cannot see unsynced history", () => {
    const html = renderToStaticMarkup(
      <StatusPage
        state="ready"
        status={{
          sync: {
            loggedIn: false,
            mode: "local_only",
            pendingLocalChanges: 0,
            rawDecryptionAvailable: false,
            readableSurface: []
          },
          sources: []
        }}
      />
    );

    expect(html).toContain("Web cannot see unsynced local history");
  });

  test("hybrid status names readable and encrypted surfaces", () => {
    const html = renderToStaticMarkup(
      <StatusPage
        state="ready"
        status={{
          sync: {
            loggedIn: true,
            mode: "hybrid_private",
            pendingLocalChanges: 0,
            rawDecryptionAvailable: false,
            readableSurface: ["metadata", "snippet", "optional_summary"]
          },
          sources: []
        }}
      />
    );

    expect(html).toContain("raw evidence stays local-only");
    expect(html).toContain("metadata, snippets, and optional summaries are readable");
    expect(html).toContain("normalized conversation messages sync as encrypted chunks");
  });
});
