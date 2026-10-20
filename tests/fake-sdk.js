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
  return {from,auth:{
    async getSession(){return success({session:store.session});},
    async signInWithPassword({email,password}){
      if(email!=='test@example.com'||password!=='test-password')return {data:null,error:{message:'Invalid login credentials'}};
      store.session={user:{id:'00000000-0000-4000-a000-000000000001',email}};persist();return success({session:store.session});
    },
    async signOut(){store.session=null;persist();authCallback?.('SIGNED_OUT',null);return success(null);},
    onAuthStateChange(callback){authCallback=callback;return {data:{subscription:{unsubscribe(){}}}};},
    async resetPasswordForEmail(){return success(null);},
    async updateUser(){return success({user:store.session?.user});}
  }};
}
