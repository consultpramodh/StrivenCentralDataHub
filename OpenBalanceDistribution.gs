/**
 * Classic Fireplace & BBQ Store
 * Striven Central Data Hub — Sales Rep Open Balance Distribution
 * Target Apps Script Project ID:
 * 1t81y0BcV0cnBEBSKcbZt2nx16IBAg63rRvsfSVpjiDiBvrNi6TEq-AG8
 *
 * Privacy model:
 * - Source report is fetched once.
 * - Every source row must resolve to exactly one enabled/READY rep.
 * - Unknown, missing, or ambiguous ownership aborts the ENTIRE run before email.
 * - TEST mode sends every rep-specific report only to ADMIN_TEST_EMAIL.
 * - PRODUCTION mode sends exactly one recipient per rep. No CC/BCC.
 * - CreatedBy is NEVER used as a substitute for SalesRep.
 */

const OB = Object.freeze({
  SPREADSHEET_ID: '13OKw69We9tsIWzEQwNOl4aAHh11qrsICSOt781O2upU',
  SHEETS: Object.freeze({
    CONTROL: 'OPEN_BALANCE_CONTROL',
    REPS: 'OPEN_BALANCE_REP_CONFIG',
    DATA: 'DATA_OPEN_BALANCES',
    SEND_LOG: 'OPEN_BALANCE_SEND_LOG',
    EXCEPTIONS: 'OPEN_BALANCE_EXCEPTIONS',
    EMPLOYEE_PROFILES: 'DATA_EMPLOYEE_PROFILES'
  }),
  REPORT_URL_PROPERTY: 'STRIVEN_OPEN_BALANCE_REPORT_URL',
  DIRECT_API: Object.freeze({
    BASE_URL: 'https://api.striven.com',
    INVOICE_SEARCH_PATH: '/v1/invoices/search',
    INVOICE_DETAIL_PREFIX: '/v1/invoices/',
    EMPLOYEE_DETAIL_PREFIX: '/v1/employees/',
    SEARCH_PAGE_SIZE: 100,
    SEARCH_MAX_PAGES: 500,
    SEARCH_TIME_BUDGET_MS: 4 * 60 * 1000,
    API_BRAKE_MS: 750
  }),
  TRIGGER_FUNCTION: 'runOpenBalanceRepDistribution',
  REFRESH_TRIGGER_FUNCTION: 'runOpenBalanceAutoRefresh',
  PRIVATE_CONFIG_SHEET: 'OPEN_BALANCE_PRIVATE_CONFIG',
  DEFAULT_OWNER_FIELD: 'SalesRep',
  SENDER_NAME: 'Classic Fireplace & BBQ Store',
  CURRENCY: 'CAD'
});

/** Production entry point. Intended for the biweekly installable trigger. */
function runOpenBalanceRepDistribution() {
  return obRun_({ modeOverride: null, sendEmails: true, allowDisabled: false });
}

/**
 * Unattended cache refresh.
 * Safe before Sales Rep routing is ready: it refreshes DATA_OPEN_BALANCES
 * without sending email and without substituting CreatedBy for SalesRep.
 */
function runOpenBalanceAutoRefresh() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return { ok: false, status: 'SKIPPED_LOCKED' };
  }

  try {
    const ss = SpreadsheetApp.openById(OB.SPREADSHEET_ID);
    const control = obReadControl_(ss);

    if (control.AUTO_REFRESH_ENABLED !== true) {
      return { ok: false, status: 'AUTO_REFRESH_DISABLED' };
    }

    const report = obFetchReport_();
    const ownerFieldRequested = String(control.OWNER_FIELD_REQUIRED || OB.DEFAULT_OWNER_FIELD).trim();
    const ownerField = obFindField_(report.fields, ownerFieldRequested);

    // Always cache the freshly fetched report before routing validation.
    // This keeps DATA_OPEN_BALANCES current even while Sales Rep ownership is still being configured.
    obWriteRawSnapshot_(ss, report.rows, ownerField);
    obRecordRefresh_(ss, report.rows.length, 'SUCCESS');

    obSetControlValue_(ss, 'OWNER_FIELD_PRESENT', !!ownerField);
    obSetControlValue_(
      ss,
      'STATUS',
      ownerField ? 'REFRESHED_WAITING_ROUTING' : 'BLOCKED_PENDING_OWNER_FIELD'
    );

    const result = {
      ok: true,
      status: ownerField ? 'REFRESHED_WAITING_ROUTING' : 'REFRESHED_PENDING_OWNER_FIELD',
      rows: report.rows.length,
      ownerFieldPresent: !!ownerField
    };
    console.log(JSON.stringify(result));
    return result;
  } catch (err) {
    try {
      const ss = SpreadsheetApp.openById(OB.SPREADSHEET_ID);
      obRecordRefresh_(ss, '', 'FAILED: ' + String(err && err.message ? err.message : err).slice(0, 500));
    } catch (loggingErr) {}
    throw err;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Resolves authoritative ownership for every Open Balance Invoice through
 * Striven's direct Invoice API.
 *
 * Route:
 *   Transaction Number
 *     -> POST /v1/invoices/search
 *     -> unique Invoice ID
 *     -> GET /v1/invoices/{id}
 *     -> invoice.salesRep.id/name
 *     -> one-time GET /v1/employees/{salesRep.id} cache
 *
 * Safety:
 * - Never substitutes CreatedBy.
 * - Never guesses duplicate/missing Invoice IDs.
 * - Payment rows remain blocked until payment-to-invoice application evidence
 *   is implemented and verified.
 * - Sends no email.
 */
function openBalanceResolveInvoiceOwners() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const ss = SpreadsheetApp.openById(OB.SPREADSHEET_ID);
    const report = obFetchReport_();
    const invoiceRows = report.rows.filter(function(row) {
      return String(row.TransactionType || '').trim().toUpperCase() === 'INVOICE';
    });

    if (!invoiceRows.length) {
      throw new Error('Open Balance report returned zero Invoice rows.');
    }

    const resolution = obResolveInvoiceOwnersFromDirectApi_(invoiceRows);
    const fetchedAt = new Date();
    const runId = 'OWNER-' + Utilities.formatDate(
      fetchedAt,
      Session.getScriptTimeZone() || 'America/Toronto',
      'yyyyMMdd-HHmmss'
    );

    const employeeIds = [];
    const stagingRows = report.rows.map(function(row) {
      const type = String(row.TransactionType || '').trim().toUpperCase();
      const hash = obHash_(JSON.stringify(row));

      if (type !== 'INVOICE') {
        return obStagingRow_(
          runId,
          fetchedAt,
          '',
          row,
          type === 'PAYMENT'
            ? 'PENDING_PAYMENT_APPLICATION_OWNER'
            : 'BLOCKED_UNSUPPORTED_TRANSACTION_TYPE',
          hash
        );
      }

      const comparable = obNormalizeTransactionNumber_(row.TransactionNumber);
      const resolved = resolution.byTransaction[comparable];

      if (!resolved || resolved.status !== 'VERIFIED') {
        return obStagingRow_(
          runId,
          fetchedAt,
          '',
          row,
          resolved ? resolved.status : 'BLOCKED_INVOICE_NOT_RESOLVED',
          hash
        );
      }

      const employeeId = String(resolved.salesRepId);
      if (employeeIds.indexOf(employeeId) === -1) employeeIds.push(employeeId);

      return obStagingRow_(
        runId,
        fetchedAt,
        employeeId,
        row,
        'VERIFIED_INVOICE_SALES_REP_API',
        hash
      );
    });

    obReplaceStaging_(ss, stagingRows);

    const profiles = obCacheEmployeeProfiles_(ss, employeeIds, resolution);
    const verifiedCount = Object.keys(resolution.byTransaction).filter(function(key) {
      return resolution.byTransaction[key].status === 'VERIFIED';
    }).length;

    obSetControlValue_(ss, 'INVOICE_OWNERS_VERIFIED', verifiedCount);
    obSetControlValue_(
      ss,
      'STATUS',
      verifiedCount === invoiceRows.length
        ? 'INVOICE_OWNER_ENRICHMENT_COMPLETE'
        : 'OWNER_ENRICHMENT_PARTIAL'
    );

    const result = {
      ok: verifiedCount === invoiceRows.length,
      status: verifiedCount === invoiceRows.length
        ? 'INVOICE_OWNER_ENRICHMENT_COMPLETE'
        : 'OWNER_ENRICHMENT_PARTIAL',
      sourceRows: report.rows.length,
      invoiceRows: invoiceRows.length,
      verifiedInvoiceOwners: verifiedCount,
      unresolvedInvoiceOwners: invoiceRows.length - verifiedCount,
      paymentRows: report.rows.filter(function(row) {
        return String(row.TransactionType || '').trim().toUpperCase() === 'PAYMENT';
      }).length,
      invoiceSearchPages: resolution.pagesFetched,
      apiCalls: resolution.apiCalls + profiles.apiCalls,
      employeeProfilesRequested: profiles.requested,
      employeeProfilesVerified: profiles.verified,
      employeeProfilesWithoutEmail: profiles.withoutEmail
    };

    console.log(JSON.stringify(result));
    return result;
  } finally {
    lock.releaseLock();
  }
}

/** Manual no-email validation. Safe to run from the Apps Script editor. */
function openBalanceDryRun() {
  return obRun_({ modeOverride: 'DRY_RUN', sendEmails: false, allowDisabled: true });
}

/**
 * Manual test send. Sends ALL rep reports only to ADMIN_TEST_EMAIL.
 * It never sends to the rep addresses.
 */
function openBalanceTestSend() {
  return obRun_({ modeOverride: 'TEST', sendEmails: true, allowDisabled: true });
}

/** Fetches the source once and updates source-schema readiness in OPEN_BALANCE_CONTROL. */
function openBalanceAuditSource() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = SpreadsheetApp.openById(OB.SPREADSHEET_ID);
    const control = obReadControl_(ss);
    const report = obFetchReport_();
    const ownerFieldRequested = String(control.OWNER_FIELD_REQUIRED || OB.DEFAULT_OWNER_FIELD).trim();
    const ownerField = obFindField_(report.fields, ownerFieldRequested);
    const present = !!ownerField;

    obSetControlValue_(ss, 'OWNER_FIELD_PRESENT', present);
    obSetControlValue_(
      ss,
      'STATUS',
      present ? 'WAITING_FOR_REP_CONFIG' : 'BLOCKED_PENDING_OWNER_FIELD'
    );

    const result = {
      ok: present,
      totalRecords: report.rows.length,
      fields: report.fields,
      requestedOwnerField: ownerFieldRequested,
      resolvedOwnerField: ownerField || null,
      status: present ? 'WAITING_FOR_REP_CONFIG' : 'BLOCKED_PENDING_OWNER_FIELD'
    };
    console.log(JSON.stringify(result));
    return result;
  } finally {
    lock.releaseLock();
  }
}

/** Prompts once for the tokenized Striven report URL and stores it in Script Properties. */
function openBalanceSetupReportUrl() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt(
    'Open Balance Report URL',
    'Paste the complete Striven v2 report URL. It will be stored in Script Properties, not in the sheet.',
    ui.ButtonSet.OK_CANCEL
  );
  if (response.getSelectedButton() !== ui.Button.OK) return 'CANCELLED';
  const url = String(response.getResponseText() || '').trim();
  if (!/^https:\/\/api\.striven\.com\/v2\/reports\//i.test(url)) {
    throw new Error('Invalid Striven report URL. Expected https://api.striven.com/v2/reports/...');
  }
  PropertiesService.getScriptProperties().setProperty(OB.REPORT_URL_PROPERTY, url);
  return openBalanceAuditSource();
}

/** Stores the TEST-only recipient in OPEN_BALANCE_CONTROL. */
function openBalanceSetupAdminTestEmail() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt(
    'Admin Test Email',
    'Enter the single email address that should receive ALL test-mode rep reports.',
    ui.ButtonSet.OK_CANCEL
  );
  if (response.getSelectedButton() !== ui.Button.OK) return 'CANCELLED';
  const email = obValidateSingleEmail_(response.getResponseText());
  const ss = SpreadsheetApp.openById(OB.SPREADSHEET_ID);
  obSetControlValue_(ss, 'ADMIN_TEST_EMAIL', email);
  return { ok: true, adminTestEmail: email };
}

/**
 * Installs both unattended triggers:
 * 1) daily refresh of DATA_OPEN_BALANCES
 * 2) biweekly rep distribution
 *
 * This is an infrastructure/deployment action, not an operator workflow.
 * Once installed, no recurring manual refresh or send action is required.
 */
function installOpenBalanceAutomation() {
  const ss = SpreadsheetApp.openById(OB.SPREADSHEET_ID);
  const control = obReadControl_(ss);
  const tz = String(control.TIMEZONE || 'America/Toronto').trim();
  const refreshHour = Number(control.REFRESH_HOUR == null ? 7 : control.REFRESH_HOUR);

  if (!Number.isInteger(refreshHour) || refreshHour < 0 || refreshHour > 23) {
    throw new Error('REFRESH_HOUR must be an integer from 0 to 23.');
  }

  const reportUrl = obGetReportUrl_();
  if (!reportUrl) throw new Error('Open Balance report URL is not configured.');

  obDeleteRefreshTriggers_();

  const refreshTrigger = ScriptApp.newTrigger(OB.REFRESH_TRIGGER_FUNCTION)
    .timeBased()
    .everyDays(1)
    .atHour(refreshHour)
    .inTimezone(tz)
    .create();

  let distribution = null;
  try {
    distribution = installOpenBalanceBiweeklyTrigger();
  } catch (err) {
    // Keep the cache refresh alive even while Sales Rep routing is still being completed.
    distribution = { ok: false, status: 'DISTRIBUTION_NOT_READY', error: String(err && err.message ? err.message : err) };
  }

  return {
    ok: true,
    refreshTriggerId: refreshTrigger.getUniqueId(),
    refreshHour: refreshHour,
    timezone: tz,
    distribution: distribution
  };
}

/**
 * Installs exactly one biweekly trigger using the control sheet settings.
 * Refuses installation while ownership routing is not ready.
 */
function installOpenBalanceBiweeklyTrigger() {
  const ss = SpreadsheetApp.openById(OB.SPREADSHEET_ID);
  const control = obReadControl_(ss);
  const readiness = obCheckConfigurationReadiness_(ss, control);
  if (!readiness.ready) {
    throw new Error('Trigger not installed: ' + readiness.reason);
  }

  obDeleteDistributionTriggers_();

  const dayName = String(control.DAY || 'MONDAY').toUpperCase();
  const dayMap = {
    MONDAY: ScriptApp.WeekDay.MONDAY,
    TUESDAY: ScriptApp.WeekDay.TUESDAY,
    WEDNESDAY: ScriptApp.WeekDay.WEDNESDAY,
    THURSDAY: ScriptApp.WeekDay.THURSDAY,
    FRIDAY: ScriptApp.WeekDay.FRIDAY,
    SATURDAY: ScriptApp.WeekDay.SATURDAY,
    SUNDAY: ScriptApp.WeekDay.SUNDAY
  };
  if (!dayMap[dayName]) throw new Error('Unsupported DAY in OPEN_BALANCE_CONTROL: ' + dayName);

  const hour = Number(control.HOUR);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new Error('HOUR must be an integer from 0 to 23.');
  }

  const tz = String(control.TIMEZONE || 'America/Toronto').trim();
  const trigger = ScriptApp.newTrigger(OB.TRIGGER_FUNCTION)
    .timeBased()
    .everyWeeks(2)
    .onWeekDay(dayMap[dayName])
    .atHour(hour)
    .inTimezone(tz)
    .create();

  return { ok: true, triggerId: trigger.getUniqueId(), cadence: 'EVERY_2_WEEKS', day: dayName, hour: hour, timezone: tz };
}

function removeOpenBalanceBiweeklyTrigger() {
  const count = obDeleteDistributionTriggers_();
  return { ok: true, removed: count };
}

function removeOpenBalanceAutomation() {
  const refreshRemoved = obDeleteRefreshTriggers_();
  const distributionRemoved = obDeleteDistributionTriggers_();
  return { ok: true, refreshRemoved: refreshRemoved, distributionRemoved: distributionRemoved };
}

function openBalanceStatus() {
  const ss = SpreadsheetApp.openById(OB.SPREADSHEET_ID);
  const control = obReadControl_(ss);
  const reps = obReadRepConfig_(ss, false);
  const triggers = ScriptApp.getProjectTriggers();
  const triggerCount = triggers.filter(t => t.getHandlerFunction() === OB.TRIGGER_FUNCTION).length;
  const refreshTriggerCount = triggers.filter(t => t.getHandlerFunction() === OB.REFRESH_TRIGGER_FUNCTION).length;
  return {
    control: control,
    enabledRepCount: reps.length,
    triggerCount: triggerCount,
    refreshTriggerCount: refreshTriggerCount,
    reportUrlConfigured: !!obGetReportUrl_()
  };
}

function obRun_(options) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  const startedAt = new Date();
  const runId = 'OB-' + Utilities.formatDate(startedAt, 'America/Toronto', 'yyyyMMdd-HHmmss') + '-' + Utilities.getUuid().slice(0, 8);

  try {
    const ss = SpreadsheetApp.openById(OB.SPREADSHEET_ID);
    const control = obReadControl_(ss);
    const configuredMode = String(control.MODE || 'TEST').toUpperCase();
    const mode = String(options.modeOverride || configuredMode).toUpperCase();

    if (!options.allowDisabled && control.ENABLED !== true) {
      return { ok: false, status: 'DISABLED', runId: runId, message: 'OPEN_BALANCE_CONTROL ENABLED is FALSE.' };
    }

    if (!['PRODUCTION', 'TEST', 'DRY_RUN'].includes(mode)) {
      throw new Error('Unsupported MODE: ' + mode);
    }

    const report = obFetchReport_();
    const ownerFieldRequested = String(control.OWNER_FIELD_REQUIRED || OB.DEFAULT_OWNER_FIELD).trim();
    const ownerField = obFindField_(report.fields, ownerFieldRequested);

    if (!ownerField) {
      obSetControlValue_(ss, 'OWNER_FIELD_PRESENT', false);
      obSetControlValue_(ss, 'STATUS', 'BLOCKED_PENDING_OWNER_FIELD');
      obAppendException_(ss, [
        runId,
        new Date(),
        'SCHEMA_MISSING_OWNER_FIELD',
        '', '', '', '', '', '',
        'Required field "' + ownerFieldRequested + '" was not found. Available fields: ' + report.fields.join(', '),
        'BLOCKED'
      ]);
      throw new Error('Privacy stop: required owner field "' + ownerFieldRequested + '" is absent from the Striven report. CreatedBy will not be used as a substitute.');
    }

    obSetControlValue_(ss, 'OWNER_FIELD_PRESENT', true);

    const reps = obReadRepConfig_(ss, true);
    if (!reps.length) throw new Error('No enabled READY sales reps exist in OPEN_BALANCE_REP_CONFIG.');
    const repByOwner = obBuildRepMap_(reps);

    const routing = obRouteRows_(report.rows, ownerField, repByOwner, runId);
    obReplaceStaging_(ss, routing.stagingRows);

    if (routing.exceptions.length) {
      routing.exceptions.forEach(row => obAppendException_(ss, row));
      obSetControlValue_(ss, 'STATUS', 'BLOCKED_ROUTING_EXCEPTIONS');
      throw new Error('Privacy stop: ' + routing.exceptions.length + ' row(s) could not be assigned to exactly one authorized rep. No emails were sent.');
    }

    // Critical invariant: every source row must be routed exactly once before ANY email.
    if (routing.routedCount !== report.rows.length) {
      obSetControlValue_(ss, 'STATUS', 'BLOCKED_ROUTING_COUNT_MISMATCH');
      throw new Error('Privacy stop: routed row count (' + routing.routedCount + ') does not equal source row count (' + report.rows.length + ').');
    }

    obSetControlValue_(ss, 'STATUS', mode === 'DRY_RUN' ? 'DRY_RUN_VALIDATED' : 'READY');

    if (!options.sendEmails || mode === 'DRY_RUN') {
      const dry = {
        ok: true,
        status: 'DRY_RUN_VALIDATED',
        runId: runId,
        sourceRows: report.rows.length,
        repCount: Object.keys(routing.groups).length,
        ownerField: ownerField
      };
      console.log(JSON.stringify(dry));
      return dry;
    }

    let adminTestEmail = '';
    if (mode === 'TEST') adminTestEmail = obValidateSingleEmail_(control.ADMIN_TEST_EMAIL);
    if (mode === 'PRODUCTION' && control.ENABLED !== true) {
      throw new Error('Production send blocked because ENABLED is FALSE.');
    }

    const results = [];
    const repKeys = Object.keys(routing.groups).sort();

    // All routing validations above happen BEFORE this first send.
    for (const repKey of repKeys) {
      const group = routing.groups[repKey];
      const rep = group.rep;
      const rows = group.rows;

      obAssertGroupIsolation_(rep, rows, ownerField);

      const recipient = mode === 'TEST'
        ? adminTestEmail
        : obValidateSingleEmail_(rep.email);

      const payloadHash = obHash_(JSON.stringify(rows));
      const totalOpenBalance = rows.reduce((sum, row) => sum + obToNumber_(row.OpenBalance), 0);
      const subjectDate = Utilities.formatDate(new Date(), String(control.TIMEZONE || 'America/Toronto'), 'yyyy-MM-dd');
      const subject = mode === 'TEST'
        ? '[TEST – Intended for ' + rep.name + '] Open Balance Report – ' + subjectDate
        : 'Open Balance Report – ' + subjectDate;

      const htmlBody = obBuildEmailHtml_(rep, rows, totalOpenBalance, mode, control.TIMEZONE || 'America/Toronto');
      const textBody = obBuildEmailText_(rep, rows, totalOpenBalance, mode, control.TIMEZONE || 'America/Toronto');

      try {
        MailApp.sendEmail({
          to: recipient,
          subject: subject,
          body: textBody,
          htmlBody: htmlBody,
          name: OB.SENDER_NAME
        });

        obAppendSendLog_(ss, [
          runId, new Date(), mode, rep.key, rep.name, recipient,
          rows.length, totalOpenBalance, payloadHash, 'SENT', ''
        ]);
        results.push({ repKey: rep.key, repName: rep.name, recipient: recipient, rowCount: rows.length, status: 'SENT' });
      } catch (err) {
        obAppendSendLog_(ss, [
          runId, new Date(), mode, rep.key, rep.name, recipient,
          rows.length, totalOpenBalance, payloadHash, 'FAILED', String(err && err.message ? err.message : err)
        ]);
        throw err;
      }
    }

    obSetControlValue_(ss, 'STATUS', mode === 'PRODUCTION' ? 'LAST_RUN_SENT' : 'LAST_TEST_SENT');
    return { ok: true, status: mode === 'PRODUCTION' ? 'SENT' : 'TEST_SENT', runId: runId, results: results };
  } finally {
    lock.releaseLock();
  }
}

function obResolveInvoiceOwnersFromDirectApi_(invoiceRows) {
  const targetNumbers = [];
  const targetIndex = Object.create(null);

  invoiceRows.forEach(function(row) {
    const raw = String(row.TransactionNumber || '').trim();
    const comparable = obNormalizeTransactionNumber_(raw);
    if (!comparable) return;
    if (!targetIndex[comparable]) {
      targetIndex[comparable] = raw;
      targetNumbers.push(raw);
    }
  });

  const matches = Object.create(null);
  const startedAt = Date.now();
  let pageIndex = 0;
  let pagesFetched = 0;
  let apiCalls = 0;
  let searchComplete = false;

  while (
    pageIndex < OB.DIRECT_API.SEARCH_MAX_PAGES &&
    Date.now() - startedAt < OB.DIRECT_API.SEARCH_TIME_BUDGET_MS
  ) {
    const response = obStrivenApiRequest_({
      path: OB.DIRECT_API.INVOICE_SEARCH_PATH,
      method: 'post',
      payload: {
        PageIndex: pageIndex,
        PageSize: OB.DIRECT_API.SEARCH_PAGE_SIZE
      }
    });
    apiCalls++;

    const page = obExtractInvoiceSearchPage_(response.data);
    pagesFetched++;

    page.records.forEach(function(record) {
      const transactionNumber = String(
        record.txnNumber ||
        record.TxnNumber ||
        record.transactionNumber ||
        record.TransactionNumber ||
        record.invoiceNumber ||
        record.InvoiceNumber ||
        ''
      ).trim();
      const comparable = obNormalizeTransactionNumber_(transactionNumber);
      if (!targetIndex[comparable]) return;

      const invoiceId = String(
        record.id ||
        record.Id ||
        record.invoiceId ||
        record.InvoiceId ||
        record.InvoiceID ||
        ''
      ).trim();
      if (!/^\d+$/.test(invoiceId)) return;

      if (!matches[comparable]) matches[comparable] = [];
      if (matches[comparable].indexOf(invoiceId) === -1) {
        matches[comparable].push(invoiceId);
      }
    });

    if (page.isLastPage || !page.records.length) {
      searchComplete = true;
      break;
    }
    pageIndex++;
  }

  if (!searchComplete) {
    throw new Error(
      'Privacy stop: Invoice search did not reach the end of the result set ' +
      'within the configured safety budget. No ownership was accepted because ' +
      'transaction-number uniqueness could not be proven.'
    );
  }

  const byTransaction = Object.create(null);

  targetNumbers.forEach(function(number) {
    const comparable = obNormalizeTransactionNumber_(number);
    const ids = matches[comparable] || [];

    if (!ids.length) {
      byTransaction[comparable] = {
        status: 'BLOCKED_INVOICE_ID_NOT_FOUND',
        transactionNumber: number
      };
      return;
    }
    if (ids.length !== 1) {
      byTransaction[comparable] = {
        status: 'BLOCKED_AMBIGUOUS_INVOICE_ID',
        transactionNumber: number,
        candidateCount: ids.length
      };
      return;
    }

    const invoiceId = ids[0];
    const detailResponse = obStrivenApiRequest_({
      path: OB.DIRECT_API.INVOICE_DETAIL_PREFIX + encodeURIComponent(invoiceId),
      method: 'get'
    });
    apiCalls++;

    const detail = detailResponse.data;
    if (!detail || typeof detail !== 'object' || Array.isArray(detail)) {
      byTransaction[comparable] = {
        status: 'BLOCKED_INVALID_INVOICE_DETAIL',
        transactionNumber: number,
        invoiceId: invoiceId
      };
      return;
    }

    const detailNumber = String(
      detail.txnNumber ||
      detail.TxnNumber ||
      detail.transactionNumber ||
      detail.TransactionNumber ||
      detail.invoiceNumber ||
      detail.InvoiceNumber ||
      ''
    ).trim();

    if (obNormalizeTransactionNumber_(detailNumber) !== comparable) {
      byTransaction[comparable] = {
        status: 'BLOCKED_INVOICE_NUMBER_MISMATCH',
        transactionNumber: number,
        invoiceId: invoiceId
      };
      return;
    }

    const salesRep = detail.salesRep || detail.SalesRep;
    const salesRepId = salesRep && String(salesRep.id || salesRep.Id || '').trim();
    const salesRepName = salesRep && String(salesRep.name || salesRep.Name || '').trim();

    if (!salesRepId || !/^\d+$/.test(salesRepId) || !salesRepName) {
      byTransaction[comparable] = {
        status: 'BLOCKED_INVOICE_SALES_REP_MISSING',
        transactionNumber: number,
        invoiceId: invoiceId
      };
      return;
    }

    byTransaction[comparable] = {
      status: 'VERIFIED',
      transactionNumber: number,
      invoiceId: invoiceId,
      salesRepId: salesRepId,
      salesRepName: salesRepName
    };
  });

  return {
    byTransaction: byTransaction,
    targetCount: targetNumbers.length,
    pagesFetched: pagesFetched,
    apiCalls: apiCalls
  };
}

function obExtractInvoiceSearchPage_(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invoice search returned an unsupported payload.');
  }

  const records = Array.isArray(payload)
    ? payload
    : (
        Array.isArray(payload.data)
          ? payload.data
          : (
              Array.isArray(payload.results)
                ? payload.results
                : (
                    Array.isArray(payload.items)
                      ? payload.items
                      : []
                  )
            )
      );

  const totalCount = Number(
    payload.totalCount ||
    payload.TotalCount ||
    payload.totalRecords ||
    payload.TotalRecords ||
    payload.count ||
    0
  );
  const pageIndex = Number(payload.pageIndex || payload.PageIndex || 0);
  const pageSize = Number(
    payload.pageSize ||
    payload.PageSize ||
    OB.DIRECT_API.SEARCH_PAGE_SIZE
  );

  return {
    records: records,
    isLastPage: totalCount > 0 && pageSize > 0
      ? ((pageIndex + 1) * pageSize >= totalCount)
      : records.length < pageSize
  };
}

function obStrivenApiRequest_(request, retrying) {
  request = request || {};
  const path = String(request.path || '');
  if (!/^\/v1\//.test(path)) {
    throw new Error('Refusing unapproved Striven API path: ' + path);
  }

  const token = obGetStrivenAccessToken_(!!retrying);
  Utilities.sleep(OB.DIRECT_API.API_BRAKE_MS);

  const options = {
    method: String(request.method || 'get').toLowerCase(),
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/json'
    },
    muteHttpExceptions: true
  };

  if (request.payload !== undefined) {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(request.payload);
  }

  const response = UrlFetchApp.fetch(OB.DIRECT_API.BASE_URL + path, options);
  const status = response.getResponseCode();
  const text = response.getContentText();

  if (status === 401 && !retrying) {
    obClearStrivenTokenCache_();
    return obStrivenApiRequest_(request, true);
  }

  if (status < 200 || status >= 300) {
    throw new Error(
      'Striven API HTTP ' + status + ' for ' + path +
      ': ' + String(text || '').slice(0, 500)
    );
  }

  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (err) {
      throw new Error('Striven API returned non-JSON content for ' + path + '.');
    }
  }

  return { statusCode: status, data: data };
}

function obGetStrivenAccessToken_(forceRefresh) {
  const props = PropertiesService.getScriptProperties();
  const tokenKey = 'OB_STRIVEN_ACCESS_TOKEN';
  const expiryKey = 'OB_STRIVEN_ACCESS_TOKEN_EXPIRES_AT_MS';
  const now = Date.now();

  if (!forceRefresh) {
    const cached = String(props.getProperty(tokenKey) || '');
    const expiry = Number(props.getProperty(expiryKey) || 0);
    if (cached && expiry > now + 5 * 60 * 1000) return cached;
  }

  const clientId = String(
    props.getProperty('CLIENT_ID') ||
    props.getProperty('STRIVEN_CLIENT_ID') ||
    ''
  ).trim();
  const clientSecret = String(
    props.getProperty('CLIENT_SECRET') ||
    props.getProperty('STRIVEN_CLIENT_SECRET') ||
    ''
  ).trim();

  if (!clientId || !clientSecret) {
    throw new Error(
      'Missing Striven OAuth credentials. Expected CLIENT_ID/CLIENT_SECRET ' +
      'or STRIVEN_CLIENT_ID/STRIVEN_CLIENT_SECRET in Script Properties.'
    );
  }

  const basic = Utilities.base64Encode(clientId + ':' + clientSecret);
  const response = UrlFetchApp.fetch(OB.DIRECT_API.BASE_URL + '/accesstoken', {
    method: 'post',
    headers: {
      Authorization: 'Basic ' + basic,
      Accept: 'application/json'
    },
    payload: {
      grant_type: 'client_credentials',
      ClientId: clientId
    },
    muteHttpExceptions: true
  });

  const status = response.getResponseCode();
  const text = response.getContentText();
  if (status < 200 || status >= 300) {
    throw new Error('Striven OAuth failed HTTP ' + status + '.');
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error('Striven OAuth returned non-JSON content.');
  }

  if (!parsed || !parsed.access_token) {
    throw new Error('Striven OAuth response did not contain access_token.');
  }

  const expiresIn = Number(parsed.expires_in);
  if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new Error('Striven OAuth response did not contain a valid expires_in.');
  }

  props.setProperties({
    [tokenKey]: String(parsed.access_token),
    [expiryKey]: String(now + expiresIn * 1000)
  }, false);

  return String(parsed.access_token);
}

function obClearStrivenTokenCache_() {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty('OB_STRIVEN_ACCESS_TOKEN');
  props.deleteProperty('OB_STRIVEN_ACCESS_TOKEN_EXPIRES_AT_MS');
}

function obNormalizeTransactionNumber_(value) {
  return String(value == null ? '' : value)
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

function obCacheEmployeeProfiles_(ss, employeeIds, resolution) {
  const sheet = obRequireSheet_(ss, OB.SHEETS.EMPLOYEE_PROFILES);
  const lastRow = sheet.getLastRow();
  const existing = lastRow >= 2
    ? sheet.getRange(2, 1, lastRow - 1, 14).getValues()
    : [];

  const rowById = Object.create(null);
  const rowsByName = Object.create(null);

  existing.forEach(function(row, index) {
    const sheetRow = index + 2;
    const id = String(row[0] || '').trim();
    const name = obNorm_(row[2]);
    if (id) rowById[id] = sheetRow;
    if (name) {
      if (!rowsByName[name]) rowsByName[name] = [];
      rowsByName[name].push(sheetRow);
    }
  });

  const repNameById = Object.create(null);
  Object.keys(resolution.byTransaction).forEach(function(key) {
    const item = resolution.byTransaction[key];
    if (item.status === 'VERIFIED') {
      repNameById[String(item.salesRepId)] = item.salesRepName;
    }
  });

  let apiCalls = 0;
  let verified = 0;
  let withoutEmail = 0;

  employeeIds.forEach(function(employeeId) {
    const id = String(employeeId || '').trim();
    if (!/^\d+$/.test(id)) return;

    const existingRowNumber = rowById[id];
    if (existingRowNumber) {
      const existingStatus = String(
        sheet.getRange(existingRowNumber, 13).getValue() || ''
      ).toUpperCase();
      if (existingStatus === 'VERIFIED') {
        verified++;
        return;
      }
    }

    const response = obStrivenApiRequest_({
      path: OB.DIRECT_API.EMPLOYEE_DETAIL_PREFIX + encodeURIComponent(id),
      method: 'get'
    });
    apiCalls++;

    const employee = response.data;
    if (!employee || typeof employee !== 'object' || Array.isArray(employee)) {
      throw new Error('Employee ' + id + ' returned an invalid profile payload.');
    }
    if (String(employee.Id || employee.id || '').trim() !== id) {
      throw new Error('Employee profile ID mismatch for ' + id + '.');
    }

    const fullName = obEmployeeFullName_(employee) || repNameById[id] || '';
    const primaryEmail = obEmployeePrimaryEmail_(employee);
    const manager = employee.Manager || employee.manager || {};
    const division = employee.Division || employee.division || {};
    const location = employee.Location || employee.location || {};
    const jobTitle = employee.JobTitle || employee.jobTitle || {};

    let targetRow = rowById[id] || 0;
    if (!targetRow && fullName) {
      const candidates = rowsByName[obNorm_(fullName)] || [];
      if (candidates.length === 1) targetRow = candidates[0];
    }
    if (!targetRow) {
      targetRow = Math.max(sheet.getLastRow() + 1, 2);
      obEnsureRows_(sheet, targetRow);
    }

    const profileStatus = primaryEmail ? 'VERIFIED' : 'VERIFIED_NO_EMAIL';
    if (!primaryEmail) withoutEmail++;

    sheet.getRange(targetRow, 1, 1, 14).setValues([[
      id,
      (employee.EmployeeNumber == null && employee.employeeNumber == null)
        ? ''
        : String(employee.EmployeeNumber == null ? employee.employeeNumber : employee.EmployeeNumber),
      fullName,
      primaryEmail,
      (employee.Status === true || employee.status === true),
      (employee.SystemUser === true || employee.systemUser === true),
      division.Name || division.name || '',
      location.Name || location.name || '',
      jobTitle.Name || jobTitle.name || '',
      manager.Id || manager.id || '',
      manager.Name || manager.name || '',
      'GET /v1/employees/' + id,
      profileStatus,
      new Date()
    ]]);

    rowById[id] = targetRow;
    if (profileStatus === 'VERIFIED') verified++;
  });

  return {
    requested: employeeIds.length,
    verified: verified,
    withoutEmail: withoutEmail,
    apiCalls: apiCalls
  };
}

function obEmployeeFullName_(employee) {
  return [
    employee.Prefix || employee.prefix,
    employee.Firstname || employee.firstname || employee.firstName,
    employee.MiddleName || employee.middleName,
    employee.Lastname || employee.lastname || employee.lastName,
    employee.Suffix || employee.suffix
  ].map(function(value) {
    return String(value || '').trim();
  }).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

function obEmployeePrimaryEmail_(employee) {
  const emails = Array.isArray(employee.Emails)
    ? employee.Emails
    : (Array.isArray(employee.emails) ? employee.emails : []);

  const usable = emails.filter(function(item) {
    return item && String(item.Email || item.email || '').trim();
  });

  const ordered = [
    usable.filter(function(item) {
      return item.Active === true && item.IsPrimary === true;
    }),
    usable.filter(function(item) {
      return item.IsPrimary === true;
    }),
    usable.filter(function(item) {
      return item.Active === true;
    }),
    usable
  ];

  for (let i = 0; i < ordered.length; i++) {
    if (ordered[i].length) {
      return String(ordered[i][0].Email || ordered[i][0].email || '').trim();
    }
  }
  return '';
}

function obFetchReport_() {
  const url = obGetReportUrl_();
  if (!url) {
    throw new Error('Open Balance report URL is not configured.');
  }
  if (!/^https:\/\/api\.striven\.com\/v2\/reports\//i.test(url)) {
    throw new Error('Stored open-balance report URL is not an expected Striven v2 report URL.');
  }

  const response = UrlFetchApp.fetch(url, {
    method: 'get',
    muteHttpExceptions: true,
    followRedirects: true,
    headers: { Accept: 'application/json' }
  });
  const status = response.getResponseCode();
  if (status < 200 || status >= 300) {
    throw new Error('Striven report HTTP ' + status + ': ' + response.getContentText().slice(0, 500));
  }

  let parsed;
  try {
    parsed = JSON.parse(response.getContentText());
  } catch (err) {
    throw new Error('Striven report did not return valid JSON.');
  }

  if (!parsed || !Array.isArray(parsed.data)) {
    throw new Error('Unexpected Striven report shape: expected an object with data[].');
  }
  if (parsed.nextPage) {
    throw new Error('Report pagination is present but not yet explicitly validated. Privacy stop instead of guessing pagination semantics.');
  }

  const rows = parsed.data;
  const fields = rows.length ? Object.keys(rows[0]) : [];
  return { rows: rows, fields: fields, totalRecords: Number(parsed.totalRecords || rows.length) };
}

function obReadControl_(ss) {
  const sheet = obRequireSheet_(ss, OB.SHEETS.CONTROL);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error('OPEN_BALANCE_CONTROL has no settings.');
  const values = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  const out = {};
  values.forEach(row => {
    const key = String(row[0] || '').trim();
    if (key) out[key] = row[1];
  });
  return out;
}

function obSetControlValue_(ss, key, value) {
  const sheet = obRequireSheet_(ss, OB.SHEETS.CONTROL);
  const lastRow = sheet.getLastRow();
  const keys = sheet.getRange(1, 1, Math.max(lastRow, 1), 1).getValues().flat();
  const index = keys.findIndex(v => String(v || '').trim() === key);
  if (index < 0) throw new Error('Control setting not found: ' + key);
  sheet.getRange(index + 1, 2).setValue(value);
}

function obReadRepConfig_(ss, readyOnly) {
  const sheet = obRequireSheet_(ss, OB.SHEETS.REPS);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, 8).getValues();
  const reps = [];
  values.forEach((row, idx) => {
    const enabled = row[0] === true;
    if (!enabled) return;
    const status = String(row[6] || '').trim().toUpperCase();
    if (readyOnly && status !== 'READY') return;

    const rep = {
      rowNumber: idx + 2,
      key: String(row[1] || '').trim(),
      name: String(row[2] || '').trim(),
      email: String(row[3] || '').trim(),
      sourceOwnerValue: String(row[4] || '').trim(),
      status: status,
      notes: String(row[7] || '').trim()
    };

    if (!rep.key || !rep.name || !rep.email || !rep.sourceOwnerValue) {
      throw new Error('Enabled rep config row ' + rep.rowNumber + ' is incomplete.');
    }
    obValidateSingleEmail_(rep.email);
    reps.push(rep);
  });
  return reps;
}

function obBuildRepMap_(reps) {
  const map = {};
  const repKeys = new Set();
  const emails = new Set();

  reps.forEach(rep => {
    const ownerKey = obNorm_(rep.sourceOwnerValue);
    if (!ownerKey) throw new Error('Blank Source Owner Value for rep ' + rep.name + '.');
    if (map[ownerKey]) throw new Error('Duplicate Source Owner Value in rep config: ' + rep.sourceOwnerValue);
    if (repKeys.has(obNorm_(rep.key))) throw new Error('Duplicate Rep Key in rep config: ' + rep.key);
    if (emails.has(rep.email.toLowerCase())) throw new Error('Duplicate production recipient email in rep config: ' + rep.email);
    map[ownerKey] = rep;
    repKeys.add(obNorm_(rep.key));
    emails.add(rep.email.toLowerCase());
  });

  return map;
}

function obRouteRows_(sourceRows, ownerField, repByOwner, runId) {
  const groups = {};
  const stagingRows = [];
  const exceptions = [];
  let routedCount = 0;
  const fetchedAt = new Date();

  sourceRows.forEach(row => {
    const ownerRaw = row[ownerField];
    const ownerNormalized = obNorm_(ownerRaw);
    const rep = ownerNormalized ? repByOwner[ownerNormalized] : null;
    const hash = obHash_(JSON.stringify(row));

    if (!ownerNormalized) {
      exceptions.push(obExceptionRow_(runId, row, 'MISSING_OWNER', 'Owner field ' + ownerField + ' is blank.'));
      stagingRows.push(obStagingRow_(runId, fetchedAt, '', row, 'BLOCKED_MISSING_OWNER', hash));
      return;
    }
    if (!rep) {
      exceptions.push(obExceptionRow_(runId, row, 'OWNER_NOT_CONFIGURED', 'No enabled READY rep config matches owner value: ' + ownerRaw));
      stagingRows.push(obStagingRow_(runId, fetchedAt, '', row, 'BLOCKED_OWNER_NOT_CONFIGURED', hash));
      return;
    }

    if (!groups[rep.key]) groups[rep.key] = { rep: rep, rows: [] };
    groups[rep.key].rows.push(row);
    stagingRows.push(obStagingRow_(runId, fetchedAt, rep.key, row, 'ROUTED', hash));
    routedCount++;
  });

  return { groups: groups, stagingRows: stagingRows, exceptions: exceptions, routedCount: routedCount };
}

function obAssertGroupIsolation_(rep, rows, ownerField) {
  if (!rows.length) throw new Error('Refusing to send empty group for ' + rep.name + '.');
  const expected = obNorm_(rep.sourceOwnerValue);
  for (const row of rows) {
    const actual = obNorm_(row[ownerField]);
    if (actual !== expected) {
      throw new Error('Privacy invariant failed for ' + rep.name + ': row owner ' + row[ownerField] + ' does not equal configured owner ' + rep.sourceOwnerValue + '.');
    }
  }
}

function obReplaceStaging_(ss, rows) {
  const sheet = obRequireSheet_(ss, OB.SHEETS.DATA);
  const maxRows = sheet.getMaxRows();
  if (maxRows > 1) sheet.getRange(2, 1, maxRows - 1, 15).clearContent();
  if (!rows.length) return;
  obEnsureRows_(sheet, rows.length + 1);
  sheet.getRange(2, 1, rows.length, 15).setValues(rows);
}

function obAppendException_(ss, row) {
  const sheet = obRequireSheet_(ss, OB.SHEETS.EXCEPTIONS);
  sheet.appendRow(row);
}

function obAppendSendLog_(ss, row) {
  const sheet = obRequireSheet_(ss, OB.SHEETS.SEND_LOG);
  sheet.appendRow(row);
}

function obStagingRow_(runId, fetchedAt, repKey, row, routingStatus, hash) {
  return [
    runId,
    fetchedAt,
    repKey,
    row.CustomerNumber == null ? '' : String(row.CustomerNumber),
    row.CustomerName == null ? '' : String(row.CustomerName),
    row.TransactionType == null ? '' : String(row.TransactionType),
    row.TransactionNumber == null ? '' : String(row.TransactionNumber),
    obToNumber_(row.TransactionAmount),
    row.TransactionDate == null ? '' : String(row.TransactionDate),
    obToNumber_(row.OpenBalance),
    row.CreatedBy == null ? '' : String(row.CreatedBy),
    row.CreatedOn == null ? '' : String(row.CreatedOn),
    row.TransactionMemo == null ? '' : String(row.TransactionMemo),
    routingStatus,
    hash
  ];
}

function obExceptionRow_(runId, row, reason, details) {
  return [
    runId,
    new Date(),
    reason,
    row.CustomerNumber == null ? '' : String(row.CustomerNumber),
    row.CustomerName == null ? '' : String(row.CustomerName),
    row.TransactionType == null ? '' : String(row.TransactionType),
    row.TransactionNumber == null ? '' : String(row.TransactionNumber),
    row.CreatedBy == null ? '' : String(row.CreatedBy),
    obToNumber_(row.OpenBalance),
    details,
    'BLOCKED'
  ];
}

function obBuildEmailHtml_(rep, rows, total, mode, timezone) {
  const now = Utilities.formatDate(new Date(), String(timezone), 'yyyy-MM-dd h:mm a z');
  const sorted = rows.slice().sort((a, b) => {
    const an = String(a.CustomerName || '').toLowerCase();
    const bn = String(b.CustomerName || '').toLowerCase();
    if (an !== bn) return an.localeCompare(bn);
    return String(a.TransactionDate || '').localeCompare(String(b.TransactionDate || ''));
  });

  const banner = mode === 'TEST'
    ? '<div style="padding:10px 12px;background:#f2f2f2;border:1px solid #d7d7d7;margin-bottom:16px;"><strong>TEST MODE</strong> — Intended for ' + obHtml_(rep.name) + '. This message was sent only to the configured admin test recipient.</div>'
    : '';

  const bodyRows = sorted.map(row => '<tr>' +
    '<td>' + obHtml_(row.CustomerNumber) + '</td>' +
    '<td>' + obHtml_(row.CustomerName) + '</td>' +
    '<td>' + obHtml_(row.TransactionType) + '</td>' +
    '<td>' + obHtml_(row.TransactionNumber) + '</td>' +
    '<td>' + obHtml_(row.TransactionDate) + '</td>' +
    '<td style="text-align:right;white-space:nowrap;">' + obMoney_(row.TransactionAmount) + '</td>' +
    '<td style="text-align:right;white-space:nowrap;font-weight:600;">' + obMoney_(row.OpenBalance) + '</td>' +
    '<td>' + obHtml_(row.TransactionMemo) + '</td>' +
  '</tr>').join('');

  return '<div style="font-family:Arial,sans-serif;color:#222;line-height:1.4;">' +
    banner +
    '<h2 style="margin:0 0 6px;">Open Balance Report</h2>' +
    '<div style="margin-bottom:14px;"><strong>Sales Rep:</strong> ' + obHtml_(rep.name) + '<br>' +
    '<strong>Generated:</strong> ' + obHtml_(now) + '<br>' +
    '<strong>Rows:</strong> ' + rows.length + '<br>' +
    '<strong>Total Open Balance:</strong> ' + obMoney_(total) + '</div>' +
    '<table style="border-collapse:collapse;width:100%;font-size:12px;">' +
      '<thead><tr>' +
        '<th style="border:1px solid #ddd;padding:6px;text-align:left;">Customer #</th>' +
        '<th style="border:1px solid #ddd;padding:6px;text-align:left;">Customer</th>' +
        '<th style="border:1px solid #ddd;padding:6px;text-align:left;">Type</th>' +
        '<th style="border:1px solid #ddd;padding:6px;text-align:left;">Transaction #</th>' +
        '<th style="border:1px solid #ddd;padding:6px;text-align:left;">Date</th>' +
        '<th style="border:1px solid #ddd;padding:6px;text-align:right;">Amount</th>' +
        '<th style="border:1px solid #ddd;padding:6px;text-align:right;">Open Balance</th>' +
        '<th style="border:1px solid #ddd;padding:6px;text-align:left;">Memo</th>' +
      '</tr></thead>' +
      '<tbody>' + bodyRows + '</tbody>' +
    '</table>' +
    '<p style="margin-top:16px;color:#666;font-size:11px;">This report is automatically generated from the Striven Central Data Hub. It contains only rows assigned to the named sales rep by the configured authoritative owner field.</p>' +
  '</div>';
}

function obBuildEmailText_(rep, rows, total, mode, timezone) {
  const now = Utilities.formatDate(new Date(), String(timezone), 'yyyy-MM-dd h:mm a z');
  const prefix = mode === 'TEST' ? 'TEST MODE — Intended for ' + rep.name + '\n\n' : '';
  const lines = rows.map(row => [
    row.CustomerNumber || '', row.CustomerName || '', row.TransactionType || '',
    row.TransactionNumber || '', row.TransactionDate || '',
    obMoney_(row.TransactionAmount), obMoney_(row.OpenBalance), row.TransactionMemo || ''
  ].join(' | '));

  return prefix +
    'Open Balance Report\n' +
    'Sales Rep: ' + rep.name + '\n' +
    'Generated: ' + now + '\n' +
    'Rows: ' + rows.length + '\n' +
    'Total Open Balance: ' + obMoney_(total) + '\n\n' +
    lines.join('\n');
}

function obCheckConfigurationReadiness_(ss, control) {
  if (control.OWNER_FIELD_PRESENT !== true) return { ready: false, reason: 'OWNER_FIELD_PRESENT is FALSE.' };
  const reps = obReadRepConfig_(ss, true);
  if (!reps.length) return { ready: false, reason: 'No enabled READY reps are configured.' };
  obBuildRepMap_(reps);
  if (!obGetReportUrl_()) {
    return { ready: false, reason: 'Striven report URL is missing.' };
  }
  return { ready: true };
}

function obDeleteDistributionTriggers_() {
  let count = 0;
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === OB.TRIGGER_FUNCTION) {
      ScriptApp.deleteTrigger(trigger);
      count++;
    }
  });
  return count;
}

function obDeleteRefreshTriggers_() {
  let count = 0;
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === OB.REFRESH_TRIGGER_FUNCTION) {
      ScriptApp.deleteTrigger(trigger);
      count++;
    }
  });
  return count;
}

function obGetReportUrl_() {
  const scriptValue = String(
    PropertiesService.getScriptProperties().getProperty(OB.REPORT_URL_PROPERTY) || ''
  ).trim();
  if (scriptValue) return scriptValue;

  const ss = SpreadsheetApp.openById(OB.SPREADSHEET_ID);
  const sh = ss.getSheetByName(OB.PRIVATE_CONFIG_SHEET);
  if (!sh || sh.getLastRow() < 2) return '';

  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
  for (const row of rows) {
    if (String(row[0] || '').trim() === OB.REPORT_URL_PROPERTY) {
      return String(row[1] || '').trim();
    }
  }
  return '';
}

function obWriteRawSnapshot_(ss, rows, ownerField) {
  const fetchedAt = new Date();
  const runId = 'REFRESH-' + Utilities.formatDate(
    fetchedAt,
    Session.getScriptTimeZone() || 'America/Toronto',
    'yyyyMMdd-HHmmss'
  );

  const stagingRows = rows.map(row => obStagingRow_(
    runId,
    fetchedAt,
    '',
    row,
    ownerField ? 'REFRESHED_PENDING_ROUTING' : 'REFRESHED_PENDING_OWNER_FIELD',
    obHash_(JSON.stringify(row))
  ));

  obReplaceStaging_(ss, stagingRows);
}

function obRecordRefresh_(ss, rowCount, status) {
  obSetControlValue_(ss, 'LAST_REFRESH_AT', new Date());
  obSetControlValue_(ss, 'LAST_REFRESH_ROWS', rowCount);
  obSetControlValue_(ss, 'LAST_REFRESH_STATUS', status);
}

function obFindField_(fields, requested) {
  const target = obFieldNorm_(requested);
  return fields.find(f => obFieldNorm_(f) === target) || null;
}

function obFieldNorm_(value) {
  return String(value == null ? '' : value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function obNorm_(value) {
  return String(value == null ? '' : value).trim().replace(/\s+/g, ' ').toLowerCase();
}

function obToNumber_(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function obHash_(text) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text), Utilities.Charset.UTF_8);
  return Utilities.base64EncodeWebSafe(digest).replace(/=+$/g, '');
}

function obValidateSingleEmail_(value) {
  const email = String(value || '').trim();
  if (!email) throw new Error('Email is required.');
  if (/[;,\s].*@|[,;]/.test(email) || !/^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/.test(email)) {
    throw new Error('Exactly one valid email address is required: ' + email);
  }
  return email;
}

function obRequireSheet_(ss, name) {
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error('Required sheet not found: ' + name);
  return sheet;
}

function obEnsureRows_(sheet, requiredRows) {
  const current = sheet.getMaxRows();
  if (requiredRows > current) sheet.insertRowsAfter(current, requiredRows - current);
}

function obMoney_(value) {
  const n = obToNumber_(value);
  return n.toLocaleString('en-CA', { style: 'currency', currency: OB.CURRENCY });
}

function obHtml_(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
