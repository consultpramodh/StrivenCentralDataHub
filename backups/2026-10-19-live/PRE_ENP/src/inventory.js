// /***********************
//  * STRIVEN ITEMS REPORT CONFIG (SYNC)
//  * ----------------------------------
//  * Required Script Properties (per your screenshot):
//  *  - STRIVEN_BASE_URL
//  *  - ItemsReport_API_KEY              (FULL /v2/reports/{accessKey} URL)
//  *  - Striven_CLIENT_ID
//  *  - Striven_CLIENT_SECRET
//  *
//  * Optional:
//  *  - STRIVEN_ITEMS_REPORT_URL         (share/fyi only; not used by API)
//  *  - striven_token                    (if you manually store a bearer token)
//  *
//  * Shopify props present (not used here):
//  *  - SHOPIFY_SHOP_DOMAIN, Shopify_ID, Shopify_Secret, Shopify_API_Key
//  ***********************/
// function getStrivenItemsReportConfig_() {
//   const props = PropertiesService.getScriptProperties();

//   const baseUrl       = props.getProperty('STRIVEN_BASE_URL');
//   const reportApiUrl  = props.getProperty('ItemsReport_API_KEY');      // MUST be full /v2/reports/... url
//   const reportShareUrl = props.getProperty('STRIVEN_ITEMS_REPORT_URL'); // optional

//   const clientId     = props.getProperty('CLIENT_ID');
//   const clientSecret = props.getProperty('CLIENT_SECRET');

//   // Optional: if you already store a live bearer token in this project
//   const existingToken = props.getProperty('striven_token');

//   if (!baseUrl) throw new Error('Missing Script Property: STRIVEN_BASE_URL');
//   if (!reportApiUrl) throw new Error('Missing Script Property: ItemsReport_API_KEY (must be full /v2/reports/{accessKey} URL)');
//   if (!clientId) throw new Error('Missing Script Property: Striven_CLIENT_ID');
//   if (!clientSecret) throw new Error('Missing Script Property: Striven_CLIENT_SECRET');

//   return {
//     baseUrl: baseUrl.replace(/\/+$/, ''), // trim trailing slashes
//     reportApiUrl,
//     reportShareUrl,
//     clientId,
//     clientSecret,
//     existingToken
//   };
// }


// function getStrivenBearerToken_() {
//   const props = PropertiesService.getScriptProperties();
//   const cfg = getStrivenItemsReportConfig_();

//   // Cached token (keep this)
//   const cachedToken = props.getProperty('striven_token');
//   const cachedExpMs = Number(props.getProperty('striven_token_expires_at_ms') || '0');
//   if (cachedToken && cachedExpMs && Date.now() < (cachedExpMs - 60000)) return cachedToken;

//   // IMPORTANT: baseUrl must be a host root like https://api.striven.com (no trailing /v2)
//   const base = (cfg.baseUrl || '').replace(/\/+$/, '');

//   // Try the usual suspects
//   const candidates = [
//     base + '/oauth/token',
//     base + '/connect/token',
//     base + '/token',
//     base + '/oauth2/token'
//   ];

//   const formPayload = {
//     grant_type: 'client_credentials',
//     client_id: cfg.clientId,
//     client_secret: cfg.clientSecret
//   };

//   // Variant: Basic Auth style
//   const basic = Utilities.base64Encode(cfg.clientId + ':' + cfg.clientSecret);
//   const basicFormPayload = { grant_type: 'client_credentials' };

//   let lastErr = null;

//   for (const tokenUrl of candidates) {
//     // 1) Try "client_id/client_secret in body"
//     try {
//       const resp = UrlFetchApp.fetch(tokenUrl, {
//         method: 'post',
//         contentType: 'application/x-www-form-urlencoded',
//         payload: formPayload,
//         muteHttpExceptions: true
//       });

//       const code = resp.getResponseCode();
//       const body = resp.getContentText();

//       if (code === 200) {
//         const json = JSON.parse(body);
//         if (json.access_token) {
//           const expiresInSec = Number(json.expires_in || 3600);
//           props.setProperty('striven_token', json.access_token);
//           props.setProperty('striven_token_expires_at_ms', String(Date.now() + expiresInSec * 1000));
//           return json.access_token;
//         }
//         lastErr = `HTTP 200 but no access_token at ${tokenUrl}: ${body}`;
//         continue;
//       }

//       // If endpoint doesn't exist, keep trying
//       if (code === 404) continue;

//       // If exists but auth rejected, remember it (could still be wrong auth style)
//       lastErr = `HTTP ${code} at ${tokenUrl}: ${body.substring(0, 500)}`;
//     } catch (e) {
//       lastErr = `Fetch error at ${tokenUrl}: ${e.message}`;
//     }

//     // 2) Try Basic Auth header (common for /connect/token)
//     try {
//       const resp2 = UrlFetchApp.fetch(tokenUrl, {
//         method: 'post',
//         contentType: 'application/x-www-form-urlencoded',
//         payload: basicFormPayload,
//         headers: { Authorization: 'Basic ' + basic },
//         muteHttpExceptions: true
//       });

//       const code2 = resp2.getResponseCode();
//       const body2 = resp2.getContentText();

//       if (code2 === 200) {
//         const json2 = JSON.parse(body2);
//         if (json2.access_token) {
//           const expiresInSec2 = Number(json2.expires_in || 3600);
//           props.setProperty('striven_token', json2.access_token);
//           props.setProperty('striven_token_expires_at_ms', String(Date.now() + expiresInSec2 * 1000));
//           return json2.access_token;
//         }
//         lastErr = `HTTP 200 but no access_token at ${tokenUrl} (Basic): ${body2}`;
//         continue;
//       }

//       if (code2 === 404) continue;
//       lastErr = `HTTP ${code2} at ${tokenUrl} (Basic): ${body2.substring(0, 500)}`;
//     } catch (e2) {
//       lastErr = `Fetch error at ${tokenUrl} (Basic): ${e2.message}`;
//     }
//   }

//   throw new Error(
//     'Could not obtain Striven token. Your STRIVEN_BASE_URL is almost certainly wrong (web host vs auth host), ' +
//     'or the tenant uses a non-standard token URL. Last error: ' + (lastErr || 'none')
//   );
// }



// function fetchStrivenItemsReportToSheet() {
//   const sheetName = 'Striven_Items';
//   const cfg = getStrivenItemsReportConfig_();

//   // ✅ This function returns a headers object including Authorization: 'Bearer ...'
//   const authHeaders = getStrivenAuthHeaders_();

//   const ss = SpreadsheetApp.getActiveSpreadsheet();
//   const sheet = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);
//   sheet.clearContents();

//   const pageSize = 2000;
//   const maxPages = 50;

//   let allRows = [];
//   let headers = [];
//   let headersSet = false;

//   for (let pageIndex = 0; pageIndex < maxPages; pageIndex++) {
//     const url = cfg.reportApiUrl + '?PageIndex=' + pageIndex + '&PageSize=' + pageSize;

//     const resp = UrlFetchApp.fetch(url, {
//       method: 'get',
//       headers: {
//         // ✅ Use the bearer header directly
//         Authorization: authHeaders.Authorization,
//         Accept: 'application/json'
//       },
//       muteHttpExceptions: true
//     });

//     const code = resp.getResponseCode();
//     if (code !== 200) {
//       Logger.log('Stopped at PageIndex ' + pageIndex + ', HTTP ' + code + ': ' + resp.getContentText());
//       break;
//     }

//     const data = JSON.parse(resp.getContentText());

//     let rows;
//     if (Array.isArray(data)) rows = data;
//     else if (Array.isArray(data.rows)) rows = data.rows;
//     else if (Array.isArray(data.data)) rows = data.data;
//     else {
//       Logger.log('Unexpected JSON shape at PageIndex ' + pageIndex + ': ' + JSON.stringify(data).substring(0, 1000));
//       break;
//     }

//     if (!rows || rows.length === 0) {
//       Logger.log('No more rows at PageIndex ' + pageIndex + ', stopping.');
//       break;
//     }

//     if (!headersSet) {
//       headers = Object.keys(rows[0] || {});
//       allRows.push(headers);
//       headersSet = true;
//     }

//     rows.forEach(obj => {
//       const rowArr = headers.map(h => obj[h] ?? '');
//       allRows.push(rowArr);
//     });
//   }

//   if (!allRows.length) {
//     sheet.getRange(1, 1).setValue('No data returned across all pages.');
//     return;
//   }

//   sheet.getRange(1, 1, allRows.length, allRows[0].length).setValues(allRows);
// }