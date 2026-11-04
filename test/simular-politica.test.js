// O simulador usa os portões reais, não grava nada, não inventa resultado e não viaja no pacote.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-simular-politica-'));
process.env.FAROL_HOME = FAROL_HOME;
const { simular, lerAlternativa, relatorio } = await import('../tools/simular-politica.js');
test.after(() => fs.rmSync(FAROL_HOME, { recursive: true, force: true }));

const RAIZ = path.join(import.meta.dirname, '..');
const pr = (account, author = 'outra-pessoa') => ({ repo: 'o/r', number: 1, account, author });
const aprovada = (attention, account = 'ana') => ({ status: 'auto_approved', verdict: 'approve', action: 'approve', attention, pr: pr(account) });
const reprovada = (account = 'ana') => ({ status: 'auto_rejected', verdict: 'request_changes', action: 'request_changes', pr: pr(account) });
const CONFIG = { accounts: [{ user: 'ana', onClean: 'approve', onCaveats: 'approve', onReject: 'request_changes' }] };
const RESSALVA = [{ text: 'o card não foi comprovado', kind: 'content' }];

const decisoes = (...resolved) => ({ pending: [], resolved });
const linha = (r, conta = 'ana') => r.contas.find(c => c.conta === conta);

test('com a política atual igual à da época, nada muda', () => {
  const r = simular(decisoes(aprovada([]), aprovada(RESSALVA), reprovada()), CONFIG);
  const c = linha(r);
  assert.deepEqual(c.aprovacoes, { total: 2, postaAtual: 2, postaAlternativa: 2, deixaDeSair: 0, passaASair: 0 });
  assert.deepEqual(c.reprovacoes, { total: 1, postaAtual: 1, postaAlternativa: 1, deixaDeSair: 0, passaASair: 0 });
  assert.deepEqual(r.fora, {});
});

test('a alternativa conta pelo portão real: o com ressalvas nunca é mais aberto que o limpo', () => {
  const lista = decisoes(aprovada([]), aprovada(RESSALVA), reprovada());
  const limpo = linha(simular(lista, CONFIG, lerAlternativa('{"onClean":"wait"}')));
  assert.equal(limpo.aprovacoes.deixaDeSair, 2, 'onClean wait segura também o com ressalvas (politicaExplicita)');
  assert.equal(limpo.reprovacoes.deixaDeSair, 0);
  const ressalvas = linha(simular(lista, CONFIG, lerAlternativa('{"onCaveats":"wait"}')));
  assert.equal(ressalvas.aprovacoes.deixaDeSair, 1);
  const reprova = linha(simular(lista, CONFIG, lerAlternativa('{"onReject":"wait"}')));
  assert.equal(reprova.reprovacoes.deixaDeSair, 1);
  assert.equal(reprova.aprovacoes.deixaDeSair, 0);
});

test('a política atual mais fechada que a da época aparece, e a alternativa pode reabrir', () => {
  const fechada = { accounts: [{ user: 'ana', onClean: 'wait' }] };
  const c = linha(simular(decisoes(aprovada([])), fechada, lerAlternativa('{"onClean":"approve"}')));
  assert.deepEqual(c.aprovacoes, { total: 1, postaAtual: 0, postaAlternativa: 1, deixaDeSair: 0, passaASair: 1 });
});

test('aviso de CI em attention não conta como ressalva, como na decisão original', () => {
  const aviso = [{ text: 'check obrigatório vermelho no head (build)', kind: 'gate' }];
  const pendente = [{ text: 'check obrigatório ainda sem resultado no head (build)', kind: 'gate' }];
  const c = linha(simular(decisoes(aprovada(aviso), aprovada(pendente)), CONFIG, lerAlternativa('{"onCaveats":"wait"}')));
  assert.equal(c.aprovacoes.deixaDeSair, 0);
});

test('alternativa por conta só vale para a conta citada, sem diferença de caixa', () => {
  const config = { accounts: [...CONFIG.accounts, { user: 'bia' }] };
  const r = simular(decisoes(aprovada([]), aprovada([], 'bia')), config, lerAlternativa('{"ANA":{"onClean":"wait"}}'));
  assert.equal(linha(r).aprovacoes.deixaDeSair, 1);
  assert.equal(linha(r, 'bia').aprovacoes.deixaDeSair, 0);
  assert.deepEqual(r.contasDaAlternativaSemDecisao, []);
  const errada = simular(decisoes(aprovada([])), CONFIG, lerAlternativa('{"anna":{"onClean":"wait"}}'));
  assert.deepEqual(errada.contasDaAlternativaSemDecisao, ['anna'], 'nome errado não pode parecer "nada mudaria"');
});

test('o que não dá para reproduzir fica fora da conta, com o motivo, e nunca vira resultado', () => {
  const r = simular({ pending: [{ status: 'pending', pr: pr('ana') }], resolved: [
    { status: 'posted', action: 'approve', pr: pr('ana') },
    { status: 'superseded', pr: pr('ana') },
    { status: 'auto_approved', verdict: 'approve', attention: [], pr: pr('') },
    { status: 'auto_approved', verdict: 'approve', pr: pr('ana') },
    { status: 'auto_rejected', verdict: 'approve', pr: pr('ana') },
    aprovada([], 'ana'),
    null,
  ] }, CONFIG, lerAlternativa('{"onClean":"wait"}'));
  assert.deepEqual(r.fora, {
    status_pending: 1, status_posted: 1, status_superseded: 1, sem_conta_gravada: 1, sem_ressalvas_gravadas: 1,
    reprovacao_pelo_caminho_do_defeito: 1, status_desconhecido: 1,
  });
  assert.equal(linha(r).aprovacoes.total, 1);
  assert.equal(r.lidas, 8);
});

test('o portão real recusando a testemunha tira a decisão da conta: PR da própria conta', () => {
  const propria = { ...aprovada([]), pr: pr('ana', 'ana') };
  const r = simular(decisoes(propria, { ...reprovada(), pr: pr('ana', 'ANA') }), CONFIG);
  assert.deepEqual(r.fora, { testemunha_recusada_pr_proprio: 1, testemunha_recusada_recusou: 1 });
  assert.deepEqual(r.contas, []);
});

test('conta fora da config cai na política padrão e a saída diz isso', () => {
  const r = simular(decisoes(aprovada([], 'antiga')), CONFIG);
  assert.equal(linha(r, 'antiga').naConfig, false);
  assert.match(relatorio(r), /antiga \(fora da config/);
  assert.match(relatorio(r), /não medido/);
});

test('alternativa inválida é recusada, sem cair em política padrão', () => {
  for (const texto of ['nao-json', '[]', 'null', '{"onClean":"talvez"}', '{"ana":{"onReject":"approve"}}', '{"ana":{"muted":true}}', '{"ana":"wait"}', '{"onClean":"wait","ana":{}}']) {
    assert.throws(() => lerAlternativa(texto), undefined, texto);
  }
});

function retrato(dir) {
  return fs.readdirSync(dir, { recursive: true }).sort().map((nome) => {
    const alvo = path.join(dir, nome), st = fs.statSync(alvo);
    return `${nome}|${st.size}|${st.mtimeMs}`;
  });
}

test('linha de comando: lê, imprime a contagem e não grava nada no home', () => {
  const home = fs.mkdtempSync(path.join(FAROL_HOME, 'cli-'));
  fs.mkdirSync(path.join(home, 'workspace', 'state'), { recursive: true });
  const tituloSecreto = 'titulo-que-nao-pode-sair';
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ ...CONFIG, jira: { token: 'valor-que-nao-pode-sair' } }));
  fs.writeFileSync(path.join(home, 'workspace', 'state', 'decisions.json'), JSON.stringify(decisoes({ ...aprovada([]), reportMarkdown: tituloSecreto })));
  const antes = retrato(home);
  const rodar = (...args) => spawnSync(process.execPath, [path.join(RAIZ, 'tools', 'simular-politica.js'), ...args], { encoding: 'utf8', env: { ...process.env, FAROL_HOME: home } });
  const r = rodar('--politica', '{"onClean":"wait"}', '--json');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).contas[0].aprovacoes.deixaDeSair, 1);
  assert.equal(r.stdout.includes(tituloSecreto) || r.stdout.includes('valor-que-nao-pode-sair'), false);
  assert.equal(rodar().status, 0);
  assert.equal(rodar('--politica', '{"onClean":"talvez"}').status, 2);
  assert.equal(rodar('--desconhecido').status, 2);
  assert.deepEqual(retrato(home), antes);
});

test('linha de comando: sem o arquivo de decisões sai com erro, sem inventar contagem', () => {
  const home = fs.mkdtempSync(path.join(FAROL_HOME, 'vazio-'));
  const r = spawnSync(process.execPath, [path.join(RAIZ, 'tools', 'simular-politica.js')], { encoding: 'utf8', env: { ...process.env, FAROL_HOME: home } });
  assert.equal(r.status, 2);
  assert.equal(r.stdout, '');
});

test('o simulador não viaja em nenhuma rota de pacote nem é usado em runtime', () => {
  for (const rota of ['tools/make-package.ps1', 'tools/make-package.sh', 'tools/make-installer.ps1', 'tools/make-offline-mac.sh']) {
    assert.equal(fs.readFileSync(path.join(RAIZ, rota), 'utf8').includes('simular-politica'), false, rota);
  }
  const fonte = fs.readdirSync(path.join(RAIZ, 'lib'), { recursive: true }).filter(n => String(n).endsWith('.js'));
  for (const nome of fonte) assert.equal(fs.readFileSync(path.join(RAIZ, 'lib', nome), 'utf8').includes('simular-politica'), false, nome);
});
