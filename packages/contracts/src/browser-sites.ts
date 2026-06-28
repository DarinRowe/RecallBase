export type BrowserSiteAdapterKind = "custom" | "configured";

export interface BrowserSiteContract {
  id: string;
  sourceId: string;
  sourceLabel: string;
  docsName: string;
  hosts: readonly string[];
  validPath: RegExp;
  hostPermissionPatterns: readonly string[];
  assetHostPermissionPatterns: readonly string[];
  contentScriptMatches: readonly string[];
  adapterKind: BrowserSiteAdapterKind;
}

export interface BrowserSiteCaptureReference {
  site: string;
  sourceId: string;
  sourceLabel: string;
  url: string;
}

export const browserSites = [
  site("chatgpt", "ChatGPT", ["chatgpt.com", "chat.openai.com"], /^\/(c|share|g|gg)\//, {
    adapterKind: "custom",
    assetHostPermissionPatterns: ["https://*.oaiusercontent.com/*", "https://oaidalleapiprodscus.blob.core.windows.net/*"]
  }),
  site("claude", "Claude", ["claude.ai"], /^\/chat\/.+/, {
    assetHostPermissionPatterns: ["https://claude.ai/api/organizations/*/files/*"]
  }),
  site("gemini", "Gemini", ["gemini.google.com"], /^\/(.+\/)?(app\/.+|gem\/.+\/.+)/, {
    assetHostPermissionPatterns: ["https://lh3.googleusercontent.com/*"]
  }),
  site("deepseek", "DeepSeek", ["chat.deepseek.com"], /^\/a\/chat\/s\/[^/]+$/),
  site("kimi", "Kimi", ["kimi.com", "moonshot.cn"], /^\/chat\/[^/]+/, {
    hostPermissionPatterns: ["https://kimi.moonshot.cn/*", "https://kimi.com/*", "https://www.kimi.com/*"],
    contentScriptMatches: ["https://kimi.moonshot.cn/*", "https://kimi.com/*", "https://www.kimi.com/*"]
  }),
  site("qianwen", "Qwen", ["qianwen.com"], /^\/chat\/[a-f0-9]+$/, {
    docsName: "Qwen",
    hostPermissionPatterns: ["https://qianwen.com/*", "https://www.qianwen.com/*"],
    contentScriptMatches: ["https://qianwen.com/*", "https://www.qianwen.com/*"]
  }),
  site("doubao", "Doubao", ["doubao.com"], /^\/chat\/(?!local)[^/]+/, {
    docsName: "Doubao",
    hostPermissionPatterns: ["https://www.doubao.com/*"],
    contentScriptMatches: ["https://www.doubao.com/*"]
  }),
  site("yuanbao", "Tencent Yuanbao", ["yuanbao.tencent.com"], /^\/chat\/[^/]+\/[^/]+$/, {
    docsName: "Tencent Yuanbao"
  }),
  site("grok", "Grok", ["grok.com"], /^(\/(chat|c)\/[^/]+|\/)$/, {
    assetHostPermissionPatterns: ["https://assets.grok.com/*"]
  }),
  site("perplexity", "Perplexity", ["perplexity.ai"], /^\/(search\/[^/]+|spaces\/[^/]+\/search\/[^/]+)/, {
    adapterKind: "custom",
    assetHostPermissionPatterns: ["https://pplx-res.cloudinary.com/*", "https://assets.perplexity.ai/*"],
    hostPermissionPatterns: ["https://perplexity.ai/*", "https://www.perplexity.ai/*"],
    contentScriptMatches: ["https://perplexity.ai/*", "https://www.perplexity.ai/*"]
  }),
  site("notebooklm", "NotebookLM", ["notebooklm.google.com"], /^\/notebook\/[^/]+/),
  site("google-ai-studio", "Google AI Studio", ["aistudio.google.com"], /^\/(app\/)?(u\/\d+\/)?prompts\/[^/]+/),
  site("github-copilot", "GitHub Copilot", ["github.com"], /^\/copilot(?:\/.*)?$/, {
    hostPermissionPatterns: ["https://github.com/*"],
    contentScriptMatches: ["https://github.com/copilot*"]
  }),
  site("microsoft-copilot", "Microsoft Copilot", ["copilot.microsoft.com"], /^\/($|chats?\/[^/]+|threads?\/[^/]+)/, {
    assetHostPermissionPatterns: ["https://copilot.microsoft.com/images/*"]
  })
] as const satisfies readonly BrowserSiteContract[];

export type BrowserSiteId = (typeof browserSites)[number]["id"];

export const browserSiteIds = browserSites.map((item) => item.id);

export function browserSourceId(siteId: string): string {
  return `browser-extension-${siteId}`;
}

export function browserHostPermissionPatterns(): readonly string[] {
  return unique(browserSites.flatMap((item) => [...item.hostPermissionPatterns, ...item.assetHostPermissionPatterns]));
}

export function browserAssetHostPermissionPatterns(): readonly string[] {
  return unique(browserSites.flatMap((item) => item.assetHostPermissionPatterns));
}

export function browserContentScriptMatches(): readonly string[] {
  return unique(browserSites.flatMap((item) => item.contentScriptMatches));
}

export function findBrowserSiteById(siteId: string): BrowserSiteContract | undefined {
  return browserSites.find((item) => item.id === siteId);
}

export function findBrowserSiteForCapture(input: BrowserSiteCaptureReference): BrowserSiteContract | undefined {
  const url = parseHttpsUrl(input.url);
  return browserSites.find((item) =>
    item.id === input.site &&
    item.sourceId === input.sourceId &&
    item.sourceLabel === input.sourceLabel &&
    matchesBrowserSiteUrl(item, url)
  );
}

export function assertSupportedBrowserSiteCapture(input: BrowserSiteCaptureReference): void {
  if (!findBrowserSiteForCapture(input)) {
    throw new Error("Browser capture source is not supported.");
  }
}

export function matchesBrowserSiteUrl(siteContract: BrowserSiteContract, url: URL): boolean {
  return siteContract.hosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`)) &&
    siteContract.validPath.test(url.pathname);
}

export function parseBrowserSiteHttpsUrl(value: string): URL {
  return parseHttpsUrl(value);
}

function site(
  id: string,
  sourceLabel: string,
  hosts: readonly string[],
  validPath: RegExp,
  options: {
    docsName?: string;
    hostPermissionPatterns?: readonly string[];
    assetHostPermissionPatterns?: readonly string[];
    contentScriptMatches?: readonly string[];
    adapterKind?: BrowserSiteAdapterKind;
  } = {}
): BrowserSiteContract {
  const defaultPatterns = hosts.map((host) => `https://${host}/*`);
  return {
    id,
    sourceId: browserSourceId(id),
    sourceLabel,
    docsName: options.docsName ?? sourceLabel,
    hosts,
    validPath,
    hostPermissionPatterns: options.hostPermissionPatterns ?? defaultPatterns,
    assetHostPermissionPatterns: options.assetHostPermissionPatterns ?? [],
    contentScriptMatches: options.contentScriptMatches ?? options.hostPermissionPatterns ?? defaultPatterns,
    adapterKind: options.adapterKind ?? "configured"
  };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function parseHttpsUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Browser capture URL is invalid.");
  }
  if (url.protocol !== "https:") throw new Error("Browser capture URL must use HTTPS.");
  return url;
}
