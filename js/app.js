import * as api from './database.js';
import {today,localISO,parseDate,formatDate,weekday,minutes,duration,hm,monday,addDays,days,summary,weeks,validateEntry,importLegacy} from './domain.js';
import {createPin,verifyPin} from './pin.js';

const $ = selector => document.querySelector(selector);
const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state = {user:null,profile:null,entries:[],demo:false,unlocked:false,invite:null};
let editing = null, deleting = null, busy = 0, toastTimer, generation = 0;
let activityAt = Date.now();
const expanded = new Map();
function message(id,text,error=false) { $(id).textContent=text; $(id).classList.toggle('error',error); }
function toast(text,error=false) { clearTimeout(toastTimer); message('#toast',text,error); $('#toast').hidden=false; toastTimer=setTimeout(()=>$('#toast').hidden=true,6500); }
async function action(form,messageId,fn) {
  if (form.dataset.busy) return;
  form.dataset.busy='true'; busy++;
  const controls = [...form.querySelectorAll('button,input')];
  controls.forEach(c=>c.disabled=true);
  if(messageId) message(messageId,'');
  try { await fn(); }
  catch(error) { messageId ? message(messageId,error.message || 'Não foi possível concluir.',true) : toast(error.message,true); }
  finally { controls.forEach(c=>c.disabled=false); delete form.dataset.busy; busy--; }
}
function closeDialogs() { document.querySelectorAll('dialog[open]').forEach(d=>d.close()); }
function access(mode,copy) {
  closeDialogs(); state.unlocked=false;
  $('#appView').hidden=true; $('#accessView').hidden=false;
  for(const id of ['loginForm','signupForm','pinForm','recoveryRequestForm','recoveryForm']) $('#'+id).hidden=id!==mode;
  $('#accessCopy').textContent=copy;
  const titles={pinForm:'Bom te ver por aqui.',signupForm:'Seu Ponto começa aqui.',recoveryRequestForm:'Esqueceu seu PIN?',recoveryForm:'Crie um novo PIN.'};
  $('#accessTitle').textContent=titles[mode]||'Bem-vinda de volta.';
  message('#accessMessage','');
}
function showPin() {
  access('pinForm',state.demo ? 'Demonstração: use o PIN 1234.' : 'Este navegador já lembra sua conta. Digite seu PIN para entrar.');
  $('#pinForm').reset();
  $('#pinLogout').textContent=state.demo ? 'Sair da demonstração' : 'Entrar em outra conta';
  $('#pinForgot').hidden=state.demo;
  $('#pinForm').elements.pin.focus();
}
async function prepare(user) {
  const current=++generation;state.user=user;
  access('','Carregando sua conta…');
  try {
    const account=await api.access('resume');
    if(current!==generation || state.demo) return;
    state.profile={contact_email:account.email};showPin();
  } catch(error) {
    if(current!==generation) return;
    access('loginForm','Entre com seu e-mail e PIN.');message('#accessMessage',error.message,true);
  }
}
async function enter(s) {
  ++generation;state.demo=false;state.user=s.user;
  state.profile=await api.loadProfile(s.user);
  state.invite=null;history.replaceState(null,'',location.pathname+location.search);
  await openApp();
}
function recover() {
  $('#recoveryRequestForm').elements.email.value=state.profile?.contact_email||$('#loginForm').elements.email.value;
  access('recoveryRequestForm','Vamos enviar um código para você escolher outro PIN.');
}
function lock() {
  if(!state.unlocked) return;
  if(busy) { toast('Aguarde a operação terminar antes de bloquear.'); return; }
  state.unlocked=false; closeDialogs();
  // Remove os registros do DOM enquanto a interface está bloqueada.
  $('#weeksContainer').replaceChildren();
  if(!state.demo) state.entries=[];
  showPin();
}
async function openApp() {
  const entries=state.demo ? state.entries : await api.loadEntries(state.user);
  state.entries=entries; state.unlocked=true; activityAt=Date.now();
  $('#accessView').hidden=true; $('#appView').hidden=false; $('#demoBanner').hidden=!state.demo;
  $('#connectionLabel').textContent=state.demo ? 'Modo demonstração' : 'Dados na nuvem';
  render();
}
async function logout() {
  if(!state.demo) await api.signOut();
  ++generation; state.demo=false; state.user=null; state.profile=null; state.entries=[]; state.unlocked=false;
  expanded.clear();$('#weeksContainer').replaceChildren();
  access('loginForm','Entre com a sua conta para continuar.');
}

function filtered() {
  const mode=$('#periodSelect').value;
  const now=today();
  const from=mode==='month' ? now.slice(0,7)+'-01' : mode==='week' ? monday(now) : mode==='custom' ? $('#fromDate').value : '';
  const until=mode==='month' ? localISO(new Date(parseDate(now).getFullYear(),parseDate(now).getMonth()+1,0,12)) : mode==='week' ? addDays(monday(now),6) : mode==='custom' ? $('#toDate').value : '';
  return state.entries.filter(e=>(!from||e.date>=from)&&(!until||e.date<=until));
}
function render() {
  if(!state.unlocked) return;
  const name=state.profile?.display_name || '';
  $('#profileName').textContent=name || 'Meu ponto'; $('#avatar').textContent=(name||'P').slice(0,1).toUpperCase();
  $('#greeting').textContent=name ? `Olá, ${name.split(' ')[0]}! Seu tempo está aqui.` : 'Olá! Seu tempo está aqui.';
  $('#todayLabel').textContent=new Date().toLocaleDateString('pt-BR',{day:'numeric',month:'long',year:'numeric'});
  const entries=filtered(), total=summary(state.entries), period=summary(entries);
  $('#totalBalance').textContent=hm(total.balance,true);
  $('#balanceBadge').textContent=total.balance>0 ? 'Horas a seu favor' : total.balance<0 ? 'Horas a compensar' : 'Tudo em dia';
  $('#periodWorked').textContent=hm(period.worked);
  $('#periodWorkedNote').textContent=period.count ? `${hm(Math.round(period.worked/period.count))} em média por dia` : 'Nenhum registro ainda';
  $('#periodDays').innerHTML=`${period.count} <span>${period.count===1?'dia':'dias'}</span>`;
  $('#periodBalance').textContent=hm(period.balance,true);
  $('#periodBalance').className=period.balance<0 ? 'negative' : period.balance>0 ? 'positive' : '';
  $('#entriesCount').textContent=entries.length;
  $('#filterSummary').textContent=`${entries.length} ${entries.length===1?'registro':'registros'} · ${period.count} ${period.count===1?'dia':'dias'}`;
  $('#saveStatus').innerHTML=`<span class="online-dot"></span>${state.demo ? 'Exemplos · sem salvar na nuvem' : 'Todos os registros salvos'}`;
  renderChart(); renderWeeks(entries);
}
function renderChart() {
  const start=monday(today());
  $('#weekRange').textContent=`${formatDate(start)} a ${formatDate(addDays(start,6))}`;
  const currentDays=days(state.entries.filter(e=>e.date>=start && e.date<=addDays(start,6)));
  const values=Array.from({length:7},(_,i)=>currentDays.find(d=>d.date===addDays(start,i))?.worked||0);
  const max=Math.max(420,...values);
  const labels=['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'];
  $('#weekChart').innerHTML=values.map((value,i)=>`<div class="chart-day ${addDays(start,i)===today()?'current':''}"><div class="bar-area" style="--reference:${(1-300/max)*100}%"><div class="bar ${!value?'bar-empty':''}" style="height:${Math.max(value/max*100,3)}%"><span class="bar-value">${value?hm(value):'—'}</span></div></div><span class="day-label">${labels[i]}</span></div>`).join('');
  $('#weekChart').setAttribute('aria-label',values.map((v,i)=>`${labels[i]}: ${hm(v)}`).join('; ')+'. Referência de 5 horas nos dias úteis.');
}
function renderWeeks(entries) {
  const grouped=weeks(entries);
  if(!grouped.length) {
    $('#weeksContainer').innerHTML=`<div class="empty-state"><span class="metric-icon">${icon('calendar')}</span><h3>${state.entries.length?'Nenhum registro neste período.':'Sua jornada começa por aqui.'}</h3><p>${state.entries.length?'Escolha outro período para ver seus registros.':'Adicione seu primeiro horário ou importe o db.json do programa antigo.'}</p><button class="button secondary" data-new>${icon('plus')}Novo registro</button></div>`;
    return;
  }
  $('#weeksContainer').innerHTML=grouped.map((week,index)=>`<details class="week" data-week="${week.start}" ${expanded.has(week.start)?expanded.get(week.start)?'open':'':index<3?'open':''}>
    <summary>${icon('chevron')}<span class="week-title">${formatDate(week.start)} <span class="muted">—</span> ${formatDate(addDays(week.start,6))}</span><span class="week-meta"><span class="worked-meta">${hm(week.worked)} trabalhadas</span><span class="week-saldo ${week.balance<0?'negative':''}">Saldo ${hm(week.balance,true)}</span></span></summary>
    <div class="table-wrap"><table><thead><tr><th scope="col">Dia</th><th scope="col">Entrada e saída</th><th scope="col">Trabalhado</th><th scope="col">Saldo do dia</th><th scope="col"><span class="sr-only">Ações</span></th></tr></thead><tbody>${week.days.map(day=>day.entries.map((entry,i)=>`<tr>
      ${!i?`<td rowspan="${day.entries.length}"><div class="day-cell"><span class="date-box">${Number(day.date.slice(8))}<small>${parseDate(day.date).toLocaleDateString('pt-BR',{month:'short'}).replace('.','')}</small></span><div><strong>${weekday(day.date)}</strong><small>${day.required?'Jornada de 5h':'Horas extras'}</small></div></div></td>`:''}
      <td><span class="time-chip">${entry.start}<span class="arrow">→</span>${entry.end}</span>${entry.note?`<span class="entry-note">${escape(entry.note)}</span>`:''}</td>
      <td class="day-total">${hm(duration(entry))}</td>
      ${!i?`<td rowspan="${day.entries.length}" class="day-total ${day.balance<0?'negative':day.balance>0?'positive':''}">${hm(day.balance,true)}</td>`:''}
      <td><div class="row-actions"><button class="icon-button" data-edit="${escape(entry.id)}" aria-label="Editar registro de ${formatDate(entry.date)} às ${entry.start}" title="Editar">${icon('edit')}</button><button class="icon-button danger" data-delete="${escape(entry.id)}" aria-label="Excluir registro de ${formatDate(entry.date)} às ${entry.start}" title="Excluir">${icon('trash')}</button></div></td></tr>`).join('')).join('')}</tbody></table></div></details>`).join('');
  $('#weeksContainer').querySelectorAll('details').forEach(d=>d.addEventListener('toggle',()=>expanded.set(d.dataset.week,d.open)));
}
function openEntry(id) {
  editing=id ? state.entries.find(e=>e.id===id) : null;
  $('#entryForm').reset(); message('#entryMessage','');
  $('#entryTitle').textContent=editing?'Editar registro':'Novo registro';
  for(const field of ['date','start','end','note']) $('#entryForm').elements[field].value=editing?.[field] ?? ({date:today(),start:'13:00',end:'18:00',note:''}[field]);
  preview(); $('#entryDialog').showModal();
}
function preview() {
  const form=$('#entryForm'); const start=form.elements.start.value,end=form.elements.end.value;
  $('#durationPreview').textContent=start&&end&&minutes(end)>minutes(start) ? `${hm(minutes(end)-minutes(start))} de trabalho neste registro` : 'A saída deve ser depois da entrada, no mesmo dia.';
}
function download(text,type,filename) {
  const url=URL.createObjectURL(new Blob([text],{type})); const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);
}
// Evita que observações sejam interpretadas como fórmulas em planilhas.
const csvCell = value => '"'+String(value).replace(/^[=+@\-\t\r]/,"'$&").replace(/"/g,'""')+'"';

$('#loginForm').addEventListener('submit',event=>{
  event.preventDefault();const form=event.currentTarget;
  const email=form.elements.email.value.trim(),pin=form.elements.pin.value;
  action(form,'#accessMessage',async()=>{
    await api.connect();await enter(await api.signIn(email,pin));form.elements.pin.value='';
  });
});
$('#signupForm').addEventListener('submit',event=>{
  event.preventDefault();const form=event.currentTarget;
  const values={email:form.elements.email.value.trim(),name:form.elements.name.value.trim(),pin:form.elements.pin.value,invite:state.invite};
  action(form,'#accessMessage',async()=>{
    const result=await api.access('register',values);await enter(result.session);form.reset();
  });
});
$('#signupLogin').addEventListener('click',()=>access('loginForm','Entre com seu e-mail e PIN.'));
$('#forgotPassword').addEventListener('click',recover);$('#pinForgot').addEventListener('click',recover);
$('#recoveryBack').addEventListener('click',()=>access('loginForm','Entre com seu e-mail e PIN.'));
$('#resendRecovery').addEventListener('click',recover);
$('#recoveryRequestForm').addEventListener('submit',event=>{
  event.preventDefault();const form=event.currentTarget,email=form.elements.email.value.trim();
  action(form,'#accessMessage',async()=>{
    await api.access('recover',{email});$('#recoveryForm').reset();$('#recoveryForm').elements.email.value=email;
    access('recoveryForm','Se o e-mail estiver cadastrado, o código chegará em instantes. Ele vale por 15 minutos.');
  });
});
$('#recoveryForm').addEventListener('submit',event=>{
  event.preventDefault();const form=event.currentTarget;
  const values={email:form.elements.email.value.trim(),code:form.elements.code.value,pin:form.elements.pin.value};
  action(form,'#accessMessage',async()=>{await enter((await api.access('reset',values)).session);form.reset();});
});
$('#pinForm').addEventListener('submit',event=>{
  event.preventDefault(); const form=event.currentTarget,pin=form.elements.pin.value;
  action(form,'#accessMessage',async()=>{
    if(state.demo) {
      if(!await verifyPin(pin,state.profile)) throw new Error('PIN incorreto.');
      await openApp();
    } else {
      const result=await api.access('unlock',{pin});
      await enter(result.session||await api.session());
    }
    form.reset();
  });
});
$('#pinLogout').addEventListener('click',()=>action($('#pinForm'),'#accessMessage',logout));
$('#inviteButton').addEventListener('click',()=>{
  if(state.demo) {toast('Os convites ficam disponíveis na sua conta.');return;}
  closeDialogs();$('#inviteLinkLabel').hidden=true;$('#copyInvite').hidden=true;message('#inviteMessage','');$('#inviteDialog').showModal();
});
$('#settingsInvite').addEventListener('click',()=>$('#inviteButton').click());
$('#inviteForm').addEventListener('submit',event=>{
  event.preventDefault();
  action(event.currentTarget,'#inviteMessage',async()=>{
    const result=await api.access('invite');
    const url=new URL('./',location.href);url.hash='invite='+result.invite;
    $('#inviteLink').value=url.href;$('#inviteLinkLabel').hidden=false;$('#copyInvite').hidden=false;
    message('#inviteMessage','Pronto! Copie o link e envie para a pessoa.');
  });
});
$('#copyInvite').addEventListener('click',async()=>{
  try {await navigator.clipboard.writeText($('#inviteLink').value);message('#inviteMessage','Link copiado!');}
  catch {$('#inviteLink').select();message('#inviteMessage','Selecione o link acima e copie para compartilhar.');}
});
$('#addButton').addEventListener('click',()=>openEntry());
$('#entryForm').addEventListener('input',preview);
$('#entryForm').addEventListener('submit',event=>{
  event.preventDefault();const form=event.currentTarget;
  const entry={id:editing?.id||crypto.randomUUID(),date:form.elements.date.value,start:form.elements.start.value,end:form.elements.end.value,note:form.elements.note.value.trim()};
  const previous=editing;
  action(form,'#entryMessage',async()=>{
    validateEntry(entry,state.entries);
    const saved=state.demo?entry:await api.saveEntry(state.user,entry,previous);
    state.entries=[...state.entries.filter(e=>e.id!==saved.id),saved];
    $('#entryDialog').close();render();toast(state.demo?'Registro adicionado à demonstração.':'Registro salvo na nuvem.');
  });
});
$('#weeksContainer').addEventListener('click',event=>{
  const edit=event.target.closest('[data-edit]'),del=event.target.closest('[data-delete]');
  if(event.target.closest('[data-new]')) openEntry();
  if(edit) openEntry(edit.dataset.edit);
  if(del) {
    deleting=state.entries.find(e=>e.id===del.dataset.delete);
    $('#deleteDescription').textContent=`${formatDate(deleting.date)} · ${deleting.start} às ${deleting.end}`;
    message('#deleteMessage','');$('#deleteDialog').showModal();
  }
});
$('#deleteForm').addEventListener('submit',event=>{
  event.preventDefault();const entry=deleting;
  action(event.currentTarget,'#deleteMessage',async()=>{
    if(!state.demo) await api.deleteEntry(state.user,entry);
    state.entries=state.entries.filter(e=>e.id!==entry.id);$('#deleteDialog').close();render();toast('Registro excluído.');
  });
});
for(const selector of ['#periodSelect','#fromDate','#toDate']) $(selector).addEventListener('change',()=>{
  $('#customDates').hidden=$('#periodSelect').value!=='custom';
  $('#toDate').min=$('#fromDate').value;$('#fromDate').max=$('#toDate').value;
  if($('#fromDate').value && $('#toDate').value && $('#fromDate').value>$('#toDate').value) {toast('O fim do período deve ser depois do início.',true);return;}
  render();
});
$('#refreshButton').addEventListener('click',async event=>{
  const button=event.currentTarget;button.disabled=true;busy++;
  try {if(!state.demo)state.entries=await api.loadEntries(state.user);render();toast('Registros atualizados.');}catch(error){toast(error.message,true);}finally{button.disabled=false;busy--;}
});
$('#settingsButton').addEventListener('click',()=>{
  const form=$('#settingsForm');form.reset();form.elements.name.value=state.profile?.display_name||'';
  $('#accountEmail').textContent=state.demo?'Conta de demonstração':state.profile?.contact_email||state.user.email;
  message('#settingsMessage','');$('#settingsDialog').showModal();
});
$('#mobileSettings').addEventListener('click',()=>$('#settingsButton').click());
$('#settingsForm').addEventListener('submit',event=>{
  event.preventDefault();const form=event.currentTarget;
  const name=form.elements.name.value.trim(),pin=form.elements.pin.value,confirmation=form.elements.confirmation.value;
  action(form,'#settingsMessage',async()=>{
    if(!name) throw new Error('Informe como quer ser chamado.');
    if(pin!==confirmation) throw new Error('Os PINs precisam ser iguais.');
    if(state.demo) state.profile={...state.profile,display_name:name,...(pin?await createPin(pin):{})};
    else state.profile=(await api.access('profile',{name,pin})).profile;
    form.reset();$('#settingsDialog').close();render();toast('Preferências salvas.');
  });
});
$('#logoutButton').addEventListener('click',()=>action($('#settingsForm'),'#settingsMessage',logout));
$('#lockButton').addEventListener('click',lock);$('#mobileLock').addEventListener('click',lock);
$('#importButton').addEventListener('click',()=>{$('#importForm').reset();message('#importMessage','');$('#importDialog').showModal();});
$('#importForm').addEventListener('submit',event=>{
  event.preventDefault();const form=event.currentTarget;
  const file=form.elements.file.files[0];
  action(form,'#importMessage',async()=>{
    if(!file || file.size>5*1024*1024) throw new Error('Escolha um JSON de até 5 MB.');
    let raw;try{raw=JSON.parse(await file.text());}catch{throw new Error('Este arquivo não é um JSON válido.');}
    const result=importLegacy(raw,state.entries);
    if(!state.demo) await api.importEntries(state.user,result.entries);
    // Só recarrega após sucesso. Se a leitura falhar, os IDs importados continuam conhecidos.
    state.entries.push(...result.entries);render();
    if(!state.demo && result.entries.length) {try{state.entries=await api.loadEntries(state.user);render();}catch{toast('Importado. Atualize os registros antes de editar.',true);}}
    $('#importDialog').close();toast(`${result.entries.length} importados; ${result.skipped} duplicados ignorados.`);
  });
});
$('#exportButton').addEventListener('click',()=>$('#exportDialog').showModal());
$('#exportJson').addEventListener('click',()=>{
  const points=state.entries.map(({id,date,start,end,note})=>({id,date,start,end,note}));
  download(JSON.stringify({version:2,userName:state.profile.display_name,pontos:points},null,2),'application/json',`ponto-backup-${today()}.json`);
  $('#exportDialog').close();
});
$('#exportCsv').addEventListener('click',()=>{
  const rows=[['Data','Dia','Entrada','Saída','Minutos trabalhados','Observação']];
  filtered().sort((a,b)=>(a.date+a.start).localeCompare(b.date+b.start)).forEach(e=>rows.push([e.date,weekday(e.date),e.start,e.end,duration(e),e.note||'']));
  download('\ufeff'+rows.map(row=>row.map(csvCell).join(';')).join('\r\n'),'text/csv;charset=utf-8',`ponto-periodo-${today()}.csv`);$('#exportDialog').close();
});
document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>button.closest('dialog').close()));
document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();}));
document.querySelectorAll('.sidebar nav a').forEach(link=>link.addEventListener('click',()=>{
  document.querySelectorAll('.sidebar nav a').forEach(a=>a.classList.toggle('active',a===link));
  $('.breadcrumb strong').textContent=link.getAttribute('href')==='#history'?'Meus registros':'Visão geral';
}));
async function demo() {
  if(busy)return;
  ++generation;state.demo=true;state.user={id:'demo',email:'demo@ponto.local'};
  state.profile={display_name:'Letícia',...await createPin('1234')};
  state.entries=[];
  for(let offset=0;offset<16;offset++) {
    const date=addDays(today(),-offset),dow=parseDate(date).getDay();if(dow===0||dow===6)continue;
    const end=offset%4===0?'18:30':offset%3===0?'17:45':'18:00';
    state.entries.push({id:crypto.randomUUID(),date,start:'13:00',end,note:offset===0?'Atividades do estágio':''});
  }
  await openApp();
}
$('#demoButton').addEventListener('click',demo);$('#exitDemo').addEventListener('click',logout);
for(const name of ['pointerdown','keydown']) document.addEventListener(name,()=>activityAt=Date.now(),{passive:true});
setInterval(()=>{if(state.unlocked && !busy && Date.now()-activityAt>10*60000)lock();},30000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&state.unlocked&&Date.now()-activityAt>10*60000)lock();});
window.addEventListener('offline',()=>toast('Sem internet. Aguarde a conexão para salvar seus registros.',true));
window.addEventListener('online',()=>toast('Conexão restabelecida.'));
window.addEventListener('beforeunload',event=>{
  if(busy || $('#entryDialog').open) {event.preventDefault();event.returnValue='';}
});
async function init() {
  const invitation=new URLSearchParams(location.hash.slice(1)).get('invite');
  try {
    await api.connect();
    api.observeAuth(async(event,s)=>{
      if(state.demo||busy)return;
      if(event==='SIGNED_OUT' && state.user) {
        ++generation;state.user=null;state.profile=null;state.entries=[];state.unlocked=false;
        $('#weeksContainer').replaceChildren();access('loginForm','Sua sessão terminou. Entre com e-mail e PIN.');
      }
      if(event==='SIGNED_IN' && s && state.user && s.user.id!==state.user.id) await prepare(s.user);
    });
    if(state.demo)return;
    if(invitation) {
      state.invite=invitation;access('','Conferindo seu convite…');
      const info=await api.access('invite-info',{invite:invitation});
      access('signupForm',info.inviter?`${info.inviter} convidou você para usar o Ponto. Seus registros serão só seus.`:'Você recebeu um convite para usar o Ponto.');
      return;
    }
    const s=await api.session();
    if(s)await prepare(s.user);else access('loginForm','Entre com seu e-mail e PIN.');
  } catch(error) {
    if(!state.demo){access('loginForm','Entre com seu e-mail e PIN.');message('#accessMessage',error.message,true);}
  }
}
init();
