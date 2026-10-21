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
