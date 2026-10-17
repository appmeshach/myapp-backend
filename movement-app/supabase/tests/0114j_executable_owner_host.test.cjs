'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),cp=require('node:child_process'),path=require('node:path');
const root=path.resolve(__dirname,'../..'),host=path.join(root,'scripts/assessment-worker/qualification-railway-acquisition-owner-host.cjs');
const files=['qualification-railway-acquisition-owner-host.cjs','qualification-railway-live-authorization.cjs','qualification-railway-acquisition-wrapper.cjs','qualification-railway-target-identity.cjs','qualification-railway-https-adapter.cjs'];
function child(args=[]){return cp.spawn(process.execPath,[...args,host],{cwd:root,env:{},windowsHide:true,stdio:['pipe','pipe','pipe']});}
function capture(p){let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{p.kill();reject(Error('host timeout'));},7000);p.on('error',reject);p.on('exit',(code,signal)=>{clearTimeout(timer);resolve({code,signal,out,err});});});}
async function ready(p){let out='';return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('no prompt')),5000);p.stdout.on('data',b=>{out+=b;if(out.includes('movement> ')){clearTimeout(timer);resolve();}});p.on('exit',()=>{clearTimeout(timer);reject(Error('early exit'));});});}

test('ordinary import is inert and exposes no initialization connector',()=>{
 const script=`const h=require(${JSON.stringify(host)});if(h.executableOwnerAvailable!==false||Reflect.ownKeys(h).some(k=>String(k).startsWith('_connect')))process.exit(7)`;
 assert.equal(cp.spawnSync(process.execPath,['-e',script],{cwd:root,env:{},windowsHide:true}).status,0);
});

test('preload and alternate-main bootstrap fail closed',()=>{
 const auth=path.join(root,'scripts/assessment-worker/qualification-railway-live-authorization.cjs');
 assert.equal(cp.spawnSync(process.execPath,['-r',auth,host],{cwd:root,env:{},windowsHide:true}).status,1);
 const script=`require(${JSON.stringify(host)});setTimeout(()=>{},20)`;
 const r=cp.spawnSync(process.execPath,['-e',script],{cwd:root,env:{},windowsHide:true,encoding:'utf8'});assert.equal(r.status,0);assert.doesNotMatch(r.stdout,/movement> /);
});

test('exact host seals five cache and exports bindings before exposing movement',async()=>{
 const p=child(),done=capture(p);await ready(p);
 const expression=`console.log('SEALED',${JSON.stringify(files)}.every(f=>{const k=require.resolve('./scripts/assessment-worker/'+f),m=require.cache[k],a=Object.getOwnPropertyDescriptor(require.cache,k),b=Object.getOwnPropertyDescriptor(m,'exports');return a&&!a.writable&&!a.configurable&&b&&!b.writable&&!b.configurable&&Object.isFrozen(m.exports)}),Object.isFrozen(movement))`;
 p.stdin.write(expression+'\n.exit\n');const r=await done;assert.equal(r.code,0);assert.match(r.out,/SEALED true true/);
});

test('constant writer, preview false, empty completer and default evaluator remain active',async()=>{
 const p=child(),done=capture(p);await ready(p);p.stdin.write(`({secret:'never-render'})\nnew Error('never-render')\n.exit\n`);const r=await done;
 assert.equal(r.code,0);assert.doesNotMatch(r.out,/never-render/);assert.match(r.out,/\[movement output hidden\]/);assert.equal((r.out.match(/movement output hidden/g)||[]).length,2);
});

for(const kind of ['returned','thrown','crossContext'])test('reserved own-data native Error is terminal: '+kind,async()=>{
 const p=child(),done=capture(p);await ready(p);const source=kind==='crossContext'?`require('node:vm').runInNewContext(\"Object.assign(new Error(),{code:'ERR_SCRIPT_EXECUTION_INTERRUPTED'})\")`:
  kind==='thrown'?`(()=>{const e=new Error();Object.defineProperty(e,'code',{value:'ERR_SCRIPT_EXECUTION_INTERRUPTED'});throw e})()`:
  `(()=>{const e=new Error();Object.defineProperty(e,'code',{value:'ERR_SCRIPT_EXECUTION_INTERRUPTED'});return e})()`;
 p.stdin.write(source+'\n');const r=await done;assert.equal(r.code,130);assert.doesNotMatch(r.out,/ERR_SCRIPT_EXECUTION_INTERRUPTED/);
});

test('ordinary errors, inherited/accessor codes, proxies and custom inspection stay nonterminal without hooks',async()=>{
 const p=child(),done=capture(p);await ready(p);
 p.stdin.write(`globalThis.count=0\n`+
 `(()=>{const e=new Error('interrupted');Object.defineProperty(e,'code',{get(){count++;return 'ERR_SCRIPT_EXECUTION_INTERRUPTED'}});return e})()\n`+
 `new Proxy(new Error(),{getOwnPropertyDescriptor(){count++;return undefined}})\n`+
 `({[Symbol.for('nodejs.util.inspect.custom')](){count++;return 'secret'}})\n`+
 `console.log('HOOKS',count)\n.exit\n`);
 const r=await done;assert.equal(r.code,0);assert.match(r.out,/HOOKS 0/);assert.doesNotMatch(r.out,/secret/);
});

test('direct EOF terminates an unresolved top-level await without a reusable prompt',async()=>{
 const p=child(),done=capture(p);await ready(p);p.stdin.write(`await new Promise(()=>{})\n`);setTimeout(()=>p.stdin.end(),50);const r=await done;
 assert.equal(r.code,0);assert.equal((r.out.match(/movement> /g)||[]).length,1);
});

test('process SIGINT reaches the terminal owner once with exit 130',async()=>{
 const p=child(),done=capture(p);await ready(p);p.stdin.write(`setTimeout(()=>process.emit('SIGINT'),0)\n`);const r=await done;assert.equal(r.code,130);assert.equal(r.signal,null);
});

test('SIGTERM reaches terminal cleanup with exit 143',async()=>{
 const p=child(),done=capture(p);await ready(p);p.stdin.write(`process.emit('SIGTERM')\n`);const r=await done;assert.equal(r.code,143);assert.equal(r.signal,null);
});
