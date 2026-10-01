// Revisão das configurações das contas (29/09/2026, pedido do dono: "não quero de maneira
// nenhuma habilitar um botão à toa"), e a consequência dela em 30/09/2026: "Preciso que não
// exista mais sobreposição de configurações". As chaves gerais de revisar e de aprovar com
// ressalvas saíram da Automação, a política mora só na conta, cada seletor mostra o valor
// da conta sem opção de herdar, e o nome do perfil diz que ele escolhe o login do Claude,
// não o modelo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const P = await import('../ui/pure.js');
const RAIZ = path.join(import.meta.dirname, '..');
const HTML = fs.readFileSync(path.join(RAIZ, 'ui', 'index.html'), 'utf8');
const ler = (...partes) => fs.readFileSync(path.join(RAIZ, ...partes), 'utf8');

const BIUDER = { user: 'biuder', autoReview: true, onClean: 'approve', onCaveats: 'wait', onReject: 'request_changes' };
const contasConfig = (await import('../lib/engine/contas-config.js')).default;

function engineCom(contas) {
  return { config: {}, accountList: () => contas };
}

const seletor = (html, classe, u) => html.slice(html.indexOf(`class="${classe}" data-user="${u}"`)).split('</select>')[0];
const cartao = (contas) => P.accountsManagerHtml({ accounts: contas, acct: {}, config: { claudeProfiles: [] } });

/* ---------- uma decisão, uma configuração: a política mora só na conta ---------- */

test('Automação: as chaves gerais de revisar e de aprovar com ressalvas não existem mais', () => {
  for (const id of ['sys-row-autoreview', 'sys-row-autoapprove', 'setAutoReview', 'setAutoApproveAll', 'alcanceAutoReview', 'alcanceAutoApproveAll']) {
    assert.doesNotMatch(HTML, new RegExp(`id="${id}"`), id);
  }
  assert.doesNotMatch(ler('ui', 'telas', 'acoes.js'), /autoReview|autoApproveAll/, 'a tela não manda mais essas chaves');
  assert.doesNotMatch(ler('ui', 'telas', 'sistema.js'), /setAutoReview|setAutoApproveAll|sys-row-autoreview|sys-row-autoapprove/);
  assert.doesNotMatch(ler('ui', 'telas', 'sistema-automacao.js'), /alcance/);
  assert.equal(P.alcanceDaChaveGeral, undefined, 'a frase do alcance explicava uma herança que acabou');
});

test('Automação e Contas dizem onde a decisão mora, e nenhuma fala em herdar', () => {
  const automacao = HTML.slice(HTML.indexOf('id="sys-automation"'), HTML.indexOf('id="sys-row-autocontested"'));
  assert.match(automacao, /Se uma conta revisa e aprova sozinha é decidido só em <span class="is-goto" data-goto="sys:accounts:#accountsManager"/);
  const contas = HTML.slice(HTML.indexOf('id="sys-accounts"'), HTML.indexOf('id="sys-automation"'));
  assert.doesNotMatch(contas, /herda|padrão geral/);
  assert.match(contas, /A política de automação é por conta/);
});

test('Contas: os quatro seletores mostram o valor da conta, sem opção de herdar', () => {
  const html = cartao([BIUDER]);
  assert.doesNotMatch(html, /herda o geral|padrão: aprova sozinho|segue o padrão geral/);
  for (const classe of ['acct-autoreview', 'acct-onclean', 'acct-oncaveats', 'acct-onreject']) {
    const bloco = seletor(html, classe, 'biuder');
    assert.doesNotMatch(bloco, /<option value="">/, `${classe} não tem opção vazia`);
    assert.equal((bloco.match(/ selected/g) || []).length, 1, `${classe} marca exatamente o valor da conta`);
  }
  assert.match(seletor(html, 'acct-autoreview', 'biuder'), /<option value="true" selected>revisa sozinho<\/option>/);
  assert.match(seletor(html, 'acct-onclean', 'biuder'), /<option value="approve" selected>aprova sozinho<\/option>/);
  assert.match(seletor(html, 'acct-oncaveats', 'biuder'), /<option value="wait" selected>espera você aprovar<\/option>/);
  assert.match(seletor(html, 'acct-onreject', 'biuder'), /<option value="request_changes" selected>reprova sozinho \(posta pedir mudanças\)<\/option>/);
});

test('Contas: os textos honestos continuam no cartão', () => {
  const html = cartao([BIUDER]);
  assert.match(html, /aprova \(as ressalvas ficam no app\)/);
  assert.match(html, /só põe na fila \(você manda revisar; o resultado segue as regras abaixo\)/);
  assert.match(html, /Revisar sozinho não é na hora: espera os checks obrigatórios ficarem verdes/);
  assert.match(html, /Com o Jira ligado, isso exige o card do PR lido e atendido/);
  assert.doesNotMatch(html, /destaca as ressalvas/, 'o APPROVE não destaca ressalva nenhuma no PR');
});

// O com ressalvas nunca é mais permissivo que o limpo, e a tela diz isso em vez de oferecer
// uma escolha que o engine não cumpriria. O que o cartão mostra é o que acaoAoAprovar devolve.
test('Contas: com o sem ressalvas esperando você, o com ressalvas fica desligado e diz por quê', () => {
  const espera = { ...BIUDER, user: 'cautelosa', onClean: 'wait', onCaveats: 'wait' };
  const aprova = { ...BIUDER, user: 'solta', onCaveats: 'approve' };
  const html = cartao([espera, aprova]);
  const preso = seletor(html, 'acct-oncaveats', 'cautelosa');
  assert.match(html, /class="acct-oncaveats" data-user="cautelosa" disabled/);
  assert.match(preso, /<option value="wait" selected>espera você \(o sem ressalvas espera\)<\/option>/);
  assert.equal((preso.match(/<option/g) || []).length, 1, 'sem escolha a oferecer');
  assert.equal(contasConfig.acaoAoAprovar(engineCom([espera, aprova]), 'cautelosa', false), 'wait');
  const livre = seletor(html, 'acct-oncaveats', 'solta');
  assert.doesNotMatch(html, /class="acct-oncaveats" data-user="solta" disabled/);
  assert.match(livre, /<option value="approve" selected>aprova \(as ressalvas ficam no app\)<\/option>/);
  assert.equal(contasConfig.acaoAoAprovar(engineCom([espera, aprova]), 'solta', false), 'approve');
  // par proibido gravado à mão: a tela mostra o que o engine faz, não o que está no arquivo
  const torta = { ...BIUDER, user: 'torta', onClean: 'wait', onCaveats: 'approve' };
  assert.match(seletor(cartao([torta]), 'acct-oncaveats', 'torta'), /espera você \(o sem ressalvas espera\)/);
  assert.equal(contasConfig.acaoAoAprovar(engineCom([torta]), 'torta', false), 'wait');
});

test('a leitura da tela e a do engine dão o mesmo valor para toda combinação de conta', () => {
  const eixo = { autoReview: [undefined, true, false], onClean: [undefined, 'approve', 'wait'], onCaveats: [undefined, 'approve', 'wait'], onReject: [undefined, 'wait', 'request_changes'] };
  for (const autoReview of eixo.autoReview) for (const onClean of eixo.onClean) for (const onCaveats of eixo.onCaveats) for (const onReject of eixo.onReject) {
    const conta = { user: 'x', autoReview, onClean, onCaveats, onReject };
    const e = engineCom([conta]);
    assert.deepEqual(P.politicaDaContaNaTela(conta), {
      autoReview: contasConfig.revisaSozinho(e, 'x'), onClean: contasConfig.acaoAoAprovar(e, 'x', true),
      onCaveats: contasConfig.acaoAoAprovar(e, 'x', false), onReject: contasConfig.acaoAoReprovar(e, 'x'),
    }, JSON.stringify(conta));
  }
});

test('a tela de Contas grava o valor por extenso em cada seletor', () => {
  const fonte = ler('ui', 'telas', 'sistema-contas.js');
  assert.match(fonte, /autoReview: t\.value === 'true'/);
  assert.match(fonte, /onReject: t\.value === 'request_changes' \? 'request_changes' : 'wait'/);
  assert.doesNotMatch(fonte, /herda o global|alcanceDasChavesGerais/);
});

/* ---------- Radar > Aparelhos: os mesmos campos, com as mesmas palavras ---------- */

const TAG = 'f'.repeat(32);
const remoto = (politica) => P.contasDoAparelhoHtml({ deviceId: 'dCel', contas: [{ acctTag: TAG, nome: 'ana-exemplo', politica }] }, {});

test('Radar > Aparelhos usa os rótulos e as opções do cartão de Contas, campo a campo', () => {
  const T = P.POLITICA_DA_CONTA_TEXTOS;
  const local = cartao([BIUDER]);
  const longe = remoto({ autoReview: true, muted: false, onClean: 'approve', onCaveats: 'approve', onReject: 'wait' });
  for (const campo of ['autoReview', 'onClean', 'onCaveats', 'onReject']) {
    assert.ok(local.includes(`<span class="a-fieldlabel">${T[campo].rotulo}</span>`), `cartão: ${campo}`);
    assert.ok(longe.includes(`<div>${T[campo].rotulo}</div>`), `aparelho: ${campo}`);
  }
  for (const campo of ['onClean', 'onCaveats', 'onReject']) {
    for (const [valor, texto] of T[campo].opcoes) {
      // comparação de texto, sem regex: montar expressão a partir do rótulo pedia escape completo
      const temOpcao = (html) => ['', ' selected'].some((marca) => html.includes(`<option value="${valor}"${marca}>${texto}</option>`));
      assert.ok(temOpcao(local), `cartão: ${campo}=${valor}`);
      assert.ok(temOpcao(longe), `aparelho: ${campo}=${valor}`);
    }
  }
  // o seletor de dois botões leva o começo da mesma opção, e o texto inteiro na dica
  assert.match(longe, /data-campo="autoReview"[^>]*data-valor="true"[^>]*>revisa sozinho<\/button>/);
  assert.match(longe, /data-campo="autoReview"[^>]*data-valor="false"[^>]*title="só põe na fila \(você manda revisar; o resultado segue as regras abaixo\)">só põe na fila<\/button>/);
  assert.doesNotMatch(longe, /Com blocker|destaca as ressalvas|Revisar sozinho/, 'os rótulos próprios desta tela saíram');
});

test('Radar > Aparelhos: com o sem ressalvas esperando, o com ressalvas fica desligado, como no cartão', () => {
  const longe = remoto({ autoReview: true, muted: false, onClean: 'wait', onCaveats: 'wait', onReject: 'wait' });
  const sel = longe.slice(longe.indexOf('data-campo="onCaveats"') - 200).split('</select>')[0];
  assert.match(sel, /data-campo="onCaveats"[^>]* disabled><option value="wait" selected>espera você \(o sem ressalvas espera\)<\/option>/);
  assert.doesNotMatch(sel, /aprova \(as ressalvas ficam no app\)/);
});

test('o comando à distância se descreve com as palavras da opção escolhida', () => {
  const cmd = { cmdId: 'c1', alvo: 'dCel', tipo: 'config-conta', campo: 'onCaveats', valor: 'approve', at: 1 };
  const r = P.retornoDoComando([cmd], {}, () => true, { agora: 2 });
  assert.match(r.html, /quando fica aprovável com ressalvas: aprova \(as ressalvas ficam no app\)/);
});

/* ---------- paralelismo: cada número diz uma coisa só ---------- */

test('Automação: "por conta" é sempre por conta, e o total do aparelho tem um nome só', () => {
  const porConta = HTML.slice(HTML.indexOf('id="sys-row-paralelas"'), HTML.indexOf('id="sys-row-teto-global"'));
  assert.match(porConta, /É sempre por conta, com ou sem o compartilhamento entre aparelhos/);
  assert.doesNotMatch(porConta, /passa a ser o total do aparelho/);
  const total = HTML.slice(HTML.indexOf('id="sys-row-teto-global"'), HTML.indexOf('id="sys-row-esforco"'));
  assert.match(total, /<label class="set-title" for="setGlobalParallelReviews">Teto total deste aparelho<\/label>/);
  assert.match(total, /"Teto total do aparelho", em Sistema → Aparelhos e em Radar → Aparelhos\): vale o menor dos dois/);
  assert.match(total, /<option value="0">Sem teto total \(padrão\)<\/option>/);
  assert.doesNotMatch(HTML, /Teto global/);
});

test('Sistema > Aparelhos e Radar > Aparelhos chamam o teto do admin pelo mesmo nome', () => {
  const politica = P.aparelhoPoliticaHtml({ deviceId: 'd1', name: 'Celular' }, { leitura: { estado: 'ok', existe: true, valida: true, versao: 1, politica: { pausado: false } } });
  assert.match(politica, /<span>Teto total do aparelho<\/span>/);
  assert.match(politica, /não definir \(vale o teto total do próprio aparelho, em Sistema → Automação\)/);
  assert.doesNotMatch(politica, /Teto de paralelismo/);
  const ap = { deviceId: 'd1', nome: 'Celular', platform: 'android', versao: P.VERSAO_DO_CONTROLE, vistoEm: Date.now(), abriu: true, pausado: false, paralelismo: 2, ocupadas: 1, iaPronta: true, aceitarAdmin: true, contas: [], falhas: [], publicadoEm: Date.now() };
  const painel = P.painelDoAparelhoHtml(ap, {});
  assert.match(painel, /Teto total do aparelho <select class="ap-teto"/);
  assert.match(painel, /teto total do aparelho: 2/);
  assert.match(painel, /<option value="">não definir \(vale o teto total do próprio aparelho\)<\/option>/);
  assert.match(painel, /<option value="2" selected>2<\/option>/);
  assert.doesNotMatch(painel, /Ao mesmo tempo/);
  // total que o admin não pode definir (soma dos limites por conta): o seletor abre em "não definir"
  const semTeto = P.painelDoAparelhoHtml({ ...ap, paralelismo: 6 }, {});
  assert.match(semTeto, /<option value="" selected>não definir \(vale o teto total do próprio aparelho\)<\/option>/);
  assert.match(semTeto, /teto total do aparelho: 6/);
});

test('a Justiça de fila usa o nome novo do teto total', () => {
  const html = P.filaJustaHtml({ porOrg: [], porPerfil: [], emCurso: 1, tetoGlobal: 3 });
  assert.match(html, /<h4>Teto total deste aparelho<\/h4>/);
});

test('Contas: o perfil diz que escolhe o login do Claude, e que o modelo vem da Automação', () => {
  const html = P.accountsManagerHtml({ accounts: [BIUDER], acct: {}, config: { claudeProfiles: [] } });
  assert.match(html, /login do Claude \(plano\)/);
  assert.match(html, /O modelo e o raciocínio vêm de Sistema &gt; Automação|O modelo e o raciocínio vêm de Sistema > Automação/);
  assert.doesNotMatch(html, /a-fieldlabel">perfil de IA</);
});

test('Automação: a co-assinatura avisa no app, não no PR, e respeita a conta', () => {
  const desc = HTML.slice(HTML.indexOf('id="sys-row-coassinar"'), HTML.indexOf('id="sys-row-reviewfast"'));
  assert.doesNotMatch(desc, /avisa no PR/);
  assert.match(desc, /sem postar nada no PR/);
  assert.match(desc, /espera você também não co-assina/);
});

test('Automação: nenhuma chave promete o que o engine não faz', () => {
  assert.doesNotMatch(HTML, /código do qual você é dono, por exemplo/, 'a co-assinatura nunca vale onde você é dono');
  assert.match(HTML, /Nunca co-assina onde você é dono do código pelo CODEOWNERS/);
  assert.match(HTML, /Não vale no modelo Auto/, 'o Auto fixa fast:false em toda faixa');
  assert.doesNotMatch(HTML, /org que está esperando há mais tempo/, 'o escalonador escolhe a org atendida há mais tempo');
  assert.doesNotMatch(HTML, /APPROVE destacando as ressalvas/);
});
