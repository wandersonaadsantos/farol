// "CI obrigatório antes da aprovação" voltou a ser escolha, desligada por padrão (06/11/2026).
//
// Pedido do dono: "CI obrigatório antes da aprovação: isso aqui tem que ter como desativar no
// Farol, acredito que isso é a maior falha, e deve vir por default como desabilitado". As vias da
// decisão e da postagem têm casos próprios (gate-espera-revisao, decisao-sem-mesa,
// retirada-de-pedido, technical-review, sem-declaracao-tecnica, busca-da-prova); aqui ficam o
// prompt da sessão e o que a tela promete: com a chave desligada, nada pode prometer espera do CI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ciForaDaDecisaoBlock } from '../lib/engine/review-prompt.js';
import { esperaCiCardMeta, staleCardMeta, tituloDoAprovarDesligado, fraseDoCi, accountsManagerHtml } from '../ui/pure.js';
import { PREFERENCE_LABELS } from '../ui/pure/preferences.js';
import { flagSemPermissoes, buildLoginScript, buildLoginScriptMac } from '../lib/engine/session.js';

const ler = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
// a seção v2.78.42 do CHANGELOG, a deste PR
function secaoDoChangelog() {
  const texto = ler('CHANGELOG.md');
  const inicio = texto.indexOf('## v2.78.42');
  return inicio < 0 ? '' : texto.slice(inicio, texto.indexOf('## v2.78.41', inicio));
}

test('prompt: desligada, a sessão é avisada de que o CI não decide; ligada, nada muda', () => {
  for (const config of [{}, { aguardarCiParaAprovar: false }, { aguardarCiParaAprovar: 'true' }]) {
    const bloco = ciForaDaDecisaoBlock(config);
    assert.match(bloco, /CI obrigatório fora da decisão/);
    assert.match(bloco, /Não conclua `request_changes` nem declare bloqueio com causa `ci`/);
    assert.match(bloco, /defeito do código \(causa `defeito_codigo`\)/, 'o diff que quebra o check, com prova, continua defeito');
    assert.match(bloco, /não rebaixe `decision` para `needs_decision` nem escreva item em\s+`reasons` só pelo estado do CI/,
      'o CI não vira ressalva pela sessão (com a conta esperando você nas ressalvas, isso mandaria o PR limpo para a mesa)');
    assert.match(bloco, /vale por cima das regras de CI deste prompt/);
  }
  assert.equal(ciForaDaDecisaoBlock({ aguardarCiParaAprovar: true }), '');
  assert.match(ler('lib/engine/review-prompt.js'), /thirdPartyReviewBlock\(\) \+ ciForaDaDecisaoBlock\(engine\.config\)/, 'o bloco entra no prompt da revisão');
});

test('card da espera do CI: ligada promete a espera e desliga o Aprovar; desligada não promete nada', () => {
  const d = { id: '1', key: 'o/r#1', verdict: 'approve', esperaCi: { checks: [] }, reasons: [] };
  const ligada = esperaCiCardMeta(d, true);
  assert.equal(ligada.approveDisabled, true);
  assert.match(ligada.statusHtml, /Aprovo sozinho quando ele fechar verde/);
  const desligada = esperaCiCardMeta(d, false);
  assert.equal(desligada.approveDisabled, false);
  assert.doesNotMatch(desligada.statusHtml + desligada.verdictHtml, /Aprovo sozinho quando|ESPERANDO O CI|exige os checks/);
  assert.match(desligada.statusHtml, /a espera do CI está desligada/i);
  assert.match(desligada.statusHtml, /a decisão sai pela política da conta ou vem para você/,
    'o pedido de mudanças que esperava só pelo CI vai para a mesa (liberarSemCi): o card não promete que tudo sai pela política');
  assert.equal(esperaCiCardMeta(d).approveDisabled, true, 'sem a informação, o lado seguro');
  assert.equal(staleCardMeta(d, null, {}, false).approveDisabled, false, 'o card do Radar e a paleta leem o mesmo');
  const comLacuna = esperaCiCardMeta({ ...d, technical: { state: 'pending', message: '' } }, false);
  assert.equal(comLacuna.approveDisabled, true, 'a prova técnica continua exigida');
  assert.doesNotMatch(comLacuna.statusHtml, /checks obrigatórios verdes/);
});

test('espera armada e desligada: nenhum texto promete que a decisão sempre sai pela política da conta', () => {
  // decisao-sem-mesa.test.js, "desligada depois de armada": a aprovação sai pela política, mas
  // a espera de um pedido de mudanças só pelo CI vai para você. Quem descreve a liberação diz os dois.
  const fontes = {
    'ui/pure/review.js': ler('ui/pure/review.js').match(/const ESPERA_DESLIGADA = '([^']+)'/)[1],
    'CHANGELOG.md': secaoDoChangelog(),
  };
  assert.ok(fontes['CHANGELOG.md'], 'a seção v2.78.42 deste PR');
  assert.match(fontes['ui/pure/review.js'], /política da conta ou vem para você/);
  assert.match(fontes['CHANGELOG.md'], /o pedido de mudanças sustentado só pelo CI vem para você/);
  for (const [arquivo, texto] of Object.entries(fontes)) {
    assert.doesNotMatch(texto, /sai pela política da conta, sem olhar o CI/, arquivo);
    assert.doesNotMatch(texto, /Aprovação que já estava esperando o CI sai no ciclo seguinte/, arquivo);
  }
});

test('desligar só é seguro com check obrigatório no ruleset: a linha da chave, os docs e as notas avisam', () => {
  const html = ler('ui/index.html');
  const inicio = html.indexOf('id="sys-row-aguardarciaprovar"');
  const linha = html.slice(inicio, html.indexOf('</label>', inicio));
  assert.match(linha, /Só desligue onde o check é obrigatório no ruleset/);
  assert.match(linha, /pode aprovar com o CI vermelho e o GitHub não barra o merge/);
  assert.doesNotMatch(linha, /O merge continua barrado pelo GitHub/, 'sem promessa incondicional');
  assert.match(ler('docs/CONFIGURATION.md'), /Só é seguro desligar onde o check é obrigatório no ruleset\*\*: sem isso, o Farol pode aprovar com o CI vermelho/);
  assert.match(ler('docs/REVIEW-GATES.md'), /desligar só é seguro nesse caso: num repositório sem check obrigatório, desligar permite APPROVE com o CI vermelho/);
  assert.doesNotMatch(ler('docs/REVIEW-GATES.md'), /e é por isso que desligar é seguro/);
  assert.match(secaoDoChangelog(), /Só desligue onde o check é obrigatório no ruleset/);
  const notas = ler('ui/telas/release-notes.js');
  const nota = notas.slice(notas.indexOf("['2.78.42'"), notas.indexOf("['2.78.41'"));
  assert.match(nota, /só desligue onde o check é obrigatório no ruleset/);
  assert.doesNotMatch(nota, /o merge segue barrado pelo GitHub'/);
  assert.match(ler('lib/settings.js'), /Só é seguro onde o check é obrigatório no ruleset/);
  // o card da espera desligada e o título dos seletores da conta também condicionam a barreira ao ruleset
  const card = esperaCiCardMeta({ id: '1', key: 'o/r#1', verdict: 'approve', esperaCi: { checks: [] }, reasons: [] }, false).statusHtml;
  for (const [onde, texto] of [['card', card], ['fraseDoCi', fraseDoCi({})]]) {
    assert.match(texto, /só fica barrado pelo GitHub onde o check é obrigatório no ruleset/, onde);
    assert.doesNotMatch(texto, /continua barrado pelo GitHub/, onde);
  }
});

test('sessão no terminal sem pedir permissões: ligada por padrão, mas como root a flag não entra', () => {
  const engine = { config: { skipPermissions: true, port: 47170 } };
  const getuidOriginal = process.getuid;
  const comUid = (uid, fn) => { process.getuid = () => uid; try { return fn(); } finally { process.getuid = getuidOriginal; } };
  try {
    comUid(1000, () => {
      assert.equal(flagSemPermissoes(engine), ' --dangerously-skip-permissions');
      assert.match(buildLoginScript(engine, ''), /claude --dangerously-skip-permissions/);
    });
    comUid(0, () => {
      assert.equal(flagSemPermissoes(engine), '', 'o Claude Code recusa a flag como root: a sessão morreria ao abrir');
      assert.doesNotMatch(buildLoginScript(engine, '') + buildLoginScriptMac(engine, '', 't1'), /--dangerously-skip-permissions/);
    });
    comUid(1000, () => assert.equal(flagSemPermissoes({ config: { skipPermissions: false } }), '', 'desligada continua sem a flag'));
  } finally {
    if (getuidOriginal === undefined) delete process.getuid;
  }
});

test('o padrão ausente do card é o lado seguro, e todo chamador das telas passa a chave', () => {
  // ui/pure/review.js trata o argumento ausente como ligado (trava o Aprovar); o engine trata a
  // config ausente como desligada. Por isso nenhum chamador pode omitir o argumento.
  // varre todo .js de ui/ (pure e telas): uma tela nova que esqueça o argumento também reprova
  const raiz = new URL('../ui/', import.meta.url);
  const arquivos = fs.readdirSync(raiz, { recursive: true }).map(String).filter((f) => f.endsWith('.js'));
  const achadas = [];
  for (const rel of arquivos) {
    const linhas = fs.readFileSync(new URL(rel.split(String.fromCharCode(92)).join('/'), raiz), 'utf8').split('\n');
    for (const l of linhas) {
      if (l.includes('export function') || l.trim().startsWith('//')) continue;
      if (/(staleCardMeta|esperaCiCardMeta|tituloDoAprovarDesligado)\(/.test(l)) achadas.push([rel, l.trim()]);
    }
  }
  assert.ok(achadas.length >= 4, 'os chamadores conhecidos (radar, paleta, review) foram achados');
  // a forma esperada é a chamada numa linha só terminando em `ciObrigatorio)`: quebrar a chamada em
  // várias linhas ou passar outra variável também reprova, e a mensagem diz isso
  for (const [rel, l] of achadas) {
    assert.ok(l.includes('ciObrigatorio)'), `ui/${rel}: a chamada precisa passar a chave como último argumento, na mesma linha, terminando em "ciObrigatorio)": ${l}`);
  }
});

test('Sistema > Automação: as chaves que nascem ligadas só desligam com false explícito', () => {
  const sistema = ler('ui/telas/sistema.js');
  for (const linha of [
    "$('#setReReviewResume').checked = c.reReviewResume !== false;",
    "$('#setSkipPerms').checked = c.skipPermissions !== false;",
    "$('#setAutoUpdate').checked = c.autoUpdate !== false;",
  ]) assert.ok(sistema.includes(linha), linha);
});

test('importar preferências antigas não reabre a migração do esquema 2', async () => {
  const { KEYS } = await import('../lib/preferences/values.js');
  assert.equal(KEYS.includes('esquemaConfig'), false, 'o marcador não viaja na exportação nem volta na importação');
  const M = (await import('../lib/engine/contas-migracao.js')).default;
  const depoisDaImportacao = { esquemaConfig: 2, aguardarCiParaAprovar: true, skipPermissions: false, reReviewResume: false };
  assert.deepEqual(M.migrarPadroes(depoisDaImportacao), { mudou: false, valores: {}, mudancas: [] }, 'a escolha importada fica');
});

test('botão Aprovar desligado: o título só fala de CI com a chave ligada', () => {
  assert.equal(tituloDoAprovarDesligado(true), 'A aprovação exige prova técnica atual e CI obrigatório verde');
  assert.equal(tituloDoAprovarDesligado(false), 'A aprovação exige prova técnica atual');
  const radar = ler('ui/telas/radar.js');
  assert.match(radar, /const ciObrigatorio = estado\(\)\.config\?\.aguardarCiParaAprovar === true;/);
  assert.match(radar, /tituloDoAprovarDesligado\(ciObrigatorio\)/);
  assert.doesNotMatch(radar, /disabled title="A aprovação exige prova técnica atual e CI obrigatório verde"/, 'sem título fixo prometendo CI');
});

test('títulos da política da conta: só prometem a espera do CI com a chave ligada', () => {
  assert.match(fraseDoCi({ aguardarCiParaAprovar: true }), /só adia: o Farol espera e aprova sozinho/);
  for (const config of [undefined, {}, { aguardarCiParaAprovar: false }]) {
    assert.doesNotMatch(fraseDoCi(config), /espera e aprova sozinho/);
    assert.match(fraseDoCi(config), /não segura nem adia a aprovação/);
  }
  const conta = { user: 'eu', owners: ['acme'], autoReview: true, onClean: 'approve', onCaveats: 'approve', onReject: 'request_changes', tokenOk: true };
  const html = (config) => accountsManagerHtml({ accounts: [conta], acct: {}, config: { claudeProfiles: [], ...config } });
  assert.doesNotMatch(html({}), /espera e aprova sozinho quando fechar verde/);
  assert.equal((html({ aguardarCiParaAprovar: true }).match(/espera e aprova sozinho quando fechar verde/g) || []).length, 2, 'sem ressalvas e com ressalvas');
});

test('Sistema > Automação: a linha virou chave, ligada à preferência, e os padrões dizem a verdade', () => {
  const html = ler('ui/index.html');
  const linha = (id) => html.slice(html.indexOf(`id="${id}"`), html.indexOf('</label>', html.indexOf(`id="${id}"`)));
  assert.match(linha('sys-row-aguardarciaprovar'), /<input id="setAguardarCiAprovar" type="checkbox">/);
  assert.match(linha('sys-row-aguardarciaprovar'), /Desligado \(padrão\)/);
  for (const id of ['sys-row-rereviewresume', 'sys-row-autoupdate', 'sys-row-skipperms']) {
    assert.match(linha(id), /Ligado \(padrão\)/, id);
    assert.doesNotMatch(linha(id), /Desligado \(padrão\)/, id);
  }
  assert.match(ler('ui/telas/acoes.js'), /\['#setAguardarCiAprovar', 'aguardarCiParaAprovar', el => el\.checked\]/);
  assert.match(ler('ui/telas/sistema.js'), /\$\('#setAguardarCiAprovar'\)\.checked = c\.aguardarCiParaAprovar === true;/);
  assert.equal(PREFERENCE_LABELS.aguardarCiParaAprovar, 'CI obrigatório antes da aprovação', 'a preferência viaja na exportação');
});

test('lacunas da rodada: o CI só entra na prova exigida com a chave ligada; o approvalGaps segue apontando a pipe', async () => {
  const { lacunasDaRodada } = await import('../lib/engine/busca-da-prova.js');
  const { approvalGaps } = await import('../lib/technical-review/evidence.js');
  const head = 'a'.repeat(40);
  const base = () => ({ analysisStatus: 'complete', headSha: head, checksVerifiedHead: null,
    checksObrigatorios: [{ nome: 'audit', estado: 'vermelho' }] });
  const ci = ['checks não conferidos no commit revisado', 'ci_vermelho'];
  for (const g of ci) assert.ok(approvalGaps(base()).includes(g), g);
  const ligada = lacunasDaRodada({ config: { aguardarCiParaAprovar: true } }, null, base());
  for (const g of ci) assert.ok(ligada.includes(g), `ligada exige ${g}`);
  for (const config of [{}, { aguardarCiParaAprovar: false }]) {
    const desligada = lacunasDaRodada({ config }, null, base());
    for (const g of ci) assert.equal(desligada.includes(g), false, `desligada não exige ${g}`);
  }
});

test('reprovacaoSoPeloCi: só o CI vermelho sustentando o pedido, inclusive com achados ilegíveis', async () => {
  const { reprovacaoSoPeloCi } = await import('../lib/engine/review-consistency.js');
  const head = 'b'.repeat(40);
  const base = { verdict: 'request_changes', headSha: head, checksVerifiedHead: head, checksObrigatorios: [{ nome: 'audit', estado: 'vermelho' }] };
  assert.equal(reprovacaoSoPeloCi({ ...base, findings: [] }), true);
  assert.equal(reprovacaoSoPeloCi({ ...base, findings: 'ilegível' }), true, 'contagem não confiável: segura o pedido automático');
  assert.equal(reprovacaoSoPeloCi({ ...base, findings: [{ severity: 'blocking', title: 'x', summary: 'y', causa: 'defeito_codigo' }] }), false, 'com bloqueio, não é só o CI');
  assert.equal(reprovacaoSoPeloCi({ ...base, findings: [], checksObrigatorios: [] }), false, 'sem CI vermelho, não');
  assert.equal(reprovacaoSoPeloCi({ ...base, findings: [], checksVerifiedHead: 'c'.repeat(40) }), false, 'CI lido em outro commit não sustenta');
  assert.equal(reprovacaoSoPeloCi({ ...base, verdict: 'approve' }), false);
});

test('sem check obrigatório no ruleset: a leitura marca, e o aviso da aprovação diz que o GitHub não barra o merge', async () => {
  const checks = await import('../lib/engine/checks-exigidos.js');
  const { avisoDaAprovacao } = await import('../lib/engine/gate-espera.js');
  const io = (await import('../lib/io.js')).default;
  assert.equal(checks.semCheckObrigatorio([]), true);
  assert.equal(checks.semCheckObrigatorio(['acrity/review']), true, 'veredito de review de ferramenta não é check de CI');
  assert.equal(checks.semCheckObrigatorio(['audit']), false);
  assert.equal(checks.semCheckObrigatorio(null), false, 'exigência desconhecida não vira aviso');
  const rodada = (name, conclusion, status = 'COMPLETED') => ({ name, status, conclusion, startedAt: '2026-11-06T12:00:00Z' });

  // a leitura real do bloqueadoPorChecks, com o gh falso: ruleset vazio e um check vermelho
  const runReal = io.run;
  io.run = async (_cmd, args) => {
    const sub = args.join(' ');
    if (sub.includes('rules/branches/main')) return { ok: true, stdout: '[]' };
    return { ok: true, stdout: JSON.stringify({ baseRefName: 'main', headRefOid: 'f'.repeat(40),
      statusCheckRollup: [rodada('lint', 'FAILURE'), rodada('build', 'SUCCESS'), rodada('e2e', null, 'IN_PROGRESS')] }) };
  };
  try {
    const engine = { accountForPr: () => 'eu', accountForOwner: () => 'eu', tokenFor: () => 'tk', ghEnv: () => ({}) };
    const lido = await checks.bloqueadoPorChecks(engine, { url: 'https://github.com/o/r/pull/1', repo: 'o/r' });
    assert.deepEqual([lido.bloqueado, lido.semExigencia], [false, true]);
    assert.deepEqual(lido.naoVerdes, [{ nome: 'lint', estado: 'vermelho' }, { nome: 'e2e', estado: 'rodando' }]);
    const result = {};
    await checks.anexarChecksObrigatorios({ bloqueadoPorChecks: async () => lido }, {}, result);
    assert.equal(result.semCheckObrigatorio, true);
    const [aviso] = avisoDaAprovacao(result);
    assert.equal(aviso.text, 'aprovado sem check de CI obrigatório no ruleset da branch de destino: se a branch também não tiver proteção clássica, o GitHub não barra o merge, e o CI não está verde no head (lint vermelho, e2e sem resultado)');
  } finally {
    io.run = runReal;
  }

  assert.deepEqual(avisoDaAprovacao({ semCheckObrigatorio: true, checksForaDoRuleset: [] }).map((a) => a.text),
    ['aprovado sem check de CI obrigatório no ruleset da branch de destino: se a branch também não tiver proteção clássica, o GitHub não barra o merge'], 'sem CI nenhum também avisa');
  const muitos = Array.from({ length: 13 }, (_, i) => ({ nome: 'c' + i, estado: 'vermelho' }));
  assert.match(avisoDaAprovacao({ semCheckObrigatorio: true, checksForaDoRuleset: muitos })[0].text, /c9 vermelho, mais 3\)$/, 'teto de dez nomes no card');
  assert.deepEqual(avisoDaAprovacao({ checksObrigatorios: [{ nome: 'audit', estado: 'vermelho' }] }).map((a) => a.text),
    ['aprovado com check obrigatório vermelho no head (audit): o ruleset segura o merge até ele passar, salvo bypass']);
  assert.deepEqual(avisoDaAprovacao({ checksObrigatorios: [] }), [], 'CI obrigatório verde: sem aviso');
});

test('migração do esquema 2: o que se distingue como escolha fica; o indistinguível segue a migração única, com rastro', async () => {
  const M = (await import('../lib/engine/contas-migracao.js')).default;
  const jaNoPadraoNovo = M.migrarPadroes({ esquemaConfig: 1, skipPermissions: true, reReviewResume: true, aguardarCiParaAprovar: false });
  assert.deepEqual([jaNoPadraoNovo.valores, jaNoPadraoNovo.mudancas], [{}, []], 'true gravado é escolha ou já o padrão: nada muda, nada vai ao rastro');
  const indistinguivel = M.migrarPadroes({ esquemaConfig: 1, skipPermissions: false, reReviewResume: true, aguardarCiParaAprovar: false });
  assert.deepEqual(indistinguivel.valores, { skipPermissions: true });
  assert.deepEqual(indistinguivel.mudancas, [{ conta: null, campo: 'skipPermissions', de: false, para: true }], 'a troca fica visível no rastro');
  assert.match(ler('docs/CONFIGURATION.md'), /indistinguível do padrão antigo/);
});
