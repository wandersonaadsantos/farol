// Vínculo do perfil ao grupo de consumo (CT-GRUPO). Mora em state/, porque é dado de
// operação e não segredo: segredo mora em ~/.farol.
//
// O VÍNCULO É UM INTERVALO, não um campo, e é daí que vem quase tudo o que a spec exige.
// Trocar de grupo fecha o intervalo anterior com `ate` e abre outro; nada é apagado,
// duplicado ou reatribuído em silêncio. Por isso `grupoDoConsumo(perfil, at)` responde
// pelo INSTANTE do gasto, e não pelo vínculo de agora: o consumo já registrado permanece
// no grupo em que foi feito.
//
// Revincular ao MESMO grupo não abre intervalo novo. É o caso da rotação de credencial:
// a chave muda, o vínculo não, e a contagem não recomeça.
//
// Perfil sem vínculo vigente não aparece em `lerVinculos`: identidade indefinida não vira
// identidade por omissão, e quem consulta precisa ver a diferença.
import path from 'node:path';
import fs from 'node:fs';
import { STATE_DIR } from '../paths.js';
import io from '../io.js';
import { TIPOS_DE_PERFIL } from './grupo.js';

const ARQUIVO = path.join(STATE_DIR, 'sync-vinculos.json');
const VERSAO = 1;
const ID_RE = /^[0-9a-f]{32}$/;

function caminhoDosVinculos() { return ARQUIVO; }

function objeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function numero(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function intervaloDe(x) {
  if (!objeto(x) || !ID_RE.test(String(x.grupo || ''))) return null;
  if (!TIPOS_DE_PERFIL.includes(String(x.tipo || ''))) return null;
  return { grupo: String(x.grupo), tipo: String(x.tipo), desde: numero(x.desde), ate: numero(x.ate) };
}

function lerTudo() {
  const d = io.readJson(ARQUIVO, null);
  if (!objeto(d) || d.v !== VERSAO || !objeto(d.perfis)) return {};
  const saida = {};
  for (const [perfil, lista] of Object.entries(d.perfis)) {
    if (!Array.isArray(lista)) continue;
    const limpa = lista.map(intervaloDe).filter(Boolean);
    if (limpa.length) saida[perfil] = limpa;
  }
  return saida;
}

function gravarTudo(perfis) {
  try {
    io.ensureDir(path.dirname(ARQUIVO));
    io.writeJsonAtomic(ARQUIVO, { v: VERSAO, perfis });
    return true;
  } catch {
    // sem o arquivo, o perfil volta a ser "não identificado", que é o lado seguro
    return false;
  }
}

function apagarVinculos() {
  if (!fs.existsSync(ARQUIVO)) return false;
  fs.rmSync(ARQUIVO, { force: true });
  return true;
}

function historicoDoVinculo(perfilId) {
  return lerTudo()[String(perfilId)] || [];
}

function abertoDe(lista) {
  return lista.find((x) => x.ate === 0) || null;
}

function vinculoVigente(perfilId) {
  return abertoDe(historicoDoVinculo(perfilId));
}

function lerVinculos() {
  const saida = {};
  for (const [perfil, lista] of Object.entries(lerTudo())) {
    const aberto = abertoDe(lista);
    if (aberto) saida[perfil] = aberto;
  }
  return saida;
}

function fechar(lista, agora) {
  const aberto = abertoDe(lista);
  if (aberto) aberto.ate = numero(agora);
  return lista;
}

function vincular(perfilId, { grupo, tipo, agora } = {}) {
  const novo = intervaloDe({ grupo, tipo, desde: agora, ate: 0 });
  if (!novo) return false;
  const perfis = lerTudo();
  const perfil = String(perfilId);
  const lista = perfis[perfil] || [];
  const aberto = abertoDe(lista);
  // mesmo grupo e mesmo tipo: é rotação de credencial, não vínculo novo
  if (aberto && aberto.grupo === novo.grupo && aberto.tipo === novo.tipo) return true;
  perfis[perfil] = [...fechar(lista, agora), novo];
  return gravarTudo(perfis);
}

function desvincular(perfilId, { agora } = {}) {
  const perfis = lerTudo();
  const perfil = String(perfilId);
  if (!perfis[perfil] || !abertoDe(perfis[perfil])) return false;
  perfis[perfil] = fechar(perfis[perfil], agora);
  return gravarTudo(perfis);
}

// Responde pelo INSTANTE do gasto. O intervalo aberto vai até agora; o fechado vale em
// [desde, ate), com o instante da troca já pertencendo ao grupo novo.
function grupoDoConsumo(perfilId, at) {
  const quando = numero(at);
  for (const x of historicoDoVinculo(perfilId)) {
    if (quando < x.desde) continue;
    if (x.ate === 0 || quando < x.ate) return x.grupo;
  }
  return null;
}

export default { caminhoDosVinculos, lerVinculos, vincular, desvincular, vinculoVigente, historicoDoVinculo, grupoDoConsumo, apagarVinculos };
export { caminhoDosVinculos, lerVinculos, vincular, desvincular, vinculoVigente, historicoDoVinculo, grupoDoConsumo, apagarVinculos };
