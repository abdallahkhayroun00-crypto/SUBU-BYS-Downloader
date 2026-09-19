#!/usr/bin/env node
// Group 02 regression tests for scoped download interception and completion.
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
 const armed=await msg({type:'ARM_TRANSFER',baseName:'Hafta 02 - Lecture',folderPath:'SUBU/Course',captureOnly:false,expectedUrl:'https://ogrenci.bys.subu.edu.tr/files/lecture.pdf'});
 assert.equal(armed.ok,true);
 let unrelatedSuggestion;
 events.determining({id:77,tabId:9,url:'https://unrelated.example/holiday.pdf',filename:'holiday.pdf',byExtensionId:'other'},suggest=>{unrelatedSuggestion=suggest;});
 let state=await msg({type:'GET_TRANSFER_STATUS',token:armed.token});
 assert.equal(unrelatedSuggestion,undefined);
 assert.equal(state.resolved,false);
 console.log('PASS: unrelated origin download untouched');
 events.determining({id:78,tabId:999,url:'https://ogrenci.bys.subu.edu.tr/files/lecture.pdf',filename:'lecture.pdf'},()=>{});
 state=await msg({type:'GET_TRANSFER_STATUS',token:armed.token});
 assert.equal(state.resolved,false);
 console.log('PASS: other-tab download untouched');
 let filename;
 events.determining({id:79,tabId:9,url:'https://ogrenci.bys.subu.edu.tr/files/lecture.pdf',filename:'lecture.pdf'},suggest=>{filename=suggest.filename;});
 state=await msg({type:'GET_TRANSFER_STATUS',token:armed.token});
 assert.equal(filename,'SUBU/Course/Hafta 02 - Lecture.pdf');
 assert.equal(state.resolved,false);
 assert.equal(state.downloadId,79);
 console.log('PASS: filename determination is not completion');
 events.downloadChanged({id:79,state:{current:'interrupted'},error:{current:'NETWORK_FAILED'}});
 state=await msg({type:'GET_TRANSFER_STATUS',token:armed.token});
 assert.equal(state.resolved,false);
 assert.match(state.error,/NETWORK_FAILED/);
 console.log('PASS: interrupted transfer remains incomplete');
 await msg({type:'CLEAR_TRANSFER',token:armed.token});
 const second=await msg({type:'ARM_TRANSFER',baseName:'Lecture 2',captureOnly:false});
 events.determining({id:80,tabId:9,url:'https://ogrenci.bys.subu.edu.tr/files/lecture2.pdf',filename:'lecture2.pdf'},()=>{});
 state=await msg({type:'GET_TRANSFER_STATUS',token:second.token});
 assert.equal(state.resolved,false);
 events.downloadChanged({id:80,state:{current:'complete'}});
 state=await msg({type:'GET_TRANSFER_STATUS',token:second.token});
 assert.equal(state.resolved,true);
 console.log('PASS: matching download resolves only after complete');
 const busy=await msg({type:'ARM_TRANSFER',baseName:'Other'});
 assert.equal(busy.ok,true); // completed transfer can be replaced
 console.log('PASS: completed transfer does not block next');
 console.log('PASS: 6/6 mocked regression checks');

}
main().catch(err=>{console.error(err);process.exitCode=1;});
