import {config} from './config.js';
let client;
export async function connect() {
  if (!client) {
    const {createClient} = await import(config.sdkUrl);
    client = createClient(config.url,config.publishableKey,{auth:{storageKey:'ponto-pp-auth',persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  }
  return client;
}
function unwrap(result) {
  if (result.error) {
    const error = result.error;
    if (error.code === '23P01') throw new Error('Já existe um registro neste horário. Atualize a página para conferir.');
    if (['42P01','PGRST205'].includes(error.code)) throw new Error('O banco do Ponto ainda precisa ser configurado. Consulte o README do projeto.');
    if (error.message?.includes('Invalid login')) throw new Error('E-mail ou senha incorretos.');
    throw new Error(error.message || 'Não foi possível acessar o banco.');
  }
  return result.data;
}
export async function session() { return unwrap(await client.auth.getSession()).session; }
export async function signIn(email,password) { return unwrap(await client.auth.signInWithPassword({email,password})).session; }
export async function signOut() { unwrap(await client.auth.signOut({scope:'local'})); }
export function observeAuth(callback) { return client.auth.onAuthStateChange((event,s)=>setTimeout(()=>callback(event,s),0)); }
export async function resetPassword(email) {
  const redirectTo = new URL('./',location.href).href;
  unwrap(await client.auth.resetPasswordForEmail(email,{redirectTo}));
}
export async function updatePassword(password) { unwrap(await client.auth.updateUser({password})); }
export async function loadProfile(user) {
  unwrap(await client.from('ponto_profiles').upsert({user_id:user.id},{onConflict:'user_id',ignoreDuplicates:true}));
  return unwrap(await client.from('ponto_profiles').select('*').eq('user_id',user.id).single());
}
export async function saveProfile(user,values) {
  return unwrap(await client.from('ponto_profiles').update(values).eq('user_id',user.id).select().single());
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
