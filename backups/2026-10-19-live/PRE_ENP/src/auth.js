// /***********************
//  * AUTH + HTTP HELPERS *
//  ***********************/

// /**
//  * Ensure we have a valid Striven token and return headers.
//  * Auto-refreshes if missing or expired.
//  */
// function getStrivenAuthHeaders_() {
//   const props   = PropertiesService.getScriptProperties();
//   const baseUrl = props.getProperty('STRIVEN_BASE_URL');
//   if (!baseUrl) throw new Error('Missing STRIVEN_BASE_URL in Script Properties.');

//   const now       = Date.now();
//   const token     = props.getProperty('striven_token');
//   const expiresMs = Number(props.getProperty('striven_token_expires') || 0);

//   // If no token or expired → refresh once
//   if (!token || !expiresMs || now >= (expiresMs - 60000)) {
//     refreshStrivenToken_();
//   }

//   const newToken = props.getProperty('striven_token');
//   if (!newToken) throw new Error('striven_token missing even after refresh.');

//   return {
//     Authorization: 'Bearer ' + newToken,
//     'Content-Type': 'application/json'
//   };
// }

// /**
//  * Refresh Striven API token using client_credentials.
//  * Uses https://api.striven.com/accesstoken regardless of STRIVEN_BASE_URL.
//  */
// function refreshStrivenToken_() {
//   const props     = PropertiesService.getScriptProperties();
//   const clientId  = props.getProperty('CLIENT_ID');
//   const clientSec = props.getProperty('CLIENT_SECRET');

//   if (!clientId || !clientSec) {
//     throw new Error('Missing CLIENT_ID / CLIENT_SECRET in Script Properties.');
//   }

//   // Striven auth endpoint
//   const tokenUrl = 'https://api.striven.com/accesstoken';

//   const payload = {
//     grant_type:    'client_credentials',
//     client_id:     clientId,
//     client_secret: clientSec,
//     scope:         'api'
//   };

//   // IMPORTANT: send as form-encoded, NOT JSON
//   const res  = UrlFetchApp.fetch(tokenUrl, {
//     method:             'post',
//     payload:            payload,  // <– not JSON.stringify
//     muteHttpExceptions: true
//     // no explicit contentType: default is application/x-www-form-urlencoded
//   });

//   const code = res.getResponseCode();
//   const text = res.getContentText();

//   if (code !== 200) {
//     Logger.log('❌ Token refresh HTTP ' + code);
//     Logger.log('Token URL: ' + tokenUrl);
//     Logger.log('Response (truncated): ' + text.slice(0, 2000));
//     throw new Error('Striven token refresh failed. HTTP ' + code + ' — ' + text.slice(0, 200));
//   }

//   let body;
//   try {
//     body = JSON.parse(text || '{}');
//   } catch (e) {
//     Logger.log('❌ Token JSON parse failed: ' + text);
//     throw new Error('Token refresh returned invalid JSON.');
//   }

//   if (!body.access_token || !body.expires_in) {
//     Logger.log('❌ Token payload missing fields: ' + JSON.stringify(body));
//     throw new Error('Token refresh response missing access_token / expires_in.');
//   }

//   const expiresAt = Date.now() + Number(body.expires_in) * 1000;
//   props.setProperty('striven_token', body.access_token);
//   props.setProperty('striven_token_expires', String(expiresAt));

//   Logger.log('✅ Striven token refreshed; expires ' + new Date(expiresAt).toISOString());
// }


// /**
//  * Generic Striven request wrapper with ONE automatic retry
//  * if the token is expired/invalid.
//  */
// function strivenRequest_(method, path, payload) {
//   const props   = PropertiesService.getScriptProperties();
//   const baseUrl = props.getProperty('STRIVEN_BASE_URL');
//   if (!baseUrl) throw new Error('Missing STRIVEN_BASE_URL in Script Properties.');

//   const url = baseUrl.replace(/\/+$/, '') + path;

//   return strivenRequestWithRetry_(method, url, payload, false);
// }

// function strivenRequestWithRetry_(method, url, payload, hasRetried) {
//   const headers = getStrivenAuthHeaders_();

//   const options = {
//     method:             method.toLowerCase(),
//     headers:            headers,
//     muteHttpExceptions: true
//   };

//   if (payload !== undefined && payload !== null) {
//     options.payload = JSON.stringify(payload);
//   }

//   const res  = UrlFetchApp.fetch(url, options);
//   const code = res.getResponseCode();
//   const text = res.getContentText();

//   Logger.log('Striven ' + method + ' ' + url + ' HTTP ' + code);

//   // If token is bad/expired, try ONE refresh + retry
//   if ((code === 401 || code === 403) && !hasRetried) {
//     Logger.log('⚠️ Unauthorized/Forbidden. Trying token refresh and retry once.');
//     refreshStrivenToken_();

//     const newHeaders = getStrivenAuthHeaders_();
//     options.headers  = newHeaders;

//     const res2  = UrlFetchApp.fetch(url, options);
//     const code2 = res2.getResponseCode();
//     const text2 = res2.getContentText();

//     Logger.log('Striven ' + method + ' ' + url + ' retry HTTP ' + code2);

//     if (code2 < 200 || code2 >= 300) {
//       Logger.log('Body (truncated): ' + text2.slice(0, 2000));
//       throw new Error('Striven ' + method + ' ' + url + ' failed after retry with HTTP ' + code2);
//     }

//     if (!text2) return {};
//     try {
//       return JSON.parse(text2);
//     } catch (e) {
//       Logger.log('Non-JSON response (truncated): ' + text2.slice(0, 500));
//       return {};
//     }
//   }

//   // Non-token-related error or retry already attempted
//   if (code < 200 || code >= 300) {
//     Logger.log('Body (truncated): ' + text.slice(0, 2000));
//     throw new Error('Striven ' + method + ' ' + url + ' failed with HTTP ' + code);
//   }

//   if (!text) return {};
//   try {
//     return JSON.parse(text);
//   } catch (e) {
//     Logger.log('Non-JSON response (truncated): ' + text.slice(0, 500));
//     return {};
//   }
// }

// function testRefreshToken() {
//   refreshStrivenToken_();
// }
