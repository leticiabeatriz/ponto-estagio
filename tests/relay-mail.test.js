import assert from 'node:assert/strict';
import {sendByRelay} from '../supabase/functions/ponto-access/relay-mail.js';
const input={key:'test-only-key',email:'fixture@example.invalid',subject:'Recuperar PIN',text:'Código de teste'};
let captured;
await sendByRelay(input,async(url,options)=>{
  captured={url,options};return Response.json({ok:true,sent:true,mode:'relay'});
});
assert.equal(captured.options.headers['x-securessmtp-api-key'],input.key);
const sent=JSON.parse(captured.options.body);
assert.equal(sent.sender_mode,'relay');assert.equal(sent.to,input.email);
assert.equal('address' in sent.from,false);assert.equal(sent.text,input.text);
for(const body of [{ok:false,sent:false,reason:'over_quota'},{ok:true,sent:true,held:true},{ok:true},{},null]) {
  await assert.rejects(()=>sendByRelay(input,async()=>Response.json(body)));
}
await assert.rejects(()=>sendByRelay(input,async()=>Response.json({ok:true,sent:true},{status:403})));
console.log('Envio com remetente do serviço: requisição e recusas verificadas, sem e-mails reais.');
