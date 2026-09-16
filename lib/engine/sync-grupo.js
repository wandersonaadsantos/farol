// O grupo de consumo no banco (CT-GRUPO): publicar (admin) e aceitar (consumidor).
//
// Mesmo contrato de nó da política, mesma ordem de recusa, pelo mesmo módulo comum. O que
// muda é só o conteúdo e o que se faz com ele depois.
//
// CONFIGURAR NÃO É ATIVAR, e este módulo é o lado "configurar". O teto aceito aqui NÃO
// entra em nenhum caminho de admissão: ele é guardado e exibido, e passa a barrar na C4b,
// que exige, junto, consumo confiável (A1), identidade de grupo (C2), admissão local com
// reserva (C4) e as duas definições de métrica. Publicar um teto hoje não pode parar
// aparelho nenhum, e existe um teste que grava teto zero e confere que nada muda.
import { sharedActive } from '../sync/config.js';
import { motivoDe } from '../sync/errors.js';
import noAssinado from '../sync/no-assinado.js';
import publicar from './sync-publicar.js';
import grupo from '../sync/grupo.js';
import vinculo from '../sync/vinculo.js';
import { autoridadeFresca } from '../sync/autoridade.js';
import { SYNC } from '../constants.js';

const NO = 'live/groups';
const CAMPO = 'grupo';
const ESQUEMA = 'grupo1';

const MOTIVOS = {
  forma: 'grupo incompleto',
  geracao: 'o grupo não é da geração vigente do admin',
  assinatura: 'o grupo não foi assinado pelo admin vigente',
  autoridade: 'o admin não deu sinal de vida recente',
  antiga: 'já existe uma versão mais nova deste grupo neste aparelho',
  cifra: 'não deu para abrir o grupo',
};

function recusa(code, motivo) {
  return { ok: false, code, motivo: motivo || motivoDe(code) };
}

function objeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function caminhoDe(id) { return `${NO}/${id}`; }

function frescor(autoridade) {
  if (!objeto(autoridade)) return false;
  const intervaloMs = Number(autoridade.intervaloMs) || SYNC.AUTORIDADE_INTERVALO_MS;
  return autoridadeFresca(autoridade, { agora: Number(autoridade.agora) || 0, intervaloMs });
}

async function syncPublicarGrupo(engine, cfg, { grupo: bruto } = {}) {
  const limpo = grupo.sanearGrupo(bruto);
  return publicar.publicarNoAssinado(engine, cfg, {
    caminho: limpo.id ? caminhoDe(limpo.id) : '', no: NO, campo: CAMPO, esquema: ESQUEMA,
    dados: { g: limpo }, assunto: 'o grupo',
  });
}

// O que volta é o grupo saneado de novo: o que veio do banco é entrada, mesmo tendo
// assinatura válida, e a allowlist é do consumidor.
function aceitarGrupo(engine, cfg, { no, admin, autoridade, id } = {}) {
  if (!sharedActive(cfg)) return recusa('compartilhamento-desligado', 'o compartilhamento cifrado está desligado');
  if (cfg.aceitarAdmin !== true) return recusa('nao-aceita-admin', 'este aparelho não aceita configuração de admin');
  const rt = engine.sync;
  if (!rt || !rt.uid || !rt.material) return recusa('sem-chave', 'a chave do conjunto não está aberta neste aparelho');
  const alvo = String(id || '').trim();
  const r = noAssinado.aceitarNoAssinado({
    no, admin, uid: rt.uid, caminho: caminhoDe(alvo), campo: CAMPO, esquema: ESQUEMA,
    material: rt.material, fresca: frescor(autoridade), versaoAceita: versaoAceitaDe(rt, alvo),
  });
  if (!r.ok) return recusa(r.code, MOTIVOS[r.code] || motivoDe(r.code));
  const limpo = grupo.sanearGrupo(r.valor && r.valor.g);
  guardar(rt, alvo, { grupo: limpo, versao: r.versao, generation: r.generation });
  return { ok: true, grupo: limpo, versao: r.versao, generation: r.generation };
}

// O grupo aceito vive na sessão: ele não decide nada ainda, e guardar em disco um valor
// que não barra nada só criaria um arquivo para alguém confundir com orçamento ativo.
function guardar(rt, id, valor) {
  if (!objeto(rt.grupos)) rt.grupos = {};
  rt.grupos[id] = valor;
}

function versaoAceitaDe(rt, id) {
  const atual = objeto(rt.grupos) ? rt.grupos[id] : null;
  return atual ? Number(atual.versao) || 0 : 0;
}

function grupoAceito(engine, id) {
  const rt = engine.sync || {};
  const atual = objeto(rt.grupos) ? rt.grupos[String(id || '').trim()] : null;
  return atual ? atual.grupo : null;
}

// Vincular e desvincular são LOCAIS e explícitos: nenhum dos dois toca o banco, e nenhum
// deles transfere credencial ou autoriza ação nova. O vínculo serve para contabilizar e
// aplicar política, e só.
function syncVincularPerfil(engine, { perfilId, grupo: id, tipo, desvincular } = {}) {
  const perfil = String(perfilId || '').trim();
  if (!perfil) return { ok: false, code: 'forma', motivo: 'falta dizer qual perfil' };
  const agora = Date.now();
  const feito = desvincular === true ? vinculo.desvincular(perfil, { agora }) : vinculo.vincular(perfil, { grupo: id, tipo, agora });
  if (!feito) return { ok: false, code: 'forma', motivo: 'grupo ou tipo de perfil inválido' };
  if (typeof engine.pushState === 'function') engine.pushState();
  return { ok: true, vinculo: vinculo.vinculoVigente(perfil) };
}

export default { syncPublicarGrupo, aceitarGrupo, grupoAceito, syncVincularPerfil };
export { syncPublicarGrupo, aceitarGrupo, grupoAceito, syncVincularPerfil };
