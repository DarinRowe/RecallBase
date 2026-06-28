import {
  assertSupportedBrowserSiteCapture,
  browserSites,
  parseBrowserSiteHttpsUrl,
  type BrowserExtensionCapturePayload
} from "@recallbase/contracts";

export const supportedBrowserSites = browserSites.map((site) => ({
  site: site.id,
  sourceId: site.sourceId,
  sourceLabel: site.sourceLabel,
  hosts: site.hosts,
  validPath: site.validPath
}));

export function assertSupportedBrowserCapture(payload: BrowserExtensionCapturePayload): void {
  parseBrowserSiteHttpsUrl(payload.url);
  try {
    assertSupportedBrowserSiteCapture(payload);
  } catch {
    throw new Error("Browser capture source is not supported by this native host.");
  }
}
