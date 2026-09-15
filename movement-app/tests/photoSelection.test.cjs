const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function loader(stubs = {}, globals = {}) {
  const cache = new Map();
  function load(file) {
    const full=path.resolve(file); if(cache.has(full)) return cache.get(full);
    const exports={};cache.set(full,exports);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(full,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{
      exports,Error,TypeError,ArrayBuffer,Uint8Array,Blob,URL,AbortController,AbortSignal,setTimeout,clearTimeout,...globals,
      require(name){if(name in stubs)return stubs[name];if(!name.startsWith('.'))return require(name);
        const base=path.resolve(path.dirname(full),name);return load(fs.existsSync(base+'.ts')?base+'.ts':base+'.tsx');},
    });return exports;
  } return load;
}
const png = Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,0]);
const jpeg = Uint8Array.from([255,216,255,224]);
const asset = (extra={}) => ({uri:'file:///cache/photo.png',mimeType:'image/png',fileSize:png.length,type:'image',width:1,height:1,...extra});
const signal = () => new AbortController().signal;
const flush = () => new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
function adapter({result={canceled:false,assets:[asset()]},permission=true,bytes=png,fetchError,launchError,os='ios',globals={}}={}) {
  const calls=[];
  const api=loader({
    'react-native':{Platform:{OS:os}},
    'expo-image-picker':{
      requestCameraPermissionsAsync:async()=>{calls.push('permission');return {granted:permission};},
      launchCameraAsync:async options=>{calls.push(['camera',options]);if(launchError)throw launchError;return result;},
      launchImageLibraryAsync:async options=>{calls.push(['library',options]);if(launchError)throw launchError;return result;},
    },
  },{fetch:async(uri,init)=>{calls.push(['fetch',uri,init]);if(fetchError)throw fetchError;return new Response(bytes,{headers:{'Content-Type':'image/png'}});},...globals})('src/providers/expoMovementPhotoPicker.ts');
  return {api,calls};
}
test('library cancellation is harmless and requests no broad permissions',async()=>{
  const {api,calls}=adapter({result:{canceled:true,assets:null}});
  assert.equal(calls.length,0);assert.equal(await api.expoMovementPhotoPicker.pick('library',signal()),null);
  assert.equal(calls.length,1);assert.equal(calls[0][0],'library');
});
test('camera permission is requested only on action and denial is safe',async()=>{
  const {api,calls}=adapter({permission:false});assert.equal(calls.length,0);
  assert.equal((await api.expoMovementPhotoPicker.pick('camera',signal())).kind,'permission_denied');
  assert.deepEqual(calls,['permission']);
});
test('library permission rejection returns safe result without raw error',async()=>{
  const {api}=adapter({launchError:Object.assign(new Error('private/details'),{code:'ERR_USER_REJECTED_PERMISSIONS'})});
  assert.equal(JSON.stringify(await api.expoMovementPhotoPicker.pick('library',signal())),JSON.stringify({kind:'permission_denied'}));
});
test('camera returns real bytes and requests images without EXIF or base64',async()=>{
  const {api,calls}=adapter();const result=await api.expoMovementPhotoPicker.pick('camera',signal());
  assert.equal(result.kind,'selected');assert.equal(result.selected.photo.type,'image/png');
  assert.deepEqual(new Uint8Array(await result.selected.photo.arrayBuffer()),png);
  const options=calls.find(c=>c[0]==='camera')[1];assert.deepEqual(Array.from(options.mediaTypes),['images']);
  assert.equal(options.exif,false);assert.equal(options.base64,false);assert.equal(options.allowsMultipleSelection,false);
  result.selected.release();
});
for(const mime of ['image/heic','image/heif','image/gif','image/avif','image/svg+xml']) test(`unsupported ${mime} rejected before read`,async()=>{
  const {api,calls}=adapter();await assert.rejects(api.prepareSelectedPhoto(asset({mimeType:mime}),signal()),/photo_invalid/);
  assert.equal(calls.length,0);
});
test('HEIC extension with missing MIME is rejected rather than relabeled',async()=>{
  const {api}=adapter();await assert.rejects(api.prepareSelectedPhoto(asset({uri:'file:///cache/photo.heic',mimeType:null}),signal()),/photo_invalid/);
});
test('known oversize rejected before reading bytes',async()=>{
  const {api,calls}=adapter();await assert.rejects(api.prepareSelectedPhoto(asset({fileSize:5242881}),signal()),/photo_too_large/);assert.equal(calls.length,0);
});
test('actual oversize rejected even if reported size was small',async()=>{
  const {api}=adapter({bytes:new Uint8Array(5242881)});await assert.rejects(api.prepareSelectedPhoto(asset(),signal()),/photo_too_large/);
});
for(const size of [0]) test('known empty asset is rejected',async()=>{
  const {api,calls}=adapter();await assert.rejects(api.prepareSelectedPhoto(asset({fileSize:size}),signal()),/photo_invalid/);assert.equal(calls.length,0);
});
test('empty bytes and unreadable asset fail with safe category',async()=>{
  for(const options of [{bytes:new Uint8Array()},{fetchError:new Error('file:///private/internal')}]){
    const {api}=adapter(options);await assert.rejects(api.prepareSelectedPhoto(asset(),signal()),/^Error: photo_invalid$/);
  }
});
test('HEIC bytes mislabeled JPEG cannot pass signature check',async()=>{
  const {api}=adapter({bytes:Uint8Array.from([0,0,0,24,102,116,121,112,104,101,105,99])});
  await assert.rejects(api.prepareSelectedPhoto(asset({mimeType:'image/jpeg'}),signal()),/photo_invalid/);
});
test('supported extension fallback uses bytes and correct MIME even if reader returns empty MIME',async()=>{
  const {api}=adapter({globals:{fetch:async()=>new Response(jpeg)}});
  const selected=await api.prepareSelectedPhoto(asset({uri:'file:///cache/photo.jpg',mimeType:null}),signal());
  assert.equal(selected.photo.type,'image/jpeg');assert.deepEqual(new Uint8Array(await selected.photo.arrayBuffer()),jpeg);
});
test('remote and data URIs cannot become selection fetch targets',async()=>{
  const {api,calls}=adapter();for(const uri of ['https://storage.invalid/private','data:image/png;base64,secret','../private']){
    await assert.rejects(api.prepareSelectedPhoto(asset({uri}),signal()),/photo_invalid/);
  }assert.equal(calls.length,0);
});
test('web File is read without fetching and local object URL is released once',async()=>{
  const revoked=[];const {api,calls}=adapter({os:'web',globals:{URL:{revokeObjectURL:uri=>revoked.push(uri)}}});
  const selected=await api.prepareSelectedPhoto(asset({uri:'blob:local-photo',file:new Blob([png],{type:'image/png'})}),signal());
  assert.equal(calls.length,0);selected.release();selected.release();assert.deepEqual(revoked,['blob:local-photo']);
});
test('cancel after native picker resolves discards selection without reading/uploading',async()=>{
  const wait=deferred();const abort=new AbortController();
  const {api,calls}=adapter({globals:{}});
  abort.abort();assert.equal(await api.expoMovementPhotoPicker.pick('library',abort.signal),null);assert.equal(calls.length,0);
});
test('safe selection projects no library IDs or metadata',async()=>{
  const {api}=adapter();const selected=await api.prepareSelectedPhoto(asset({assetId:'private-id',exif:{secret:'private'},memberId:'private',fileName:'private'}),signal());
  assert.deepEqual(Object.keys(selected).sort(),['photo','previewUri','release']);assert(!JSON.stringify(selected).includes('private'));
});

function uiHarness(initialState) {
  const values=[];let cursor=0;const effects=[];let mounted=true;let updates=0;
  const model={state:initialState,signedIn:true,accountGeneration:1,submit:async()=>true,refresh:async()=>{}};
  const card=loader({
    react:{...require('react'),useState:v=>{const i=cursor++;if(!(i in values))values[i]=v;return [values[i],value=>{if(!mounted)throw new Error('update after unmount');updates++;values[i]=typeof value==='function'?value(values[i]):value;}];},
      useRef:v=>{const i=cursor++;if(!(i in values))values[i]={current:v};return values[i];},
      useEffect:(fn,deps)=>{const i=cursor++;if(!(i in values)){values[i]=deps;effects.push(fn);}}},
    'react-native':{View:'View',Text:'Text',Image:'Image',Pressable:'Pressable',StyleSheet:{create:v=>v}},
    '../hooks/useVerification':{useProfilePhotoVerification:()=>model},
  })('src/components/VerificationCards.tsx').ProfilePhotoVerificationCard;
  let picker;let tree;const cleanup=[];
  function render(){cursor=0;tree=card({picker});while(effects.length)cleanup.push(effects.shift()());return tree;}
  function find(element,title){if(!element||typeof element!=='object')return;if(Array.isArray(element))return element.map(e=>find(e,title)).find(Boolean);
    if(element.props?.title===title)return element;return find(element.props?.children,title);}
  function text(element){if(element==null)return '';if(typeof element==='string')return element;if(Array.isArray(element))return element.map(text).join(' ');return text(element.props?.children);}
  return {model,setPicker:p=>{picker=p;},render,press:title=>{const action=find(tree,title);assert(action,`missing ${title}`);assert(!action.props.disabled,`disabled ${title}`);action.props.onPress();},
    text:()=>text(tree),unmount:()=>{cleanup.forEach(fn=>fn?.());mounted=false;},updates:()=>updates};
}
const initial={phase:'none',loaded:true,error:null,submittedAt:null,replacementPending:false};
function selected(){let releases=0;return {kind:'selected',selected:{photo:new Blob([png],{type:'image/png'}),previewUri:'file:///cache/photo.png',release(){releases++;}},releases:()=>releases};}
test('preview requires explicit upload; verified replacement notice and double-upload protection',async()=>{
  const h=uiHarness({...initial,phase:'verified'});const choice=selected();h.setPicker({pick:async()=>choice});
  let uploads=0;const wait=deferred();h.model.submit=async photo=>{uploads++;assert.equal(photo,choice.selected.photo);return wait.promise;};
  h.render();h.press('Choose photo');await flush();h.render();
  assert.equal(uploads,0);assert(!h.text().includes('Verified photo'));assert.match(h.text(),/new live face check/);
  h.press('Replace and upload');h.press('Replace and upload');assert.equal(uploads,1);
  h.model.state={...initial,phase:'processing'};wait.resolve(true);await flush();h.render();
  assert.match(h.text(),/Preparing photo/);assert(!h.text().includes('Verified'));assert.equal(choice.releases(),1);
});
test('cancel selection releases preview without upload',async()=>{
  const h=uiHarness(initial);const choice=selected();let uploads=0;h.model.submit=async()=>{uploads++;};h.setPicker({pick:async()=>choice});
  h.render();h.press('Choose photo');await flush();h.render();h.press('Cancel selection');h.render();
  assert.equal(uploads,0);assert.equal(choice.releases(),1);assert(!h.text().includes('Review your selected'));
});
test('unmount during selection ignores and releases late draft',async()=>{
  const h=uiHarness(initial);const wait=deferred();const choice=selected();h.setPicker({pick:()=>wait.promise});
  h.render();h.press('Choose photo');h.unmount();const before=h.updates();wait.resolve(choice);await flush();
  assert.equal(h.updates(),before);assert.equal(choice.releases(),1);
});
test('network upload failure keeps draft retryable and is not verification failure',async()=>{
  const h=uiHarness(initial);const choice=selected();h.setPicker({pick:async()=>choice});h.model.submit=async()=>{throw new TypeError('private/network');};
  h.render();h.press('Choose photo');await flush();h.render();h.press('Upload photo');await flush();h.render();
  assert.match(h.text(),/Connection unavailable/);assert(!h.text().includes('private'));assert(!h.text().includes('could not be prepared'));assert.equal(choice.releases(),0);
});
test('permission denial copy is neutral and never contains underlying details',async()=>{
  const h=uiHarness(initial);h.setPicker({pick:async()=>({kind:'permission_denied'})});h.render();h.press('Take photo');await flush();h.render();
  assert.match(h.text(),/Camera permission was not granted/);assert(!h.text().includes('Verified'));
});
test('binary upload contract contains no asset or identity metadata',async()=>{
  let sent;const api=loader({'../lib/supabase':{supabase:{auth:{getSession:async()=>({data:{session:{access_token:'jwt'}}})}}}},{
    process:{env:{EXPO_PUBLIC_SUPABASE_URL:'https://project.invalid',EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'public-key'}},
    fetch:async(url,init)=>{sent={url,init};return new Response(JSON.stringify({status:'pending'}));},
  })('src/services/faceOrchestrationService.ts');
  const photo=new Blob([png],{type:'image/png'});const receipt=await api.submitMovementIdentityPhoto(photo);
  assert.equal(sent.init.body,photo);assert.equal(sent.init.headers['Content-Type'],'image/png');assert.equal(sent.init.headers.Authorization,'Bearer jwt');
  assert.deepEqual(Object.keys(sent.init.headers).sort(),['Authorization','Content-Type','apikey']);
  assert(!/member|media|storage|provider|verified/i.test(JSON.stringify(receipt)));assert.equal(receipt.status,'pending');
});
test('config adds only image picker and no microphone permission',()=>{
  const config=JSON.parse(fs.readFileSync('app.json','utf8'));const plugin=config.expo.plugins.find(p=>Array.isArray(p)&&p[0]==='expo-image-picker');
  assert.equal(plugin[1].microphonePermission,false);assert(plugin[1].cameraPermission);
  assert.match(fs.readFileSync('src/app/identity-photo.tsx','utf8'),/picker=\{expoMovementPhotoPicker\}/);
});

test('native FileReader fallback reads only the signature slice',async()=>{
  let sliced;let closed=0;
  const part={close:()=>closed++};
  const blob={size:12,type:'image/png',slice:(from,to)=>{sliced=[from,to];return part;}};
  class Reader { readAsArrayBuffer(value){assert.equal(value,part);this.result=png.buffer;this.onload();} abort(){this.onabort();} }
  const {api}=adapter({globals:{FileReader:Reader,fetch:async()=>({ok:true,blob:async()=>blob})}});
  const chosen=await api.prepareSelectedPhoto(asset(),signal());assert.equal(chosen.photo,blob);assert.deepEqual(sliced,[0,12]);assert.equal(closed,1);
});
test('cancellation while library is open discards returned asset and avoids file read',async()=>{
  const wait=deferred();const abort=new AbortController();const {api,calls}=adapter({result:wait.promise});
  const work=api.expoMovementPhotoPicker.pick('library',abort.signal);abort.abort();wait.resolve({canceled:false,assets:[asset()]});
  assert.equal(await work,null);assert.equal(calls.filter(c=>c[0]==='fetch').length,0);
});
test('unmount during upload defers release until bytes are no longer in use',async()=>{
  const h=uiHarness(initial);const choice=selected();const wait=deferred();h.setPicker({pick:async()=>choice});h.model.submit=()=>wait.promise;
  h.render();h.press('Choose photo');await flush();h.render();h.press('Upload photo');h.unmount();const before=h.updates();
  assert.equal(choice.releases(),0);wait.resolve(true);await flush();assert.equal(h.updates(),before);assert.equal(choice.releases(),1);
});
test('account change hides prior local preview before effect cleanup',async()=>{
  const h=uiHarness(initial);h.setPicker({pick:async()=>selected()});h.render();h.press('Choose photo');await flush();h.render();
  assert.match(h.text(),/Review your selected/);h.model.accountGeneration=2;h.render();assert(!h.text().includes('Review your selected'));
});
