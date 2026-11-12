// Uso do plano e validade do login do Claude (12/11/2026): o que o `/usage` do CLI vira, o
// aviso de login que vence, a leitura com cache e fila, e o que a tela mostra.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
process.env.FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-uso-plano-'));

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
const { TEMPOS } = await import('../lib/constants.js');
const uso = await import('../lib/engine/uso-do-plano.js');
const { cadeiaParaTela } = await import('../lib/engine/cadeia-perfis.js');
const { usoDoPlanoHtml, validadeDoLoginHtml, cadeiaHtml } = await import('../ui/pure.js');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

const AGORA = Date.parse('2026-11-12T04:30:00Z');
const VENCE = '2026-12-04T11:45:01.476Z';
// a saída real do Claude Code 2.1.322, medida em 12/11/2026
const TEXTO = [
  'You are currently using your subscription to power your Claude Code usage',
  '',
  'Current session: 29% used · resets Nov 12, 5:59am (America/Sao_Paulo)',
  'Current week (all models): 81% used · resets Nov 12, 4:59am (America/Sao_Paulo)',
  'Current week (Fable): 10% used · resets Nov 12, 5am (America/Sao_Paulo)',
  '',
  "What's contributing to your usage?",
].join('\n');

function saida(result, extra = {}) {
  return { ok: true, code: 0, stdout: JSON.stringify({ type: 'result', is_error: false, num_turns: 0, result, ...extra }), stderr: '' };
}

const PERFIL = { id: 'p1', label: 'BIUD-EX-5X', dir: '/home/x/.claude-biud' };
const engineCom = (perfis = [PERFIL]) => ({ config: { claudeProfiles: perfis, cadeiaPerfis: perfis.map((p) => ({ id: p.id, ativo: true })) } });

test('resumirUso: as três janelas da saída real, com o reset no fuso do CLI', () => {
  const janelas = uso.resumirUso(TEXTO, AGORA);
  assert.deepEqual(janelas.map((j) => [j.id, j.nome, j.usado]), [['sessao', 'Sessão', 0.29], ['semana', 'Semana', 0.81], ['semana:fable', 'Semana Fable', 0.1]]);
  assert.equal(new Date(janelas[0].reset).toISOString(), '2026-11-12T08:59:00.000Z');
  assert.equal(new Date(janelas[2].reset).toISOString(), '2026-11-12T08:00:00.000Z');
});

test('resumirUso: linha que não casa fica de fora, e texto de outro formato não vira número', () => {
  assert.deepEqual(uso.resumirUso('Total cost: $0.0000\nUsage: 0 input, 0 output', AGORA), []);
  assert.deepEqual(uso.resumirUso('Current session: 140% used', AGORA), []);
  assert.deepEqual(uso.resumirUso(null, AGORA), []);
  const semReset = uso.resumirUso('Current session: 7% used', AGORA);
  assert.deepEqual([semReset[0].usado, semReset[0].reset, semReset[0].resetTexto], [0.07, 0, '']);
});

test('resetEmMs: sem data é a próxima vez da hora; virada do ano; fuso ou texto desconhecido = 0', () => {
  assert.equal(new Date(uso.resetEmMs('6am (America/Sao_Paulo)', AGORA)).toISOString(), '2026-11-12T09:00:00.000Z');
  assert.equal(new Date(uso.resetEmMs('1am (America/Sao_Paulo)', AGORA)).toISOString(), '2026-11-13T04:00:00.000Z');
  const dezembro = Date.parse('2026-12-30T00:00:00Z');
  assert.equal(new Date(uso.resetEmMs('Jan 2, 1pm (America/Sao_Paulo)', dezembro)).toISOString(), '2027-01-02T16:00:00.000Z');
  assert.equal(new Date(uso.resetEmMs('Nov 12, 12pm (UTC)', AGORA)).toISOString(), '2026-11-12T12:00:00.000Z');
  assert.equal(new Date(uso.resetEmMs('Nov 12, 12am (UTC)', AGORA)).toISOString(), '2026-11-12T00:00:00.000Z');
  assert.equal(uso.resetEmMs('6am (Marte/Olimpo)', AGORA), 0);
  assert.equal(uso.resetEmMs('amanhã cedo', AGORA), 0);
});

test('leituraDaSaida: uso e validade; login vencido responde sem janela e sem validade', () => {
  const boa = uso.leituraDaSaida(saida(TEXTO, { credential_expires_at: VENCE }), AGORA);
  assert.equal(boa.ok, true);
  assert.equal(boa.erro, '');
  assert.equal(boa.janelas.length, 3);
  assert.equal(boa.venceEm, Date.parse(VENCE));

  const vencido = uso.leituraDaSaida(saida('Total cost:            $0.0000\nUsage: 0 input'), AGORA);
  assert.deepEqual([vencido.ok, vencido.semLogin, vencido.venceEm, vencido.erro], [false, true, 0, 'sem login válido nesta pasta']);

  // o texto mudou, a validade continua saindo do campo próprio
  const mudou = uso.leituraDaSaida(saida('Sessão: 29%', { credential_expires_at: VENCE }), AGORA);
  assert.deepEqual([mudou.ok, mudou.venceEm, mudou.erro], [false, Date.parse(VENCE), 'o Claude Code mudou o formato do uso']);
});

test('leituraDaSaida: sem JSON e prazo estourado têm motivo próprio; aviso antes do JSON não atrapalha', () => {
  assert.equal(uso.leituraDaSaida({ ok: false, code: 1, stdout: 'erro qualquer', stderr: '' }, AGORA).erro, 'o Claude Code não devolveu o uso');
  assert.equal(uso.leituraDaSaida({ ok: false, code: null, stdout: '', stderr: '' }, AGORA).erro, 'o Claude Code não respondeu a tempo');
  const comAviso = saida(TEXTO, { credential_expires_at: VENCE });
  comAviso.stdout = `aviso de atualização\n${comAviso.stdout}\n`;
  assert.equal(uso.leituraDaSaida(comAviso, AGORA).ok, true);
});

test('pastaDoUso: só assinatura do Claude por pasta; o login da máquina é pasta vazia', () => {
  assert.deepEqual(uso.pastaDoUso(PERFIL, {}), { dir: '/home/x/.claude-biud' });
  assert.deepEqual(uso.pastaDoUso({ id: 'maquina', kind: 'maquina' }, {}), { dir: '' });
  for (const p of [{ id: 'a', kind: 'apikey', apiKey: 'k' }, { id: 'o', kind: 'openrouter', apiKey: 'k' }, { id: 'c', kind: 'codex' }, { id: 'g', kind: 'agy' }, null]) {
    assert.equal(uso.pastaDoUso(p, {}), null);
  }
});

test('avisoDeVencimento: longe não avisa; cada faixa tem chave própria; login renovado volta a avisar', () => {
  const vence = AGORA + 10 * TEMPOS.DIA_MS;
  assert.equal(uso.avisoDeVencimento(PERFIL, vence, AGORA), null);
  assert.equal(uso.avisoDeVencimento(PERFIL, 0, AGORA), null);
  const perto = uso.avisoDeVencimento(PERFIL, vence, vence - 2 * TEMPOS.DIA_MS);
  const ultimo = uso.avisoDeVencimento(PERFIL, vence, vence - TEMPOS.HORA_MS);
  const vencido = uso.avisoDeVencimento(PERFIL, vence, vence + 1);
  assert.equal(new Set([perto.chave, ultimo.chave, vencido.chave]).size, 3);
  assert.match(perto.texto, /BIUD-EX-5X vence em/);
  assert.match(vencido.texto, /BIUD-EX-5X venceu em/);
  assert.match(perto.texto, /Plano e chaves/);
  const renovado = uso.avisoDeVencimento(PERFIL, vence + 28 * TEMPOS.DIA_MS, vence + 26 * TEMPOS.DIA_MS);
  assert.notEqual(renovado.chave, perto.chave);
});

test('avisar: um toast por faixa, não um por leitura', () => {
  const toasts = [];
  const engine = { ...engineCom(), emit: (ev, dado) => toasts.push([ev, dado]) };
  const leitura = { venceEm: AGORA + TEMPOS.DIA_MS * 2 };
  uso.avisar(engine, PERFIL, leitura, AGORA);
  uso.avisar(engine, PERFIL, leitura, AGORA + TEMPOS.HORA_MS);
  // a validade lida de novo com segundos de diferença é a mesma validade
  uso.avisar(engine, PERFIL, { venceEm: leitura.venceEm + 1500 }, AGORA + 2 * TEMPOS.HORA_MS);
  assert.equal(toasts.length, 1);
  assert.deepEqual([toasts[0][0], toasts[0][1].kind], ['toast', 'info']);
  uso.avisar(engine, PERFIL, leitura, leitura.venceEm - TEMPOS.HORA_MS);
  assert.equal(toasts.length, 2);
  assert.equal(toasts[1][1].kind, 'error', 'no último dia o aviso é de erro');
});

test('lerUso: cache curto, leitura única por perfil e uma de cada vez na máquina', async () => {
  const engine = engineCom([PERFIL, { id: 'p2', label: 'Outro', dir: '/home/x/.claude-outro' }]);
  const chamadas = [];
  let abertas = 0;
  let pico = 0;
  const rodar = async (dir, comando, opts) => {
    chamadas.push({ dir, comando, opts });
    abertas += 1;
    pico = Math.max(pico, abertas);
    await new Promise((r) => setTimeout(r, 5));
    abertas -= 1;
    return saida(TEXTO, { credential_expires_at: VENCE });
  };
  const [a, b, c] = await Promise.all([
    uso.lerUso(engine, PERFIL, { rodar }),
    uso.lerUso(engine, PERFIL, { rodar }),
    uso.lerUso(engine, engine.config.claudeProfiles[1], { rodar }),
  ]);
  assert.equal(a, b, 'quem chega no meio espera a mesma leitura');
  assert.equal(c.ok, true);
  assert.equal(chamadas.length, 2);
  assert.equal(pico, 1, 'nunca dois CLIs ao mesmo tempo');
  assert.equal(chamadas[0].comando, uso.COMANDO);
  assert.match(chamadas[0].comando, /^claude -p "\/usage" --output-format json/);
  assert.equal(chamadas[0].opts.timeout, TEMPOS.CLAUDE_USO_LIMITE_MS);

  await uso.lerUso(engine, PERFIL, { rodar });
  assert.equal(chamadas.length, 2, 'dentro do cache não abre o CLI');
  await uso.lerUso(engine, PERFIL, { rodar, agora: Date.now() + TEMPOS.CLAUDE_USO_CACHE_MS + 1 });
  assert.equal(chamadas.length, 3, 'cache vencido lê de novo');
  await uso.lerUso(engine, PERFIL, { rodar, forcar: true });
  assert.equal(chamadas.length, 4);
});

test('lerUso: perfil que não é assinatura não abre o CLI, e o CLI que lança vira leitura com erro', async () => {
  const engine = engineCom([{ id: 'k', kind: 'apikey', apiKey: 'x' }, PERFIL]);
  let chamou = 0;
  assert.equal(await uso.lerUso(engine, engine.config.claudeProfiles[0], { rodar: async () => { chamou += 1; } }), null);
  assert.equal(chamou, 0);
  // a mensagem da exceção traz caminho da máquina: vai ao log uma vez, nunca à tela
  const logs = [];
  engine.log = (nivel, texto) => logs.push([nivel, texto]);
  const lanca = async () => { throw new Error("EACCES: copyfile 'C:\\Users\\alguem\\.claude-x\\.claude.json'"); };
  const l = await uso.lerUso(engine, PERFIL, { rodar: lanca });
  assert.deepEqual([l.ok, l.erro, l.janelas.length], [false, uso.ERRO_DE_LEITURA, 0]);
  await uso.lerUso(engine, PERFIL, { rodar: lanca, forcar: true });
  assert.equal(logs.length, 1);
  assert.match(logs[0][1], /BIUD-EX-5X: EACCES/);
  assert.equal(JSON.stringify(uso.usoParaTela(engine, PERFIL, AGORA)).includes('alguem'), false);
});

test('falha de passagem mantém a última leitura boa, marcada; depois de uma hora ela sai', async () => {
  const engine = engineCom();
  const boa = await uso.lerUso(engine, PERFIL, { rodar: async () => saida(TEXTO, { credential_expires_at: VENCE }) });
  const semResposta = async () => ({ ok: false, code: null, stdout: '', stderr: '' });
  const l = await uso.lerUso(engine, PERFIL, { rodar: semResposta, forcar: true });
  assert.deepEqual([l.ok, l.desatualizado, l.janelas.length, l.venceEm, l.lidaEm], [true, true, 3, boa.venceEm, boa.em]);
  assert.equal(l.erro, 'o Claude Code não respondeu a tempo');
  const tela = uso.usoParaTela(engine, PERFIL, AGORA);
  assert.deepEqual([tela.desatualizado, tela.lidaEm], [true, boa.em]);
  assert.match(usoDoPlanoHtml(tela, AGORA), /uso-pct">29%[\s\S]*Não foi possível atualizar agora\. Uso lido /);

  const velha = { ...boa, em: boa.em - TEMPOS.HORA_MS - 1 };
  const nova = { ok: false, respondeu: false, erro: 'x', semLogin: false, janelas: [], venceEm: 0, em: boa.em };
  assert.equal(uso.comAnterior(nova, velha), nova, 'leitura boa com mais de uma hora não é mantida');
});

test('login que venceu continua dizendo quando venceu; validade no futuro não é herdada', () => {
  const semLogin = { ok: false, respondeu: true, semLogin: true, erro: 'sem login válido nesta pasta', janelas: [], venceEm: 0, em: AGORA };
  const vencida = uso.comAnterior(semLogin, { ok: true, venceEm: AGORA - TEMPOS.HORA_MS, em: AGORA - 2 * TEMPOS.HORA_MS });
  assert.equal(vencida.venceEm, AGORA - TEMPOS.HORA_MS);
  assert.equal(uso.faixaDoVencimento(vencida.venceEm, AGORA), 'vencido');
  assert.equal(uso.comAnterior(semLogin, { ok: true, venceEm: AGORA + TEMPOS.DIA_MS, em: AGORA - TEMPOS.HORA_MS }).venceEm, 0, 'logout antes do prazo não vira vencimento');
});

test('agendarLeitura: só o engine ligado no boot lê, e a leitura avisa e atualiza a tela', async () => {
  const eventos = [];
  let abriu = 0;
  const rodar = async () => { abriu += 1; return saida(TEXTO, { credential_expires_at: new Date(Date.now() + TEMPOS.DIA_MS * 2).toISOString() }); };
  // um engine de teste com ghEnv e tudo, como o `new Engine()` da suíte: sem a chave, nada abre
  const engine = { ...engineCom(), ghEnv: () => ({}), emit: (ev, d) => eventos.push([ev, d.kind]), pushState: () => eventos.push(['pushState']) };
  uso.agendarLeitura(engine, PERFIL, Date.now(), rodar);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(abriu, 0);

  engine.usoDoPlanoLigado = true;
  uso.agendarLeitura(engine, PERFIL, Date.now(), rodar);
  uso.agendarLeitura(engine, PERFIL, Date.now(), rodar);
  await engine.filaDoUsoDoPlano;
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(abriu, 1, 'leitura em andamento não agenda outra');
  assert.deepEqual(eventos, [['toast', 'info'], ['pushState']]);
  uso.agendarLeitura(engine, PERFIL, Date.now(), rodar);
  assert.equal(abriu, 1, 'leitura fresca não reagenda: o pushState não vira laço');
});

test('esquecerPasta: login refeito apaga a leitura guardada dos perfis daquela pasta', async () => {
  const outro = { id: 'p2', label: 'Outro', dir: '/home/x/.claude-outro' };
  const engine = engineCom([PERFIL, outro, { id: 'maquina', kind: 'maquina' }]);
  for (const p of engine.config.claudeProfiles) await uso.lerUso(engine, p, { rodar: async () => saida(TEXTO, { credential_expires_at: VENCE }) });
  uso.esquecerPasta(engine, PERFIL.dir);
  assert.deepEqual([...engine.usosDoPlano.keys()], ['p2', 'maquina']);
  uso.esquecerPasta(engine, '');
  assert.deepEqual([...engine.usosDoPlano.keys()], ['p2']);
});

test('resetEmMs: troca de horário de verão e leitura na virada do ano', () => {
  // 1/11/2026 02:00 em Nova York o relógio volta uma hora; 8/3/2026 02:00 ele adianta
  assert.equal(new Date(uso.resetEmMs('Nov 1, 3am (America/New_York)', Date.parse('2026-10-31T12:00:00Z'))).toISOString(), '2026-11-01T08:00:00.000Z');
  assert.equal(new Date(uso.resetEmMs('Mar 8, 4am (America/New_York)', Date.parse('2026-03-07T12:00:00Z'))).toISOString(), '2026-03-08T08:00:00.000Z');
  // reset de 31/12 lido já em 1/1: é o de ontem, não o do fim do ano que começa
  assert.equal(new Date(uso.resetEmMs('Dec 31, 11pm (UTC)', Date.parse('2027-01-01T00:30:00Z'))).toISOString(), '2026-12-31T23:00:00.000Z');
});

test('leituraDaSaida: processo que não abriu (ENOENT) não é prazo estourado', () => {
  assert.equal(uso.leituraDaSaida({ ok: false, code: 'ENOENT', stdout: '', stderr: '' }, AGORA).erro, 'o Claude Code não devolveu o uso');
});

test('usoParaTela: allowlist sem pasta nem conta, com a faixa do login; fora da assinatura é null', async () => {
  const engine = engineCom();
  assert.deepEqual(uso.usoParaTela(engine, PERFIL, AGORA), { lido: false });
  await uso.lerUso(engine, PERFIL, { rodar: async () => saida(TEXTO, { credential_expires_at: VENCE }) });
  const tela = uso.usoParaTela(engine, PERFIL, Date.parse(VENCE) - TEMPOS.DIA_MS * 2);
  assert.deepEqual(Object.keys(tela).sort(), ['desatualizado', 'em', 'erro', 'faixaDoLogin', 'janelas', 'lidaEm', 'lido', 'ok', 'venceEm']);
  assert.equal(tela.faixaDoLogin, 'perto');
  assert.equal(JSON.stringify(tela).includes('.claude-biud'), false);
  assert.equal(uso.usoParaTela(engine, { id: 'g', kind: 'agy' }, AGORA), null);
});

test('cadeiaParaTela: todo perfil de assinatura leva o uso, ligado ou desligado', async () => {
  const perfis = [PERFIL, { id: 'p2', label: 'Desligado', dir: '/home/x/.claude-2' }, { id: 'c', label: 'Codex', kind: 'codex' }];
  const engine = { config: { claudeProfiles: perfis, cadeiaPerfis: [{ id: 'p1', ativo: true }, { id: 'p2', ativo: false }, { id: 'c', ativo: true }] } };
  await uso.lerUso(engine, perfis[1], { rodar: async () => saida(TEXTO, { credential_expires_at: VENCE }) });
  const entradas = cadeiaParaTela(engine, AGORA).entradas;
  assert.deepEqual(entradas.map((e) => [e.id, e.uso && e.uso.lido]), [['p1', false], ['p2', true], ['c', null]]);
  assert.equal(entradas[1].uso.janelas.length, 3);
});

test('tela: barra por janela, cor por faixa de uso e a hora em que volta', () => {
  const html = usoDoPlanoHtml({ lido: true, ok: true, venceEm: AGORA + 22 * TEMPOS.DIA_MS, faixaDoLogin: '', janelas: [
    { id: 'sessao', nome: 'Sessão', usado: 0.29, reset: AGORA + TEMPOS.HORA_MS },
    { id: 'semana', nome: 'Semana', usado: 0.81, reset: AGORA + 3 * TEMPOS.DIA_MS },
    { id: 'semana:fable', nome: 'Semana Fable', usado: 0.94, reset: 0, resetTexto: 'Nov 15, 5am (Marte/Olimpo)' },
  ] }, AGORA);
  assert.match(html, /uso-janela">\s*<span class="uso-topo"><span class="uso-nome">Sessão<\/span><span class="uso-pct">29%/);
  assert.match(html, /uso-janela uso-alto">[\s\S]*81%/);
  assert.match(html, /uso-janela uso-critico">[\s\S]*94%/);
  assert.match(html, /aria-label="Semana: 81% usados"/);
  assert.match(html, /volta hoje \d\d:\d\d/);
  assert.match(html, /volta \d\d\/\d\d \d\d:\d\d/);
  assert.match(html, /volta Nov 15, 5am \(Marte\/Olimpo\)/);
  assert.match(html, /Login vence \d\d\/\d\d \d\d:\d\d \(faltam 22 dias\)/);
});

test('tela: sem leitura, leitura com erro e perfil de outro provedor', () => {
  assert.equal(usoDoPlanoHtml(null), '');
  assert.match(usoDoPlanoHtml({ lido: false }), /ainda não lido/);
  const erro = usoDoPlanoHtml({ lido: true, ok: false, erro: 'sem login válido nesta pasta', janelas: [], venceEm: 0 }, AGORA);
  assert.match(erro, /Uso do plano não lido: sem login válido nesta pasta\./);
  assert.equal(erro.includes('uso-login'), false);
  assert.match(usoDoPlanoHtml({ lido: true, ok: false, erro: '<b>x</b>', janelas: [] }, AGORA), /&lt;b&gt;x&lt;\/b&gt;/);
});

test('tela: a validade do login muda de tom perto do vencimento e depois dele', () => {
  const vence = AGORA + 2 * TEMPOS.DIA_MS + TEMPOS.HORA_MS;
  assert.match(validadeDoLoginHtml({ venceEm: vence, faixaDoLogin: 'perto' }, AGORA), /pill session">Login vence em 2 dias<[\s\S]*Renove pela sessão de login/);
  assert.match(validadeDoLoginHtml({ venceEm: AGORA + 5 * TEMPOS.HORA_MS, faixaDoLogin: 'ultimo-dia' }, AGORA), /pill err">Login vence em 5 h</);
  assert.match(validadeDoLoginHtml({ venceEm: AGORA - TEMPOS.HORA_MS, faixaDoLogin: 'vencido' }, AGORA), /pill err">Login vencido<[\s\S]*Desde (hoje|ontem) \d\d:\d\d\./);
  assert.match(validadeDoLoginHtml({ venceEm: AGORA + TEMPOS.DIA_MS * 1.5, faixaDoLogin: '' }, AGORA), /faltam 1 dia\)/);
  assert.equal(validadeDoLoginHtml({ venceEm: 0 }, AGORA), '');
});

test('tela: a linha da ordem de uso leva o uso do perfil do Claude e não muda a dos outros', () => {
  const html = cadeiaHtml({ entradas: [
    { id: 'p1', label: 'BIUD-EX-5X', provedor: 'claude', provedorRotulo: 'Claude Code', ativo: true, estado: 'em-uso', ate: 0, estimado: false, cota: null,
      uso: { lido: true, ok: true, venceEm: AGORA + 22 * TEMPOS.DIA_MS, faixaDoLogin: '', janelas: [{ id: 'sessao', nome: 'Sessão', usado: 0.24, reset: AGORA + TEMPOS.HORA_MS }] } },
    { id: 'c', label: 'Codex', provedor: 'codex', provedorRotulo: 'Codex', ativo: true, estado: 'pronto', ate: 0, estimado: false, cota: null, uso: null },
  ] }, AGORA);
  assert.equal(html.split('uso-plano').length - 1, 1);
  assert.match(html, /BIUD-EX-5X[\s\S]*uso-pct">24%/);
});
