// O ramo do Antigravity CLI no runProvedor (lib/engine/session.js): o que se confere ANTES
// de abrir a sessão num perfil `agy`, e a troca de perfil quando a cota dele acabou.
//
// Antes de gastar qualquer token (spec, "O contrato com a cadeia de prioridade"):
//   1. LOGIN: o arquivo do token existe na pasta do perfil (lib/agy/home.js). Sem ele, a
//      sessão pediria login e esperaria 60 s por um código que ninguém vai colar.
//   2. CONTA E COTA: o `/usage` do perfil (zero token, cache curto, lib/agy/cota.js). Conta
//      autenticada diferente da esperada (ou token que não veio da pasta) para com motivo
//      permanente: a cadeia não pode confundir isso com cota. Grupo do modelo esgotado
//      registra o limite até o reset e a CADEIA ESCOLHE DE NOVO: a sessão roda no próximo
//      perfil sem abrir nada neste. Sem perfil livre, a falha é de limite, com a hora.
//   3. PROTOCOLO: as regras em `.agents/rules/` abaixo do teto de 24 KB (lib/agy/protocolo.js)
//      e o bloco do provedor no fim do prompt (sem subagente, checkpoint em texto).
// Depois, a sessão (lib/agy/stream.js), com o desfecho amarrado ao perfil USADO
// (comPerfilDaSessao): limite registrado neste perfil, sucesso libera este perfil.
import fs from 'node:fs';
import path from 'node:path';
import { WORKSPACE, TEMPLATE_DIR } from '../paths.js';
import { erroDeSessao } from '../engine/falhas.js';
import { comPerfilDaSessao } from '../engine/limite-na-cadeia.js';
import { chaveDaAssinatura, registroDaAssinatura } from '../engine/limite-plano.js';
import { temLogin } from './home.js';
import { lerCota, aplicarLeitura, contaConfere } from './cota.js';
import { escreverRegras, blocoDoProvedor } from './protocolo.js';
import { runAgyStream, fraseDoReset } from './stream.js';

const SEM_LOGIN = 'agy: sem login na pasta do perfil; abra o login do perfil em Plano e chaves';
const CONTA_TROCADA = 'agy: a conta autenticada na pasta do perfil não é a esperada; abra o login do perfil em Plano e chaves';

function perfilDe(engine, id) {
  return (engine.config?.claudeProfiles || []).find((p) => p?.id === id) || { id };
}

// O protocolo que vale é o do workspace (o boot o ressincroniza do template); sem ele, o do
// pacote. Falha aqui não segura a sessão: o prompt continua trazendo as substituições.
function prepararRegras(engine) {
  for (const origem of [path.join(WORKSPACE, 'CLAUDE.md'), path.join(TEMPLATE_DIR, 'CLAUDE.md')]) {
    let texto = '';
    try { texto = fs.readFileSync(origem, 'utf8'); } catch { continue; }
    try { escreverRegras(WORKSPACE, texto); } catch (err) { engine.log?.('WARN', `agy: regras do protocolo não gravadas: ${err.message}`); }
    return;
  }
}

function erroDeLimite(r, grupo) {
  const err = erroDeSessao(`agy: cota do plano atingida (grupo ${grupo}); ${fraseDoReset(r.ate)}; `, 'lido no /usage antes de abrir a sessão');
  err.limitePlano = { ate: r.ate, grupo, fonte: 'usage' };
  return err;
}

/**
 * O que fazer com este perfil agora: `{ rodar: true }`, `{ trocar: true }` (a cadeia tem outro
 * perfil livre) ou lança a falha (sem login, conta errada, todos no limite).
 */
async function conferir(engine, opts, auth) {
  if (!temLogin(auth.id)) throw erroDeSessao(SEM_LOGIN, '');
  const leitura = await lerCota(engine, auth.id);
  if (leitura.semLogin) throw erroDeSessao(SEM_LOGIN, '');
  if (contaConfere(perfilDe(engine, auth.id), leitura) === false) throw erroDeSessao(CONTA_TROCADA, '');
  const r = aplicarLeitura(engine, auth, leitura);
  if (!r.esgotado) return { rodar: true };
  const proximo = engine.resolveClaudeAuth(opts.account) || {};
  const outro = chaveDaAssinatura(proximo) !== chaveDaAssinatura(auth) && !registroDaAssinatura(engine, proximo);
  if (outro) return { trocar: true };
  throw erroDeLimite(r, r.grupo);
}

/**
 * @param {Function} redespachar roda o runProvedor de novo (a cadeia escolhe o perfil)
 */
function runAgy(engine, prompt, opts, auth, redespachar, observe = execute => execute()) {
  const usado = { kind: 'agy', id: auth.id || '', grupo: auth.grupo || 'gemini' };
  return conferir(engine, opts, usado).then((d) => {
    if (d.trocar) return redespachar();
    return observe(() => {
      prepararRegras(engine);
      const texto = String(prompt || '') + blocoDoProvedor(opts.operationKind || 'review');
      return comPerfilDaSessao(engine, runAgyStream(engine, texto, { ...opts, authProfileId: usado.id, auth: usado }), usado);
    }, usado);
  }, (err) => comPerfilDaSessao(engine, Promise.reject(err), usado));
}

export default { runAgy, conferir, prepararRegras };
export { runAgy, conferir, prepararRegras };
