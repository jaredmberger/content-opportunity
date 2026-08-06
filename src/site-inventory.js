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

async function fetchIndexHtml(origin) {
  const candidates = [
    `${origin}/site-map`,
    `${origin}/sitemap`,
    `${origin}/site-map.html`,
    `${origin}/sitemap.html`
  ];
  const failures = [];

  for (const indexUrl of candidates) {
    try {
      const response = await fetch(indexUrl, {
        headers: {
          accept: 'text/html,application/xhtml+xml',
          'user-agent': 'CuratorOS-Content-Opportunity/0.8.1 (+https://content.oceanliners.net)'
        },
        cf: { cacheTtl: 300, cacheEverything: true }
      });
      if (!response.ok) {
        failures.push(`${new URL(indexUrl).pathname}: HTTP ${response.status}`);
        continue;
      }
      const html = await response.text();
      if (!/<a\b/i.test(html)) {
        failures.push(`${new URL(indexUrl).pathname}: no links found`);
        continue;
      }
      return { indexUrl, html };
    } catch (error) {
      failures.push(`${new URL(indexUrl).pathname}: ${error?.message || String(error)}`);
    }
  }

  throw new Error(`No usable site index found (${failures.join('; ')})`);
}

export async function fetchSiteInventory(siteOrigin) {
  const origin = String(siteOrigin || 'https://www.oceanliners.net').replace(/\/$/, '');
  const { indexUrl, html } = await fetchIndexHtml(origin);
  const anchorPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const seen = new Map();
  let match;

  while ((match = anchorPattern.exec(html))) {
    const url = sameOriginUrl(match[1], origin);
    if (!url || url === indexUrl) continue;
    const pathname = new URL(url).pathname;
    if (/\.(?:jpg|jpeg|png|gif|webp|svg|pdf|css|js|xml|json)$/i.test(pathname)) continue;

    const title = titleFromAnchor(match[2]);
    const existing = seen.get(url);
    if (!existing || (!existing.title && title)) {
      seen.set(url, { url, pathname, title: title || null });
    }
  }

  const pages = [...seen.values()].sort((a, b) => a.pathname.localeCompare(b.pathname));
  if (!pages.length) throw new Error(`Site index ${indexUrl} returned no usable internal pages.`);

  return {
    source: indexUrl,
    fetchedAt: new Date().toISOString(),
    count: pages.length,
    pages
  };
}
