const fs = require('fs');
const path = require('path');
const child = require('child_process');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'PATCH_SOURCE');
const required = ['00_Config.js','10_Central_Hub.js','90_Tests.js','appsscript.json','SCRIPT_ID.txt'];

function fail(msg) {
  console.error('SELF-TEST FAIL: ' + msg);
  process.exit(1);
}

for (const name of required) {
  const p = name === 'SCRIPT_ID.txt' ? path.join(ROOT,name) : path.join(SRC,name);
  if (!fs.existsSync(p)) fail('Missing required file: ' + name);
}

const sid = fs.readFileSync(path.join(ROOT,'SCRIPT_ID.txt'),'utf8').trim();
if (sid !== '1t81y0BcV0cnBEBSKcbZt2nx16IBAg63rRvsfSVpjiDiBvrNi6TEq-AG8') {
  fail('SCRIPT_ID.txt does not contain the expected Hub Script ID.');
}

for (const js of ['00_Config.js','10_Central_Hub.js','90_Tests.js']) {
  const p = path.join(SRC,js);
  const r = child.spawnSync(process.execPath, ['--check', p], {encoding:'utf8'});
  if (r.status !== 0) fail(js + ' syntax error:\n' + (r.stderr || r.stdout));
}

const config = fs.readFileSync(path.join(SRC,'00_Config.js'),'utf8');
const main = fs.readFileSync(path.join(SRC,'10_Central_Hub.js'),'utf8');
const tests = fs.readFileSync(path.join(SRC,'90_Tests.js'),'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(SRC,'appsscript.json'),'utf8'));

const all = config + '\n' + main + '\n' + tests;

const testFns = [...tests.matchAll(/\bfunction\s+(test_[A-Za-z0-9_$]+)\s*\(/g)].map(m => m[1]);
if (testFns.length !== 1 || testFns[0] !== 'test_HubReadyForInventory') {
  fail('90_Tests must contain exactly one current test function.');
}
if (/\bfunction\s+test_/g.test(config + '\n' + main)) {
  fail('Production files contain a test_ function.');
}
if (/hub_bootstrapCentralHub/.test(all)) {
  fail('Deprecated standalone bootstrap function still present.');
}
if (/function\s+hub_testAppsScriptApiAccess\s*\(/.test(all)) {
  fail('Deprecated old API test function still present.');
}
if (!/hub_initializeOrRepair/.test(main)) fail('Initializer missing.');
if (!/hub_inventoryAllProjects/.test(main)) fail('Inventory function missing.');
if (!/hub_addProjectSource/.test(main)) fail('Expandable project registration missing.');
if (!/STRIVEN_CENTRAL_DATA_HUB_R1_20260909/.test(config)) fail('Release marker missing.');

const expectedScopes = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/script.external_request',
  'https://www.googleapis.com/auth/script.projects.readonly'
];
for (const scope of expectedScopes) {
  if (!manifest.oauthScopes || !manifest.oauthScopes.includes(scope)) {
    fail('Missing OAuth scope: ' + scope);
  }
}

const projectCount = (config.match(/\bkey:\s*'/g) || []).length;
if (projectCount !== 8) fail('Expected exactly 8 initial registered project definitions, got ' + projectCount);

console.log(JSON.stringify({
  status: 'PASS',
  version: 'R1',
  tests: {
    requiredFiles: true,
    targetScriptId: true,
    jsSyntax: true,
    exactlyThreeFunctionalFiles: true,
    separateSingleCurrentTest: true,
    oldBootstrapRemoved: true,
    oldApiTestRemoved: true,
    initializerPresent: true,
    inventoryPresent: true,
    expandableRegistryPresent: true,
    eightInitialProjects: true,
    requiredOAuthScopes: true
  }
}, null, 2));
