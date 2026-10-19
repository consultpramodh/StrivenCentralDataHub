/************************************************************
 * ENTERNEWPART — EXISTING ITEM RESOLUTION GUARD R3
 *
 * RULES ENFORCED
 * ----------------------------------------------------------
 * 1) Existing NewItemId always wins.
 * 2) Exact Item Number hit in Striven_Items is reusable.
 * 3) Striven_Items miss is UNKNOWN, never proof of nonexistence.
 * 4) Exact authoritative POST /v1/items/search lookup is required
 *    before a create is allowed.
 * 5) Duplicate create race -> exact lookup -> EXISTS, not failure.
 * 6) Replacement code must continue to use NewItemId only.
 * 7) Automatic ENTERNEWPART creation requires standard description:
 *      Item Number:
 *      Item Name:
 *      Price:
 *
 * Marker: ENP_EXISTING_ITEM_RESOLVER_R3_20260908
 ************************************************************/

const ENP_EXISTING_ITEM_RESOLVER_R3 = 'ENP_EXISTING_ITEM_RESOLVER_R3_20260908';

function enp_guardNorm_(value) {
  return String(value == null ? '' : value).trim();
}

function enp_guardUpper_(value) {
  return enp_guardNorm_(value).toUpperCase();
}

function enp_guardNum_(value) {
  if (value === '' || value == null) return null;
  const n = Number(String(value).replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? null : n;
}

function enp_guardIsStandardDescription_(text) {
  const raw = String(text == null ? '' : text).replace(/\r/g, '').trim();
  // Exact ENTERNEWPART contract: three ordered labeled lines, values required.
  // Spaces after ':' are optional; commas in Price are supported.
  return /^\s*Item\s*Number\s*:\s*[^\n]+\n\s*Item\s*Name\s*:\s*[^\n]+\n\s*Price\s*:\s*\$?\s*[0-9][0-9,]*(?:\.[0-9]{1,2})?\s*$/i.test(raw);
}

function enp_guardBaseUrl_() {
  const props = PropertiesService.getScriptProperties();
  const base = props.getProperty('STRIVEN_BASE_URL') || 'https://api.striven.com';
  return String(base).replace(/\/+$/, '');
}

function enp_guardHeaders_() {
  if (typeof getStrivenAuthHeaders_ === 'function') {
    return getStrivenAuthHeaders_();
  }
  if (typeof enp_getStrivenHeaders_ === 'function') {
    return enp_getStrivenHeaders_();
  }
  throw new Error('No Striven auth header helper is available.');
}

function enp_guardRefreshAuth_() {
  if (typeof refreshStrivenToken_ === 'function') {
    refreshStrivenToken_();
    return;
  }

  const props = PropertiesService.getScriptProperties();
  props.deleteProperty('striven_token');
  props.deleteProperty('striven_token_expires');
  props.deleteProperty('striven_token_expires_at_ms');

  if (typeof enp_getStrivenHeaders_ === 'function') {
    enp_getStrivenHeaders_();
  }
}

function enp_guardRawRequest_(method, path, payload, hasRetriedAuth) {
  const url = /^https?:\/\//i.test(path)
    ? path
    : enp_guardBaseUrl_() + '/' + String(path || '').replace(/^\/+/, '');

  const options = {
    method: String(method || 'GET').toLowerCase(),
    headers: enp_guardHeaders_(),
    muteHttpExceptions: true
  };

  if (payload !== undefined && payload !== null) {
    options.payload = JSON.stringify(payload);
  }

  const res = UrlFetchApp.fetch(url, options);
  const code = res.getResponseCode();
  const text = res.getContentText();

  Logger.log('ENP resolver ' + method + ' ' + url + ' HTTP ' + code);

  if ((code === 401 || code === 403) && !hasRetriedAuth) {
    enp_guardRefreshAuth_();
    return enp_guardRawRequest_(method, path, payload, true);
  }

  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch (e) {
      body = text;
    }
  }

  return {
    ok: code >= 200 && code < 300,
    code: code,
    text: text || '',
    body: body,
    url: url
  };
}

function enp_guardUnwrapItem_(value) {
  if (!value) return null;
  if (Array.isArray(value)) return value.length ? enp_guardUnwrapItem_(value[0]) : null;

  if (value.Data && !Array.isArray(value.Data)) return enp_guardUnwrapItem_(value.Data);
  if (value.data && !Array.isArray(value.data)) return enp_guardUnwrapItem_(value.data);
  if (value.Item && typeof value.Item === 'object') return enp_guardUnwrapItem_(value.Item);
  if (value.item && typeof value.item === 'object') return enp_guardUnwrapItem_(value.item);

  return value;
}

function enp_guardItemId_(item) {
  const x = enp_guardUnwrapItem_(item) || {};
  return enp_guardNum_(
    x.Id != null ? x.Id :
    x.id != null ? x.id :
    x.ItemId != null ? x.ItemId :
    x.itemId != null ? x.itemId : x.ItemID
  );
}

function enp_guardItemNumber_(item) {
  const x = enp_guardUnwrapItem_(item) || {};
  return enp_guardNorm_(
    x.ItemNumber != null ? x.ItemNumber :
    x.itemNumber != null ? x.itemNumber :
    x.Number != null ? x.Number :
    x.number != null ? x.number :
    x.SKU != null ? x.SKU : x.sku
  );
}

function enp_guardItemName_(item) {
  const x = enp_guardUnwrapItem_(item) || {};
  return enp_guardNorm_(
    x.Name != null ? x.Name :
    x.name != null ? x.name :
    x.ItemName != null ? x.ItemName : x.itemName
  );
}

function enp_guardItemPrice_(item) {
  const x = enp_guardUnwrapItem_(item) || {};
  const v = x.Price != null ? x.Price : x.price;
  return enp_guardNum_(v);
}

function enp_guardItemCost_(item) {
  const x = enp_guardUnwrapItem_(item) || {};
  const v = x.Cost != null ? x.Cost : x.cost;
  return enp_guardNum_(v);
}

function enp_guardNormalizeItemRecord_(item, fallbackNumber) {
  const x = enp_guardUnwrapItem_(item) || {};
  const id = enp_guardItemId_(x);
  if (!id) return null;

  return {
    Id: id,
    id: id,
    ItemNumber: enp_guardItemNumber_(x) || enp_guardNorm_(fallbackNumber),
    Name: enp_guardItemName_(x),
    Price: enp_guardItemPrice_(x),
    Cost: enp_guardItemCost_(x),
    Active: x.Active != null ? x.Active : x.active,
    __raw: x
  };
}

function enp_guardRowsFromSearch_(body) {
  if (!body) return [];
  if (Array.isArray(body)) return body;

  const candidates = [
    body.Data, body.data,
    body.Rows, body.rows,
    body.Results, body.results,
    body.Items, body.items,
    body.Records, body.records,
    body.Value, body.value
  ];

  for (let i = 0; i < candidates.length; i++) {
    if (Array.isArray(candidates[i])) return candidates[i];
  }
  return [];
}

function enp_guardGetItemById_(itemId, fallback) {
  const id = enp_guardNum_(itemId);
  if (!id) return enp_guardNormalizeItemRecord_(fallback, '');

  const res = enp_guardRawRequest_('GET', '/v1/items/' + id, null, false);
  if (res.ok) {
    const normalized = enp_guardNormalizeItemRecord_(res.body, enp_guardItemNumber_(fallback));
    if (normalized) return normalized;
  }

  return enp_guardNormalizeItemRecord_(fallback, '');
}


function enp_guardSyncItemsReportToSheet_() {
  const props = PropertiesService.getScriptProperties();
  const reportUrl = props.getProperty('ItemsReport_API_KEY');
  if (!reportUrl) throw new Error('Missing Script Property: ItemsReport_API_KEY');

  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName('Striven_Items') || ss.insertSheet('Striven_Items');
  const pageSize = 2000;
  const maxPages = 100;
  let headers = [];
  const out = [];

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex++) {
    const sep = reportUrl.indexOf('?') >= 0 ? '&' : '?';
    const url = reportUrl + sep + 'PageIndex=' + pageIndex + '&PageSize=' + pageSize;
    const options = {
      method: 'get',
      muteHttpExceptions: true,
      headers: { Authorization: enp_guardHeaders_().Authorization, Accept: 'application/json' }
    };

    const res = UrlFetchApp.fetch(url, options);
    const code = res.getResponseCode();
    const text = res.getContentText();
    if (code !== 200) {
      throw new Error('Striven_Items report failed at PageIndex=' + pageIndex + ': HTTP ' + code + ' — ' + String(text || '').slice(0, 1000));
    }

    const body = JSON.parse(text || '{}');
    const rows = Array.isArray(body) ? body :
      Array.isArray(body.rows) ? body.rows :
      Array.isArray(body.data) ? body.data :
      Array.isArray(body.Data) ? body.Data : [];

    if (!rows.length) break;
    if (!headers.length) headers = Object.keys(rows[0] || {});
    rows.forEach(function(obj) { out.push(headers.map(function(h) { return obj && obj[h] != null ? obj[h] : ''; })); });

    if (rows.length < pageSize) break;
  }

  if (!headers.length) {
    throw new Error('Striven_Items report returned no rows. Existing sheet preserved.');
  }

  sh.clearContents();
  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  if (out.length) sh.getRange(2, 1, out.length, headers.length).setValues(out);
  sh.setFrozenRows(1);

  Logger.log('ENP resolver: Striven_Items synced rows=' + out.length);
  return { rows: out.length, columns: headers.length };
}

function enp_guardFindLocalItemByNumber_(itemNumber) {
  const wanted = enp_guardUpper_(itemNumber);
  if (!wanted) return null;

  const ss = SpreadsheetApp.getActive();
  const names = ['Striven_Items'];
  if (typeof ENP !== 'undefined' && ENP.SHEETS && ENP.SHEETS.ITEMS) {
    names.unshift(ENP.SHEETS.ITEMS);
  }

  let sh = null;
  for (let i = 0; i < names.length; i++) {
    if (!names[i]) continue;
    sh = ss.getSheetByName(names[i]);
    if (sh) break;
  }
  if (!sh) return null;

  const data = sh.getDataRange().getValues();
  if (data.length < 2) return null;

  const headers = data[0].map(function(h) { return enp_guardNorm_(h); });
  const col = {};
  headers.forEach(function(h, i) { if (h) col[h] = i; });

  const numberCol = col.ItemNumber != null ? col.ItemNumber :
    col.itemNumber != null ? col.itemNumber :
    col.Number != null ? col.Number : col.SKU;
  const idCol = col.Id != null ? col.Id :
    col.id != null ? col.id :
    col.ItemId != null ? col.ItemId : col.ItemID;

  if (numberCol == null || idCol == null) return null;

  const nameCol = col.Name != null ? col.Name :
    col.ItemName != null ? col.ItemName : col.name;
  const priceCol = col.Price != null ? col.Price : col.price;
  const costCol = col.Cost != null ? col.Cost : col.cost;
  const activeCol = col.Active != null ? col.Active : col.active;

  let found = null;
  for (let r = 1; r < data.length; r++) {
    if (enp_guardUpper_(data[r][numberCol]) !== wanted) continue;
    const id = enp_guardNum_(data[r][idCol]);
    if (!id) continue;

    if (found && found.Id !== id) {
      throw new Error('Ambiguous local Item Number: ' + itemNumber + ' maps to more than one Item ID.');
    }

    found = {
      Id: id,
      id: id,
      ItemNumber: enp_guardNorm_(data[r][numberCol]),
      Name: nameCol != null ? enp_guardNorm_(data[r][nameCol]) : '',
      Price: priceCol != null ? enp_guardNum_(data[r][priceCol]) : null,
      Cost: costCol != null ? enp_guardNum_(data[r][costCol]) : null,
      Active: activeCol != null ? data[r][activeCol] : null
    };
  }

  return found;
}

function enp_guardSearchPageInfo_(body, requestedPageIndex, requestedPageSize) {
  const rows = enp_guardRowsFromSearch_(body);
  const source = body && typeof body === 'object' && !Array.isArray(body) ? body : {};

  function firstNumber_(values) {
    for (let i = 0; i < values.length; i++) {
      const n = Number(values[i]);
      if (isFinite(n)) return n;
    }
    return null;
  }

  const totalCount = firstNumber_([
    source.totalCount, source.TotalCount,
    source.count, source.Count
  ]);
  const pageIndex = firstNumber_([
    source.pageIndex, source.PageIndex,
    requestedPageIndex
  ]);
  const pageSize = firstNumber_([
    source.pageSize, source.PageSize,
    requestedPageSize
  ]);

  const isLastPage = totalCount != null && totalCount >= 0 && pageSize && pageSize > 0
    ? ((pageIndex != null ? pageIndex : requestedPageIndex) + 1) * pageSize >= totalCount
    : rows.length < requestedPageSize;

  return {
    rows: rows,
    totalCount: totalCount,
    isLastPage: isLastPage
  };
}

/**
 * Authoritative fallback based on the same proven pattern used by the
 * Napoleon direct-API diagnostics: paginate /v1/items/search with only
 * PageIndex/PageSize and exact-match Item Number client-side.
 *
 * A complete scan miss is the only condition treated as authoritative
 * NOT FOUND. Hitting the safety page cap fails closed and never creates.
 */
function enp_guardScanAllItemsExact_(itemNumber) {
  const wanted = enp_guardUpper_(itemNumber);
  const pageSize = 100;
  const maxPages = 500;

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex++) {
    const res = enp_guardRawRequest_('POST', '/v1/items/search', {
      PageIndex: pageIndex,
      PageSize: pageSize
    }, false);

    if (!res.ok) {
      throw new Error(
        'Authoritative Striven item population scan failed at PageIndex=' + pageIndex +
        ': HTTP ' + res.code + ' — ' + String(res.text || '').slice(0, 1000)
      );
    }

    const page = enp_guardSearchPageInfo_(res.body, pageIndex, pageSize);
    const exact = [];
    page.rows.forEach(function(row) {
      if (enp_guardUpper_(enp_guardItemNumber_(row)) !== wanted) return;
      const normalized = enp_guardNormalizeItemRecord_(row, itemNumber);
      if (normalized) exact.push(normalized);
    });

    const unique = {};
    exact.forEach(function(item) { unique[item.Id] = item; });
    const ids = Object.keys(unique);

    if (ids.length > 1) {
      throw new Error(
        'Ambiguous Striven Item Number: ' + itemNumber +
        ' maps to multiple exact Item IDs: ' + ids.join(', ')
      );
    }

    if (ids.length === 1) {
      return enp_guardGetItemById_(Number(ids[0]), unique[ids[0]]) || unique[ids[0]];
    }

    if (page.rows.length === 0 || page.isLastPage) {
      return null;
    }
  }

  throw new Error(
    'Authoritative Striven item lookup reached the ' + maxPages +
    '-page safety cap before the complete Item population was exhausted. ' +
    'Creation is blocked rather than guessing that Item Number ' + itemNumber + ' is new.'
  );
}

function enp_guardSearchExactItemNumber_(itemNumber, forceFresh) {
  const wanted = enp_guardUpper_(itemNumber);
  if (!wanted) return null;

  const cache = CacheService.getScriptCache();
  const cacheKey = 'ENP_ITEM_R3_' + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      wanted,
      Utilities.Charset.UTF_8
    )
  ).slice(0, 32);

  if (!forceFresh) {
    try {
      const cached = cache.get(cacheKey);
      if (cached) {
        if (cached === '__MISS__') return null;
        const parsed = JSON.parse(cached);
        if (parsed && parsed.Id) return parsed;
      }
    } catch (cacheErr) {
      Logger.log('ENP resolver cache read ignored: ' + cacheErr);
    }
  }

  // Optimization only: Striven documents that Item search supports Item Number.
  // A miss here is NOT trusted. We fall back to a complete paginated population scan.
  const searchPayloads = [
    { ItemNumber: itemNumber, PageIndex: 0, PageSize: 100 },
    { itemNumber: itemNumber, PageIndex: 0, PageSize: 100 }
  ];

  for (let p = 0; p < searchPayloads.length; p++) {
    const res = enp_guardRawRequest_('POST', '/v1/items/search', searchPayloads[p], false);
    if (!res.ok) {
      if (res.code === 400 || res.code === 404 || res.code === 405 || res.code === 422) continue;
      throw new Error(
        'Striven exact Item Number search failed: HTTP ' + res.code +
        ' — ' + String(res.text || '').slice(0, 1000)
      );
    }

    const rows = enp_guardRowsFromSearch_(res.body);
    const exact = [];
    rows.forEach(function(row) {
      if (enp_guardUpper_(enp_guardItemNumber_(row)) !== wanted) return;
      const normalized = enp_guardNormalizeItemRecord_(row, itemNumber);
      if (normalized) exact.push(normalized);
    });

    const unique = {};
    exact.forEach(function(item) { unique[item.Id] = item; });
    const ids = Object.keys(unique);

    if (ids.length > 1) {
      throw new Error(
        'Ambiguous Striven Item Number: ' + itemNumber +
        ' returned multiple exact Item IDs: ' + ids.join(', ')
      );
    }

    if (ids.length === 1) {
      const item = enp_guardGetItemById_(Number(ids[0]), unique[ids[0]]) || unique[ids[0]];
      try { cache.put(cacheKey, JSON.stringify(item), 600); } catch (cachePutErr) {}
      return item;
    }
  }

  // Critical safety rule: filtered-search miss is still UNKNOWN.
  // Prove absence by scanning the direct Item search population to completion.
  const scanned = enp_guardScanAllItemsExact_(itemNumber);
  if (scanned && scanned.Id) {
    try { cache.put(cacheKey, JSON.stringify(scanned), 600); } catch (cachePutErr2) {}
    return scanned;
  }

  try { cache.put(cacheKey, '__MISS__', 180); } catch (cacheMissErr) {}
  return null;
}

function enp_guardResolveExistingItem_(itemNumber) {
  const wanted = enp_guardNorm_(itemNumber);
  if (!wanted) return null;

  const local = enp_guardFindLocalItemByNumber_(wanted);
  if (local && local.Id) {
    const full = enp_guardGetItemById_(local.Id, local) || local;
    if (!enp_guardItemNumber_(full) || enp_guardUpper_(enp_guardItemNumber_(full)) === enp_guardUpper_(wanted)) {
      return full;
    }
  }

  return enp_guardSearchExactItemNumber_(wanted);
}

function enp_guardIsDuplicateItemError_(code, text) {
  if (Number(code) !== 400 && Number(code) !== 409 && Number(code) !== 422) return false;
  const t = String(text || '').toUpperCase();
  // Recover only Item Number uniqueness races. A duplicate Item Name by itself
  // is a different validation failure and must not be mislabeled as an existing number.
  return (
    t.indexOf('ITEM NUMBER') >= 0 &&
    (t.indexOf('ALREADY EXISTS') >= 0 || t.indexOf('MUST BE UNIQUE') >= 0)
  ) || t.indexOf('ITEMNUMBER_MUSTBEUNIQUE') >= 0 ||
       t.indexOf('ITEMNUMBER_MUST_BE_UNIQUE') >= 0;
}

function enp_guardCreateOrResolveItem_(payload) {
  payload = payload || {};
  const itemNumber = enp_guardNorm_(payload.ItemNumber != null ? payload.ItemNumber : payload.itemNumber);

  if (!itemNumber) {
    throw new Error('Item Number is required before automatic item creation.');
  }
  if (enp_guardUpper_(itemNumber) === 'ENTERNEWPART') {
    throw new Error('Item Number cannot be the ENTERNEWPART placeholder.');
  }

  const existing = enp_guardResolveExistingItem_(itemNumber);
  if (existing && existing.Id) {
    Logger.log('ENP resolver: EXISTS ItemNumber=' + itemNumber + ' ItemId=' + existing.Id);
    return { status: 'EXISTS', id: existing.Id, item: existing };
  }

  const createRes = enp_guardRawRequest_('POST', '/v1/items', payload, false);
  if (createRes.ok) {
    const created = enp_guardNormalizeItemRecord_(createRes.body, itemNumber);
    const createdId = created && created.Id;
    if (!createdId) {
      throw new Error('Item create succeeded but no Item ID was returned.');
    }

    const fullCreated = enp_guardGetItemById_(createdId, created) || created;
    Logger.log('ENP resolver: CREATED ItemNumber=' + itemNumber + ' ItemId=' + createdId);
    return { status: 'CREATED', id: createdId, item: fullCreated };
  }

  if (enp_guardIsDuplicateItemError_(createRes.code, createRes.text)) {
    Logger.log('ENP resolver: duplicate create race detected; resolving exact existing Item Number=' + itemNumber);
    const racedExisting = enp_guardSearchExactItemNumber_(itemNumber, true);
    if (racedExisting && racedExisting.Id) {
      return { status: 'EXISTS', id: racedExisting.Id, item: racedExisting };
    }

    throw new Error(
      'Striven confirmed Item Number already exists, but exact Item ID could not be resolved. ' +
      'ItemNumber=' + itemNumber + '. Creation remains blocked.'
    );
  }

  throw new Error(
    'Striven POST /v1/items failed: HTTP ' + createRes.code + ' — ' +
    String(createRes.text || '').slice(0, 2000)
  );
}

function enp_guardResolutionAsItemResponse_(resolution) {
  const item = Object.assign({}, (resolution && resolution.item) || {});
  const id = resolution && resolution.id;
  if (id) {
    item.Id = item.Id || id;
    item.id = item.id || id;
  }
  item.__ENP_STATUS = resolution && resolution.status ? resolution.status : '';
  item.__ENP_EXISTING = item.__ENP_STATUS === 'EXISTS';
  return item;
}

function enp_guardResolutionField_(resolution, field, fallback) {
  const item = resolution && resolution.item ? resolution.item : {};
  let value = null;

  if (field === 'id') value = resolution && resolution.id;
  if (field === 'number') value = enp_guardItemNumber_(item);
  if (field === 'name') value = enp_guardItemName_(item);
  if (field === 'price') value = enp_guardItemPrice_(item);
  if (field === 'cost') value = enp_guardItemCost_(item);

  return value !== '' && value != null ? value : fallback;
}

function enp_guardWriteResolutionToRow_(row, col, resolution, fallback, now) {
  fallback = fallback || {};
  if (!row || !col || !resolution) return;

  if (col['NewItemId'] != null) row[col['NewItemId']] = enp_guardResolutionField_(resolution, 'id', '');
  if (col['NewItemNumber'] != null) row[col['NewItemNumber']] = enp_guardResolutionField_(resolution, 'number', fallback.itemNumber || '');
  if (col['NewItemName'] != null) row[col['NewItemName']] = enp_guardResolutionField_(resolution, 'name', fallback.itemName || '');
  if (col['NewItemPrice'] != null) row[col['NewItemPrice']] = enp_guardResolutionField_(resolution, 'price', fallback.price != null ? fallback.price : '');
  if (col['NewItemCost'] != null) row[col['NewItemCost']] = enp_guardResolutionField_(resolution, 'cost', fallback.cost != null ? fallback.cost : '');
  if (col['LastAction'] != null) row[col['LastAction']] = resolution.status;
  if (col['LastError'] != null) row[col['LastError']] = '';
  if (col['LastUpdated'] != null) row[col['LastUpdated']] = now || new Date();
}

function enp_guardTestResolverStatic() {
  const checks = {
    marker: ENP_EXISTING_ITEM_RESOLVER_R3,
    standardGood: enp_guardIsStandardDescription_('Item Number: ABC\nItem Name: Test\nPrice: $10.00'),
    standardBad: !enp_guardIsStandardDescription_('ABC Test $10'),
    placeholderBlocked: false
  };

  try {
    enp_guardCreateOrResolveItem_({ ItemNumber: 'ENTERNEWPART', Name: 'x' });
  } catch (e) {
    checks.placeholderBlocked = /placeholder/i.test(String(e && e.message ? e.message : e));
  }

  Logger.log(JSON.stringify(checks, null, 2));
  return checks;
}
