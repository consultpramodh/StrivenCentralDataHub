const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const cp = require('child_process');

const ROOT = __dirname;
const VERSION = 'R1';
const MARKER = 'STRIVEN_CENTRAL_DATA_HUB_R1_20260909';
const PATCH_SRC = path.join(ROOT, 'PATCH_SOURCE');
const SCRIPT_ID_FILE = path.join(ROOT, 'SCRIPT_ID.txt');
const CLASP_VERSION = '3.3.0';

function die(msg) { throw new Error(msg); }
function ts() { const d=new Date(),p=n=>String(n).padStart(2,'0'); return d.getFullYear()+p(d.getMonth()+1)+p(d.getDate())+'-'+p(d.getHours())+p(d.getMinutes())+p(d.getSeconds()); }
function mkdir(p){fs.mkdirSync(p,{recursive:true});}
function copyDir(src,dst){fs.cpSync(src,dst,{recursive:true});}
function writeClaspProject(dir,scriptId){mkdir(dir);mkdir(path.join(dir,'src'));fs.writeFileSync(path.join(dir,'.clasp.json'),JSON.stringify({scriptId,rootDir:'src'},null,2));}

function resolveClaspLauncher() {
  const node=process.execPath, nodeDir=path.dirname(node), direct=path.join(nodeDir,'node_modules','npm','bin','npx-cli.js');
  if(fs.existsSync(direct)) return {label:'NODE_NPX_CLI',command:node,prefix:[direct,'-y','@google/clasp@'+CLASP_VERSION]};
  const where=cp.spawnSync('where.exe',['npx.cmd'],{encoding:'utf8'});
  if(where.status===0&&where.stdout.trim()) return {label:'NPX_CMD',command:where.stdout.trim().split(/\r?\n/)[0],prefix:['-y','@google/clasp@'+CLASP_VERSION]};
  die('Could not resolve npx/clasp. Install Node.js, then run this package again.');
}

function runRaw(command,args,opts={}) {
  const pretty=[command].concat(args).map(x=>/\s/.test(x)?'"'+x+'"':x).join(' '); console.log('> '+pretty);
  const r=cp.spawnSync(command,args,{cwd:opts.cwd||ROOT,encoding:'utf8',shell:false,maxBuffer:1024*1024*40});
  if(r.stdout)process.stdout.write(r.stdout); if(r.stderr)process.stderr.write(r.stderr);
  if(r.status!==0) die('Command failed with exit code '+r.status+': '+pretty); return r;
}
function clasp(launcher,args,projectDir){const full=launcher.prefix.concat(args);if(projectDir)full.push('--project',projectDir);return runRaw(launcher.command,full);}
function sourceFiles(dir){const src=path.join(dir,'src');if(!fs.existsSync(src))return[];return fs.readdirSync(src).filter(n=>fs.statSync(path.join(src,n)).isFile()).sort((a,b)=>a.localeCompare(b));}
function shaFile(p){return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');}
function projectManifest(dir){const src=path.join(dir,'src'),m={};for(const f of sourceFiles(dir))m[f]=shaFile(path.join(src,f));return m;}
function projectSha(dir){const m=projectManifest(dir),c=Object.keys(m).sort().map(k=>k+'\n'+m[k]).join('\n');return crypto.createHash('sha256').update(c).digest('hex');}
function fullText(dir){const src=path.join(dir,'src');return sourceFiles(dir).map(f=>fs.readFileSync(path.join(src,f),'utf8')).join('\n');}

function fingerprintCentralHub(dir) {
  const text=fullText(dir),checks={hubTitle:/STRIVEN CENTRAL DATA HUB/i.test(text),inventoryFunction:/hub_inventoryAllProjects/.test(text),projectRegistry:/PROJECT_REGISTRY/.test(text),apiAudit:/API_DEPENDENCY_AUDIT/.test(text),oldApiTest:/hub_testAppsScriptApiAccess/.test(text),oldBootstrap:/hub_bootstrapCentralHub/.test(text)};
  return {score:Object.values(checks).filter(Boolean).length,checks};
}

function buildWork(preDir,workDir,scriptId){mkdir(workDir);copyDir(preDir,workDir);const workSrc=path.join(workDir,'src');fs.rmSync(workSrc,{recursive:true,force:true});mkdir(workSrc);for(const f of fs.readdirSync(PATCH_SRC))fs.copyFileSync(path.join(PATCH_SRC,f),path.join(workSrc,f));fs.writeFileSync(path.join(workDir,'.clasp.json'),JSON.stringify({scriptId,rootDir:'src'},null,2));}
function syntaxCheck(workDir){const src=path.join(workDir,'src');for(const f of sourceFiles(workDir)){if(/\.js$/i.test(f))runRaw(process.execPath,['--check',path.join(src,f)]);}}

function validateWork(workDir) {
  const files=sourceFiles(workDir),expected=['00_Config.js','10_Central_Hub.js','90_Tests.js','appsscript.json'];
  if(JSON.stringify(files)!==JSON.stringify(expected))die('WORK source file set is not minimal/exact.');
  const text=fullText(workDir),tests=fs.readFileSync(path.join(workDir,'src','90_Tests.js'),'utf8');
  const testFns=[...tests.matchAll(/\bfunction\s+(test_[A-Za-z0-9_$]+)\s*\(/g)].map(m=>m[1]);
  if(testFns.length!==1||testFns[0]!=='test_HubReadyForInventory')die('90_Tests does not contain exactly one current test.');
  if(/hub_bootstrapCentralHub/.test(text))die('Deprecated bootstrap function survived into WORK.');
  if(/function\s+hub_testAppsScriptApiAccess\s*\(/.test(text))die('Deprecated old API test survived into WORK.');
  if(!text.includes(MARKER))die('WORK release marker missing.');
  return {files,onlyCurrentTest:testFns[0],marker:MARKER,sha:projectSha(workDir)};
}

function createBackupZip(preDir,outZip) {
  const parent=path.dirname(preDir),name=path.basename(preDir),tar=process.env.SystemRoot?path.join(process.env.SystemRoot,'System32','tar.exe'):'tar.exe';
  let r=cp.spawnSync(tar,['-a','-c','-f',outZip,name],{cwd:parent,encoding:'utf8',maxBuffer:1024*1024*20});
  if(r.status===0&&fs.existsSync(outZip))return;
  const ps=process.env.SystemRoot?path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe'):'powershell.exe';
  const escapedPre=preDir.replace(/'/g,"''"),escapedZip=outZip.replace(/'/g,"''");
  r=cp.spawnSync(ps,['-NoProfile','-Command',"Compress-Archive -LiteralPath '"+escapedPre+"' -DestinationPath '"+escapedZip+"' -Force"],{encoding:'utf8',maxBuffer:1024*1024*20});
  if(r.status!==0||!fs.existsSync(outZip))die('Could not create immutable PRE backup ZIP. Safe stop before push.');
}

function restorePre(launcher,preDir,scriptId,stamp) {
  console.error('\n!!! ROLLBACK STARTED !!!'); clasp(launcher,['push','--force'],preDir);
  const verify=path.join(ROOT,'ROLLBACK-VERIFY-HUB-'+VERSION+'-'+stamp);writeClaspProject(verify,scriptId);clasp(launcher,['pull'],verify);
  const expected=projectSha(preDir),actual=projectSha(verify);if(expected!==actual)die('ROLLBACK verification failed.');
  console.error('ROLLBACK VERIFIED: live source restored to exact PRE SHA.');
}

function main() {
  console.log('============================================================');
  console.log('STRIVEN CENTRAL DATA HUB R1 - AUTOMATIC UPDATE');
  console.log('============================================================');
  console.log('Pull live -> fingerprint -> PRE backup -> deterministic');
  console.log('minimal-source replacement -> syntax/static checks ->');
  console.log('freshness pull -> push -> full SHA read-back -> rollback on uncertainty.\n');

  const sid=fs.readFileSync(SCRIPT_ID_FILE,'utf8').trim();if(!sid)die('SCRIPT_ID.txt is empty.');
  const launcher=resolveClaspLauncher(),stamp=ts();

  console.log('=== 1/8 Package self-test + clasp authentication ===');
  runRaw(process.execPath,[path.join(ROOT,'SELF_TEST_HUB_R1.js')]);
  console.log('Resolved npx launcher: '+launcher.label);clasp(launcher,['--version']);clasp(launcher,['show-authorized-user','--json']);

  console.log('\n=== 2/8 Pull live Hub project READ ONLY + fingerprint ===');
  const preDir=path.join(ROOT,'PRE-HUB-'+VERSION+'-'+stamp);writeClaspProject(preDir,sid);clasp(launcher,['pull'],preDir);
  const fp=fingerprintCentralHub(preDir);console.log(JSON.stringify({fingerprintScore:fp.score,checks:fp.checks},null,2));
  if(fp.score<3)die('Target project did not fingerprint as the existing Central Hub. SAFE STOP before any push.');

  console.log('\n=== 3/8 Immutable PRE backup ===');
  const preSha=projectSha(preDir),backup=path.join(ROOT,'PRE-STRIVEN-CENTRAL-HUB-'+VERSION+'-BACKUP-'+stamp+'.zip');createBackupZip(preDir,backup);console.log('PRE full-source SHA-256: '+preSha);console.log('Created PRE backup: '+backup);

  console.log('\n=== 4/8 Build minimal WORK source + verification ===');
  const workDir=path.join(ROOT,'WORK-HUB-'+VERSION+'-'+stamp);buildWork(preDir,workDir,sid);syntaxCheck(workDir);const work=validateWork(workDir);console.log(JSON.stringify({status:'PATCHED',version:VERSION,marker:MARKER,sourceFiles:work.files,currentTest:work.onlyCurrentTest,workSha:work.sha},null,2));

  console.log('\n=== 5/8 Freshness pull immediately before push ===');
  const freshDir=path.join(ROOT,'FRESHNESS-HUB-'+VERSION+'-'+stamp);writeClaspProject(freshDir,sid);clasp(launcher,['pull'],freshDir);const freshSha=projectSha(freshDir);if(freshSha!==preSha)die('Live Hub source changed during patch preparation. SAFE STOP before push.');

  let pushed=false;
  try {
    console.log('\n=== 6/8 Push minimal WORK source ===');clasp(launcher,['push','--force'],workDir);pushed=true;
    console.log('\n=== 7/8 Full remote SHA read-back ===');const postDir=path.join(ROOT,'POST-VERIFY-HUB-'+VERSION+'-'+stamp);writeClaspProject(postDir,sid);clasp(launcher,['pull'],postDir);const postSha=projectSha(postDir);console.log('WORK SHA-256: '+work.sha);console.log('POST SHA-256: '+postSha);if(postSha!==work.sha)die('POST verification mismatch.');if(JSON.stringify(sourceFiles(postDir))!==JSON.stringify(work.files))die('POST source file set differs from WORK.');
    console.log('\n=== 8/8 VERIFIED COMPLETE ===');console.log('PASS: Central Hub R1 is patched and full remote source SHA matches WORK.');console.log('Current test: test_HubReadyForInventory');console.log('PRE backup ZIP: '+backup);
  } catch(err) {
    if(pushed){try{restorePre(launcher,preDir,sid,stamp);}catch(rollbackErr){throw new Error('Patch failed after push AND rollback verification failed. Original: '+String(err&&err.message||err)+' | Rollback: '+String(rollbackErr&&rollbackErr.message||rollbackErr));}}
    throw err;
  }
}

try{main();}catch(err){console.error('\nUPDATE FAILED / SAFE STOP');console.error(String(err&&err.stack||err));process.exit(1);}
