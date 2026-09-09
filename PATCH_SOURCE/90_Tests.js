/**
 * STRIVEN CENTRAL DATA HUB
 * 90_Tests
 * CURRENT TEST ONLY — STD CONTACTS SCHEMA DISCOVERY
 * R1.3b
 *
 * READ-ONLY against Striven.
 * Fetches only two sample rows.
 * Does not write DATA_CONTACTS.
 * Does not modify any registered source project.
 *
 * BUSINESS RULES CONFIRMED:
 * - Only Active customers are included by the report filter.
 * - Customer ID = Customer Number in this tenant.
 * - Customer Primary Email is redundant with the available contact email path.
 * - Contact Status is not required because contact-level active/inactive filtering
 *   is not part of this workflow.
 * - Contact Date Created is not operationally required.
 */

function test_StdContactsReportSchema() {
  const startedMs = Date.now();
  const props = PropertiesService.getScriptProperties();

  const clientId = String(props.getProperty('CLIENT_ID') || '').trim();
  const clientSecret = String(props.getProperty('CLIENT_SECRET') || '').trim();
  const reportUrl = String(props.getProperty('STRIVEN_STD_CONTACTS_REPORT_URL') || '').trim();

  const missingProperties = [];
  if (!clientId) missingProperties.push('CLIENT_ID');
  if (!clientSecret) missingProperties.push('CLIENT_SECRET');
  if (!reportUrl) missingProperties.push('STRIVEN_STD_CONTACTS_REPORT_URL');

  if (missingProperties.length) {
    throw new Error('Missing Script Properties: ' + missingProperties.join(', '));
  }

  if (!/^https:\/\/api\.striven\.com\//i.test(reportUrl)) {
    throw new Error('STRIVEN_STD_CONTACTS_REPORT_URL must use https://api.striven.com/.');
  }

  const tokenInfo = hub_strivenAccessToken_(clientId, clientSecret);
  const token = tokenInfo.accessToken;

  const pageUrl = testContactsPagedUrl_(reportUrl, 0, 2);
  const response = UrlFetchApp.fetch(pageUrl, {
    method: 'get',
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/json'
    },
    muteHttpExceptions: true
  });

  const httpCode = response.getResponseCode();
  const responseText = response.getContentText();

  if (httpCode < 200 || httpCode >= 300) {
    throw new Error(
      'STD Contacts report fetch failed HTTP ' + httpCode + ': ' +
      testContactsSafeText_(responseText, 500)
    );
  }

  let payload;
  try {
    payload = JSON.parse(responseText);
  } catch (e) {
    throw new Error('STD Contacts report returned non-JSON content.');
  }

  const rows = testContactsExtractRows_(payload).slice(0, 2);
  if (!rows.length) {
    throw new Error('STD Contacts report returned zero sample rows.');
  }

  const actualFields = testContactsFieldUnion_(rows);
  const schema = testContactsSchema_();
  const audit = testContactsAuditSchema_(actualFields, schema);

  const status =
    audit.missingCanonicalFields.length === 0 &&
    audit.ambiguousCanonicalFields.length === 0 &&
    audit.unexpectedSourceFields.length === 0 &&
    actualFields.length === schema.length
      ? 'PASS'
      : 'REVIEW_SCHEMA';

  const result = {
    status: status,
    test: 'test_StdContactsReportSchema',
    reportConfigured: true,
    reportHost: 'api.striven.com',
    oauth: 'PASS',
    sampleRows: rows.length,
    expectedCanonicalFieldCount: schema.length,
    actualFieldCount: actualFields.length,
    actualFields: actualFields,
    canonicalToSource: audit.canonicalToSource,
    sourceToCanonical: audit.sourceToCanonical,
    missingCanonicalFields: audit.missingCanonicalFields,
    ambiguousCanonicalFields: audit.ambiguousCanonicalFields,
    unexpectedSourceFields: audit.unexpectedSourceFields,
    derivedWithoutReportSlots: [
      'CustomerNumber = CustomerId',
      'CustomerStatus = Active (from report filter)',
      'CustomerPrimaryEmail = use available ContactPrimaryEmail where needed',
      'CustomerCity = parse CustomerFullAddress',
      'ContactCity = parse ContactFullAddress',
      'NormalizedCustomerPhone',
      'NormalizedCustomerAddress',
      'NormalizedContactPhone',
      'ContactPhoneExtension',
      'NormalizedContactEmail',
      'NormalizedContactAddress',
      'EntityType = CONTACT',
      'EntityId = ContactId',
      'CustomerContactKey'
    ],
    intentionallyNotRequired: [
      'CustomerPrimaryEmail',
      'ContactDateCreated',
      'ContactStatus'
    ],
    filterExpectation: 'Customer Status = Active. This test validates returned data/schema, not the saved Report Builder filter definition.',
    writesPerformed: false,
    dataContactsWritten: false,
    strivenWritesPerformed: false,
    sourceProjectsModified: false,
    tokenRequestMade: tokenInfo.requestedNewToken,
    apiCallsThisRun: 1 + (tokenInfo.requestedNewToken ? 1 : 0),
    elapsedMs: Date.now() - startedMs,
    nextStep: status === 'PASS'
      ? 'Build production hub_refreshStdContacts and full DATA_CONTACTS validation.'
      : 'Review only the fields reported missing/ambiguous/unexpected and rerun this same test.'
  };

  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * Confirmed 12-field standard source schema.
 * Every canonical field keeps an alias set as a standing Hub rule.
 */
function testContactsSchema_() {
  return [
    {
      canonical: 'CustomerDateCreated',
      aliases: [
        'CustomerDateCreated', 'Customer Date Created',
        'CustomerCreatedOn', 'Customer Created On',
        'CustomerCreatedAt', 'Customer Created At'
      ]
    },
    {
      canonical: 'CustomerId',
      aliases: [
        'CustomerId', 'CustomerID', 'Customer Id', 'Customer ID',
        'CustomerCustomerId', 'CustomerCustomerID',
        'CustomerNumber', 'Customer Number'
      ]
    },
    {
      canonical: 'CustomerName',
      aliases: [
        'CustomerName', 'Customer Name',
        'CustomerFullName', 'Customer Full Name',
        'CustomerCustomerName'
      ]
    },
    {
      canonical: 'CustomerPrimaryPhone',
      aliases: [
        'CustomerPrimaryPhone', 'Customer Primary Phone',
        'CustomerPhone', 'Customer Phone'
      ]
    },
    {
      canonical: 'CustomerFullAddress',
      aliases: [
        'CustomerFullAddress', 'Customer Full Address',
        'CustomerAddressFullAddress', 'Customer Address Full Address',
        'CustomerAddress'
      ]
    },
    {
      canonical: 'ContactId',
      aliases: [
        'ContactId', 'ContactID', 'Contact Id', 'Contact ID'
      ]
    },
    {
      canonical: 'FirstName',
      aliases: [
        'FirstName', 'First Name',
        'ContactFirstName', 'Contact First Name'
      ]
    },
    {
      canonical: 'LastName',
      aliases: [
        'LastName', 'Last Name',
        'ContactLastName', 'Contact Last Name'
      ]
    },
    {
      canonical: 'ContactFullName',
      aliases: [
        'ContactFullName', 'Contact Full Name',
        'FullName', 'Full Name',
        'ContactName', 'Contact Name'
      ]
    },
    {
      canonical: 'ContactPrimaryEmail',
      aliases: [
        'ContactPrimaryEmail', 'Contact Primary Email',
        'PrimaryEmail', 'Primary Email',
        'ContactEmail', 'Contact Email'
      ]
    },
    {
      canonical: 'ContactPrimaryPhone',
      aliases: [
        'ContactPrimaryPhone', 'Contact Primary Phone',
        'PrimaryPhone', 'Primary Phone',
        'ContactPhone', 'Contact Phone'
      ]
    },
    {
      canonical: 'ContactFullAddress',
      aliases: [
        'ContactFullAddress', 'Contact Full Address',
        'ContactAddressFullAddress', 'Contact Address Full Address',
        'AddressFullAddress', 'Address Full Address'
      ]
    }
  ];
}

function testContactsAuditSchema_(actualFields, schema) {
  const normToRaw = {};
  actualFields.forEach(function(raw) {
    const norm = testContactsNormalize_(raw);
    if (!normToRaw[norm]) normToRaw[norm] = [];
    normToRaw[norm].push(raw);
  });

  const canonicalToSource = {};
  const sourceToCanonical = {};
  const missing = [];
  const ambiguous = [];
  const acceptedNorms = {};

  schema.forEach(function(def) {
    const matches = [];

    def.aliases.forEach(function(alias) {
      const norm = testContactsNormalize_(alias);
      acceptedNorms[norm] = true;

      (normToRaw[norm] || []).forEach(function(raw) {
        if (matches.indexOf(raw) < 0) matches.push(raw);
      });
    });

    if (matches.length === 0) {
      missing.push(def.canonical);
      return;
    }

    if (matches.length > 1) {
      ambiguous.push({
        canonical: def.canonical,
        sourceFields: matches
      });
      return;
    }

    canonicalToSource[def.canonical] = matches[0];
    sourceToCanonical[matches[0]] = def.canonical;
  });

  const unexpected = actualFields.filter(function(raw) {
    return !acceptedNorms[testContactsNormalize_(raw)];
  });

  return {
    canonicalToSource: canonicalToSource,
    sourceToCanonical: sourceToCanonical,
    missingCanonicalFields: missing,
    ambiguousCanonicalFields: ambiguous,
    unexpectedSourceFields: unexpected
  };
}

function testContactsFieldUnion_(rows) {
  const out = [];
  rows.forEach(function(row) {
    Object.keys(row || {}).forEach(function(key) {
      if (out.indexOf(key) < 0) out.push(key);
    });
  });
  return out;
}

function testContactsNormalize_(value) {
  return String(value == null ? '' : value)
    .replace(/[^A-Za-z0-9]/g, '')
    .toLowerCase();
}

function testContactsPagedUrl_(reportUrl, pageIndex, pageSize) {
  let url = String(reportUrl || '').trim();

  url = url
    .replace(/([?&])pageIndex=\d+(&?)/ig, function(_, lead, tail) {
      return tail ? lead : '';
    })
    .replace(/([?&])pageSize=\d+(&?)/ig, function(_, lead, tail) {
      return tail ? lead : '';
    })
    .replace(/[?&]$/, '');

  const separator = url.indexOf('?') >= 0 ? '&' : '?';
  return url +
    separator + 'pageIndex=' + encodeURIComponent(pageIndex) +
    '&pageSize=' + encodeURIComponent(pageSize);
}

function testContactsExtractRows_(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];

  const candidates = [
    payload.data, payload.Data,
    payload.results, payload.Results,
    payload.items, payload.Items,
    payload.rows, payload.Rows,
    payload.records, payload.Records
  ];

  for (let i = 0; i < candidates.length; i++) {
    if (Array.isArray(candidates[i])) return candidates[i];
  }

  const keys = Object.keys(payload);
  for (let i = 0; i < keys.length; i++) {
    const value = payload[keys[i]];
    if (
      Array.isArray(value) &&
      value.length &&
      typeof value[0] === 'object' &&
      !Array.isArray(value[0])
    ) {
      return value;
    }
  }

  return [];
}

function testContactsSafeText_(value, maxLen) {
  let s = String(value == null ? '' : value);

  s = s.replace(
    /(authorization\s*[:=]\s*['"]?\s*(?:basic|bearer)\s+)[A-Za-z0-9._~+\/=-]+/ig,
    '$1[REDACTED]'
  );
  s = s.replace(/\b(sk-[A-Za-z0-9_-]{12,})\b/g, '[REDACTED_KEY]');
  s = s.replace(
    /([?&](?:api[_-]?key|key|token|access_token)=)[^&\s'"]+/ig,
    '$1[REDACTED]'
  );

  return s.length <= maxLen ? s : s.substring(0, maxLen) + '...';
}
