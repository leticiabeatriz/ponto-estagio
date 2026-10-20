import test from 'node:test';
import assert from 'node:assert/strict';
import {summary,validateEntry,monday,weeks,importLegacy,parseDate,hm,days} from '../js/domain.js';
import {createPin,verifyPin} from '../js/pin.js';
const entry=(date,start='13:00',end='18:00',id=crypto.randomUUID())=>({id,date,start,end});

test('cobra 5h uma única vez por dia útil, mesmo com vários intervalos',()=>{
  assert.deepEqual(summary([entry('2026-10-19','08:00','11:00'),entry('2026-10-19','13:00','16:00')]),{worked:360,required:300,balance:60,count:1});
});
test('dias úteis sem registro não geram débito; fim de semana é extra',()=>{
  assert.deepEqual(summary([entry('2026-10-19','13:00','17:00'),entry('2026-10-24','09:00','11:00')]),{worked:360,required:300,balance:60,count:2});
  assert.deepEqual(summary([]),{worked:0,required:0,balance:0,count:0});
});
test('segunda-feira define a semana incluindo domingo e virada de ano',()=>{
  assert.equal(monday('2026-02-01'),'2026-01-26');
  assert.equal(monday('2027-01-01'),'2026-12-28');
  const grouped=weeks([entry('2026-10-18'),entry('2026-10-19')]);
  assert.equal(grouped.length,2);assert.equal(grouped[0].start,'2026-10-19');
});
test('rejeita data impossível, turno invertido e horários fora de formato',()=>{
  for(const date of ['2026-02-30','2026-13-02','0000-01-01','2026-2-1'])assert.throws(()=>parseDate(date));
  assert.throws(()=>validateEntry(entry('2026-10-19','18:00','13:00')));
  assert.throws(()=>validateEntry(entry('2026-10-19','24:00','25:00')));
  assert.throws(()=>validateEntry(entry('2026-10-19','13:00','13:00')));
});
test('rejeita sobreposição, permite intervalos adjacentes e edição do próprio registro',()=>{
  const existing=entry('2026-10-19','13:00','18:00');
  assert.throws(()=>validateEntry(entry('2026-10-19','12:00','13:30'),[existing]));
  assert.doesNotThrow(()=>validateEntry(entry('2026-10-19','18:00','19:00'),[existing]));
  assert.doesNotThrow(()=>validateEntry({...existing,end:'18:30'},[existing]));
});
test('importação preserva horários do legado e ignora duplicados',()=>{
  const existing=entry('2026-02-01');
  const result=importLegacy({pontos:[existing,entry('2026-02-02'),entry('2026-02-02')]},[existing]);
  assert.equal(result.skipped,2);assert.equal(result.entries.length,1);
  assert.equal(result.entries[0].date,'2026-02-02');
  assert.throws(()=>importLegacy({pontos:[entry('2026-02-02','13:00','17:00'),entry('2026-02-02','14:00','18:00')]},[]));
  assert.throws(()=>importLegacy({pontos:'inválido'},[]));
});
test('formata saldo negativo e lista dias em ordem decrescente',()=>{
  assert.equal(hm(-65),'−1h05');assert.equal(hm(15,true),'+0h15');
  assert.equal(days([entry('2026-10-18'),entry('2026-10-20')])[0].date,'2026-10-20');
});
test('PIN usa salt aleatório e o mesmo PBKDF2 do Meu Celeiro',async()=>{
  const one=await createPin('1234'),two=await createPin('1234');
  assert.notEqual(one.pin_hash,two.pin_hash);assert.notEqual(one.pin_salt,two.pin_salt);
  assert.equal(await verifyPin('1234',one),true);assert.equal(await verifyPin('9999',one),false);
  assert.equal(await verifyPin('123',one),false);await assert.rejects(()=>createPin('123'));
});
