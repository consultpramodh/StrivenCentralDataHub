/************************************************************
 * ENTERNEWPART — CENTRAL HUB ITEM RESOLUTION GUARD R5
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
    options.contentType = 'application/json';
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
  const sh=enp_guardHubBook_().getSheetByName('DATA_ITEMS');
  if(!sh||sh.getLastRow()<2) throw new Error('Central Hub DATA_ITEMS is unavailable; local data preserved');
  const h=sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
  if(h.indexOf('ItemNumber')<0||h.indexOf('Id')<0) throw new Error('Central Hub item schema mismatch');
  return {source:'CENTRAL_HUB',rows:sh.getLastRow()-1,strivenCalls:0,localDataPreserved:true};
}

function enp_guardFindLocalItemByNumber_(itemNumber) {
  const wanted = enp_guardUpper_(itemNumber);
  if (!wanted) return null;

  const ss = enp_guardHubBook_();
  const names = ['DATA_ITEMS'];
  if (typeof ENP !== 'undefined' && ENP.SHEETS && ENP.SHEETS.ITEMS) {
    // Canonical shared dataset only; no per-project report refresh.
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
  throw new Error('Full item population scans are disabled. Use Central Hub item lookup for '+itemNumber);
}

function enp_guardSearchExactItemNumber_(itemNumber, forceFresh) {
  if(!enp_guardNorm_(itemNumber)) return null;
  return enp_guardHubLookup_(itemNumber,!!forceFresh);
}

function enp_guardResolveExistingItem_(itemNumber) {
  const wanted=enp_guardNorm_(itemNumber);
  if(!wanted) return null;
  const local=enp_guardFindLocalItemByNumber_(wanted);
  if(local&&local.Id) {
    const response=enp_guardRawRequest_('GET','/v1/items/'+local.Id,null,false);
    if(!response.ok) throw new Error('Current item identity verification HTTP '+response.code);
    const full=enp_guardNormalizeItemRecord_(response.body,'');
    if(full&&full.Id===local.Id&&enp_guardUpper_(full.ItemNumber)===enp_guardUpper_(wanted)) {
      if(full.Active===false) throw new Error('Existing item is inactive; review required: '+wanted);
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

  payload=Object.assign({},payload);
  payload.Name=enp_guardCanonicalName_(payload.Name!=null?payload.Name:payload.name,itemNumber);
  if(Object.prototype.hasOwnProperty.call(payload,'name')) delete payload.name;
  const existing = enp_guardResolveExistingItem_(itemNumber);
  if (existing && existing.Id) {
    Logger.log('ENP resolver: EXISTS ItemNumber=' + itemNumber + ' ItemId=' + existing.Id);
    return { status: 'EXISTS', id: existing.Id, item: existing };
  }

  payload = enp_guardBuildHubCreatePayload_(payload);
  const validationKey=enp_guardPayloadKey_(payload),props=PropertiesService.getScriptProperties();
  const parked=props.getProperty(validationKey);
  if(parked) throw new Error('ITEM_NEEDS_REVIEW: unchanged payload is parked — '+parked);
  let createRes;
  try { createRes=enp_guardRawRequest_('POST','/v1/items',payload,false); }
  catch(e) { props.setProperty(validationKey,'Create outcome unknown; verify in Striven before retrying'); throw e; }
  if (createRes.ok) {
    const created = enp_guardNormalizeItemRecord_(createRes.body, itemNumber);
    const createdId = created && created.Id;
    if (!createdId) {
      props.setProperty(validationKey,'Create succeeded without an Item ID; resolve in Hub before retrying');
      throw new Error('Item create succeeded but no Item ID was returned.');
    }

    // Persist identity before any optional readback or shared-sheet write.
    props.setProperty(validationKey,'Created Item ID '+createdId+'; shared result capture pending');
    enp_guardPublishCreatedToHub_(created);
    props.deleteProperty(validationKey);
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

  if([400,409,422].indexOf(Number(createRes.code))>=0) props.setProperty(validationKey,String(createRes.text||'Validation failure').slice(0,1500));
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

/* Google Apps Script — Central Hub adapter. No direct item searches. */
function enp_guardHubBook_() {
  return SpreadsheetApp.openById('13OKw69We9tsIWzEQwNOl4aAHh11qrsICSOt781O2upU');
}
function enp_guardHubRequests_() {
  const sh=enp_guardHubBook_().getSheetByName('ITEM_LOOKUP_REQUESTS');
  const expected=['ItemNumber','Status','ItemId','ItemJSON','CheckedAtUTC','NextAttemptUTC','Attempts','Error','RequestedBy','RequestedAtUTC'];
  if(!sh||JSON.stringify(sh.getRange(1,1,1,10).getValues()[0])!==JSON.stringify(expected)) throw new Error('Central Hub item lookup queue is not initialized');
  return sh;
}
function enp_guardCanonicalName_(name,number) {
  let base=enp_guardNorm_(name),part=enp_guardNorm_(number);
  if(!base||!part) throw new Error('Item Name and Item Number are required');
  const suffix=' ('+part+')';
  while(base.toUpperCase().endsWith(suffix.toUpperCase())) base=base.slice(0,-suffix.length).trim();
  if(!base) throw new Error('Item Name must contain a name before the Item Number');
  return base+suffix;
}
function enp_guardHubLookup_(number,forceFresh) {
  const sh=enp_guardHubRequests_(),key=enp_guardUpper_(number),now=Date.now();
  const rows=sh.getDataRange().getValues();
  const matches=rows.slice(1).map((r,i)=>({r:r,row:i+2})).filter(x=>enp_guardUpper_(x.r[0])===key);
  if(!forceFresh) {
    const found=matches.filter(x=>x.r[1]==='FOUND'&&Number(x.r[2])>0);
    const ids=Array.from(new Set(found.map(x=>Number(x.r[2]))));
    if(ids.length>1) throw new Error('Ambiguous Central Hub ItemNumber '+number);
    if(found.length) {
      const item=JSON.parse(found[found.length-1].r[3]);
      if(enp_guardItemId_(item)!==ids[0]||enp_guardUpper_(enp_guardItemNumber_(item))!==key) throw new Error('Central Hub item identity mismatch');
      const response=enp_guardRawRequest_('GET','/v1/items/'+ids[0],null,false);
      if(!response.ok) throw new Error('Central Hub item verification HTTP '+response.code);
      const live=enp_guardNormalizeItemRecord_(response.body,'');
      if(!live||live.Id!==ids[0]||enp_guardUpper_(live.ItemNumber)!==key||live.Active===false) throw new Error('Central Hub item failed current identity/active verification');
      return live;
    }
    const newest=matches.length?matches[matches.length-1]:null;
    if(newest&&newest.r[1]==='NOT_FOUND'&&now-Date.parse(newest.r[4])>=0&&now-Date.parse(newest.r[4])<15*60*1000) return null;
    if(newest&&['PENDING','RETRY','REVIEW'].indexOf(String(newest.r[1]))>=0) throw new Error('HUB_ITEM_'+newest.r[1]+': '+number+(newest.r[7]?' — '+newest.r[7]:''));
  }
  const request=[enp_guardNorm_(number),'PENDING','','','','',0,'','ENTERNEWPART',new Date().toISOString()];
  if(matches.length) sh.getRange(matches[matches.length-1].row,1,1,10).setValues([request]);
  else sh.appendRow(request);
  throw new Error('HUB_ITEM_PENDING: '+number+' queued for centralized exact lookup; no catalog scan attempted');
}
function enp_guardPublishCreatedToHub_(item) {
  const normalized=enp_guardNormalizeItemRecord_(item,'');
  if(!normalized||!normalized.ItemNumber) throw new Error('Cannot publish created item without identity');
  enp_guardHubRequests_().appendRow([normalized.ItemNumber,'FOUND',normalized.Id,JSON.stringify(normalized),new Date().toISOString(),'',0,'','ENTERNEWPART_CREATE',new Date().toISOString()]);
}
function enp_guardPayloadKey_(payload) {
  return 'ENP_ITEM_VALIDATION_'+Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,JSON.stringify(payload),Utilities.Charset.UTF_8)).slice(0,40);
}

/* Google Apps Script — Hub metadata adapter. No reference searches or sheet writes.
 * Reference registry: ENTERNEWPART_HUB_REFERENCE_IDS, JSON keyed by API field,
 * each value an array of {Id, Name, Verified:true, Evidence:<source>}.
 * Missing/ambiguous/unverified IDs and unsupported fields block NEW creation.
 * Existing verified items return before this adapter and are never updated here.
 */
function enp_guardHubRecords_(grid) {
  if (!Array.isArray(grid) || !grid.length) throw new Error('HUB_METADATA_BLOCKED: missing Hub data.');
  const seen = {};
  const headers = grid[0].map(function(value) {
    const h = String(value == null ? '' : value).trim();
    if (h && seen[h]) throw new Error('HUB_METADATA_BLOCKED: duplicate header ' + h);
    if (h) seen[h] = true;
    return h;
  });
  ['Create Authorized','Item Number','Item Name','Price','Cost','Item Category',
   'Preferred Vendor','Manufacturer','Manufacturer Part#','Serial Number Tracking',
   'Location Name','Taxable','Item Type','UPC','MAP Price','Currency','Source',
   'Quoted Authorization','Workflow Status'].forEach(function(h) {
    if (!seen[h]) throw new Error('HUB_METADATA_BLOCKED: missing header ' + h);
  });
  return grid.slice(1).map(function(row) {
      const out = {};
      headers.forEach(function(h,i) { if (h) out[h] = row[i]; });
      return out;
    }).filter(function(r) { return enp_guardNorm_(r['Item Number']) || enp_guardNorm_(r.Source) || enp_guardNorm_(r['Original Description']); });
}

function enp_guardHubReference_(registry, field, name) {
  const wanted = enp_guardUpper_(name);
  if (!wanted) throw new Error('HUB_METADATA_BLOCKED: missing ' + field + ' name.');
  const candidates = (Array.isArray(registry[field]) ? registry[field] : []).filter(function(ref) {
    return ref && enp_guardUpper_(ref.Name) === wanted;
  });
  if (candidates.length !== 1) throw new Error('HUB_METADATA_BLOCKED: missing or ambiguous verified ' + field + ' ID for ' + name);
  const ref = candidates[0];
  if (!Number.isSafeInteger(Number(ref.Id)) || Number(ref.Id) <= 0 || ref.Verified !== true || !enp_guardNorm_(ref.Evidence)) {
    throw new Error('HUB_METADATA_BLOCKED: unverified ' + field + ' ID for ' + name);
  }
  return {Id: Number(ref.Id)};
}

function enp_guardHubPayloadFromRecord_(base, record, registry) {
  const r = record || {};
  if (r['Create Authorized'] !== true) throw new Error('HUB_METADATA_BLOCKED: Create Authorized must be boolean TRUE.');
  if (enp_guardUpper_(r['Workflow Status']) !== 'READY') throw new Error('HUB_METADATA_BLOCKED: Workflow Status must be READY after review.');
  const source = enp_guardUpper_(r.Source);
  if (['APPROVED','QUOTED','MANUAL'].indexOf(source) < 0) throw new Error('HUB_METADATA_BLOCKED: unsupported Source.');
  if (source === 'QUOTED' && r['Quoted Authorization'] !== true) throw new Error('HUB_METADATA_BLOCKED: Quoted Authorization must be boolean TRUE.');
  if (enp_guardUpper_(r['Item Number']) !== enp_guardUpper_(base.ItemNumber)) throw new Error('HUB_METADATA_BLOCKED: Item Number mismatch.');
  const name = enp_guardCanonicalName_(r['Item Name'],r['Item Number']);
  if (enp_guardUpper_(name) !== enp_guardUpper_(enp_guardCanonicalName_(base.Name,base.ItemNumber))) throw new Error('HUB_METADATA_BLOCKED: Item Name mismatch.');
  if (r['Location Name'] !== '60 - WAREHOUSE (Ajax)' || enp_guardUpper_(r.Taxable) !== 'YES' || r['Item Type'] !== 'Inventory') {
    throw new Error('HUB_METADATA_BLOCKED: fixed location, taxable or item type differs.');
  }
  if (!enp_guardNorm_(r.Currency)) throw new Error('HUB_METADATA_BLOCKED: currency is unverified.');
  if (enp_guardUpper_(r.Currency) !== enp_guardUpper_(registry.BaseCurrency)) throw new Error('HUB_METADATA_BLOCKED: currency differs from verified company base currency.');
  const cost = enp_verificationNumber_(r.Cost), price = enp_verificationNumber_(r.Price);
  if (cost === null || cost < 0 || price === null || price < 0) throw new Error('HUB_METADATA_BLOCKED: verified nonnegative Price and Cost are required.');
  const payload = Object.assign({},base,{
    Id:0,ItemNumber:enp_guardNorm_(r['Item Number']),Name:name,
    Description:enp_guardNorm_(r.Description) || name,Price:price,Cost:cost,Taxable:true,
    ItemType:enp_guardHubReference_(registry,'ItemType','Inventory'),
    DefaultInventoryLocation:enp_guardHubReference_(registry,'DefaultInventoryLocation','60 - WAREHOUSE (Ajax)'),
    Category:enp_guardHubReference_(registry,'Category',r['Item Category']),
    PreferredVendor:enp_guardHubReference_(registry,'PreferredVendor',r['Preferred Vendor']),
    Manufacturer:enp_guardHubReference_(registry,'Manufacturer',r.Manufacturer),
    ManufacturePartNumber:enp_guardNorm_(r['Manufacturer Part#'])
  });
  if (!payload.ManufacturePartNumber) throw new Error('HUB_METADATA_BLOCKED: Manufacturer Part# is required.');
  if (r.UPC != null && r.UPC !== '') {
    if (typeof r.UPC !== 'string') throw new Error('HUB_METADATA_BLOCKED: UPC must be text to preserve leading zeros.');
    payload.BarcodeValue = r.UPC.trim();
  }
  // Keep unsupported fields visible beside the candidate payload. The caller
  // must refuse a POST until every required field has a verified write path.
  const unsupported = ['Serial Number Tracking'];
  if (r['MAP Price'] !== '' && r['MAP Price'] != null) unsupported.push('MAP Price');
  return {payload:payload,unsupportedFields:unsupported,serialTracking:r['Serial Number Tracking'],mapPrice:r['MAP Price']};
}

function enp_guardBuildHubCreatePayload_(base) {
  const book = enp_guardHubBook_(), sheet = book.getSheetByName('ENTERNEWPART');
  if (!sheet) throw new Error('HUB_METADATA_BLOCKED: ENTERNEWPART tab missing.');
  const records = enp_guardHubRecords_(sheet.getDataRange().getValues());
  const matches = records.filter(function(r) { return enp_guardUpper_(r['Item Number']) === enp_guardUpper_(base.ItemNumber); });
  if (!matches.length) throw new Error('HUB_METADATA_BLOCKED: no exact Hub Item Number match.');
  // Multiple rows can have different order authorization. Do not borrow another
  // order's approval when this item-only interface cannot identify its source.
  if (matches.length !== 1) throw new Error('HUB_METADATA_BLOCKED: multiple Hub rows require source/order disambiguation.');
  const raw = PropertiesService.getScriptProperties().getProperty('ENTERNEWPART_HUB_REFERENCE_IDS');
  let registry;
  try { registry = raw ? JSON.parse(raw) : {}; }
  catch (e) { throw new Error('HUB_METADATA_BLOCKED: invalid reference registry JSON.'); }
  const candidate = enp_guardHubPayloadFromRecord_(base,matches[0],registry || {});
  if (candidate.unsupportedFields.length) throw new Error('HUB_METADATA_BLOCKED: API write path unverified for ' + candidate.unsupportedFields.join(', ') + '.');
  return candidate.payload;
}

function enp_previewHubItemCreation() {
  const sheet = enp_guardHubBook_().getSheetByName('ENTERNEWPART');
  if (!sheet) throw new Error('Hub ENTERNEWPART tab missing.');
  const records = enp_guardHubRecords_(sheet.getDataRange().getValues());
  const raw = PropertiesService.getScriptProperties().getProperty('ENTERNEWPART_HUB_REFERENCE_IDS');
  const registry = raw ? JSON.parse(raw) : {};
  const counts = {};
  records.forEach(function(r) { const key=enp_guardUpper_(r['Item Number']); counts[key]=(counts[key]||0)+1; });
  const result = records.map(function(r) {
    try {
      if (counts[enp_guardUpper_(r['Item Number'])] !== 1) throw new Error('HUB_METADATA_BLOCKED: multiple Hub rows require source/order disambiguation.');
      const candidate = enp_guardHubPayloadFromRecord_({ItemNumber:r['Item Number'],Name:r['Item Name']},r,registry);
      return {itemNumber:candidate.payload.ItemNumber,status:candidate.unsupportedFields.length ? 'BLOCKED' : 'PAYLOAD_READY',
        reason:candidate.unsupportedFields.length ? 'API write path unverified: ' + candidate.unsupportedFields.join(', ') : '',candidate:candidate};
    } catch (e) { return {itemNumber:r['Item Number'] || '',status:'BLOCKED',reason:String(e.message || e)}; }
  });
  const summary = {rows:result.length,ready:result.filter(function(r) { return r.status === 'PAYLOAD_READY'; }).length,strivenCalls:0,writes:0,results:result};
  Logger.log(JSON.stringify(summary));
  return summary;
}
