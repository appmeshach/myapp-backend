'use strict';
// The sole executable acquisition owner. Importing this file is intentionally
// inert; only the exact plain-node main module may create and enable a graph.
const fs=require('node:fs'),path=require('node:path'),repl=require('node:repl'),util=require('node:util');
const {isMainThread}=require('node:worker_threads');
const HOST_FILE=fs.realpathSync(__filename);
const unavailable=Object.freeze(Object.assign(Object.create(null),{outcome:'PRELIVE_NOT_AUTHORIZED',executableOwnerAvailable:false}));
if(require.main!==module||!isMainThread){
 module.exports=unavailable;
 // A preload of the canonical host before the intended main evaluation cannot
 // be upgraded by Node's cache. Mark that exact attempted launch failed.
 try{if(isMainThread&&process.argv[1]&&fs.realpathSync(process.argv[1])===HOST_FILE)process.exitCode=1;}catch{}
}else{
 const moduleNames=['qualification-railway-live-authorization.cjs','qualification-railway-acquisition-wrapper.cjs',
  'qualification-railway-target-identity.cjs','qualification-railway-https-adapter.cjs'];
 /** @typedef {{facade:Readonly<Record<string,unknown>>,enable:(association:object)=>void,shutdown:()=>void}} OwnerInit */
 /** @type {OwnerInit|null} */ let init=null;
 let association=null,server=null,terminalCause=null,cleanupCount=0;
 const placeholder=Object.assign(Object.create(null),{});module.exports=placeholder;
 Object.defineProperty(placeholder,'_connectAuthorizationOwner',{configurable:true,value(...args){
  if(args.length!==1||init||!args[0]||typeof args[0].enable!=='function'||typeof args[0].shutdown!=='function'||!Object.isFrozen(args[0].facade))throw Error('Railway acquisition owner unavailable');
  init=args[0];association=Object.freeze({});Reflect.deleteProperty(placeholder,'_connectAuthorizationOwner');return association;
 }});
 const exitFor=c=>c==='SIGINT'||c==='REPL_SIGINT'||c==='VM_SIGINT_INTERRUPTION'?130:c==='SIGTERM'?143:c==='EOF'||c==='REPL_CLOSE'||c==='REPL_EXIT'?0:1;
 function terminal(cause){
  if(terminalCause!==null)return;terminalCause=cause;let code=exitFor(cause);
  try{
   cleanupCount++;if(init)init.shutdown();
   try{server?.pause();}catch{}
   try{server?.close();}catch{}
  }catch{if(code===0)code=1;}
  process.exit(code);
 }
 const isNativeError=util.types.isNativeError,getOwnPropertyDescriptor=Object.getOwnPropertyDescriptor,hasOwn=Object.hasOwn;
 const writer=value=>{
  let match=false;
  if(isNativeError(value)){
   const descriptor=getOwnPropertyDescriptor(value,'code');
   match=!!descriptor&&hasOwn(descriptor,'value')&&descriptor.value==='ERR_SCRIPT_EXECUTION_INTERRUPTED';
  }
  if(match)terminal('VM_SIGINT_INTERRUPTION');
  return '[movement output hidden]';
 };
 const completer=(line,callback)=>callback(null,[[],line]);
 try{
  if(process.argv.length!==2||fs.realpathSync(process.argv[1])!==HOST_FILE||fs.realpathSync(require.main.filename)!==HOST_FILE||require.cache[HOST_FILE]!==module)throw Error();
  const resolved=moduleNames.map(name=>require.resolve('./'+name));
  if(resolved.some(file=>Object.hasOwn(require.cache,fs.realpathSync(file))))throw Error();
  const authorization=require('./qualification-railway-live-authorization.cjs');
  const linked=/** @type {OwnerInit|null} */(init),linkedAssociation=/** @type {object|null} */(association);
  if(!linked||!linkedAssociation)throw Error();
  const loaded=[module,...resolved.map(file=>require.cache[fs.realpathSync(file)])];
  if(loaded.some(value=>!value))throw Error();
  module.exports=linked.facade;
  const keys=[HOST_FILE,...resolved.map(file=>fs.realpathSync(file))];
  for(let i=0;i<loaded.length;i++){
   const key=keys[i],owned=loaded[i];if(require.cache[key]!==owned)throw Error();
   Object.defineProperty(require.cache,key,{value:owned,writable:false,configurable:false,enumerable:true});
   Object.defineProperty(owned,'exports',{value:owned.exports,writable:false,configurable:false,enumerable:true});
   Object.freeze(owned.exports);
  }
  for(let i=0;i<loaded.length;i++){
   const cacheDescriptor=Object.getOwnPropertyDescriptor(require.cache,keys[i]),exportsDescriptor=Object.getOwnPropertyDescriptor(loaded[i],'exports');
   if(cacheDescriptor.value!==loaded[i]||cacheDescriptor.writable||cacheDescriptor.configurable||exportsDescriptor.value!==loaded[i].exports||exportsDescriptor.writable||exportsDescriptor.configurable||!Object.isFrozen(loaded[i].exports))throw Error();
  }
  linked.enable(linkedAssociation);
  process.stdin.prependListener('end',()=>terminal('EOF'));
  process.stdin.prependListener('close',()=>terminal('EOF'));
  process.stdin.prependListener('error',()=>terminal('STREAM_FAILURE'));
  process.stdout.prependListener('error',()=>terminal('STREAM_FAILURE'));
  process.prependListener('SIGINT',()=>terminal('SIGINT'));
  process.prependListener('SIGTERM',()=>terminal('SIGTERM'));
  if(process.stdin.readableEnded||process.stdin.destroyed||process.stdin.closed)terminal('EOF');
  /** @type {import('node:repl').ReplOptions & {historySize:number,preview:boolean}} */
  const replOptions={prompt:'movement> ',input:process.stdin,output:process.stdout,useGlobal:false,ignoreUndefined:true,useColors:false,
   terminal:process.stdin.isTTY===true&&process.stdout.isTTY===true,historySize:0,writer,completer,breakEvalOnSigint:true,preview:false};
  server=repl.start(replOptions);
  server.removeAllListeners('SIGINT');server.prependListener('SIGINT',()=>terminal('REPL_SIGINT'));
  server.prependListener('close',()=>terminal('REPL_CLOSE'));server.prependListener('exit',()=>terminal('REPL_EXIT'));
  Reflect.deleteProperty(server.commands,'load');Reflect.deleteProperty(server.commands,'save');
  const bindFacade=()=>Object.defineProperty(server.context,'movement',{value:init.facade,writable:false,configurable:false,enumerable:true});
  bindFacade();server.prependListener('reset',bindFacade);
  if(process.stdin.readableEnded||process.stdin.destroyed||process.stdin.closed)terminal('EOF');
 }catch{terminal('BOOTSTRAP_FAILURE');}
}
