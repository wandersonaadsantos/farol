// A label pública só entra quando a sessão prova vida (primeiro evento) ou depois do prazo
// pós-spawn: sessão que morre nos primeiros segundos não deixa label nenhuma no PR.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { armarLabelTardia } = await import('../lib/engine/label-tardia.js');

// relógio falso: guarda o timer e deixa o teste dispará-lo à mão
function relogio() {
  const r = { timers: new Map(), seq: 0 };
  r.setTimer = (fn, ms) => { const id = ++r.seq; r.timers.set(id, { fn, ms }); return id; };
  r.clearTimer = (id) => { r.timers.delete(id); };
  r.avancar = () => { for (const [id, t] of [...r.timers]) { r.timers.delete(id); t.fn(); } };
  return r;
}

function montar() {
  const r = relogio();
  let chamadas = 0;
  const tardia = armarLabelTardia({
    adicionar: async () => { chamadas += 1; return 'conta:revisando'; },
    esperaMs: 15000, setTimer: r.setTimer, clearTimer: r.clearTimer,
  });
  return { r, tardia, chamadas: () => chamadas };
}

test('dispara uma vez no primeiro evento, e o timer não dispara de novo', async () => {
  const { r, tardia, chamadas } = montar();
  tardia.aoAdmitir();
  assert.equal([...r.timers.values()][0].ms, 15000);
  tardia.aoEvento(); tardia.aoEvento();
  r.avancar();
  assert.equal(await tardia.promessa(), 'conta:revisando');
  assert.equal(chamadas(), 1);
  assert.equal(r.timers.size, 0, 'o timer foi apagado no primeiro disparo');
});

test('sem evento, dispara no prazo', async () => {
  const { r, tardia, chamadas } = montar();
  tardia.aoAdmitir();
  assert.equal(chamadas(), 0);
  r.avancar();
  assert.equal(await tardia.promessa(), 'conta:revisando');
  assert.equal(chamadas(), 1);
});

test('cancelar antes do prazo e sem evento: nunca dispara, promessa resolve vazio', async () => {
  const { r, tardia, chamadas } = montar();
  tardia.aoAdmitir();
  tardia.cancelar();
  r.avancar(); tardia.aoEvento(); tardia.aoAdmitir();
  assert.equal(await tardia.promessa(), '');
  assert.equal(chamadas(), 0);
});

test('falha na adição não sobe: a promessa resolve vazio', async () => {
  const r = relogio();
  const tardia = armarLabelTardia({ adicionar: async () => { throw new Error('rede'); }, esperaMs: 1, setTimer: r.setTimer, clearTimer: r.clearTimer });
  tardia.aoEvento();
  assert.equal(await tardia.promessa(), '');
});
