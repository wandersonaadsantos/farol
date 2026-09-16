// Revogação de acesso (7.C2). Três coisas diferentes, e o app não as confunde:
//
//   1. ACESSO AO FIREBASE: troca de senha no console, que expira os refresh tokens. O ID
//      token já emitido continua valendo até 1 h. `revokedBefore` é o corte que faz um
//      token com `auth_time` anterior parar de ler e de escrever, e ele é o único pedaço
//      desta lista que o Farol grava.
//   2. AUTORIZAÇÃO DO APARELHO: aposentar (lib/engine/sync-aparelho.js) e retirar o
//      consentimento local (`aceitarAdmin`). Vale neste aparelho, e é imediato.
//   3. PROCESSOS DE IA EM ANDAMENTO: só o próprio aparelho cancela. Comando remoto é da C6.
//
// O QUE ISTO NÃO PROMETE, e a tela repete: cancelamento imediato do que já está rodando
// noutro aparelho, e remoção de dados ou chaves que aquele aparelho já recebeu. Chave que
// saiu do banco está na máquina de alguém, e nenhum corte de token a traz de volta. Um
// resumo que sugerisse o contrário seria pior que não ter tela nenhuma.
//
// `revokedBefore` SÓ CRESCE, e precisa ser menor que o `auth_time` do token do próprio
// ato: sem isso, quem revoga se cortaria fora junto, e a conta ficaria sem ninguém capaz
// de desfazer.
import { sharedActive, authUrlsFor } from '../sync/config.js';
import { readSyncCredential, setSyncCredential } from '../sync/credentials.js';
import { signInWithPassword } from '../sync/auth.js';
import { SYNC_CODES, motivoDe } from '../sync/errors.js';
import io from '../io.js';
import cachePolitica from '../sync/cache-politica.js';

const CAMINHO = 'live/control/revokedBefore';
const MARGEM_S = 5;

function recusa(code, motivo) {
  return { ok: false, code, motivo: motivoDe(code) === motivo ? motivo : (motivo || motivoDe(code)) };
}

// O `auth_time` verdadeiro vem do token do ato. Token que não é JWT (o dublê dos testes,
// e qualquer provedor que mude de formato) cai no relógio local corrigido pelo desvio, com
// margem: é uma aproximação por baixo, e por baixo é o lado seguro, porque o corte precisa
// ser MENOR que o auth_time para o servidor aceitar.
function authTimeDe(idToken, agoraMs) {
  const partes = String(idToken || '').split('.');
  const corpo = partes.length === 3 ? io.parseJson(Buffer.from(partes[1], 'base64url').toString('utf8'), null) : null;
  const doToken = corpo && Number(corpo.auth_time);
  if (Number.isFinite(doToken) && doToken > 0) return doToken;
  return Math.floor(agoraMs / 1000) - MARGEM_S;
}

async function corteVigenteDe(rt) {
  try {
    const r = await rt.client.get(`/users/${rt.uid}/${CAMINHO}`);
    return r && r.ok ? Number(r.data) || 0 : 0;
  } catch {
    // sem leitura, o cliente não sabe o vigente; quem recusa corte que anda para trás
    // é também a regra do banco, e ela não depende desta leitura
    return 0;
  }
}

async function syncRevogar(engine, cfg, fetchImpl, { password } = {}) {
  if (!sharedActive(cfg)) return recusa('compartilhamento-desligado', 'o compartilhamento cifrado está desligado');
  const rt = engine.sync;
  if (!rt || !rt.client || !rt.uid) return recusa(SYNC_CODES.SEM_CREDENCIAL, 'este aparelho não está conectado');
  const cred = readSyncCredential();
  const email = (cred && cred.email) || rt.email;
  if (!email) return recusa(SYNC_CODES.SEM_CREDENCIAL, 'este aparelho não tem login guardado');

  const { identityUrl } = authUrlsFor(cfg.databaseUrl);
  const entrada = await signInWithPassword({ apiKey: cfg.apiKey, email, password: typeof password === 'string' ? password : '', fetchImpl, identityUrl });
  if (!entrada.ok) return recusa(entrada.code, entrada.motivo);
  setSyncCredential({ uid: entrada.uid, email: entrada.email, refreshToken: entrada.refreshToken });

  const agora = typeof rt.agora === 'function' ? rt.agora() : Date.now();
  const corte = authTimeDe(entrada.idToken, agora) - 1;
  // este nó é um NÚMERO cru, não um objeto: `lerNo` devolveria null para ele, e um
  // vigente lido como zero deixaria o corte andar para trás
  const vigente = await corteVigenteDe(rt);
  if (corte <= vigente) return recusa('sem-efeito', 'o corte vigente já é igual ou mais recente que este');

  const w = await rt.client.put(`/users/${rt.uid}/${CAMINHO}`, corte, {});
  if (!w || !w.ok) return recusa((w && w.code) || SYNC_CODES.INDISPONIVEL, 'o servidor não aceitou o corte de sessões');
  if (typeof engine.pushState === 'function') engine.pushState();
  return { ok: true, corte, vigente };
}

// Retirar o consentimento vale NESTE aparelho e é imediato: o cache da última política
// aceita vai junto, senão a restrição continuaria valendo depois de o dono dizer que não
// obedece mais a admin nenhum.
// Também chamada pelo `aplicarConfig` sempre que a config chega com o consentimento
// desligado: a tela de configuração é outro caminho para o mesmo ato, e a restrição não
// pode sobreviver por ter sido retirada pela porta errada.
function esquecerPoliticaAceita() {
  return cachePolitica.apagarPolitica();
}

function retirarConsentimento(engine, cfg) {
  engine.updateSettings({ sync: { ...cfg, aceitarAdmin: false } });
  const apagou = esquecerPoliticaAceita();
  if (typeof engine.pushState === 'function') engine.pushState();
  return { ok: true, cacheApagado: apagou, aviso: 'este aparelho voltou a valer só pela configuração local' };
}

// Campos separados, para a tela não poder juntar duas garantias diferentes numa frase só.
function resumoDaRevogacao({ corteVigente } = {}) {
  return {
    corteVigente: Number(corteVigente) || 0,
    acessoAoBanco: 'trocar a senha no console do Firebase expira os refresh tokens deste e dos outros aparelhos',
    tokenEmitido: 'um ID token já emitido continua valendo por até 1 hora, e o corte de sessões é o que o encurta',
    autorizacaoDoAparelho: 'aposentar e retirar o consentimento local valem só neste aparelho, e valem na hora',
    processosDeIa: 'sessão de IA em andamento só é cancelada no aparelho onde ela roda',
    naoPromete: 'dados e chaves que outro aparelho já recebeu continuam com ele',
  };
}

export default { syncRevogar, retirarConsentimento, esquecerPoliticaAceita, resumoDaRevogacao, authTimeDe };
export { syncRevogar, retirarConsentimento, esquecerPoliticaAceita, resumoDaRevogacao, authTimeDe };
