/* Plano e chaves (A2, brief B2 item 2.2): o resultado do teste de um perfil e o aviso de
   perfil apontado que a cascata não usa. PURAS.

   A regra desta tela é a ORIGEM: cada informação diz se foi informada por você, detectada
   num arquivo, validada pelo Claude Code, inferida ou desconhecida. Sem isso, "conta:
   fulano" parece o mesmo dado quer tenha vindo do CLI, quer tenha sido lido de um arquivo
   que pode estar velho. O nome comercial do plano nunca aparece: nada do que o CLI devolve
   o prova, e a tela diz isso em vez de calar. */
import { esc, fmtClock } from './comum.js';

const ROTULOS = {
  configDir: 'Pasta de configuração',
  login: 'Login',
  email: 'Conta',
  tipoAuth: 'Tipo de autenticação',
  plano: 'Plano',
  chave: 'Chave',
};
const ORDEM = ['configDir', 'chave', 'login', 'email', 'tipoAuth', 'plano'];
const SIM_NAO = { true: 'ativo', false: 'sem login' };

function valorLegivel(campo) {
  if (typeof campo.valor === 'boolean') return SIM_NAO[String(campo.valor)];
  if (campo.valor === null || campo.valor === undefined || campo.valor === '') return 'não sabemos';
  return String(campo.valor);
}

function linhaDoCampo(chave, campo) {
  const vazio = campo.valor === null || campo.valor === undefined || campo.valor === '';
  const motivo = campo.motivo ? `<span class="cp-motivo">${esc(campo.motivo)}</span>` : '';
  return `<div class="cp-linha">
    <span class="cp-chave">${esc(ROTULOS[chave] || chave)}</span>
    <span class="cp-valor${vazio ? ' cp-vazio' : ''}">${esc(valorLegivel(campo))}</span>
    <span class="origem ${esc(campo.origem || 'desconhecido')}">${esc(campo.origem || 'desconhecido')}</span>
    ${motivo}
  </div>`;
}

/**
 * O bloco que aparece embaixo do perfil depois de "Testar perfil".
 * @param {{ estado: 'testando'|'pronto'|'erro', perfil?: object, motivo?: string, code?: string, em?: number }} dados
 */
function perfilTesteHtml(dados = {}) {
  if (dados.estado === 'testando') return '<div class="cp-teste-box"><span class="pill busy">testando o perfil…</span></div>';
  if (dados.estado === 'erro') {
    return `<div class="cp-teste-box cp-teste-erro" role="alert">${esc(dados.motivo || 'não deu para testar este perfil agora')}</div>`;
  }
  const p = (dados.perfil && typeof dados.perfil === 'object') ? dados.perfil : null;
  if (!p) return '';
  const campos = (p.campos && typeof p.campos === 'object') ? p.campos : {};
  const linhas = ORDEM.filter((k) => campos[k]).map((k) => linhaDoCampo(k, campos[k])).join('');
  const aviso = p.aviso ? `<div class="cp-teste-aviso">${esc(p.aviso)}</div>` : '';
  const quando = dados.em ? `Testado às ${esc(fmtClock(dados.em))}` : 'Testado agora';
  return `<div class="cp-teste-box">
    <div class="cp-teste-topo"><span class="cp-teste-quando">${quando}</span><span class="cp-teste-nota">o teste não abre sessão de modelo e não altera a configuração</span></div>
    ${linhas}
    ${aviso}
  </div>`;
}

const TEXTO_DO_PROBLEMA = {
  'perfil-inexistente': (id) => `aponta para o perfil "${id}", que não existe mais`,
  'perfil-invalido': (id) => `aponta para o perfil "${id}", que está incompleto (falta a pasta ou a chave)`,
};

/** O aviso de perfil apontado que a cascata não consegue usar (A2): erro, nunca silêncio. */
function perfilProblemasHtml(problemas) {
  const lista = Array.isArray(problemas) ? problemas : [];
  if (!lista.length) return '';
  const linhas = lista.map((p) => {
    const onde = p.escopo === 'conta' ? `A conta @${esc(p.user)}` : 'O padrão do Farol';
    const causa = (TEXTO_DO_PROBLEMA[p.code] || TEXTO_DO_PROBLEMA['perfil-inexistente'])(esc(p.profileId));
    return `<li>${onde} ${causa}.</li>`;
  }).join('');
  return `<div class="banner cp-problemas" role="alert">
    <ul class="cp-problemas-lista">${linhas}</ul>
    <span class="cp-problemas-fim">Enquanto isso, as sessões dessas contas usam a assinatura legada desta máquina. Escolha outro perfil abaixo.</span>
  </div>`;
}

export { perfilTesteHtml, perfilProblemasHtml };
