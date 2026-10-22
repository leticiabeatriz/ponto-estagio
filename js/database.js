import {config} from './config.js';
let client;
export async function connect() {
  if (!client) {
    const {createClient} = await import(config.sdkUrl);
    client = createClient(config.url,config.publishableKey,{auth:{storageKey:'ponto-pp-auth',persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
  }
  return client;
}
function unwrap(result) {
  if (result.error) {
    const error = result.error;
    if (error.code === '23P01') throw new Error('Já existe um registro neste horário. Atualize a página para conferir.');
    if (['42P01','PGRST205'].includes(error.code)) throw new Error('O banco do Ponto está indisponível. Tente novamente mais tarde.');
    throw new Error(error.message || 'Não foi possível acessar o banco.');
  }
  return result.data;
}
export async function session() { return unwrap(await client.auth.getSession()).session; }
// O PIN é validado no servidor. A chave privilegiada nunca vai para o navegador.
export async function access(action,values={}) {
  const current=await session();
  const response=await fetch(`${config.url}/functions/v1/ponto-access`,{
    method:'POST',headers:{'Content-Type':'application/json',apikey:config.publishableKey,
      ...(current?.access_token?{Authorization:`Bearer ${current.access_token}`}:{})},
    body:JSON.stringify({action,...values}),signal:AbortSignal.timeout(30000)
  });
  let data;try{data=await response.json();}catch{throw new Error('Não foi possível conectar ao Ponto. Tente novamente.');}
  if(!response.ok) throw new Error(data.error||'Não foi possível concluir.');
  if(data.session) data.session=unwrap(await client.auth.setSession(data.session)).session;
  return data;
}
export async function signIn(email,pin) { return (await access('login',{email,pin})).session; }
export async function signOut() { unwrap(await client.auth.signOut({scope:'local'})); }
export function observeAuth(callback) { return client.auth.onAuthStateChange((event,s)=>setTimeout(()=>callback(event,s),0)); }
export async function loadProfile(user) {
  return unwrap(await client.from('ponto_profiles').select('*').eq('user_id',user.id).single());
}
const fromRow = r => ({id:r.id,date:r.work_date,start:r.start_time.slice(0,5),end:r.end_time.slice(0,5),note:r.note,updated_at:r.updated_at});
const toRow = (user,e) => ({id:e.id,user_id:user.id,work_date:e.date,start_time:e.start,end_time:e.end,note:e.note||''});
export async function loadEntries(user) {
  const result = [];
  for (let page=0;;page++) {
    const rows = unwrap(await client.from('ponto_entries').select('*').eq('user_id',user.id).order('work_date',{ascending:false}).order('id').range(page*1000,page*1000+999));
    result.push(...rows.map(fromRow));
    if (rows.length < 1000) return result;
  }
}
export async function saveEntry(user,entry,previous) {
  let query = previous
    ? client.from('ponto_entries').update(toRow(user,entry)).eq('id',entry.id).eq('user_id',user.id).eq('updated_at',previous.updated_at)
    : client.from('ponto_entries').insert(toRow(user,entry));
  const rows = unwrap(await query.select());
  if (!rows.length) throw new Error('Este registro mudou em outro dispositivo. Recarregue antes de editar novamente.');
  return fromRow(rows[0]);
}
export async function deleteEntry(user,entry) {
  const rows = unwrap(await client.from('ponto_entries').delete().eq('id',entry.id).eq('user_id',user.id).eq('updated_at',entry.updated_at).select('id'));
  if (!rows.length) throw new Error('Este registro mudou em outro dispositivo. Recarregue antes de excluir.');
}
export async function importEntries(user,entries) {
  if (!entries.length) return;
  // Uma única requisição: o Postgres confirma tudo ou desfaz toda a importação.
  unwrap(await client.from('ponto_entries').insert(entries.map(e=>toRow(user,e))));
}
