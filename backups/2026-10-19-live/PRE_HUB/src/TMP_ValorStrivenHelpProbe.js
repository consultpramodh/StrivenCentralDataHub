
function valorStrivenHelpProbe() {
  var urls = [
    'https://api.striven.com/Help',
    'https://api.striven.com/Help/Api/POST-v1-items-id-images',
    'https://api.striven.com/Help/Api/POST-v1-Items-id-images',
    'https://api.striven.com/Help/Api/POST-v1-Items-id-Images',
    'https://api.striven.com/Help/Api/GET-v1-items-id-images',
    'https://api.striven.com/Help/Api/GET-v1-Items-id-images'
  ];

  function cleanHtml(s) {
    return String(s || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  var out = urls.map(function(url) {
    try {
      var r = UrlFetchApp.fetch(url, {
        method:'get',
        followRedirects:true,
        muteHttpExceptions:true,
        headers:{Accept:'text/html,application/xhtml+xml'}
      });
      var body = r.getContentText() || '';
      var text = cleanHtml(body);
      var lower = text.toLowerCase();
      var ix = lower.indexOf('items');
      if (ix < 0) ix = lower.indexOf('image');
      var snippet = ix >= 0
        ? text.substring(Math.max(0, ix - 1500), Math.min(text.length, ix + 6000))
        : text.substring(0, 7000);
      return {
        url:url,
        code:r.getResponseCode(),
        contentType:String(r.getHeaders()['Content-Type'] || ''),
        length:body.length,
        snippet:snippet
      };
    } catch (e) {
      return {url:url,error:String(e && e.message || e)};
    }
  });

  return {ok:true, collectedAt:new Date().toISOString(), results:out};
}
