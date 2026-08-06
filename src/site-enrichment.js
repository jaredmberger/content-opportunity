const normalize = value => String(value || '')
  .toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/\b(?:rms|ss|mv|hmhs|hmt|uss)\b/g, ' ')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()
  .replace(/\s+/g, ' ');

const slug = value => normalize(value).replace(/\s+/g, '-');

function pageName(page) {
  const tail = String(page.pathname || '').split('/').filter(Boolean).pop() || '';
  return normalize(page.title || tail.replace(/-/g, ' '));
}

function canonicalMatch(item, pages) {
  if (item.canonicalUrl) {
    const exact = pages.find(page => page.url === item.canonicalUrl);
    return exact || { url: item.canonicalUrl, pathname: new URL(item.canonicalUrl).pathname, title: item.title || null };
  }

  const wanted = normalize(item.title);
  const wantedSlug = slug(item.title);
  if (!wanted) return null;

  const exactTitle = pages.find(page => pageName(page) === wanted);
  if (exactTitle) return exactTitle;

  const strongSlug = pages.find(page => {
    const tail = String(page.pathname || '').split('/').filter(Boolean).pop() || '';
    const normalizedTail = slug(tail.replace(/-/g, ' '));
    return normalizedTail === wantedSlug;
  });

  return strongSlug || null;
}

function resolveRelatedPages(item, pages) {
  const requested = [
    ...(Array.isArray(item.relatedUrls) ? item.relatedUrls : []),
    ...(Array.isArray(item.relatedTitles) ? item.relatedTitles : [])
  ];

  const resolved = [];
  for (const candidate of requested) {
    const raw = String(candidate || '').trim();
    if (!raw) continue;

    let page = pages.find(entry => entry.url === raw);
    if (!page) {
      const wanted = normalize(raw);
      page = pages.find(entry => pageName(entry) === wanted) || null;
    }
    if (page && !resolved.some(entry => entry.url === page.url)) resolved.push(page);
  }
  return resolved;
}

async function inspectLinks(canonicalUrl, relatedPages, siteOrigin) {
  if (!canonicalUrl || !relatedPages.length) return { checked: false, linked: [], missing: relatedPages };

  try {
    const response = await fetch(canonicalUrl, {
      headers: { 'user-agent': 'CuratorOS-Content-Opportunity/0.3 (+https://content.oceanliners.net)' }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();
    const hrefPattern = /<a\b[^>]*href=["']([^"']+)["']/gi;
    const linkedUrls = new Set();
    let match;
    while ((match = hrefPattern.exec(html))) {
      try {
        const url = new URL(match[1], canonicalUrl);
        if (url.origin !== new URL(siteOrigin).origin) continue;
        url.hash = '';
        url.search = '';
        linkedUrls.add(url.href);
      } catch {}
    }

    const linked = relatedPages.filter(page => linkedUrls.has(page.url));
    const missing = relatedPages.filter(page => !linkedUrls.has(page.url));
    return { checked: true, linked, missing };
  } catch {
    return { checked: false, linked: [], missing: relatedPages };
  }
}

export async function enrichWithSiteKnowledge(dataset, inventory, siteOrigin) {
  const pages = Array.isArray(inventory?.pages) ? inventory.pages : [];
  const items = Array.isArray(dataset?.items) ? dataset.items : [];

  const enriched = await Promise.all(items.map(async item => {
    const canonical = canonicalMatch(item, pages);
    const relatedPages = resolveRelatedPages(item, pages);
    const linkInspection = await inspectLinks(canonical?.url || null, relatedPages, siteOrigin);

    const result = {
      ...item,
      canonicalUrl: canonical?.url || item.canonicalUrl || null,
      siteInventoryMatch: canonical ? {
        url: canonical.url,
        title: canonical.title || null,
        pathname: canonical.pathname
      } : null,
      inventoryResolved: true
    };

    if (relatedPages.length) {
      result.potentialLinks = Math.max(Number(item.potentialLinks || 0), relatedPages.length);
      if (linkInspection.checked) result.missingLinks = linkInspection.missing.length;
      result.linkInspection = {
        checked: linkInspection.checked,
        relatedCount: relatedPages.length,
        linkedCount: linkInspection.linked.length,
        missingCount: linkInspection.missing.length,
        missingUrls: linkInspection.missing.map(page => page.url)
      };
    }

    return result;
  }));

  return {
    ...dataset,
    items: enriched,
    siteKnowledge: {
      source: inventory?.source || null,
      inventoryCount: pages.length,
      enrichedAt: new Date().toISOString()
    }
  };
}
