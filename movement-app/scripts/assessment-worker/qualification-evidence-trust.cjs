'use strict';
// Reviewed public identity. Rotation requires a source diff; no runtime overrides.
const crypto=require('node:crypto');
const PUBLIC_PEM='-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAcYWxHYOyBz21Z1mdST5qlJCC0gb60lsCB3bmfeS3LPA=\n-----END PUBLIC KEY-----\n';
const FINGERPRINT='13228a92e18fb61153185a048c4edb496cdee1b83d1e894f8f216568211f0fa9';
const fingerprint=key=>crypto.createHash('sha256').update(key.export({type:'spki',format:'der'})).digest('hex');
let publicKey;
try{
 publicKey=crypto.createPublicKey(PUBLIC_PEM);
 if(publicKey.asymmetricKeyType!=='ed25519'||fingerprint(publicKey)!==FINGERPRINT)throw Error();
}catch{throw Error('Reviewed evidence identity unavailable');}
function assertSigningKey(privateKey){
 try{if(privateKey.asymmetricKeyType!=='ed25519'||fingerprint(crypto.createPublicKey(privateKey))!==FINGERPRINT)throw Error();}
 catch{throw Error('Operator evidence unavailable');}
}
function verifySignature(payload,signature){return crypto.verify(null,payload,publicKey,signature);}
module.exports=Object.freeze({FINGERPRINT,assertSigningKey,verifySignature});
