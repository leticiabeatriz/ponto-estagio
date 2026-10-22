import {createClient} from 'npm:@supabase/supabase-js@2.118.0';
import {accessService,AccessError} from './core.js';
const url=Deno.env.get('SUPABASE_URL')!;
const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const options={auth:{autoRefreshToken:false,persistSession:false}};
const admin=createClient(url,key,options);
const resend=Deno.env.get('RESEND_API_KEY');
const sender=Deno.env.get('PONTO_SENDER_EMAIL');
// Gmail permite começar sem domínio próprio. Credenciais somente nos Secrets.
const gmailAddress=Deno.env.get('PONTO_GMAIL_ADDRESS');
const gmailAppPassword=Deno.env.get('PONTO_GMAIL_APP_PASSWORD')?.replace(/\s/g,'');
const handle=accessService({
  recoverySecret:key,
  mailReady:Boolean((gmailAddress&&gmailAppPassword)||(resend&&sender)),
  async storage(action:string,payload:Record<string,unknown>) {
    const {data,error}=await admin.rpc('ponto_auth_storage',{action,payload});
    if(error) {
      // Não devolve detalhes do banco, hashes ou tokens ao navegador.
      if(error.code==='23505') throw new AccessError('Este e-mail já foi cadastrado ou o convite já foi utilizado.');
      if(error.message?.includes('Convite inválido')) throw new AccessError('Convite inválido, vencido ou já utilizado.');
      throw new Error('storage:'+error.code);
    }
    return data;
  },
  auth:{
    async user(token:string) {
      if(!token) return null;
      const {data,error}=await admin.auth.getUser(token);
      return error ? null : data.user;
    },
    async create() {
      const email=`ponto.${crypto.randomUUID()}@accounts.ponto.invalid`;
      const {data,error}=await admin.auth.admin.createUser({email,email_confirm:true,app_metadata:{ponto_pin_account:true}});
      if(error) throw new Error('create:'+error.code);
      return data.user!;
    },
    async remove(id:string) {await admin.auth.admin.deleteUser(id);},
    async session(email:string) {
      // generateLink NÃO envia e-mail. O token interno nunca é mostrado ao usuário.
      const {data,error}=await admin.auth.admin.generateLink({type:'magiclink',email});
      if(error) throw new Error('session-link:'+error.code);
      // Cliente separado por requisição; nenhuma sessão é compartilhada no servidor.
      const client=createClient(url,Deno.env.get('SUPABASE_ANON_KEY')!,options);
      const result=await client.auth.verifyOtp({token_hash:data.properties.hashed_token,type:'magiclink'});
      if(result.error || !result.data.session) throw new Error('session-verify');
      const {access_token,refresh_token}=result.data.session;
      return {access_token,refresh_token};
    },
    async signOutOthers(token:string) {
      const {error}=await admin.auth.admin.signOut(token,'others');
      if(error) throw new Error('signout:'+error.code);
    }
  },
  async mail(email:string,code:string) {
    const subject='Recuperar seu PIN do Ponto';
    const text=`Seu código para criar um novo PIN no Ponto é: ${code}\n\nEle vale por 15 minutos. Digite-o na tela de recuperação do site.\nSe você não pediu a recuperação, ignore este e-mail.`;
    try {
      if(gmailAddress&&gmailAppPassword) {
        const {default:nodemailer}=await import('npm:nodemailer@10.1.7');
        // TLS desde a conexão; a porta 465 é compatível com o Supabase Edge.
        const transport=nodemailer.createTransport({
          host:'smtp.gmail.com',port:465,secure:true,
          auth:{user:gmailAddress,pass:gmailAppPassword},
          connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000,
          disableFileAccess:true,disableUrlAccess:true
        });
        try {
          const result=await transport.sendMail({from:{name:'Ponto',address:gmailAddress},to:email,subject,text});
          if(!result.accepted?.length) throw new Error('Destinatário recusado');
        } finally {transport.close();}
        return;
      }
      const response=await fetch('https://api.resend.com/emails',{
        method:'POST',headers:{Authorization:`Bearer ${resend}`,'Content-Type':'application/json'},
        body:JSON.stringify({from:`Ponto <${sender}>`,to:[email],subject,text}),signal:AbortSignal.timeout(20000)
      });
      if(!response.ok) throw new Error('Envio recusado');
    } catch {
      // As respostas do SMTP podem conter endereços; não as registra nem expõe.
      throw new AccessError('Não foi possível enviar a recuperação agora. Tente novamente mais tarde.',503);
    }
  }
});
const allowedOrigins=new Set(['https://leticiabeatriz.github.io','http://localhost:4173','http://127.0.0.1:4173']);
Deno.serve(async req=>{
  const origin=req.headers.get('origin')||'';
  const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin',
    'Access-Control-Allow-Origin':allowedOrigins.has(origin)?origin:'https://leticiabeatriz.github.io',
    'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info',
    'Access-Control-Allow-Methods':'POST,OPTIONS'};
  if(req.method==='OPTIONS') return new Response(null,{status:204,headers});
  if(req.method!=='POST') return new Response(JSON.stringify({error:'Use POST.'}),{status:405,headers});
  if(Number(req.headers.get('content-length')||0)>4096) return new Response('{}',{status:413,headers});
  try {
    const raw=await req.text();
    if(raw.length>4096) throw new AccessError('Requisição muito grande.',413);
    let data;try{data=JSON.parse(raw);}catch{throw new AccessError('Requisição inválida.');}
    if(!data || typeof data!=='object' || Array.isArray(data)) throw new AccessError('Requisição inválida.');
    const token=(req.headers.get('Authorization')||'').replace(/^Bearer /i,'');
    const ip=(req.headers.get('x-forwarded-for')||req.headers.get('cf-connecting-ip')||'unknown').split(',')[0].trim();
    return new Response(JSON.stringify(await handle(data,token,ip)),{headers});
  } catch(error) {
    const known=error instanceof AccessError;
    if(!known) console.error('ponto-access:',error instanceof Error?error.message:'Falha interna');
    return new Response(JSON.stringify({error:known?error.message:'Não foi possível concluir. Tente novamente.'}),{status:known?error.status:500,headers});
  }
});
