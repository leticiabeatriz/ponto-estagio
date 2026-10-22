import {createPin,verifyPin} from './pin.js';
export class AccessError extends Error {
  constructor(message,status=400) { super(message);this.status=status; }
}
export const digest = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(n=>n.toString(16).padStart(2,'0')).join('');
const randomToken = () => [...crypto.getRandomValues(new Uint8Array(32))].map(n=>n.toString(16).padStart(2,'0')).join('');
const emailOf = value => {
  const email=String(value||'').trim().toLowerCase();
  if(email.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AccessError('Informe um e-mail válido.');
  return email;
};
const pinOf = value => {
  if(typeof value!=='string' || !/^\d{4}$/.test(value)) throw new AccessError('Use um PIN de 4 dígitos.');
  return value;
};
const nameOf = value => {
  const name=String(value||'').trim();
  if(!name || name.length>80) throw new AccessError('Informe como quer ser chamado, com até 80 caracteres.');
  return name;
};
const tokenOf = value => {
  if(typeof value!=='string' || !/^[a-f0-9]{64}$/.test(value)) throw new AccessError('Este convite é inválido. Peça um novo link.');
  return value;
};

// Todas as dependências com privilégios são injetadas somente pelo servidor.
export function accessService({storage,auth,mail,mailReady,recoverySecret}) {
  const limit = async(key,max,seconds) => {
    if(!await storage('limit',{key:await digest(key),max,seconds})) throw new AccessError('Muitas tentativas. Aguarde alguns minutos e tente novamente.',429);
  };
  const attempt = async email => limit('pin:'+email,5,300);
  const clearAttempts = async email => storage('clear_limit',{key:await digest('pin:'+email)});
  const accountFor = async token => {
    const user=await auth.user(token);
    if(!user || user.is_anonymous) throw new AccessError('Entre novamente para continuar.',401);
    const a=await storage('account',{user_id:user.id});
    if(!a) throw new AccessError('Sua conta precisa de um convite para usar o Ponto.',403);
    return {...a,caller_id:user.id};
  };
  async function bind(a) {
    if(a.internal_email) return a;
    const user=await auth.create();
    try {
      return await storage('bind_legacy',{email:a.email,previous_id:a.user_id,user_id:user.id,internal_email:user.email});
    } catch(error) { await auth.remove(user.id);throw error; }
  }
  return async ({action,email,pin,name,invite,code},token,ip='unknown') => {
    // Defesa adicional para tentativas distribuídas entre endereços de e-mail.
    await limit('ip:'+ip,120,3600);
    if(action==='login') {
      email=emailOf(email);pin=pinOf(pin);await attempt(email);
      let a=await storage('account',{email});
      if(!a || !await verifyPin(pin,a)) throw new AccessError('E-mail ou PIN incorretos.',401);
      a=await bind(a);await clearAttempts(email);
      return {session:await auth.session(a.internal_email)};
    }
    if(action==='resume') {
      const a=await accountFor(token);return {email:a.email};
    }
    if(action==='unlock') {
      pin=pinOf(pin);let a=await accountFor(token);await attempt(a.email);
      if(!await verifyPin(pin,a)) throw new AccessError('PIN incorreto.',401);
      const legacy=!a.internal_email || a.caller_id!==a.user_id;a=await bind(a);await clearAttempts(a.email);
      return legacy ? {session:await auth.session(a.internal_email)} : {ok:true};
    }
    if(action==='invite-info') {
      const invitation=await storage('invite_info',{token_hash:await digest(tokenOf(invite))});
      if(!invitation) throw new AccessError('Este convite venceu ou já foi utilizado. Peça um novo link.');
      return invitation;
    }
    if(action==='invite') {
      const a=await accountFor(token);
      if(!a.internal_email) throw new AccessError('Desbloqueie o Ponto antes de convidar.');
      await limit('invite:'+a.user_id,10,3600);
      const invite=randomToken();
      const details=await storage('invite_create',{user_id:a.user_id,token_hash:await digest(invite)});
      return {invite,...details};
    }
    if(action==='register') {
      email=emailOf(email);pin=pinOf(pin);name=nameOf(name);invite=tokenOf(invite);
      await limit('register:'+ip,10,3600);
      if(await storage('account',{email})) throw new AccessError('Este e-mail já tem cadastro. Entre com seu PIN ou use a recuperação.');
      const token_hash=await digest(invite);
      if(!await storage('invite_info',{token_hash})) throw new AccessError('Este convite venceu ou já foi utilizado. Peça um novo link.');
      const hashed=await createPin(pin), user=await auth.create();
      try {await storage('register',{email,name,...hashed,user_id:user.id,internal_email:user.email,token_hash});}
      catch(error) {await auth.remove(user.id);throw error;}
      return {session:await auth.session(user.email)};
    }
    if(action==='profile') {
      const a=await accountFor(token);name=nameOf(name);
      if(!a.internal_email) throw new AccessError('Desbloqueie o Ponto antes de alterar seu perfil.');
      const hashed=pin ? await createPin(pinOf(pin)) : {};
      return {profile:await storage('profile',{user_id:a.user_id,name,...hashed})};
    }
    if(action==='recover') {
      email=emailOf(email);
      if(!mailReady) throw new AccessError('O envio de recuperação ainda está sendo configurado. Tente novamente mais tarde.',503);
      await limit('recovery:'+email,3,3600);
      const a=await storage('account',{email});
      if(a) {
        const bytes=crypto.getRandomValues(new Uint32Array(1));
        const code=String(bytes[0]%1000000).padStart(6,'0');
        const code_hash=await digest(recoverySecret+':'+email+':'+code);
        await storage('recovery_start',{email,code_hash});
        await mail(email,code);
      }
      return {ok:true};
    }
    if(action==='reset') {
      email=emailOf(email);pin=pinOf(pin);
      if(typeof code!=='string' || !/^\d{6}$/.test(code)) throw new AccessError('Informe os 6 dígitos enviados ao seu e-mail.');
      await limit('reset:'+email,10,900);
      const code_hash=await digest(recoverySecret+':'+email+':'+code);
      let a=await storage('recovery_finish',{email,code_hash,...await createPin(pin)});
      if(!a) throw new AccessError('Código incorreto ou vencido. Solicite a recuperação novamente.');
      a=await bind(a);await clearAttempts(email);
      const session=await auth.session(a.internal_email);
      await auth.signOutOthers(session.access_token);
      return {session};
    }
    throw new AccessError('Operação inválida.');
  };
}
