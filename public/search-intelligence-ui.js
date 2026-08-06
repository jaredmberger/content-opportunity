const input = document.querySelector('#searchDataInput');
const button = document.querySelector('#importSearchData');
const meta = document.querySelector('#searchDataMeta');
const status = document.querySelector('#searchStatus');

function setStatus(snapshot) {
  if (!status || !meta) return;
  if (!snapshot) {
    status.textContent = 'Search Intelligence · not loaded';
    meta.textContent = 'No saved snapshot detected yet.';
    return;
  }
  const when = snapshot.importedAt ? new Date(snapshot.importedAt).toLocaleString() : 'saved snapshot';
  status.textContent = `Search Intelligence · ${snapshot.pageCount || 0} pages`;
  meta.textContent = `${snapshot.pageCount || 0} pages · ${snapshot.rowCount || 0} rows · ${when}`;
}

async function refreshStatus() {
  try {
    const response = await fetch('/api/search-intelligence', { cache: 'no-store' });
    const data = await response.json();
    setStatus(data.connected ? data.snapshot : null);
  } catch {
    status.textContent = 'Search Intelligence · unavailable';
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"') {
      if (quoted && next === '"') {
        field += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(field);
      field = '';
      if (row.some(value => String(value).trim() !== '')) rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    if (row.some(value => String(value).trim() !== '')) rows.push(row);
  }
  if (rows.length < 2) return [];
  const headers = rows[0].map((value, index) => String(value || '').replace(/^\uFEFF/, '').trim() || `column_${index + 1}`);
  return rows.slice(1).map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
}

async function importSearchFile() {
  const file = input?.files?.[0];
  if (!file) return;
  button.disabled = true;
  button.textContent = 'Importing…';
  meta.textContent = `Reading ${file.name}…`;

  try {
    const text = await file.text();
    let payload;
    if (/\.csv$/i.test(file.name) || file.type.includes('csv')) {
      const rows = parseCsv(text);
      payload = { source: `search-console:${file.name}`, rows };
    } else {
      const parsed = JSON.parse(text);
      payload = Array.isArray(parsed)
        ? { source: `search-console:${file.name}`, rows: parsed }
        : { ...parsed, source: parsed.source || `search-console:${file.name}` };
    }

    const response = await fetch('/api/search-intelligence', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || data.error || 'Search Intelligence import failed');

    setStatus(data.snapshot);
    meta.textContent = `${file.name} · ${data.snapshot.pageCount} pages saved to KV. Re-running automatic discovery…`;
    document.querySelector('#discover')?.click();
  } catch (error) {
    meta.textContent = `Could not import ${file.name}: ${error.message}`;
    status.textContent = 'Search Intelligence · import failed';
  } finally {
    button.disabled = false;
    button.textContent = 'Import Search Console data';
    input.value = '';
  }
}

button?.addEventListener('click', () => input?.click());
input?.addEventListener('change', importSearchFile);
refreshStatus();
