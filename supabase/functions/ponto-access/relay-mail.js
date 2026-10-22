// O remetente pertence ao serviço: não exige domínio nem senha de Gmail.
export async function sendByRelay({key,email,subject,text},request=fetch) {
  const response=await request('https://securessmtp.com/api/v1/mail/send',{
    method:'POST',headers:{'Content-Type':'application/json','x-securessmtp-api-key':key,
      'X-QCS-Site-URL':'https://leticiabeatriz.github.io/ponto-estagio/'},
    body:JSON.stringify({to:email,from:{name:'Ponto'},subject,text,sender_mode:'relay',source_plugin:'ponto-recovery'}),
    signal:AbortSignal.timeout(20000)
  });
  const result=await response.json();
  // Este serviço também responde HTTP 200 quando recusa o envio.
  if(!response.ok || result.ok!==true || result.sent!==true || result.held===true) throw new Error('Envio não aceito');
}
