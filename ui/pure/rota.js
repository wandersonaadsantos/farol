/* Farol · UI: a ROTA, o endereço que diz o que está na tela (18/10/2026).

   Pedido do dono: "As URLs não refletem exatamente o que vejo em tela". A rota mora no
   CAMINHO desde 20/10/2026 (`/<aba>[/<sub>[/<aparelho>]]?<filtros>`), também pedido do dono:
   "usualmente associamos o uso de # pra referenciar um id, e aquilo na realidade são
   páginas". Na primeira versão ela morava no hash; o link antigo (`/#/radar/pra-mim`)
   continua valendo e é convertido na entrada (enderecoDaPagina). Quem faz o caminho
   profundo chegar à página é o servidor: toda navegação fora de /api devolve o index.html
   (lib/http-ui.js).

   Aqui é só a tradução, sem DOM: enderecoDaPagina (location -> endereço da rota), lerRota
   (endereço -> rota normalizada), escreverRota (rota -> caminho canônico) e mudancaDeRota
   (empilha ou substitui no histórico). Quem lê a tela e aplica a rota é ui/telas/rota.js.

   Nada que identifique credencial entra no endereço: cada campo é validado por formato
   fechado (aba e seção de lista conhecida, conta e org no formato de login do GitHub, PR
   no formato owner/repo#N, aparelho como id opaco), e o que não casa some calado. */

import { ghPrUrl } from './mencoes.js';

const ABAS_DA_ROTA = ['radar', 'entregas', 'destaques', 'time', 'consumo', 'sistema'];
// nome na URL <-> nome interno (o data-sub / data-section do index.html)
const SUBS_DO_RADAR = { 'pra-mim': 'mim', aparelhos: 'apar', 'meus-prs': 'meus', panorama: 'pano' };
const SECOES_DO_SISTEMA = {
  'visao-geral': 'overview', contas: 'accounts', automacao: 'automation', jira: 'jira',
  sincronizacao: 'sync', aparelhos: 'devices', grupos: 'groups', plano: 'plans',
  reviewers: 'reviewers', preferencias: 'prefs', novidades: 'news', diagnostico: 'diag', sobre: 'about',
};
// só nessas abas a barra de contas aparece (accountBarVisible, ui/pure/contas.js)
const ABAS_COM_CONTA = new Set(['radar', 'destaques', 'time']);
const DIAS_DE_ENTREGAS = [0, 7, 15, 30];
const AGRUPAR = { repositorios: 'repo', pessoas: 'author' };

const ID_OPACO = /^[A-Za-z0-9_-]{1,128}$/;
const LOGIN_GH = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_GH = /^[\w.-]{1,100}\/[\w.-]{1,100}$/;
const BUSCA_MAX = 120;
const PR_MAX = 250;
// Busca é texto livre que a pessoa digitou. Se ela colou algo com cara de credencial no
// filtro, o endereço não leva: URL vai para histórico, favorito e captura de tela.
const CARA_DE_SEGREDO = /(gh[opusr]_|github_pat_|sk-|xox[abprs]-|AKIA)[A-Za-z0-9_-]{6,}/;

function chaveDoValor(mapa, valor) {
  return Object.keys(mapa).find((k) => mapa[k] === valor) || '';
}

function decodificar(pedaco) {
  try { return decodeURIComponent(String(pedaco).replace(/\+/g, ' ')); } catch { return ''; }
}

// Só os nomes que a rota conhece saem da consulta: o nome vem do endereço, e escrever
// propriedade com nome livre deixaria `__proto__` e parentes mexerem no objeto.
const NOMES_DA_CONSULTA = ['conta', 'pr', 'org', 'dias', 'agrupar', 'busca', 'repo', 'pessoa'];

function lerConsulta(texto) {
  const lidos = new Map();
  for (const par of String(texto || '').split('&')) {
    if (!par) continue;
    const i = par.indexOf('=');
    const nome = decodificar(i < 0 ? par : par.slice(0, i));
    if (nome && !lidos.has(nome)) lidos.set(nome, i < 0 ? '' : decodificar(par.slice(i + 1)));
  }
  const consulta = {};
  for (const nome of NOMES_DA_CONSULTA) if (lidos.has(nome)) consulta[nome] = lidos.get(nome);
  return consulta;
}

// sub-aba e seção padrão de cada aba (só Radar e Sistema têm)
const SUB_PADRAO = { radar: 'mim' };
const SECAO_PADRAO = { sistema: 'overview' };

function rotaPadrao(aba = 'radar') {
  return {
    aba, sub: SUB_PADRAO[aba] || '', aparelho: '', secao: SECAO_PADRAO[aba] || '',
    conta: '', pr: '', dias: null, agrupar: '', org: '', busca: '', repo: '', pessoa: '',
  };
}

function chaveDePr(v) {
  const k = typeof v === 'string' ? v : '';
  return k.length <= PR_MAX && ghPrUrl(k) ? k : '';
}

function valido(re, v) { return typeof v === 'string' && re.test(v) ? v : ''; }

function buscaSegura(v) {
  const t = String(v || '').trim().slice(0, BUSCA_MAX);
  return CARA_DE_SEGREDO.test(t) ? '' : t;
}

function lerEntregas(rota, q) {
  const dias = Number.parseInt(q.dias, 10);
  rota.dias = /^\d+$/.test(String(q.dias || '')) && DIAS_DE_ENTREGAS.includes(dias) ? dias : null;
  rota.agrupar = AGRUPAR[q.agrupar] || '';
  rota.org = valido(LOGIN_GH, q.org);
  rota.busca = buscaSegura(q.busca);
  rota.repo = valido(REPO_GH, q.repo);
  rota.pessoa = rota.repo ? '' : valido(LOGIN_GH, q.pessoa);
}

function lerCaminho(rota, partes) {
  if (rota.aba === 'radar') {
    const sub = SUBS_DO_RADAR[partes[1]] || (Object.values(SUBS_DO_RADAR).includes(partes[1]) ? partes[1] : '');
    if (sub) rota.sub = sub;
    if (rota.sub === 'apar') rota.aparelho = valido(ID_OPACO, partes[2]);
  }
  if (rota.aba === 'sistema') {
    const secao = SECOES_DO_SISTEMA[partes[1]] || (Object.values(SECOES_DO_SISTEMA).includes(partes[1]) ? partes[1] : '');
    if (secao) rota.secao = secao;
  }
}

/* O endereço da página -> o texto que lerRota entende, e se ele veio na grafia antiga (a
   rota no hash, até 20/10/2026). O hash só é rota antiga na raiz e sem consulta, que é como
   o app escrevia; fora disso ele é pedaço do endereço, nunca a rota (o `#` cru de um
   `?pr=a/b#1` digitado à mão, por exemplo). */
export function enderecoDaPagina(loc) {
  const l = loc || {};
  const caminho = String(l.pathname || '/');
  const consulta = String(l.search || '');
  const raiz = caminho === '/' || caminho === '/index.html';
  const hash = String(l.hash || '').replace(/^#/, '').replace(/^\/+/, '');
  if (raiz && !consulta && hash.trim()) return { endereco: `/${hash}`, antigo: true };
  return { endereco: (raiz ? '' : caminho) + consulta, antigo: false };
}

/* Endereço (caminho e consulta, ou o hash antigo) -> rota normalizada. Endereço vazio (ou só
   `/`, `#`, `#/`) devolve null: não há rota pedida, e quem chama mantém a tela como está.
   Qualquer outra coisa devolve rota VÁLIDA, caindo no padrão (Radar > Pra mim) no que não
   reconhece, sem lançar. */
export function lerRota(endereco) {
  const bruto = String(endereco || '').replace(/^#/, '').replace(/^\/+/, '');
  if (!bruto.trim()) return null;
  const q = bruto.indexOf('?');
  const caminho = q < 0 ? bruto : bruto.slice(0, q);
  const consulta = lerConsulta(q < 0 ? '' : bruto.slice(q + 1));
  const partes = caminho.split('/').map(decodificar);
  const aba = ABAS_DA_ROTA.includes(partes[0]) ? partes[0] : 'radar';
  const rota = rotaPadrao(aba);
  lerCaminho(rota, aba === partes[0] ? partes : []);
  if (ABAS_COM_CONTA.has(aba)) rota.conta = valido(LOGIN_GH, consulta.conta);
  if (aba === 'entregas') lerEntregas(rota, consulta);
  rota.pr = chaveDePr(consulta.pr);
  return rota;
}

function pedacoDeConsulta(nome, valor) {
  return `${nome}=${encodeURIComponent(String(valor))}`;
}

/* Rota -> caminho canônico, sempre com a aba e (no Radar e no Sistema) a sub-aba ou seção
   explícitas, para o endereço dizer por extenso o que está na tela. Passa pela mesma
   validação da leitura: escrever e ler de volta dá a mesma rota. */
export function escreverRota(r) {
  const rota = lerRotaDeObjeto(r);
  const caminho = [rota.aba];
  if (rota.aba === 'radar') {
    caminho.push(chaveDoValor(SUBS_DO_RADAR, rota.sub));
    if (rota.sub === 'apar' && rota.aparelho) caminho.push(rota.aparelho);
  }
  if (rota.aba === 'sistema') caminho.push(chaveDoValor(SECOES_DO_SISTEMA, rota.secao));
  const consulta = [];
  if (rota.aba === 'entregas') {
    if (rota.org) consulta.push(pedacoDeConsulta('org', rota.org));
    if (rota.dias !== null) consulta.push(pedacoDeConsulta('dias', rota.dias));
    if (rota.agrupar) consulta.push(pedacoDeConsulta('agrupar', chaveDoValor(AGRUPAR, rota.agrupar)));
    if (rota.busca) consulta.push(pedacoDeConsulta('busca', rota.busca));
    if (rota.repo) consulta.push(pedacoDeConsulta('repo', rota.repo));
    if (rota.pessoa) consulta.push(pedacoDeConsulta('pessoa', rota.pessoa));
  }
  if (rota.conta) consulta.push(pedacoDeConsulta('conta', rota.conta));
  if (rota.pr) consulta.push(pedacoDeConsulta('pr', rota.pr));
  const sufixo = consulta.length ? `?${consulta.join('&')}` : '';
  return `/${caminho.map(encodeURIComponent).join('/')}${sufixo}`;
}

// normaliza um objeto de rota vindo da tela com as MESMAS regras da leitura
function lerRotaDeObjeto(r) {
  const o = r || {};
  const aba = ABAS_DA_ROTA.includes(o.aba) ? o.aba : 'radar';
  const rota = rotaPadrao(aba);
  // a tela manda sub-aba e seção sempre (cada uma lembra a sua): vale a da aba à mostra
  const segundo = aba === 'sistema' ? chaveDoValor(SECOES_DO_SISTEMA, o.secao) : chaveDoValor(SUBS_DO_RADAR, o.sub);
  const partes = [aba, segundo, o.aparelho];
  lerCaminho(rota, partes);
  if (ABAS_COM_CONTA.has(aba)) rota.conta = valido(LOGIN_GH, o.conta);
  if (aba === 'entregas') {
    lerEntregas(rota, {
      dias: o.dias === null || o.dias === undefined ? '' : String(o.dias),
      agrupar: chaveDoValor(AGRUPAR, o.agrupar), org: o.org, busca: o.busca, repo: o.repo, pessoa: o.pessoa,
    });
  }
  rota.pr = chaveDePr(o.pr);
  return rota;
}

/* Como a troca de rota entra no histórico do navegador:
   - ''             nada mudou no endereço
   - 'push'         mudou de lugar (aba, sub-aba, aparelho, seção) ou abriu uma caixa de
                    revisão: o Voltar do navegador desfaz
   - 'fechou-caixa' a única diferença é a caixa de revisão ter fechado: quem chama volta a
                    entrada que a abertura empilhou, em vez de empilhar outra igual
   - 'replace'      filtro, conta, busca: troca a entrada atual, sem encher o histórico */
export function mudancaDeRota(antes, depois) {
  const b = lerRotaDeObjeto(depois);
  if (!antes) return 'replace';
  const a = lerRotaDeObjeto(antes);
  if (escreverRota(a) === escreverRota(b)) return '';
  const lugar = (r) => [r.aba, r.sub, r.aparelho, r.secao].join('|');
  if (lugar(a) !== lugar(b)) return 'push';
  if (b.pr && b.pr !== a.pr) return 'push';
  if (a.pr && !b.pr && escreverRota({ ...a, pr: '' }) === escreverRota(b)) return 'fechou-caixa';
  return 'replace';
}
