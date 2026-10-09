// Channel of one placement of a claim, from its URL, in the vocabulary of
// Brian's claim library ("Product page", "Blog", "Amazon", ...). A claim's
// `channel` is its main channel only; the Channel filter on /claims matches a
// claim when its main channel OR any placement's channel matches, so "Amazon"
// finds every claim that appears on an Amazon listing. Returns null when the
// URL does not say clearly (a review site, a shared doc).

const PODCAST = /(podcast|buzzsprout|anchor\.fm|spotify|apple\.com\/.*podcast|youtube\.com|youtu\.be|vimeo\.com|ageist\.com\/ageist-podcast)/i;
const RETAIL = /(^|\.)(thrivemarket\.com|walmart\.com|target\.com|wholefoodsmarket\.com|vitacost\.com|iherb\.com)$/i;
const PRESS = /(^|\.)(finance\.yahoo\.com|forbes\.com|nytimes\.com|wsj\.com|businessinsider\.com|prnewswire\.com|globenewswire\.com)$/i;

export function placementChannel(url: string | null | undefined): string | null {
  if (!url) return null;
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  const host = u.hostname.replace(/^www\./, '').toLowerCase();
  const path = u.pathname.toLowerCase();
  if (/(^|\.)amazon\.[a-z.]+$/.test(host)) return 'Amazon';
  if (host === 'puritycoffee.com' || host.endsWith('.puritycoffee.com')) {
    if (path.startsWith('/products') || path.startsWith('/collections')) return 'Product page';
    if (path.startsWith('/blogs')) return 'Blog';
    return 'Site page';
  }
  if (PODCAST.test(host + path)) return 'Podcast / video';
  if (RETAIL.test(host)) return 'Retail / wholesale';
  if (PRESS.test(host)) return 'Press / media';
  return null;
}

/** True when the claim's main channel or any of its placements is `channel`. */
export function claimHasChannel(
  claim: { channel: string | null; locations?: { url?: string | null }[] | null },
  channel: string,
): boolean {
  if (claim.channel === channel) return true;
  return (claim.locations ?? []).some((l) => placementChannel(l.url) === channel);
}
