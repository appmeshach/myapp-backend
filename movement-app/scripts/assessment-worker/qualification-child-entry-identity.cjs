'use strict';
// Local reviewed-source identity only, never Railway execution identity.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const operator=require('./qualification-operator-evidence.cjs');
const ENTRY=path.join(__dirname,'qualification-child-entry.cjs');
const fail=()=>{throw Error('Qualification child unavailable');};
function comparable(file){const absolute=path.resolve(file);return process.platform==='win32'?path.toNamespacedPath(absolute):absolute;}
function sameLocation(a,b){return path.relative(comparable(a),comparable(b))==='';}
function identity(stat){if(stat.ino<=0n)fail();return {dev:stat.dev,ino:stat.ino};}
function sameIdentity(a,b){if(a.dev!==b.dev||a.ino!==b.ino)fail();}
function inspect(){
 const repository=operator.repositoryRoot(),resolved=fs.realpathSync(ENTRY);
 if(!sameLocation(ENTRY,resolved)||!operator.within(comparable(repository),comparable(resolved)))fail();
 const directories=[];let cursor=path.dirname(ENTRY);
 while(true){
  if(!operator.within(comparable(repository),comparable(cursor)))fail();
  const stat=fs.lstatSync(cursor,{bigint:true});if(stat.isSymbolicLink()||!stat.isDirectory())fail();
  directories.push(identity(stat));if(sameLocation(cursor,repository))break;
  const parent=path.dirname(cursor);if(sameLocation(parent,cursor))fail();cursor=parent;
 }
 const lexical=fs.lstatSync(ENTRY,{bigint:true}),canonical=fs.lstatSync(resolved,{bigint:true});
 if(lexical.isSymbolicLink()||!lexical.isFile()||canonical.isSymbolicLink()||!canonical.isFile())fail();
 sameIdentity(identity(lexical),identity(canonical));
 // Hash the opened regular file, not a separately reopened pathname. Recheck path
 // identity around the read; Node fork still requires a protected source filesystem.
 const fd=fs.openSync(ENTRY,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
 try{
  const opened=fs.fstatSync(fd,{bigint:true});if(!opened.isFile()||opened.size>256n*1024n)fail();
  sameIdentity(identity(lexical),identity(opened));
  const sha256=crypto.createHash('sha256').update(fs.readFileSync(fd)).digest('hex');
  const after=fs.fstatSync(fd,{bigint:true}),pathAfter=fs.lstatSync(ENTRY,{bigint:true});
  if(pathAfter.isSymbolicLink()||!pathAfter.isFile()||opened.size!==after.size||opened.mtimeNs!==after.mtimeNs||opened.ctimeNs!==after.ctimeNs)fail();
  sameIdentity(identity(opened),identity(after));sameIdentity(identity(opened),identity(pathAfter));
  return {file:identity(opened),directories,sha256};
 }finally{fs.closeSync(fd);}
}
// No path argument, configuration setter or execution capability is exported.
function pinFixedChildEntry(){let pinned;try{pinned=inspect();}catch{fail();}
 return Object.freeze({assertUnchanged(){try{
  const current=inspect();sameIdentity(pinned.file,current.file);
  if(current.sha256!==pinned.sha256||current.directories.length!==pinned.directories.length)fail();
  for(let i=0;i<current.directories.length;i++)sameIdentity(pinned.directories[i],current.directories[i]);
 }catch{fail();}}});
}
module.exports={pinFixedChildEntry};
