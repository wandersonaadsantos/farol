// UM Farol por PR (v2.51.0). O que dá pra provar sem rede é o que importa aqui:
// a leitura dos sinais é PURA (labels legadas E refs, com a união no gate), o
// gate é síncrono e sem IO (mesmo contrato do reReviewTargets: quem decide
// gastar sessão Claude tem que ser testável), a saída de cena é DURÁVEL (era o
// defeito da v2.49.0: adiava cinco minutos e revisava depois), ela CADUCA quando
// a sessão do colega morre sem deixar review, e a co-assinatura é opt-in com
// gates próprios. Desde 28/08/2026 (incidente do biud-frontend#845) a saída de
// cena é SILENCIOSA no GitHub: nada de comentário público (era template
// detectável), a âncora nasce da decisão e o aviso é um toast no app.
import os from 'node:os';
import path from 'node:path';
// ISOLAMENTO OBRIGATÓRIO, e ele estava faltando: saiDeCena/podarSkipComentado
// GRAVAM em STATE_DIR, que o paths.js resolve na hora do import. Sem fixar o
// FAROL_HOME antes, a suíte escrevia `skip-comentado.json` na instalação REAL
// (achado em 20/08/2026, com lixo de teste no ~/.farol de verdade). É a mesma
// lição do spawnlog.test.js documentada no CLAUDE.md, com outra roupa: lá o
// problema era o import hasteado, aqui era não ter env nenhuma.
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-skip-' + process.pid);

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const skip = await import('../lib/engine/skip-review.js');
const io = (await import('../lib/io.js')).default;
const { TEMPOS } = await import('../lib/constants.js');
const { revisandoPorOutros, revisandoPorSinais, textoDoPulo, outrosRevisando, standDownCaducou, quemAprovou } = skip;

const TTL = TEMPOS.SINAL_REVISAO_TTL_MS;

/* ---------- leitura das labels (PURA) ---------- */

test('revisandoPorOutros: acha a label de outra pessoa', () => {
  assert.deepEqual(revisandoPorOutros(['thiagocarvalho-dev:revisando'], 'wandersonbiuder'), ['thiagocarvalho-dev']);
});

test('revisandoPorOutros: a MINHA própria label não me barra, mesmo com outra caixa', () => {
  assert.deepEqual(revisandoPorOutros(['wandersonbiuder:revisando'], 'wandersonbiuder'), []);
  assert.deepEqual(revisandoPorOutros(['WandersonBiuder:revisando'], 'wandersonbiuder'), []);
});

// regra explícita do Wanderson: review de ferramenta não substitui olho humano
test('revisandoPorOutros: acrity NUNCA entra na conta', () => {
  assert.deepEqual(revisandoPorOutros(['acrity:revisando'], 'eu'), []);
  assert.deepEqual(revisandoPorOutros(['acrity:revisando', 'ana:revisando'], 'eu'), ['ana']);
});

/* ehFerramenta: as DUAS grafias da mesma ferramenta têm que se encontrar. O
   prefixo da label é `acrity`; o login na API de reviews é
   `acrity-advesarial-code-review[bot]`. Confundir os dois custou a revisão
   automática de um PR inteiro do time (biudtech/engine-ai#108, 29/08/2026). */
test('ehFerramenta: reconhece a ferramenta pelas três provas', () => {
  const { ehFerramenta } = skip;
  assert.equal(ehFerramenta('acrity'), true, 'o nome cru da lista');
  assert.equal(ehFerramenta('acrity-advesarial-code-review[bot]'), true, 'o login REAL da API');
  assert.equal(ehFerramenta('acrity-advesarial-code-review'), true, 'o mesmo login sem o sufixo');
  assert.equal(ehFerramenta('ACRITY-Advesarial-Code-Review[BOT]'), true, 'caixa não importa');
  assert.equal(ehFerramenta('coderabbitai[bot]'), true, 'qualquer bot, sem estar em lista');
  assert.equal(ehFerramenta('alguem', 'Bot'), true, 'o type da API basta sozinho');
});

test('ehFerramenta: gente continua sendo gente', () => {
  const { ehFerramenta } = skip;
  assert.equal(ehFerramenta('Alexpraxedes'), false);
  assert.equal(ehFerramenta('wandersonbiuder', 'User'), false);
  assert.equal(ehFerramenta('acrityana'), false, 'prefixo sem hífen não é a ferramenta');
  assert.equal(ehFerramenta(''), false);
  assert.equal(ehFerramenta(null), false);
});

/* LABEL ÓRFÃ (bug de campo relatado em 29/08/2026: "o Farol tem pulado review
   sem nunca ninguém estar analisando o PR"). A label `<conta>:revisando` é
   aplicada no início da sessão e removida no finally, mas o finally não roda
   quando o app morre no meio (o farol.log desta máquina tem 3 quedas de
   renderer em 3 dias, além dos reinícios do auto-update), e a remoção também
   pode falhar por rede (WARN `label ... não saiu de ...` observado em
   biud-esg#260). Label presa não tem relógio nenhum: as REFS da v2.53.9 já
   caducavam em 1h (sinalVivo), a label não caducava NUNCA, então um Farol morto
   calava a frota inteira naquele PR pra sempre. O relógio é local e honesto: há
   quanto tempo ESTE Farol vê a mesma label. Falta de carimbo = label nova = vale,
   então o gate nunca fica mais permissivo do que era na primeira observação. */
test('revisandoPorOutros: label vista há mais que o TTL é órfã e não segura mais', () => {
  const agora = 1_000_000_000;
  const vistas = { ana: agora - TTL - 1 };
  assert.deepEqual(revisandoPorOutros(['ana:revisando'], 'eu', vistas, agora, TTL), []);
});

test('revisandoPorOutros: label vista há POUCO continua segurando', () => {
  const agora = 1_000_000_000;
  const vistas = { ana: agora - 60_000 };
  assert.deepEqual(revisandoPorOutros(['ana:revisando'], 'eu', vistas, agora, TTL), ['ana']);
});

test('revisandoPorOutros: sem carimbo a label vale (falta de dado nunca libera sozinha)', () => {
  const agora = 1_000_000_000;
  assert.deepEqual(revisandoPorOutros(['ana:revisando'], 'eu', {}, agora, TTL), ['ana']);
  assert.deepEqual(revisandoPorOutros(['ana:revisando'], 'eu'), ['ana'], 'chamada antiga, sem relógio, segue igual');
});

test('marcarLabelsVistas: carimba na primeira vez e PRESERVA o carimbo depois', () => {
  const e = { labelVistaDesde: {}, accountForPr: () => 'eu', saveLabelVistaDesde: () => {} };
  const pano = [{ key: 'o/r#1', labels: ['ana:revisando'] }];
  skip.marcarLabelsVistas(e, pano, 1000);
  assert.deepEqual(e.labelVistaDesde['o/r#1'], { ana: 1000 });
  skip.marcarLabelsVistas(e, pano, 9000);
  assert.equal(e.labelVistaDesde['o/r#1'].ana, 1000, 'é isso que faz o tempo passar');
});

test('marcarLabelsVistas: label que saiu do PR perde o carimbo (sessão nova recomeça o relógio)', () => {
  const e = { labelVistaDesde: { 'o/r#1': { ana: 1000 } }, accountForPr: () => 'eu', saveLabelVistaDesde: () => {} };
  skip.marcarLabelsVistas(e, [{ key: 'o/r#1', labels: [] }], 9000);
  assert.equal(e.labelVistaDesde['o/r#1'], undefined);
});

test('marcarLabelsVistas: PR que saiu do panorama perde o carimbo', () => {
  const e = { labelVistaDesde: { 'o/r#9': { ana: 1000 } }, accountForPr: () => 'eu', saveLabelVistaDesde: () => {} };
  skip.marcarLabelsVistas(e, [{ key: 'o/r#1', labels: ['ana:revisando'] }], 9000);
  assert.equal(e.labelVistaDesde['o/r#9'], undefined);
});

test('revisandoPorOutros: label que não é de revisando é ignorada', () => {
  assert.deepEqual(revisandoPorOutros(['bug', 'acrity:approved', 'review:in-progress'], 'eu'), []);
});

test('revisandoPorOutros: várias pessoas saem sem repetição e em ordem estável', () => {
  assert.deepEqual(revisandoPorOutros(['zoe:revisando', 'ana:revisando', 'zoe:revisando'], 'eu'), ['ana', 'zoe']);
});

test('revisandoPorOutros: entrada torta nunca lança', () => {
  assert.deepEqual(revisandoPorOutros(null, 'eu'), []);
  assert.deepEqual(revisandoPorOutros('nao-e-array', 'eu'), []);
  assert.deepEqual(revisandoPorOutros([null, '', ':revisando'], 'eu'), []);
});

/* ---------- leitura das refs (PURA) ---------- */

const sinal = (number, login, epochMs) => ({ ref: `refs/farol/revisando/${number}/${login}/${epochMs}`, number, login, epochMs });

test('revisandoPorSinais: acha a ref de outra pessoa no PR certo', () => {
  const agora = 1756400000000;
  const entries = [sinal(845, 'ana', agora - 1000), sinal(846, 'zoe', agora - 1000)];
  assert.deepEqual(revisandoPorSinais(entries, 845, 'eu', agora, TTL), ['ana'], 'a ref do PR 846 não fala deste PR');
});

test('revisandoPorSinais: a MINHA própria ref não me barra, mesmo com outra caixa', () => {
  const agora = 1756400000000;
  assert.deepEqual(revisandoPorSinais([sinal(1, 'WandersonBiuder', agora)], 1, 'wandersonbiuder', agora, TTL), []);
});

test('revisandoPorSinais: acrity NUNCA entra na conta (review de ferramenta não dispensa olho humano)', () => {
  const agora = 1756400000000;
  assert.deepEqual(revisandoPorSinais([sinal(1, 'acrity', agora), sinal(1, 'ana', agora)], 1, 'eu', agora, TTL), ['ana']);
});

test('revisandoPorSinais: o TTL vale pros DOIS lados do relógio', () => {
  const agora = 1756400000000;
  const entries = [
    sinal(1, 'morta', agora - TTL - 1000),          // sessão morta há mais de um TTL
    sinal(1, 'viva', agora - 1000),                 // sessão de agora
    sinal(1, 'relogio-adiantado', agora + TTL + 1000), // máquina alheia com relógio adiantado
  ];
  assert.deepEqual(revisandoPorSinais(entries, 1, 'eu', agora, TTL), ['viva'],
    'ref imortal de relógio adiantado é ignorada igual à expirada');
});

test('revisandoPorSinais: dedup sem caixa, primeira grafia, ordem estável', () => {
  const agora = 1756400000000;
  const entries = [sinal(1, 'Zoe', agora), sinal(1, 'ana', agora), sinal(1, 'zoe', agora - 1)];
  assert.deepEqual(revisandoPorSinais(entries, 1, 'eu', agora, TTL), ['ana', 'Zoe']);
});

test('revisandoPorSinais: entrada torta nunca lança', () => {
  assert.deepEqual(revisandoPorSinais(null, 1, 'eu', 1, TTL), []);
  assert.deepEqual(revisandoPorSinais('nao-e-array', 1, 'eu', 1, TTL), []);
  assert.deepEqual(revisandoPorSinais([null, {}, { number: 1 }], 1, 'eu', 1, TTL), []);
});

/* ---------- o gate: síncrono, sem IO, união das duas fontes ---------- */

test('outrosRevisando: lê só o que os ciclos já trouxeram, nunca chama gh', () => {
  const engine = {
    accountForPr: () => 'eu',
    ghEnv: () => { throw new Error('o gate não podia tocar o gh'); },
    tokenFor: () => { throw new Error('o gate não podia perguntar token'); },
  };
  assert.deepEqual(outrosRevisando(engine, { labels: ['ana:revisando'] }), ['ana']);
  // PR de uma busca antiga (sem o campo labels) degrada pra "ninguém revisando",
  // que é o comportamento de antes desta feature: falta de dado nunca pula revisão
  assert.deepEqual(outrosRevisando(engine, {}), []);
});

test('outrosRevisando: UNIÃO das labels legadas com as refs, ordem estável', () => {
  const engine = {
    accountForPr: () => 'eu',
    reviewSignals: new Map([['o/r', [sinal(1, 'zoe', Date.now())]]]),
  };
  const pr = { key: 'o/r#1', repo: 'o/r', number: 1, labels: ['ana:revisando'] };
  assert.deepEqual(outrosRevisando(engine, pr), ['ana', 'zoe'], 'colega de versão antiga (label) e de versão nova (ref) contam juntos');
});

test('outrosRevisando: dedup sem caixa entre as fontes, primeira grafia (a da label) vence', () => {
  const engine = {
    accountForPr: () => 'eu',
    reviewSignals: new Map([['o/r', [sinal(1, 'Ana', Date.now())]]]),
  };
  const pr = { key: 'o/r#1', repo: 'o/r', number: 1, labels: ['ana:revisando'] };
  assert.deepEqual(outrosRevisando(engine, pr), ['ana']);
});

test('outrosRevisando: ref expirada não conta, e a minha ref não me barra', () => {
  const agora = Date.now();
  const engine = {
    accountForPr: () => 'eu',
    reviewSignals: new Map([['o/r', [sinal(1, 'ana', agora - TTL - 60000), sinal(1, 'EU', agora)]]]),
  };
  assert.deepEqual(outrosRevisando(engine, { key: 'o/r#1', repo: 'o/r', number: 1, labels: [] }), []);
});

test('outrosRevisando: engine sem snapshot de refs degrada pras labels (transição)', () => {
  const engine = { accountForPr: () => 'eu' }; // sem reviewSignals nenhum
  assert.deepEqual(outrosRevisando(engine, { key: 'o/r#1', repo: 'o/r', number: 1, labels: ['ana:revisando'] }), ['ana']);
});

test('outrosRevisando: refs de outro repo não vazam pra este PR', () => {
  const engine = {
    accountForPr: () => 'eu',
    reviewSignals: new Map([['o/outro', [sinal(1, 'ana', Date.now())]]]),
  };
  assert.deepEqual(outrosRevisando(engine, { key: 'o/r#1', repo: 'o/r', number: 1, labels: [] }), []);
});

/* ---------- texto do toast (era o comentário público até 28/08/2026) ---------- */

test('textoDoPulo: sem citar automação, sem pronome de gênero e sem travessão', () => {
  const t = textoDoPulo(['ana']);
  assert.match(t, /@ana já está revisando/);
  assert.doesNotMatch(t, /Farol|automa|bot|IA|revisão automática/i);
  assert.doesNotMatch(t, /\bele\b|\bela\b/i);
  assert.doesNotMatch(t, /—/);
});

test('textoDoPulo: plural e lista com "e" no fim', () => {
  assert.match(textoDoPulo(['ana', 'zoe']), /@ana e @zoe já estão revisando/);
  assert.match(textoDoPulo(['ana', 'bia', 'zoe']), /@ana, @bia e @zoe/);
  assert.equal(textoDoPulo([]), '');
});

test('textoDaCoassinatura: humano e sem vazar automação', () => {
  const t = skip.textoDaCoassinatura('ana');
  assert.match(t, /@ana/);
  assert.doesNotMatch(t, /Farol|automa|bot|IA|co-assin/i);
});

/* ---------- caducidade (PURA) ---------- */

// a rede de segurança: sem isso, um crash na máquina do colega deixaria o PR órfão
test('standDownCaducou: caduca quando quem pegou sumiu sem deixar review', () => {
  const reg = { quem: ['ana'] };
  assert.equal(standDownCaducou(reg, [], []), true);
});

test('standDownCaducou: NÃO caduca enquanto a pessoa ainda está com a label', () => {
  assert.equal(standDownCaducou({ quem: ['ana'] }, ['ana'], []), false);
});

test('standDownCaducou: NÃO caduca quando ela deixou review no head', () => {
  assert.equal(standDownCaducou({ quem: ['ana'] }, [], [{ quem: 'ana', state: 'APPROVED' }]), false);
  assert.equal(standDownCaducou({ quem: ['ana'] }, [], [{ quem: 'ana', state: 'CHANGES_REQUESTED' }]), false);
});

// sem prova (rede fora) fico de fora: é o lado seguro de "um Farol por PR"
test('standDownCaducou: sem a lista de reviews NUNCA caduca', () => {
  assert.equal(standDownCaducou({ quem: ['ana'] }, [], null), false);
});

test('standDownCaducou: com duas pessoas, basta uma seguir viva pra não caducar', () => {
  assert.equal(standDownCaducou({ quem: ['ana', 'zoe'] }, ['zoe'], []), false);
  assert.equal(standDownCaducou({ quem: ['ana', 'zoe'] }, [], []), true);
});

test('quemAprovou: só considera quem eu saí de cena por causa', () => {
  const reg = { quem: ['ana'] };
  assert.equal(quemAprovou(reg, [{ quem: 'ana', state: 'APPROVED' }]), 'ana');
  assert.equal(quemAprovou(reg, [{ quem: 'ana', state: 'CHANGES_REQUESTED' }]), '');
  // aprovação de terceiro que não é quem pegou o PR não conta
  assert.equal(quemAprovou(reg, [{ quem: 'bob', state: 'APPROVED' }]), '');
});

/* ---------- autoridade na saída de cena (regra PLANA, 28/08/2026 à tarde) ----------
   A saída de cena não consulta mais cobreMinhaExigencia (ver alguém revisando
   SEMPRE segura o automático); o CODEOWNERS só responde se eu sou AUTORIDADE,
   porque isso gateia a co-assinatura ("nunca co-assino onde sou autoridade"). */

const PR_AUT = { key: 'o/r#1', url: 'https://github.com/o/r/pull/1', repo: 'o/r', number: 1 };
const { parseCodeowners } = await import('../lib/engine/codeowners.js');

// semeia o cache do CODEOWNERS pra decisão sair sem rede nenhuma
function engineComRegras(regrasTexto, extra = {}) {
  return {
    accountForPr: () => 'eu',
    tokenFor: () => 'tok',
    codeownersCache: new Map([['o/r', { regras: parseCodeowners(regrasTexto), at: Date.now() }]]),
    fetchPrFiles: async () => [{ path: 'src/x.ts' }],
    ...extra,
  };
}

test('autoridadeNaSaida: sou dono de arquivo do PR, autoridade true', async () => {
  assert.equal(await skip.autoridadeNaSaida(engineComRegras('* @eu'), { ...PR_AUT }), true);
});

test('autoridadeNaSaida: dono é outra pessoa, autoridade false', async () => {
  assert.equal(await skip.autoridadeNaSaida(engineComRegras('* @ana'), { ...PR_AUT }), false);
});

test('autoridadeNaSaida: repo sem CODEOWNERS é conclusivo, autoridade false', async () => {
  const engine = engineComRegras('');
  assert.equal(await skip.autoridadeNaSaida(engine, { ...PR_AUT }), false);
});

// CODEOWNERS ilegível cai no lado seguro TRUE: co-assinar sem saber se sou
// autoridade é pior que não co-assinar
test('autoridadeNaSaida: sem token (CODEOWNERS ilegível) cai no lado seguro true', async () => {
  const engine = engineComRegras('* @ana', { tokenFor: () => null });
  assert.equal(await skip.autoridadeNaSaida(engine, { ...PR_AUT }), true);
});

test('autoridadeNaSaida: diff não medido cai no mesmo lado seguro true', async () => {
  const engine = engineComRegras('* @ana', { fetchPrFiles: async () => { throw new Error('rede'); } });
  assert.equal(await skip.autoridadeNaSaida(engine, { ...PR_AUT }), true);
});

/* ---------- saída de cena e co-assinatura ---------- */

function engineFalso(extra = {}) {
  return {
    skipComentado: {},
    config: {},
    logs: [], toasts: [], rodou: [], postados: [],
    accountForPr: () => 'eu',
    tokenFor: () => 'tok',
    ghEnv: () => ({}),
    log(nivel, msg) { this.logs.push({ nivel, msg }); },
    emit(ev, payload) { this.toasts.push({ ev, payload }); },
    myReviewStates: async () => [],
    postReview: async (pr, payload) => { extra.postados && extra.postados.push(payload); return { ok: true }; },
    ...extra,
  };
}

// substitui io.run pelo espião e devolve a função de restaurar
function espiaGh(engine, ok = true) {
  const original = io.run;
  io.run = (cmd, args) => { engine.rodou.push(args); return Promise.resolve({ ok, stdout: '[]', stderr: 'falhou' }); };
  return () => { io.run = original; };
}

const PR = { key: 'o/r#1', url: 'https://github.com/o/r/pull/1', repo: 'o/r', number: 1 };

// desde 28/08/2026 a saída de cena é silenciosa no GitHub: a âncora nasce da
// DECISÃO (não mais de um comentário que saiu) e o aviso é o toast no app
test('saiDeCena: grava a âncora POR HEAD e avisa por toast, sem gh nenhum', async (t) => {
  const engine = engineFalso();
  t.after(espiaGh(engine));
  const ok = await skip.saiDeCena(engine, PR, ['ana'], 'sha1', true);
  assert.equal(ok, true);
  assert.equal(engine.rodou.length, 0, 'NENHUM gh roda (nem pr comment, nem nada): zero rastro público');
  assert.equal(engine.skipComentado['o/r#1'].head, 'sha1');
  assert.deepEqual(engine.skipComentado['o/r#1'].quem, ['ana']);
  assert.equal(engine.skipComentado['o/r#1'].autoridade, true);
  const toast = engine.toasts.find(x => x.ev === 'toast');
  assert.ok(toast, 'o aviso existe, só que no app');
  assert.match(toast.payload.text, /@ana já está revisando/);
  assert.match(toast.payload.text, /o\/r#1/);
  assert.match(toast.payload.text, /sem postar nada público/i, 'o toast diz que nada foi postado');
});

// o contrato antigo "a âncora só nasce de comentário que saiu" morreu junto com
// o comentário; a exigência que fica é a lista de quem está revisando
test('saiDeCena: sem ninguém revisando não registra saída nenhuma', async (t) => {
  const engine = engineFalso();
  t.after(espiaGh(engine));
  assert.equal(await skip.saiDeCena(engine, PR, [], 'sha1'), false);
  assert.equal(engine.skipComentado['o/r#1'], undefined);
  assert.equal(engine.rodou.length, 0);
});

test('coAssinar: posta APPROVE em meu nome e marca a âncora', async (t) => {
  const postados = [];
  const engine = engineFalso({ postados });
  t.after(espiaGh(engine));
  engine.skipComentado['o/r#1'] = { head: 'sha1', quem: ['ana'] };
  assert.equal(await skip.coAssinar(engine, PR, 'ana', 'sha1'), true);
  assert.equal(postados[0].event, 'APPROVE');
  assert.match(postados[0].body, /@ana/);
  assert.equal(engine.skipComentado['o/r#1'].coAssinado, true);
});

// postar review não é idempotente: sem confirmar o que já existe, não posta
test('coAssinar: não posta quando eu já aprovei este head', async (t) => {
  const postados = [];
  const engine = engineFalso({ postados, myReviewStates: async () => ['APPROVED'] });
  t.after(espiaGh(engine));
  assert.equal(await skip.coAssinar(engine, PR, 'ana', 'sha1'), false);
  assert.equal(postados.length, 0);
});

test('coAssinar: sem conseguir confirmar meus reviews (null), não posta', async (t) => {
  const postados = [];
  const engine = engineFalso({ postados, myReviewStates: async () => null });
  t.after(espiaGh(engine));
  assert.equal(await skip.coAssinar(engine, PR, 'ana', 'sha1'), false);
  assert.equal(postados.length, 0);
});

/* ---------- o ciclo: seguir fora, caducar ou co-assinar ---------- */

// espião que devolve uma lista de reviews de outros pelo caminho do gh api
function espiaReviews(engine, lista) {
  const original = io.run;
  io.run = (cmd, args) => {
    engine.rodou.push(args);
    if (args[0] === 'api') return Promise.resolve({ ok: true, stdout: JSON.stringify(lista), stderr: '' });
    return Promise.resolve({ ok: true, stdout: '', stderr: '' });
  };
  return () => { io.run = original; };
}

test('seguirForaDeCena: sessão do colega morreu sem review, a saída caduca', async (t) => {
  const engine = engineFalso();
  t.after(espiaReviews(engine, []));
  engine.skipComentado['o/r#1'] = { head: 'sha1', quem: ['ana'] };
  const fora = await skip.seguirForaDeCena(engine, { ...PR, labels: [] }, engine.skipComentado['o/r#1'], 'sha1');
  assert.equal(fora, false, 'volta a revisar');
  assert.equal(engine.skipComentado['o/r#1'], undefined, 'âncora some');
});

test('seguirForaDeCena: com a chave DESLIGADA, aprovação do colega não co-assina', async (t) => {
  const postados = [];
  const engine = engineFalso({ postados });
  t.after(espiaReviews(engine, [{ quem: 'ana', state: 'APPROVED', commit_id: 'sha1' }]));
  engine.skipComentado['o/r#1'] = { head: 'sha1', quem: ['ana'] };
  const fora = await skip.seguirForaDeCena(engine, { ...PR, labels: [] }, engine.skipComentado['o/r#1'], 'sha1');
  assert.equal(fora, true, 'segue fora de cena');
  assert.equal(postados.length, 0, 'nada foi postado');
});

test('seguirForaDeCena: com a chave LIGADA, aprovação do colega vira co-assinatura', async (t) => {
  const postados = [];
  const engine = engineFalso({ postados });
  engine.config.coAssinarReview = true;
  t.after(espiaReviews(engine, [{ quem: 'ana', state: 'APPROVED', commit_id: 'sha1' }]));
  engine.skipComentado['o/r#1'] = { head: 'sha1', quem: ['ana'] };
  const fora = await skip.seguirForaDeCena(engine, { ...PR, labels: [] }, engine.skipComentado['o/r#1'], 'sha1');
  assert.equal(fora, true);
  assert.equal(postados[0].event, 'APPROVE');
});

// pedido de mudanças do colega NÃO é aprovação: nada é co-assinado, e o PR
// continua fora de cena (um Farol por PR), esperando o autor corrigir
test('seguirForaDeCena: colega pediu mudanças, não co-assina e segue fora', async (t) => {
  const postados = [];
  const engine = engineFalso({ postados });
  engine.config.coAssinarReview = true;
  t.after(espiaReviews(engine, [{ quem: 'ana', state: 'CHANGES_REQUESTED', commit_id: 'sha1' }]));
  engine.skipComentado['o/r#1'] = { head: 'sha1', quem: ['ana'] };
  assert.equal(await skip.seguirForaDeCena(engine, { ...PR, labels: [] }, engine.skipComentado['o/r#1'], 'sha1'), true);
  assert.equal(postados.length, 0);
});

test('seguirForaDeCena: já co-assinado não posta de novo', async (t) => {
  const postados = [];
  const engine = engineFalso({ postados });
  engine.config.coAssinarReview = true;
  t.after(espiaReviews(engine, [{ quem: 'ana', state: 'APPROVED', commit_id: 'sha1' }]));
  engine.skipComentado['o/r#1'] = { head: 'sha1', quem: ['ana'], coAssinado: true };
  await skip.seguirForaDeCena(engine, { ...PR, labels: [] }, engine.skipComentado['o/r#1'], 'sha1');
  assert.equal(postados.length, 0);
});

// review de head ANTIGO não conta: o autor empurrou código novo desde então
test('reviewsDeOutros: filtra pelo head pedido', async (t) => {
  const engine = engineFalso();
  t.after(espiaReviews(engine, [
    { quem: 'ana', state: 'APPROVED', commit_id: 'sha-velho' },
    { quem: 'zoe', state: 'APPROVED', commit_id: 'sha1' },
  ]));
  const lista = await skip.reviewsDeOutros(engine, PR, 'sha1');
  assert.deepEqual(lista.map(r => r.quem), ['zoe']);
});

test('podarSkipComentado: âncora some junto com o PR que saiu do panorama', () => {
  const engine = engineFalso();
  engine.skipComentado = { 'o/r#1': { at: 1 }, 'o/r#2': { at: 2 } };
  skip.podarSkipComentado(engine, new Set(['o/r#1']));
  assert.deepEqual(Object.keys(engine.skipComentado), ['o/r#1']);
});

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });
