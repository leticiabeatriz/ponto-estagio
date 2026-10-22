// Diagnóstico somente de leitura. Usa exclusivamente a chave publicável.
import {config} from '../js/config.js';
const results=[];
for (const path of ['/auth/v1/health','/auth/v1/settings','/rest/v1/ponto_profiles?select=user_id&limit=0','/rest/v1/ponto_entries?select=user_id&limit=0']) {
  try {
    const response=await fetch(config.url+path,{headers:{apikey:config.publishableKey,Accept:'application/json'},signal:AbortSignal.timeout(15000)});
    const body=await response.json().catch(()=>({}));
    const result={path,status:response.status,code:body.code||body.error_code||null};
    if(path.endsWith('/settings')&&response.ok) result.emailEnabled=body.external?.email;
    if(path.includes('/rest/'))result.tablePresent=response.ok||body.code==='42501';
    results.push(result);
  }catch(error){results.push({path,error:error.name});}
}
console.log(JSON.stringify({project:config.url,results},null,2));
if(results.some(r=>r.error||r.status>=500||r.tablePresent===false||(!r.path.includes('/rest/')&&r.status!==200)))process.exitCode=1;
// Verificação pública da função: nenhuma conta real, nenhum e-mail enviado.
for(const [payload,expected] of [
  [{action:'invite'},401],
  [{action:'login',email:`ponto-probe-${crypto.randomUUID()}@example.invalid`,pin:'9999'},401],
  [{action:'register',email:'ponto-probe@example.invalid',name:'Teste',pin:'1234',invite:'invalid'},400]
]) {
  const response=await fetch(config.url+'/functions/v1/ponto-access',{
    method:'POST',headers:{'Content-Type':'application/json',apikey:config.publishableKey},
    body:JSON.stringify(payload),signal:AbortSignal.timeout(20000)
  });
  console.log(`Acesso ${payload.action}: HTTP ${response.status}`);
  if(response.status!==expected)process.exitCode=1;
}

const assert=(await import('node:assert/strict')).default;
const fixture={"email":"ponto-e2e-c6f11b5a-8155-441e-a6bf-1c29e4a2ec3e@example.invalid","inviteEmail":"ponto-invite-e2e-c6f11b5a-8155-441e-a6bf-1c29e4a2ec3e@example.invalid","pin":"4826"};
async function request(path,body,token) {
 const response=await fetch(config.url+path,{method:body?'POST':'GET',headers:{apikey:config.publishableKey,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(25000)});
 const data=await response.json();return {status:response.status,data};
}
async function edge(body,token,status=200) {
 const r=await request('/functions/v1/ponto-access',body,token);assert.equal(r.status,status,r.data.error||'Falha na função de acesso');return r.data;
}
const logged=await edge({action:'login',email:fixture.email,pin:fixture.pin});
assert.equal(Boolean(logged.session?.access_token),true);
const ownerToken=logged.session.access_token;
const user=await request('/auth/v1/user',null,ownerToken);assert.equal(user.status,200);assert.equal(user.data.app_metadata.ponto_pin_account,true);
const entries=await request('/rest/v1/ponto_entries?select=note',null,ownerToken);assert.equal(entries.status,200);assert.equal(entries.data.length,1);
assert.equal(entries.data[0].note,'Teste temporário de integração');
await edge({action:'unlock',pin:fixture.pin},ownerToken);
const invitation=await edge({action:'invite'},ownerToken);
const registered=await edge({action:'register',email:fixture.inviteEmail,name:'Convidada temporária',pin:'2468',invite:invitation.invite});
assert.equal(Boolean(registered.session?.access_token),true);
const invitedToken=registered.session.access_token;
const isolated=await request('/rest/v1/ponto_entries?select=id',null,invitedToken);assert.equal(isolated.status,200);assert.equal(isolated.data.length,0);
const profiles=await request('/rest/v1/ponto_profiles?select=display_name,contact_email',null,invitedToken);assert.equal(profiles.status,200);assert.equal(profiles.data.length,1);assert.equal(profiles.data[0].contact_email,fixture.inviteEmail);
await edge({action:'invite-info',invite:invitation.invite},null,400);
await edge({action:'profile',name:'Convidada temporária',pin:'1357'},invitedToken);
const relogged=await edge({action:'login',email:fixture.inviteEmail,pin:'1357'});
const refreshed=await request('/auth/v1/token?grant_type=refresh_token',{refresh_token:relogged.session.refresh_token});
assert.equal(refreshed.status,200);assert.equal(Boolean(refreshed.data.access_token),true);
console.log('Integração real: PIN, transição de registros, sessões, convite, cadastro, isolamento e troca de PIN: OK.');
