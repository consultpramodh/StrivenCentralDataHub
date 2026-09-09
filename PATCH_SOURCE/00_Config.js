/**
 * STRIVEN CENTRAL DATA HUB
 * 00_Config
 * Version: R1 — 2026-09-09
 *
 * Configuration only. No credentials are stored here.
 */

const HUB_VERSION = 'R1';
const HUB_MARKER = 'STRIVEN_CENTRAL_DATA_HUB_R1_20260909';

const HUB_SHEETS = Object.freeze({
  CONTROL: '00_CONTROL',
  PROJECTS: 'PROJECT_REGISTRY',
  REPORTS: 'REPORT_REGISTRY',
  API_AUDIT: 'API_DEPENDENCY_AUDIT',
  LOCAL_DATA: 'LOCAL_DATASET_INVENTORY',
  DATASETS: 'DATASET_REGISTRY',
  REFRESH: 'REFRESH_CONTROL',
  MIGRATION: 'MIGRATION_CONTROL',
  API_USAGE: 'API_USAGE_LOG',
  SYSTEM_LOG: 'SYSTEM_LOG'
});

const HUB_DATA_TABS = Object.freeze([
  'DATA_CUSTOMERS',
  'DATA_CONTACTS',
  'DATA_LOCATIONS',
  'DATA_ITEMS',
  'DATA_INVENTORY',
  'DATA_ASSETS',
  'DATA_CUSTOMER_ASSETS',
  'DATA_TASKS',
  'DATA_WORK_ORDERS',
  'DATA_SALES_ORDERS',
  'DATA_SO_DETAILS',
  'DATA_TRANSACTIONS'
]);

const HUB_HEADERS = Object.freeze({
  '00_CONTROL': ['Key','Value'],
  'PROJECT_REGISTRY': [
    'Enabled','Project Key','Project Name','Spreadsheet ID','Spreadsheet URL',
    'Apps Script Script ID','Connection Status','Last Inventory Scan','Code Files',
    'API References','Custom Reports','Direct Reads','Writes','Migration Status','Notes'
  ],
  'REPORT_REGISTRY': [
    'Enabled','Report Key','Dataset Key','Source Project','Source File','Function',
    'Report Name/Label','Report ID / Endpoint','HTTP Method','Classification',
    'Current Trigger/Frequency','Observed Calls 30d','Central Action','Target Data Sheet',
    'Proposed Frequency','Business Hours','Last Refresh','Next Due','Status','Notes'
  ],
  'API_DEPENDENCY_AUDIT': [
    'Project','Spreadsheet ID','Script ID','Source File','Function','Line',
    'Reference Type','HTTP Method','Endpoint / Report ID','Dataset Guess',
    'Classification','Recommended Action','Source Snippet (redacted)','Scan Time','Status'
  ],
  'LOCAL_DATASET_INVENTORY': [
    'Project','Sheet Tab','Rows','Columns','Dataset Guess','Initial Assessment','Evidence / Notes'
  ],
  'DATASET_REGISTRY': [
    'Dataset Key','Target Sheet','Purpose','Initial Refresh Policy','Suggested Times',
    'Fallback Rule','Status'
  ],
  'REFRESH_CONTROL': [
    'Enabled','Dataset Key','Target Sheet','Refresh Mode','Interval Minutes',
    'Business Start','Business End','Stagger Minute','Last Attempt','Last Success',
    'Rows','API Calls','Duration Sec','Status','Error'
  ],
  'MIGRATION_CONTROL': [
    'Project','Old Local Tab / Function','Dataset Key','Central Target','Stage',
    'Validation Method','Row Count Match','Key Match','Freshness Match','Cutover Date',
    'Rollback Ready','Owner','Notes'
  ],
  'API_USAGE_LOG': [
    'Timestamp','Run ID','Dataset Key','Report / Endpoint','HTTP Method','Pages / Calls',
    'Rows Returned','Duration Sec','Result','Error','Caller'
  ],
  'SYSTEM_LOG': ['Timestamp','Level','Area','Project/Dataset','Message','Details']
});

const HUB_DEFAULT_PROJECTS = Object.freeze([
  {key:'ASSETS',name:'Assets',spreadsheetId:'1GB132DK6V0kJfB89QIx4d_gdnsIxuD9h0gvWxE50XiY',spreadsheetUrl:'https://docs.google.com/spreadsheets/d/1GB132DK6V0kJfB89QIx4d_gdnsIxuD9h0gvWxE50XiY/edit',scriptId:'17PlueQZOf6Oou_o5sH9bvqWdKuCLjYhjvY7Zw492Ft8CWMM9TvRu2-x8'},
  {key:'PRICE_UPDATE',name:'CF Price Update - Mastersheet - Feb 2026',spreadsheetId:'12yGJYyTYW9DRPA53MG7vQJWAK6moFjlQZXu17pfxgCs',spreadsheetUrl:'https://docs.google.com/spreadsheets/d/12yGJYyTYW9DRPA53MG7vQJWAK6moFjlQZXu17pfxgCs/edit',scriptId:'1kVwKBKX8DXCmjBXs4vjIRuyMD2lwMejAZEuVjvK6Yi6YRNCmqFlP9UhG'},
  {key:'CF_INSTALLS',name:'CF Installs',spreadsheetId:'1WdDufz3A0p12Vg-_0ypYbFFNGPQZB5ra4aJcS8ACWlU',spreadsheetUrl:'https://docs.google.com/spreadsheets/d/1WdDufz3A0p12Vg-_0ypYbFFNGPQZB5ra4aJcS8ACWlU/edit',scriptId:'1E86mhD2dZcOFpqWnCvoIpwEkwZ0MA63MgM8DifV6WyB2FvVQkRWKIZ_m'},
  {key:'ENTERNEWPART',name:'ENTERNEWPART',spreadsheetId:'123UZI5PmARY_2F57ABckpGBjiKVwCg4uE-QSoQCO2bU',spreadsheetUrl:'https://docs.google.com/spreadsheets/d/123UZI5PmARY_2F57ABckpGBjiKVwCg4uE-QSoQCO2bU/edit',scriptId:'1VbXsIFdiO_2Uo2wW_K6Dc64EFkp0x4POzs8yOuL-GjaaeeSOJy-iprPj'},
  {key:'SHOPIFY_STRIVEN',name:'Shopify/Striven SYNC',spreadsheetId:'1U7dhJmUDUStamzy9qE7keWNlgmlDM-7wBxxsLPgkibU',spreadsheetUrl:'https://docs.google.com/spreadsheets/d/1U7dhJmUDUStamzy9qE7keWNlgmlDM-7wBxxsLPgkibU/edit',scriptId:'1MyiyvDaje6zAQgZcnPXLoDiGZoxSbs9Uq6eZC5VUIwnjIDsULgOuCAXa'},
  {key:'COMMISSIONS',name:'Employee Commission Report',spreadsheetId:'1lYl1JfJDtywCPJtC33UDCNQIxrUhOwL76AUn_tnyPTs',spreadsheetUrl:'https://docs.google.com/spreadsheets/d/1lYl1JfJDtywCPJtC33UDCNQIxrUhOwL76AUn_tnyPTs/edit',scriptId:'1OY40FroButRetp8Qj-FrFKeJwKW_Lg8Zua9ARLECdMaIkyHIxPGzpVOs'},
  {key:'CF_SERVICE',name:'CF Service - July 2026',spreadsheetId:'1m4cIZAkDMrN1lfm_Pash636xSIb4xS_TAKTfU73QsZs',spreadsheetUrl:'https://docs.google.com/spreadsheets/d/1m4cIZAkDMrN1lfm_Pash636xSIb4xS_TAKTfU73QsZs/edit',scriptId:'1QZp4NAFeA8LmWBN31ylJYdK4XFepBX1h2lP_APaR-d1lTAC-d8LA9x3g'},
  {key:'TRAEGER_INV',name:'Traeger Inventory',spreadsheetId:'1nwJE5uXWoiNQ0a2m49-axf25gSFECSWO9dQTcqmFJXk',spreadsheetUrl:'https://docs.google.com/spreadsheets/d/1nwJE5uXWoiNQ0a2m49-axf25gSFECSWO9dQTcqmFJXk/edit',scriptId:'1OUDzVUrWkH4nKZIL-XT44d1SJwbMkDPZdPzKHwop-CnX2b9DdcthcSeR'}
]);

const HUB_DEFAULT_DATASETS = Object.freeze([
  ['CUSTOMERS','DATA_CUSTOMERS','Customer master','2x/day','07:00, 15:00','Targeted lookup on cache miss','PENDING_SOURCE_AUDIT'],
  ['CONTACTS','DATA_CONTACTS','Customer contacts','2x/day','07:10, 15:10','Targeted lookup on cache miss','PENDING_SOURCE_AUDIT'],
  ['LOCATIONS','DATA_LOCATIONS','Customer locations','2x/day','07:20, 15:20','Targeted lookup on cache miss','PENDING_SOURCE_AUDIT'],
  ['ITEMS','DATA_ITEMS','Item master','3x/day','07:30, 12:30, 17:30','Targeted item lookup allowed','PENDING_SOURCE_AUDIT'],
  ['INVENTORY','DATA_INVENTORY','Inventory','Every 3 hours','08:00-17:00','Stagger from Items','PENDING_SOURCE_AUDIT'],
  ['ASSETS','DATA_ASSETS','Assets','2x/day','08:15, 16:15','Targeted lookup on cache miss','PENDING_SOURCE_AUDIT'],
  ['CUSTOMER_ASSETS','DATA_CUSTOMER_ASSETS','Customer asset relationships','2x/day','08:25, 16:25','Targeted lookup on cache miss','PENDING_SOURCE_AUDIT'],
  ['TASKS','DATA_TASKS','Tasks across divisions','Every 2 hours','08:30-18:30','Operational dataset','PENDING_SOURCE_AUDIT'],
  ['WORK_ORDERS','DATA_WORK_ORDERS','Service work orders','Every 2 hours','08:40-18:40','Operational dataset','PENDING_SOURCE_AUDIT'],
  ['SALES_ORDERS','DATA_SALES_ORDERS','Sales orders','Every 2 hours','08:50-18:50','Operational dataset','PENDING_SOURCE_AUDIT'],
  ['SO_DETAILS','DATA_SO_DETAILS','Sales-order details','Every 2 hours','09:00-19:00','Only if required','PENDING_SOURCE_AUDIT'],
  ['TRANSACTIONS','DATA_TRANSACTIONS','Transactions / commission source','Daily','06:45','Increase only if proven necessary','PENDING_SOURCE_AUDIT']
]);

const HUB_SCRIPT_API_BASE = 'https://script.googleapis.com/v1/projects/';
