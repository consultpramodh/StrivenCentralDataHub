/************************************************************
 * APPS SCRIPT — 02_striven_core.gs
 * ENTERNEWPART — STRIVEN CORE + UTILITIES
 *
 * PURPOSE
 * ----------------------------------------------------------
 * Single shared engine for:
 * - OAuth token management
 * - HTTP requests to Striven
 * - Items report sync
 * - Item description parsing
 * - Shared utilities used by all modules
 *
 * NOTHING ELSE should implement Striven auth or fetch logic.
 ************************************************************/


/* =========================================================
 * APPS SCRIPT — OAUTH TOKEN
 * ========================================================= */

function enp_getStrivenHeaders_() {
  if (typeof getStrivenAuthHeaders_ === 'function') {
    return getStrivenAuthHeaders_();
  }

  const props = PropertiesService.getScriptProperties();
  const now = Date.now();
  let token = props.getProperty('striven_token');
  const expires = Number(props.getProperty('striven_token_expires') || 0);

  if (!token || !expires || now >= (expires - 60000)) {
    const clientId = props.getProperty('CLIENT_ID');
    const clientSecret = props.getProperty('CLIENT_SECRET');
    if (!clientId || !clientSecret) throw new Error('Missing CLIENT_ID / CLIENT_SECRET in Script Properties.');

    const res = UrlFetchApp.fetch('https://api.striven.com/accesstoken', {
      method: 'post',
      payload: {
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        scope: 'api'
      },
      muteHttpExceptions: true
    });

    const code = res.getResponseCode();
    const text = res.getContentText();
    if (code !== 200) throw new Error('Striven token refresh failed. HTTP ' + code + ' — ' + String(text || '').slice(0, 500));
    const body = JSON.parse(text || '{}');
    if (!body.access_token) throw new Error('Striven token response missing access_token.');

    token = body.access_token;
    const ttl = Number(body.expires_in || 3600);
    props.setProperty('striven_token', token);
    props.setProperty('striven_token_expires', String(Date.now() + ttl * 1000));
  }

  return { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
}


/**
 * Request a fresh Striven access token.
 *
 * Striven's documented token endpoint is:
 *   https://api.striven.com/accesstoken
 *
 * Authentication:
 *   - HTTP Basic: base64(CLIENT_ID:CLIENT_SECRET)
 *   - form body: grant_type=client_credentials, ClientId=<CLIENT_ID>
 */
function enp_refreshStrivenToken_() {
  const props = PropertiesService.getScriptProperties();

  const clientId = enp_getScriptProp_(ENP.PROPS.CLIENT_ID, true);
  const clientSecret = enp_getScriptProp_(ENP.PROPS.CLIENT_SECRET, true);

  const tokenUrl = 'https://api.striven.com/accesstoken';
  const basicAuth = Utilities.base64Encode(clientId + ':' + clientSecret);

  const res = UrlFetchApp.fetch(tokenUrl, {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    headers: {
      Authorization: 'Basic ' + basicAuth,
      Accept: 'application/json'
    },
    payload: {
      grant_type: 'client_credentials',
      ClientId: clientId
    },
    muteHttpExceptions: true
  });

  const code = res.getResponseCode();
  const text = res.getContentText();

  Logger.log('Striven token POST ' + tokenUrl + ' HTTP ' + code);

  if (code < 200 || code >= 300) {
    Logger.log('Token response (truncated): ' + text.slice(0, 2000));
    throw new Error(
      'Striven token request failed: HTTP ' + code +
      ' — ' + text.slice(0, 500)
    );
  }

  let body;
  try {
    body = JSON.parse(text || '{}');
  } catch (err) {
    throw new Error('Striven token response was not valid JSON.');
  }

  token = body.access_token;
  const ttlSeconds = Number(body.expires_in || 0);

  if (!token) {
    throw new Error('Striven token response did not include access_token.');
  }

  // If Striven omits expires_in, use a conservative 23-hour cache.
  const effectiveTtlSeconds =
    Number.isFinite(ttlSeconds) && ttlSeconds > 0
      ? ttlSeconds
      : (23 * 60 * 60);

  const expiresAt =
    Date.now() + effectiveTtlSeconds * 1000 - 60000;

  props.setProperty(ENP.PROPS.TOKEN, token);
  props.setProperty(ENP.PROPS.TOKEN_EXPIRES, String(expiresAt));

  Logger.log(
    'Striven token refreshed; cached until ' +
    new Date(expiresAt).toISOString()
  );

  return token;
}


/**
 * Force the next request to obtain a fresh token.
 * Useful after credential changes or for diagnostics.
 */
function enp_clearCachedStrivenToken_() {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty(ENP.PROPS.TOKEN);
  props.deleteProperty(ENP.PROPS.TOKEN_EXPIRES);
}


/**
 * Read-only auth test.
 * Clears the cached token and verifies that a fresh token can be acquired.
 * Does not create or modify any Striven record.
 */
function enp_testStrivenTokenOnly() {
  enp_clearCachedStrivenToken_();
  const token = enp_refreshStrivenToken_();

  Logger.log(
    JSON.stringify({
      status: 'TOKEN_OK',
      tokenPresent: !!token,
      tokenLength: token ? token.length : 0
    })
  );

  SpreadsheetApp.getActive().toast(
    'Striven token acquired successfully.',
    'Enternewpart',
    5
  );

  return true;
}


/* =========================================================
 * APPS SCRIPT — HTTP WRAPPER
 * ========================================================= */

function enp_strivenFetch_(path, options) {
  options = options || {};
  const baseUrl = enp_getScriptProp_(ENP.PROPS.BASE_URL, true);
  const url = String(path || '').startsWith('http')
    ? path
    : baseUrl.replace(/\/$/, '') + '/' + String(path || '').replace(/^\//, '');

  function runOnce() {
    const fetchOptions = {
      method: options.method || 'get',
      headers: enp_getStrivenHeaders_(),
      muteHttpExceptions: true
    };
    if (options.body !== undefined && options.body !== null) fetchOptions.payload = JSON.stringify(options.body);
    return UrlFetchApp.fetch(url, fetchOptions);
  }

  let res = runOnce();
  let code = res.getResponseCode();
  let text = res.getContentText();

  if (code === 401 || code === 403) {
    const props = PropertiesService.getScriptProperties();
    props.deleteProperty('striven_token');
    props.deleteProperty('striven_token_expires');
    res = runOnce();
    code = res.getResponseCode();
    text = res.getContentText();
  }

  if (code < 200 || code >= 300) {
    const err = new Error('Striven ' + code + ' — ' + String(text || '').slice(0, 2000));
    err.statusCode = code;
    err.responseText = text || '';
    throw err;
  }

  if (!text) return null;
  try { return JSON.parse(text); } catch (e) { return {}; }
}


function enp_strivenFetchWithRetry_(path, options, hasRetriedAuth) {
  const baseUrl = enp_getScriptProp_(ENP.PROPS.BASE_URL, true);

  const url = String(path || '').startsWith('http')
    ? String(path)
    : baseUrl.replace(/\/+$/, '') + '/' + String(path || '').replace(/^\/+/, '');

  const request = {
    method: String(options.method || 'get').toLowerCase(),
    headers: enp_getStrivenHeaders_(),
    muteHttpExceptions: true
  };

  if (options.body !== undefined && options.body !== null) {
    request.payload = JSON.stringify(options.body);
  }

  const res = UrlFetchApp.fetch(url, request);
  const code = res.getResponseCode();
  const text = res.getContentText();

  Logger.log(
    'Striven ' + request.method.toUpperCase() +
    ' ' + url +
    ' HTTP ' + code
  );

  // Token can be revoked before its cached expiry. Refresh once, then retry.
  if ((code === 401 || code === 403) && !hasRetriedAuth) {
    Logger.log(
      'Striven auth rejected cached token. Refreshing once and retrying.'
    );

    enp_clearCachedStrivenToken_();
    enp_refreshStrivenToken_();

    return enp_strivenFetchWithRetry_(path, options, true);
  }

  if (code < 200 || code >= 300) {
    Logger.log('Striven response (truncated): ' + text.slice(0, 2000));
    throw new Error(
      'Striven ' + request.method.toUpperCase() +
      ' ' + url +
      ' failed: HTTP ' + code +
      ' — ' + text.slice(0, 500)
    );
  }

  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch (err) {
    Logger.log('Non-JSON Striven response (truncated): ' + text.slice(0, 500));
    return text;
  }
}


/* =========================================================
 * APPS SCRIPT — ITEMS REPORT SYNC
 * ========================================================= */

function enp_syncItemsReport() {
  return enp_guardSyncItemsReportToSheet_();
}


/* =========================================================
 * APPS SCRIPT — DESCRIPTION PARSER
 * ========================================================= */

function enp_parseDescription_(text) {
  return enp_descParseFields_(text);
}

function enp_descNormalizeText_(text) {
  return String(text == null ? '' : text).replace(/<br\s*\/?\s*>/gi,'\n')
    .replace(/&#x([0-9a-f]+);/gi,(whole,x)=>{const n=parseInt(x,16);return n<=1114111?String.fromCodePoint(n):whole;})
    .replace(/&#(\d+);/g,(whole,x)=>{const n=Number(x);return n<=1114111?String.fromCodePoint(n):whole;})
    .replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&apos;/gi,"'")
    .replace(/\r\n?/g,'\n').replace(/[\u00a0\u202f]/g,' ').trim();
}
function enp_descParseMoney_(text) {
  if (text == null || String(text).trim()==='') return null;
  let s=String(text).trim().replace(/[\u00a0\u202f]/g,' ');
  s=s.replace(/^(?:CAD|USD)[ \t]*/i,'').replace(/^\$[ \t]*/,'');
  if (!/^(?:\d+(?:\.\d{1,2})?|\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d{1,3}(?: \d{3})+(?:\.\d{1,2})?)$/.test(s)) return null;
  const n=Number(s.replace(/[, ]/g,''));
  return Number.isFinite(n)&&n>=0&&n<=9999999999998?n:null;
}
function enp_descValidNumber_(value) {
  const s=String(value||'').trim();
  return !!s && !/[\r\n]|(?:item\s*name|item\s*number|price)\s*:/i.test(s) &&
    s.split(/\s+/).length<5 && !/["<>]/.test(s) && s.toUpperCase()!=='ENTERNEWPART';
}
function enp_descValidName_(value) {
  const s=String(value||'').trim();
  return !!s && !/^(?:item\s*name|item\s*number|price)\s*:/i.test(s) && !/^NEEDSSKU\b/i.test(s);
}
function enp_descCanonicalName_(name,number) {
  let s=String(name||'').trim().replace(/\s+/g,' '),sku=String(number||'').trim();
  if (!s) return '';
  if (!sku) return s;
  const suffix=' ('+sku+')';
  while(s.toUpperCase().endsWith(suffix.toUpperCase()))s=s.slice(0,-suffix.length).trim();
  return s?s+suffix:'';
}
function enp_descParseFields_(text) {
  const raw=String(text==null?'':text),normalized=enp_descNormalizeText_(raw),issues=[];
  const lines=normalized.split('\n').map(s=>s.trim()).filter(Boolean);
  const labels=[],values={number:[],name:[],price:[]};let current=null;
  for(const line of lines){
    const m=line.match(/^(Item[ \t]*Number|Item[ \t]*Name|Price)[ \t]*:[ \t]*(.*)$/i);
    if(m){const key=/number/i.test(m[1])?'number':/name/i.test(m[1])?'name':'price';labels.push(key);current=key;values[key].push(m[2]);}
    else if(current==='name'&&values.name.length===1)values.name[0]+=(values.name[0]?' ':'')+line;
    else if(current)issues.push('UNEXPECTED_CONTINUATION');
  }
  let itemNumber='',name='',price=null,multiItem=false,format=labels.length?'LABELED':'UNLABELED';
  if(labels.length){
    for(const key of Object.keys(values))if(values[key].length>1)issues.push('DUPLICATE_'+key.toUpperCase()+'_LABEL');
    itemNumber=values.number.length===1?values.number[0].trim():'';
    name=values.name.length===1?values.name[0].trim():'';
    price=values.price.length===1?enp_descParseMoney_(values.price[0]):null;
    if(labels.join(',')!=='number,name,price')issues.push('LABEL_STRUCTURE');
    if(values.price[0]&&price===null)issues.push('INVALID_PRICE');
  }else if(normalized){
    multiItem=lines.filter(s=>/^[-•]\s+/.test(s)).length>1;
    if(multiItem){name=lines[0];issues.push('MULTI_ITEM_DESCRIPTION');}
    else{
      const priceLines=lines.filter(s=>/^(?:CAD|USD)?\s*\$/.test(s));
      if(priceLines.length===1)price=enp_descParseMoney_(priceLines[0]);
      const body=lines.filter(s=>!priceLines.includes(s));
      const first=body[0]||'';
      const leading=first.match(/^([A-Za-z0-9][A-Za-z0-9._\/-]*)(?:[ \t]+(.*))?$/);
      if(leading&&/\d/.test(leading[1])){itemNumber=leading[1];name=[leading[2]||'',...body.slice(1)].join(' ').trim();}
      else name=body.join(' ').trim();
      issues.push('NONSTANDARD_FORMAT');
    }
  }
  const sourceItemNumber=itemNumber,sourceItemName=name;
  if(itemNumber&&!enp_descValidNumber_(itemNumber)){issues.push('INVALID_ITEM_NUMBER');itemNumber='';}
  if(name&&!enp_descValidName_(name)){issues.push('INVALID_ITEM_NAME');name='';}
  if(!itemNumber)issues.push('MISSING_ITEM_NUMBER');if(!name)issues.push('MISSING_ITEM_NAME');if(price===null)issues.push('MISSING_PRICE');
  return {raw,normalized,itemNumber,name,price,sourceItemNumber,sourceItemName,multiItem,format,labels,issues:[...new Set(issues)]};
}

/************************************************************
 * APPS SCRIPT — INVALID DESCRIPTION EMAIL HELPERS
 ************************************************************/

function enp_isStandardDescriptionFormat_(text) {
  return enp_guardIsStandardDescription_(text);
}

function enp_getSalesRepEmailByName_(fullName) {
  const map = {
    'Babz Boehm': 'babz@classicfireplace.ca',
    'Bruce Gowanlock': 'bruce@classicfireplace.ca',
    'Thang Tran': 'thang@classicfireplace.ca',
    'John Hoang': 'john@classicfireplace.ca',
    'Irina Tyrina': 'irina@classicfireplace.ca',
    'Joshua Malcolm': 'Josh@classicfireplace.ca',
    'Karen Genis': 'karen@classicfireplace.ca',
    'Spencer Bambek': 'spencer@classicfireplace.ca',
    'Adam Stokes': 'adam@classicfireplace.ca',
    'Edward McLennon': 'edward@classicfireplace.ca',
    'Colleen Trevor': 'colleen@classicfireplace.ca',
    'Classic Fireplace': 'info@classicfireplace.ca',
    'Terry Ryan': 'terry@classicfireplace.ca',
    'Karen Goldman': 'service@classicfireplace.ca',
    'Travis Mason': 'communitygas@gmail.com',
    'Chris Olomojobi': 'roccenterprises@gmail.com',
    'Steve Trevor': 'steve@classicfireplace.ca',
    'Matthew McLean': 'matthew@classicfireplace.ca',
    'Stephen Foley': 'Stephen@classicfireplace.ca',
    'Trevor Burke': 'trevor@classicfireplace.ca',
    'Pramodh Kumar': 'pramodh@classicfireplace.ca',
    'Matthew Thompson': 'matt@classicfireplace.ca',
    'Warren Jennings': 'warren@classicfireplace.ca'
  };

  const key = enp_norm_(fullName);
  return map[key] || '';
}

function enp_sendInvalidDescriptionEmailToSalesRep_(info) {
  const salesRepName = enp_norm_(info && info.salesRepName) || 'Sales Rep';
  const intendedRecipient = enp_norm_(info && info.recipientEmail);
  const soNumber = enp_norm_(info && info.soNumber) || enp_norm_(info && info.soId) || 'Unknown';
  const description = String(info && info.description != null ? info.description : '').trim();

  const testMode = !!(ENP.EMAIL && ENP.EMAIL.INVALID_DESC_ALERT_TEST_MODE);
  const testRecipient = enp_norm_(ENP.EMAIL && ENP.EMAIL.INVALID_DESC_ALERT_TEST_EMAIL);

  const finalRecipient = testMode ? testRecipient : intendedRecipient;
  if (!finalRecipient) return;

  const subject = 'ENTERNEWPART details are not in standard format ' + soNumber;

let body =
  'Hi ' + salesRepName + ',\n\n' +
  'The new item details for Sales Order ' + soNumber + ' could not be processed.\n\n' +
  'Please enter the new item details in the Standard format:\n\n' +
  'Item Number: ####\n' +
  'Item Name: ####\n' +
  'Price: $####\n\n' +
  'Thank you.\n';

  if (testMode) {
    body =
      '[TEST MODE — email not sent to sales rep]\n' +
      'Intended recipient: ' + (intendedRecipient || '[missing]') + '\n\n' +
      body;
  }

  MailApp.sendEmail({
    to: finalRecipient,
    subject: subject,
    body: body
  });
  Logger.log('Final recipient: ' + finalRecipient);
}



/************************************************************
 * APPS SCRIPT — TEST INVALID DESCRIPTION EMAIL
 ************************************************************/

function enp_testInvalidDescriptionEmail() {
  const testSalesRepName = 'John Hoang';
  const testEmail = enp_getSalesRepEmailByName_(testSalesRepName);

  const badDescription =
    '128419 Glass Ceramic Left F600 (PIC) $204';

  enp_sendInvalidDescriptionEmailToSalesRep_({
    recipientEmail: testEmail,
    salesRepName: testSalesRepName,
    soId: 'TEST-SO-001',
    soNumber: 'TEST-SO-001',
    description: badDescription
  });

  SpreadsheetApp.getActive().toast(
    'Test email triggered (check inbox)',
    'Enternewpart',
    5
  );
}

/* =========================================================
 * APPS SCRIPT — ITEM LOOKUP HELPERS
 * ========================================================= */

function enp_buildItemIndex_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(ENP.SHEETS.ITEMS);
  if (!sh) return {};

  const data = sh.getDataRange().getValues();
  if (data.length < 2) return {};

  const headers = data[0];
  const col = enp_indexByHeader_(headers);

  const numberCol =
    col.ItemNumber ?? col.itemNumber ?? col.Number ?? col.SKU;
  const idCol = col.Id ?? col.id;

  if (numberCol == null || idCol == null) return {};

  const index = {};

  for (let i = 1; i < data.length; i++) {
    const num = enp_normUpper_(data[i][numberCol]);
    const id = enp_num_(data[i][idCol]);
    if (num && id) index[num] = id;
  }

  return index;
}

function enp_lookupItemId_(itemNumber, index) {
  if (!itemNumber) return null;
  return index[enp_normUpper_(itemNumber)] || null;
}


/* =========================================================
 * APPS SCRIPT — ITEM CREATE
 * ========================================================= */

function enp_createItemInStriven_(payload) {
  const resolution = enp_guardCreateOrResolveItem_(payload);
  return enp_guardResolutionAsItemResponse_(resolution);
}


/* =========================================================
 * APPS SCRIPT — SALES ORDER UPDATE
 * ========================================================= */

function enp_getSalesOrder_(id) {
  return enp_strivenFetch_('/v1/sales-orders/' + id, {
    method: 'get'
  });
}

function enp_updateSalesOrder_(id, body) {
  return enp_strivenFetch_('/v1/sales-orders/' + id, {
    method: 'put',
    body: body
  });
}










