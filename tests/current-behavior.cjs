#!/usr/bin/env node
// Regression characterization tests for CURRENT v2.0.1 (intentionally assert known buggy behavior).
// Run: node tests/current-behavior.cjs
// These are mocks, not live Chrome/SUBÜ/Drive integration tests.
const vm = require('node:vm');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');
async function main() {
 const events = {}, stored = {};
 function event(name) { return {addListener(fn){events[name]=fn;}}; }
 const chrome = {
   runtime:{id:'audit-extension',getManifest:()=>({oauth2:{client_id:'audit-client'}}),onInstalled:event('installed'),onStartup:event('startup'),onMessage:event('message')},
   storage:{local:{async get(def){return typeof def==='object'?{...def,...stored}:stored[def];},async set(v){Object.assign(stored,v);}},onChanged:event('storageChanged')},
   action:{async setBadgeText(){},async setBadgeBackgroundColor(){},async setTitle(){}},
   downloads:{onDeterminingFilename:event('determining'),onChanged:event('downloadChanged'),async cancel(){},async erase(){}},
   tabs:{onCreated:event('tabCreated'),onUpdated:event('tabUpdated'),async remove(){}}
 };
 const context={chrome,crypto:{randomUUID:()=>'audit-token'},console,URL,Blob,fetch:async()=>({ok:true,status:200,json:async()=>({files:[]})}),setTimeout:()=>0,clearTimeout:()=>{}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','background.js'),'utf8'),context,{filename:'background.js'});
 await new Promise(resolve=>setImmediate(resolve));
 async function msg(message){return await new Promise((resolve,reject)=>{events.message(message,{tab:{id:9}},resolve);setTimeout(()=>reject(Error('Message timed out')),4000);});}
 const armed=await msg({type:'ARM_TRANSFER',baseName:'Hafta 02 - Lecture',folderPath:'SUBU/Course',captureOnly:false});
 assert.equal(armed.ok,true);
 let filename;
 events.determining({id:77,url:'https://unrelated.example/holiday.pdf',filename:'holiday.pdf',byExtensionId:'other'},suggest=>{filename=suggest.filename;});
 let state=await msg({type:'GET_TRANSFER_STATUS',token:armed.token});
 assert.equal(filename,'SUBU/Course/Hafta 02 - Lecture.pdf');
 assert.equal(state.resolved,true);
 assert.equal(state.downloadId,77);
 console.log('CURRENT BUG REPRODUCED: unrelated download intercepted and transfer resolved at filename determination.');
 events.downloadChanged({id:77,state:{current:'interrupted'},error:{current:'NETWORK_FAILED'}});
 state=await msg({type:'GET_TRANSFER_STATUS',token:armed.token});
 assert.equal(state.resolved,true);
 assert.match(state.error,/NETWORK_FAILED/);
 console.log('CURRENT BUG REPRODUCED: interrupted download remains resolved.');
 const armed2=await msg({type:'ARM_TRANSFER',baseName:'Capture',captureOnly:true});
 events.determining({id:78,url:'https://unrelated.example/any.zip',filename:'any.zip',byExtensionId:'other'},()=>{});
 state=await msg({type:'GET_TRANSFER_STATUS',token:armed2.token});
 assert.equal(state.method,'capture');
 console.log('CURRENT BUG REPRODUCED: unrelated download claimed in capture-only mode.');
 console.log('PASS: 3/3 baseline characterization cases (documenting bugs, not validating correct behavior).');
}
main().catch(err=>{console.error(err);process.exitCode=1;});
