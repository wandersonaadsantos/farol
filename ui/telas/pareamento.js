/* Tela de pareamento (A4): a interface inteira, quando a API local exige credencial e este
   navegador ainda não tem uma.

   A lógica fica em funções que recebem o que usam (`pedir`, `salvar`, `recarregar`), para o
   teste exercitar o envio sem depender de evento de DOM. O que sobra aqui é fiação. */
import { pareamentoHtml, textoDaRecusa } from '../pure.js';
import { salvarToken } from '../transporte.js';
import { api, get } from './infra.js';

const RASCUNHO_CODIGO = 'farol-par-codigo';
const RASCUNHO_ROTULO = 'farol-par-rotulo';

// O que a pessoa digitou sobrevive à volta para esta tela (sessão revogada no meio do uso).
// Duas chaves de texto em vez de um objeto serializado: não há o que interpretar na volta.
function lerRascunho(armazenamento = globalThis.sessionStorage) {
  try {
    const codigo = armazenamento.getItem(RASCUNHO_CODIGO);
    const rotulo = armazenamento.getItem(RASCUNHO_ROTULO);
    return (codigo === null && rotulo === null) ? {} : { codigo: codigo || '', rotulo: rotulo || '' };
  } catch {
    return {};
  }
}

function gravarRascunho(dados, armazenamento = globalThis.sessionStorage) {
  try {
    armazenamento.setItem(RASCUNHO_CODIGO, String((dados && dados.codigo) || ''));
    armazenamento.setItem(RASCUNHO_ROTULO, String((dados && dados.rotulo) || ''));
  } catch { /* janela privada */ }
}

function limparRascunho(armazenamento = globalThis.sessionStorage) {
  try {
    armazenamento.removeItem(RASCUNHO_CODIGO);
    armazenamento.removeItem(RASCUNHO_ROTULO);
  } catch { /* janela privada */ }
}

// Sem token ainda, o api() da infraestrutura manda os cabeçalhos de sempre. Sem resposta
// é diferente de recusa: o código não foi gasto.
async function pedirPareamento(corpo) {
  return (await api('/api/auth/pair', corpo)) || { ok: false, code: 'sem_resposta', restantes: null };
}

/**
 * Tenta parear. Devolve `{ ok }` e, quando não deu certo, o texto que a tela mostra.
 * Em caso de sucesso guarda o token e manda recarregar: a página volta como a de sempre.
 */
async function submeterPareamento({ codigo, rotulo }, deps = {}) {
  const pedir = deps.pedir || pedirPareamento;
  const salvar = deps.salvar || salvarToken;
  const recarregar = deps.recarregar || (() => globalThis.location.reload());
  const esquecer = deps.limpar || limparRascunho;
  const resposta = await pedir({ codigo: String(codigo || '').trim(), rotulo: String(rotulo || '').trim() });
  if (!resposta || resposta.ok !== true || !salvar(resposta.token)) {
    return { ok: false, texto: textoDaRecusa(resposta && resposta.ok === true ? { code: 'sem_resposta' } : resposta) };
  }
  esquecer();
  recarregar();
  return { ok: true, texto: '' };
}

// ordem importa: o Edge também diz "Chrome", e o Chrome também diz "Safari"
const NAVEGADORES = [[/Edg\//, 'Edge'], [/Firefox\//, 'Firefox'], [/Chrome\//, 'Chrome'], [/Safari\//, 'Safari']];
const APARELHOS = [[/Android/i, ' do celular'], [/iPhone|iPad/i, ' do iPhone']];

function primeiroQueCasa(tabela, texto, padrao) {
  const achado = tabela.find(([re]) => re.test(texto));
  return achado ? achado[1] : padrao;
}

function rotuloSugerido(navegador = globalThis.navigator) {
  const ua = String((navegador && navegador.userAgent) || '');
  return primeiroQueCasa(NAVEGADORES, ua, 'Navegador') + primeiroQueCasa(APARELHOS, ua, '');
}

function ehWindows(navegador = globalThis.navigator) {
  return /Windows/i.test(String((navegador && navegador.userAgent) || ''));
}

/** Desenha a tela na raiz recebida e liga o envio. `aviso` explica por que voltamos aqui;
    `recusa` é o texto da última tentativa, que aparece junto do campo do código. */
function montarPareamento(raiz, aviso = '', deps = {}, recusa = '') {
  const rascunho = lerRascunho();
  raiz.innerHTML = pareamentoHtml({
    rotuloSugerido: rascunho.rotulo || rotuloSugerido(),
    codigo: rascunho.codigo || '',
    aviso,
    recusa,
    ehWindows: ehWindows(),
  });
  const form = raiz.querySelector('#parForm');
  const codigo = raiz.querySelector('#parCodigo');
  const rotulo = raiz.querySelector('#parRotulo');
  const enviar = raiz.querySelector('#parEnviar');
  const guardar = () => gravarRascunho({ codigo: codigo.value, rotulo: rotulo.value });
  codigo.addEventListener('input', guardar);
  rotulo.addEventListener('input', guardar);
  // Enter envia mesmo onde o envio implícito do formulário não acontece (teclados virtuais
  // que mandam só o keydown, automação). Observado na jornada: sem isto, nada saía.
  const enviarComEnter = (ev) => {
    if (ev.key !== 'Enter' || ev.isComposing) return;
    ev.preventDefault();
    form.requestSubmit();
  };
  codigo.addEventListener('keydown', enviarComEnter);
  rotulo.addEventListener('keydown', enviarComEnter);
  // a raiz sobrevive às remontagens (cada recusa redesenha a tela): um ouvinte só
  if (!raiz.dataset.copiarLigado) {
    raiz.dataset.copiarLigado = '1';
    raiz.addEventListener('click', (ev) => {
      const botao = ev.target && ev.target.closest && ev.target.closest('[data-copiar]');
      if (botao && globalThis.navigator && globalThis.navigator.clipboard) globalThis.navigator.clipboard.writeText(botao.getAttribute('data-copiar'));
    });
  }
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    enviar.disabled = true;
    const r = await submeterPareamento({ codigo: codigo.value, rotulo: rotulo.value }, deps);
    enviar.disabled = false;
    if (!r.ok) {
      guardar();
      montarPareamento(raiz, aviso, deps, r.texto);
    }
  });
  if (codigo.focus) codigo.focus();
}

/** O gate do boot: quem responde se esta página pode seguir para o app. Sem resposta, o
    app segue e mostra os próprios estados de falha: a tela de pareamento aparecer por
    engano trancaria alguém fora de um Farol que está funcionando. */
async function precisaParear(ler = get) {
  const status = await ler('/api/auth/status').catch(() => null);
  return !!status && status.exigida === true && status.autenticado !== true;
}

export { montarPareamento, precisaParear, submeterPareamento, rotuloSugerido, lerRascunho, gravarRascunho, limparRascunho };
