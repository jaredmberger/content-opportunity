const sameOriginUrl = (href, origin) => {
  try {
    const url = new URL(href, origin);
    if (url.origin !== new URL(origin).origin) return null;
    url.hash = '';
    url.search = '';
    return url.href;
  } catch {
    return null;
  }
};

const decodeHtml = value => String(value || '')
  .replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>');

function titleFromAnchor(innerHtml) {
  return decodeHtml(String(innerHtml || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim());
}

export async function fetchSiteInventory(siteOrigin) {
  const origin = String(siteOrigin || 'https://www.oceanliners.net').replace(/\/$/, '');
  const indexUrl = `${origin}/sitemap`;
  const response = await fetch(indexUrl, {
    headers: {
      'user-agent': 'CuratorOS-Content-Opportunity/0.2 (+https://content.oceanliners.net)'
    }
  });

  if (!response.ok) {
    throw new Error(`Site index returned HTTP ${response.status}`);
  }

  const html = await response.text();
  const anchorPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const seen = new Map();
  let match;

  while ((match = anchorPattern.exec(html))) {
    const url = sameOriginUrl(match[1], origin);
    if (!url || url === `${origin}/sitemap`) continue;
    const pathname = new URL(url).pathname;
    if (/\.(?:jpg|jpeg|png|gif|webp|svg|pdf|css|js|xml|json)$/i.test(pathname)) continue;

    const title = titleFromAnchor(match[2]);
    const existing = seen.get(url);
    if (!existing || (!existing.title && title)) {
      seen.set(url, { url, pathname, title: title || null });
    }
  }

  const pages = [...seen.values()].sort((a, b) => a.pathname.localeCompare(b.pathname));

  return {
    source: indexUrl,
    fetchedAt: new Date().toISOString(),
    count: pages.length,
    pages
  };
}
