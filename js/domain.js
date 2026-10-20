export const DAILY_MINUTES = 300;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
export const today = () => localISO(new Date());
export function localISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
export function parseDate(value) {
  if (!datePattern.test(value)) throw new Error('Data inválida.');
  const [y,m,d] = value.split('-').map(Number);
  const result = new Date(y,m-1,d,12);
  if (localISO(result) !== value || y < 1900 || y > 2200) throw new Error('Data inválida.');
  return result;
}
export const minutes = value => Number(value.slice(0,2))*60 + Number(value.slice(3,5));
export const duration = entry => minutes(entry.end) - minutes(entry.start);
export function hm(value, signed = false) {
  return `${value < 0 ? '−' : signed && value > 0 ? '+' : ''}${Math.floor(Math.abs(value)/60)}h${String(Math.abs(value)%60).padStart(2,'0')}`;
}
export const formatDate = iso => parseDate(iso).toLocaleDateString('pt-BR', {day:'2-digit',month:'2-digit'});
export const weekday = iso => parseDate(iso).toLocaleDateString('pt-BR',{weekday:'long'});
export function monday(iso) {
  const d = parseDate(iso); d.setDate(d.getDate() - (d.getDay()+6)%7); return localISO(d);
}
export function addDays(iso, n) { const d = parseDate(iso); d.setDate(d.getDate()+n); return localISO(d); }
export function validateEntry(entry, existing = []) {
  parseDate(entry.date);
  if (!timePattern.test(entry.start) || !timePattern.test(entry.end)) throw new Error('Preencha horários válidos.');
  if (duration(entry) <= 0) throw new Error('A saída precisa ser depois da entrada, no mesmo dia.');
  if ((entry.note || '').length > 200) throw new Error('A observação deve ter até 200 caracteres.');
  if (existing.some(p => p.id !== entry.id && p.date === entry.date && entry.start < p.end && entry.end > p.start)) {
    throw new Error('Este horário se sobrepõe a outro registro do mesmo dia.');
  }
  return entry;
}
export function days(entries) {
  const groups = new Map();
  for (const entry of entries) {
    if (!groups.has(entry.date)) groups.set(entry.date, []);
    groups.get(entry.date).push(entry);
  }
  return [...groups].sort(([a],[b])=>b.localeCompare(a)).map(([date, items])=>{
    const worked = items.reduce((sum,e)=>sum+duration(e),0);
    const day = parseDate(date).getDay();
    const required = day >= 1 && day <= 5 ? DAILY_MINUTES : 0;
    return {date,entries:items.sort((a,b)=>a.start.localeCompare(b.start)),worked,required,balance:worked-required};
  });
}
export function summary(entries) {
  return days(entries).reduce((s,d)=>({worked:s.worked+d.worked,required:s.required+d.required,balance:s.balance+d.balance,count:s.count+1}),{worked:0,required:0,balance:0,count:0});
}
export function weeks(entries) {
  const groups = new Map();
  for (const day of days(entries)) {
    const key = monday(day.date);
    if (!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(day);
  }
  return [...groups].map(([start,items])=>({start,days:items,...summary(items.flatMap(d=>d.entries))}));
}
export function importLegacy(raw, existing) {
  if (!raw || !Array.isArray(raw.pontos) || raw.pontos.length > 10000) throw new Error('Selecione um db.json ou backup do Ponto válido (até 10.000 registros).');
  const result = []; let skipped = 0;
  for (const point of raw.pontos) {
    const e = {id:crypto.randomUUID(),date:point.date,start:point.start,end:point.end,note:String(point.note||'')};
    if ([...existing,...result].some(x=>x.date===e.date && x.start===e.start && x.end===e.end)) { skipped++; continue; }
    validateEntry(e,[...existing,...result]); result.push(e);
  }
  return {entries:result,skipped};
}
