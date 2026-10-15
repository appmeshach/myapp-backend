'use strict';
// TEST ONLY: isolate the new authorization/wrapper private initialization cycle.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function loadAuthorizationSandbox(source,sandbox,file){
 const original=sandbox.require, authModule=sandbox.module;let wrapperModule=null,identityModule=null;
 sandbox.require=name=>{
  if(name==='./qualification-railway-target-identity.cjs'){
   if(identityModule)return identityModule.exports;
   identityModule={exports:{}};const identityFile=path.join(path.dirname(file),'qualification-railway-target-identity.cjs');
   vm.runInNewContext(fs.readFileSync(identityFile,'utf8'),{...sandbox,module:identityModule,__filename:identityFile,
    require(dep){if(dep==='./qualification-railway-live-authorization.cjs')return authModule.exports;return original(dep);}}, {filename:identityFile});
   return identityModule.exports;
  }
  if(name!=='./qualification-railway-acquisition-wrapper.cjs')return original(name);
  if(wrapperModule)return wrapperModule.exports;
  wrapperModule={exports:{}};const wrapperFile=path.join(path.dirname(file),'qualification-railway-acquisition-wrapper.cjs');
  vm.runInNewContext(fs.readFileSync(wrapperFile,'utf8'),{...sandbox,module:wrapperModule,__filename:wrapperFile,
   setTimeout(){throw Error('Unexpected human wait in preflight-only fixture');},clearTimeout(){},
   require(dep){if(dep==='./qualification-railway-live-authorization.cjs')return authModule.exports;
    if(dep==='node:perf_hooks')return require(dep);return original(dep);}},
   {filename:wrapperFile});
  return wrapperModule.exports;
 };
 vm.runInNewContext(source,sandbox,{filename:file});
}
module.exports={loadAuthorizationSandbox};
