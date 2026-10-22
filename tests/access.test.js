import assert from 'node:assert/strict';
import {accessService,AccessError,digest} from '../supabase/functions/ponto-access/core.js';
import {createPin,verifyPin} from '../js/pin.js';
let checks=0;
const pin=await createPin('4826');
let account={email:'test@example.com',user_id:'owner',internal_email:'internal@example.invalid',...pin};
let mails=[],sessions=0,binds=0,created=0,registered=0,limits=new Map(),validInvite=true,recoveryHash;
const storage=async(action,p)=>{
  if(action==='limit'){const n=(limits.get(p.key)||0)+1;limits.set(p.key,n);return n<=p.max;}
  if(action==='clear_limit'){limits.delete(p.key);return true;}
  if(action==='account')return ((p.email&&p.email===account?.email) || (p.user_id&&(p.user_id===account?.user_id || p.user_id===account?.legacy_user_id)))?{...account}:null;
  if(action==='bind_legacy'){binds++;account={...account,user_id:p.user_id,internal_email:p.internal_email};return account;}
  if(action==='invite_info')return validInvite?{inviter:'Letícia'}:null;
  if(action==='invite_create')return {expires_at:'2026-12-01'};
  if(action==='register'){registered++;account={...p};validInvite=false;return true;}
  if(action==='recovery_start'){recoveryHash=p.code_hash;return true;}
  if(action==='recovery_finish'){
    if(!recoveryHash||p.code_hash!==recoveryHash)return null;
    recoveryHash=null;account={...account,pin_hash:p.pin_hash,pin_salt:p.pin_salt};return account;
  }
  if(action==='profile'){account={...account,...p};return {display_name:p.name};}
  throw Error(action);
};
const auth={
  user:async token=>token==='valid'?{id:account.user_id}:token==='old'?{id:'legacy'}:null,
  create:async()=>{created++;return {id:'new',email:'new@example.invalid'};},remove:async()=>{},
  session:async()=>{sessions++;return {access_token:'access',refresh_token:'refresh'};},signOutOthers:async()=>{}
};
const service=accessService({storage,auth,mailReady:true,recoverySecret:'server-secret',mail:async(...args)=>mails.push(args)});
await assert.rejects(()=>service({action:'login',email:account.email,pin:'9999'},'', 'one'),/E-mail ou PIN/);checks++;
await service({action:'login',email:' TEST@example.com ',pin:'4826'},'','one');assert.equal(sessions,1);assert.equal(mails.length,0);checks++;
await service({action:'unlock',pin:'4826'},'valid','one');assert.equal(sessions,1);checks++;
for(let i=0;i<5;i++)await assert.rejects(()=>service({action:'login',email:account.email,pin:'9999'},'','one'),/E-mail ou PIN/);
await assert.rejects(()=>service({action:'login',email:account.email,pin:'4826'},'','one'),e=>e instanceof AccessError&&e.status===429);checks++;limits.clear();
await assert.rejects(()=>service({action:'invite'},'', 'one'),e=>e.status===401);
await assert.rejects(()=>service({action:'profile',name:'Changed'},'', 'one'),e=>e.status===401);checks++;
const invitation=await service({action:'invite'},'valid','one');assert.match(invitation.invite,/^[a-f0-9]{64}$/);checks++;
validInvite=false;
await assert.rejects(()=>service({action:'register',email:'new@example.com',name:'Bia',pin:'1234',invite:'a'.repeat(64)},'','one'),/convite/i);
assert.equal(created,0);assert.equal(registered,0);validInvite=true;checks++;
account.internal_email=null;account.legacy_user_id='legacy';
await service({action:'login',email:account.email,pin:'4826'},'','one');assert.equal(binds,1);assert.equal(account.user_id,'new');assert.equal(mails.length,0);checks++;
await service({action:'unlock',pin:'4826'},'old','one');assert.equal(sessions,3);checks++;
await service({action:'register',email:'new@example.com',name:'Bia',pin:'1234',invite:'a'.repeat(64)},'','two');
assert.equal(registered,1);assert.equal(mails.length,0);assert.equal(await verifyPin('1234',account),true);checks++;
await service({action:'recover',email:account.email},'','two');assert.equal(mails.length,1);assert.match(mails[0][1],/^\d{6}$/);checks++;
await assert.rejects(()=>service({action:'reset',email:account.email,pin:'4567',code:'xxxxxx'},'','two'),/6 dígitos/);
await service({action:'reset',email:account.email,pin:'4567',code:mails[0][1]},'','two');assert.equal(await verifyPin('4567',account),true);
await assert.rejects(()=>service({action:'reset',email:account.email,pin:'4567',code:mails[0][1]},'','two'),/Código incorreto/);checks++;
const noMail=accessService({storage,auth,mailReady:false,recoverySecret:'secret'});
await assert.rejects(()=>noMail({action:'recover',email:account.email},'','two'),e=>e.status===503);checks++;
await service({action:'recover',email:'unknown@example.com'},'','two');assert.equal(mails.length,1);checks++;
assert.equal(await digest('a'),'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb');checks++;
console.log(`${checks} verificações de convites, PIN, transição e recuperação passaram.`);
