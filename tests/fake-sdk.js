// Apenas para testes de interface. O aplicativo real importa o SDK oficial.
export function createClient() {
  let authCallback;
  const store=JSON.parse(localStorage.getItem('test-db')||'{"profile":null,"entries":[],"session":null}');
  const persist=()=>localStorage.setItem('test-db',JSON.stringify(store));
  window.__fakeDb=store;
  window.__failNextWrite=false;
  const success=data=>({data,error:null});
  function from(table) {
    let op='select',payload,filters=[],start=0,end=999,one=false;
    const query={
      upsert(values){op='upsert';payload=values;return query;},
      insert(values){op='insert';payload=values;return query;},
      update(values){op='update';payload=values;return query;},
      delete(){op='delete';return query;},
      select(){return query;},
      eq(key,value){filters.push([key,value]);return query;},
      single(){one=true;return query;},
      order(){return query;},
      range(a,b){start=a;end=b;return query;},
      then(resolve,reject){return Promise.resolve().then(()=>{
        if(op!=='select' && window.__failNextWrite){window.__failNextWrite=false;return {data:null,error:{message:'Falha simulada ao salvar.'}};}
        let rows=[];
        if(table==='ponto_profiles') {
          if(op==='upsert'&&!store.profile)store.profile={user_id:payload.user_id,display_name:'',pin_salt:'',pin_hash:''};
          if(op==='update')Object.assign(store.profile,payload);
          rows=store.profile?[store.profile]:[];
        } else {
          const matches=e=>filters.every(([k,v])=>e[k]===v);
          if(op==='select')rows=store.entries.filter(matches).slice(start,end+1);
          if(op==='insert'){
            rows=(Array.isArray(payload)?payload:[payload]).map(e=>({...e,updated_at:new Date().toISOString()}));store.entries.push(...rows);
          }
          if(op==='update')rows=store.entries.filter(matches).map(e=>Object.assign(e,payload,{updated_at:new Date().toISOString()}));
          if(op==='delete'){rows=store.entries.filter(matches);store.entries=store.entries.filter(e=>!matches(e));}
        }
        persist();return success(one?rows[0]:rows);
      }).then(resolve,reject);}
    };
    return query;
  }
  const userId='00000000-0000-4000-a000-000000000001';
  const tokens=()=>({access_token:'fake-access',refresh_token:'fake-refresh',user:{id:userId,email:'internal@example.invalid'}});
  const reply=(body,status=200)=>({body,status});
  window.__pontoAccess=async({action,email,pin,name,invite,code})=>{
    if(action==='resume')return reply({email:store.profile?.contact_email||'test@example.com'});
    if(action==='login') {
      if(email!==(store.profile?.contact_email||'test@example.com') || pin!==(store.pin||'4826'))return reply({error:'E-mail ou PIN incorretos.'},401);
      if(!store.profile)store.profile={user_id:userId,display_name:'Conta teste',contact_email:email};
      persist();return reply({session:tokens()});
    }
    if(action==='unlock')return pin===(store.pin||'4826')?reply({ok:true}):reply({error:'PIN incorreto.'},401);
    if(action==='profile') {
      Object.assign(store.profile,{display_name:name});if(pin)store.pin=pin;persist();return reply({profile:store.profile});
    }
    if(action==='invite')return reply({invite:'a'.repeat(64),expires_at:'2026-12-01'});
    if(action==='invite-info')return invite==='a'.repeat(64)?reply({inviter:'Letícia'}):reply({error:'Este convite venceu ou já foi utilizado. Peça um novo link.'},400);
    if(action==='register') {
      store.profile={user_id:userId,display_name:name,contact_email:email};store.pin=pin;store.entries=[];persist();return reply({session:tokens()});
    }
    if(action==='recover'){store.recoveryEmails=(store.recoveryEmails||0)+1;persist();return reply({ok:true});}
    if(action==='reset'){
      if(code!=='123456')return reply({error:'Código incorreto ou vencido.'},400);
      store.pin=pin;persist();return reply({session:tokens()});
    }
    return reply({error:'Operação desconhecida'},400);
  };
  return {from,auth:{
    async getSession(){return success({session:store.session});},
    async setSession(){store.session=tokens();persist();authCallback?.('SIGNED_IN',store.session);return success({session:store.session});},
    async signOut(){store.session=null;persist();authCallback?.('SIGNED_OUT',null);return success(null);},
    onAuthStateChange(callback){authCallback=callback;return {data:{subscription:{unsubscribe(){}}}};}
  }};
}
