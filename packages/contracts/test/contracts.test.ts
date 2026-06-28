import { describe, expect, test } from "bun:test";
import {
  browserContentScriptMatches,
  browserHostPermissionPatterns,
  browserSiteIds,
  browserSites,
  EXTENSION_DEBUG_SCHEMA_VERSION,
  err,
  extensionDebugTraceCategories,
  extensionDebugTraceContexts,
  extensionDebugTraceStatuses,
  findBrowserSiteForCapture,
  ok,
  type ConversationDetail,
  type ExtensionDebugReport,
  type SearchResult,
  type SourcesResult,
  type TodayResult
} from "../src/index";

describe("contract envelopes", () => {
  test("exports stable success, empty, and error envelopes", () => {
    const result = ok<TodayResult>("today", {
      date: "2026-05-21",
      summary: "No imported sessions yet.",
      keySessions: [],
      continuationHints: [],
      sourceCoverage: []
    });

    expect(result.ok).toBe(true);
    expect(result.meta.schemaVersion).toBe(1);
    expect(result.data.keySessions).toEqual([]);

    const failed = err("search", {
      code: "invalid_arguments",
      message: "Query is required."
    });

    expect(failed.ok).toBe(false);
    expect(failed.error.code).toBe("invalid_arguments");
  });

  test("keeps required JSON fields for today, search, open, and sources", () => {
    const today = ok<TodayResult>("today", {
      date: "2026-05-21",
      summary: "1 session imported.",
      keySessions: [],
      continuationHints: ["Run rb open abc123"],
      sourceCoverage: []
    });
    const search = ok<SearchResult>("search", {
      query: "sync",
      filters: { limit: 10 },
      results: [],
      sourceCoverage: []
    });
    const sources = ok<SourcesResult>("sources", { sources: [] });
    const open = ok<ConversationDetail>("open", {
      id: "conv_1",
      sourceId: "codex",
      sourceLabel: "Codex",
      title: "Open contract",
      startedAt: "2026-05-21T10:00:00.000Z",
      updatedAt: "2026-05-21T10:00:00.000Z",
      messageCount: 1,
      messages: [{ id: "msg_1", role: "user", createdAt: "2026-05-21T10:00:00.000Z", text: "hello" }],
      rawEvidenceRefs: [],
      diagnostics: []
    });

    expect(Object.keys(today.data)).toEqual([
      "date",
      "summary",
      "keySessions",
      "continuationHints",
      "sourceCoverage"
    ]);
    expect(Object.keys(search.data)).toEqual(["query", "filters", "results", "sourceCoverage"]);
    expect(Object.keys(open.data)).toEqual([
      "id",
      "sourceId",
      "sourceLabel",
      "title",
      "startedAt",
      "updatedAt",
      "messageCount",
      "messages",
      "rawEvidenceRefs",
      "diagnostics"
    ]);
    expect(Object.keys(sources.data)).toEqual(["sources"]);
  });
});

describe("extension debug contract", () => {
  test("keeps required debug report fields stable for AI diagnostics", () => {
    const report: ExtensionDebugReport = {
      schemaVersion: EXTENSION_DEBUG_SCHEMA_VERSION,
      generatedAt: "2026-05-26T10:00:00.000Z",
      extensionVersion: "0.1.0",
      browser: {
        target: "chrome",
        context: "background"
      },
      events: [],
      captureSummaries: [],
      captureStorage: {},
      bridge: { state: "missing" },
      classifications: [],
      redactions: {
        total: 0,
        byReason: {}
      },
      storage: {
        enabled: true,
        retainedEvents: 0,
        droppedEvents: 0,
        maxEvents: 300
      }
    };

    expect(Object.keys(report)).toEqual([
      "schemaVersion",
      "generatedAt",
      "extensionVersion",
      "browser",
      "events",
      "captureSummaries",
      "captureStorage",
      "bridge",
      "classifications",
      "redactions",
      "storage"
    ]);
    expect(Object.keys(report.storage)).toEqual([
      "enabled",
      "retainedEvents",
      "droppedEvents",
      "maxEvents"
    ]);
    expect(extensionDebugTraceContexts).toContain("content");
    expect(extensionDebugTraceCategories).toContain("site-api");
    expect(extensionDebugTraceStatuses).toContain("failure");
  });
});

describe("browser site contract", () => {
  test("keeps one canonical browser site registry for extension and native-host consumers", () => {
    expect(browserSiteIds).toEqual([
      "chatgpt",
      "claude",
      "gemini",
      "deepseek",
      "kimi",
      "qianwen",
      "doubao",
      "yuanbao",
      "grok",
      "perplexity",
      "notebooklm",
      "google-ai-studio",
      "github-copilot",
      "microsoft-copilot"
    ]);
    expect(browserSites.every((site) => site.sourceId === `browser-extension-${site.id}`)).toBe(true);
  });

  test("derives manifest patterns from the browser site registry", () => {
    expect(browserHostPermissionPatterns()).toContain("https://github.com/*");
    expect(browserHostPermissionPatterns()).toContain("https://*.oaiusercontent.com/*");
    expect(browserHostPermissionPatterns()).toContain("https://oaidalleapiprodscus.blob.core.windows.net/*");
    expect(browserHostPermissionPatterns()).toContain("https://claude.ai/api/organizations/*/files/*");
    expect(browserHostPermissionPatterns()).toContain("https://copilot.microsoft.com/images/*");
    expect(browserHostPermissionPatterns()).toContain("https://lh3.googleusercontent.com/*");
    expect(browserContentScriptMatches()).toContain("https://github.com/copilot*");
    expect(browserContentScriptMatches()).not.toContain("https://*.oaiusercontent.com/*");
    expect(browserContentScriptMatches()).not.toContain("https://oaidalleapiprodscus.blob.core.windows.net/*");
    expect(browserContentScriptMatches()).not.toContain("https://claude.ai/api/organizations/*/files/*");
    expect(browserContentScriptMatches()).not.toContain("https://copilot.microsoft.com/images/*");
    expect(browserContentScriptMatches()).not.toContain("https://lh3.googleusercontent.com/*");
    expect(browserHostPermissionPatterns()).not.toContain("<all_urls>");
    expect(browserContentScriptMatches()).not.toContain("<all_urls>");
  });

  test("validates native-host capture identity and supported paths", () => {
    expect(findBrowserSiteForCapture({
      site: "perplexity",
      sourceId: "browser-extension-perplexity",
      sourceLabel: "Perplexity",
      url: "https://www.perplexity.ai/search/what-is-recallbase"
    })?.id).toBe("perplexity");
    expect(findBrowserSiteForCapture({
      site: "perplexity",
      sourceId: "browser-extension-perplexity",
      sourceLabel: "Perplexity",
      url: "https://www.perplexity.ai/"
    })).toBeUndefined();
    expect(findBrowserSiteForCapture({
      site: "perplexity",
      sourceId: "browser-extension-chatgpt",
      sourceLabel: "Perplexity",
      url: "https://www.perplexity.ai/search/what-is-recallbase"
    })).toBeUndefined();
    expect(findBrowserSiteForCapture({
      site: "chatgpt",
      sourceId: "browser-extension-chatgpt",
      sourceLabel: "ChatGPT",
      url: "https://chatgpt.com/g/g-custom-gpt/c/conversation-1"
    })?.id).toBe("chatgpt");
    expect(findBrowserSiteForCapture({
      site: "chatgpt",
      sourceId: "browser-extension-chatgpt",
      sourceLabel: "ChatGPT",
      url: "https://chatgpt.com/gg/conversation-1"
    })?.id).toBe("chatgpt");
  });
});
