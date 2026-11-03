// As pastas de motor em ~/.farol/engine/<X.Y.Z>/ (28/10/2026): qual delas vale para esta casca
// e qual já pode sair do disco. A maior versão instalada mais nova que a semeada, e cujo
// `engines.farolShell` aceita a versão da casca, é a que vale.
//
// `escolherMotor` é pura sobre o disco (a pasta vem por parâmetro) e nunca lança. Falta de
// prova (manifesto ilegível, sem farolShell, casca sem versão) é ficar na semeada.
import fs from 'node:fs';
import path from 'node:path';
import { parseJson } from '../io.js';
import { cmpVersion } from './update.js';
import { VERSAO, faixaDaCasca, cascaAceita } from './casca-manifesto.js';

function pastasDeVersao(pastaEngine) {
  let itens;
  try { itens = fs.readdirSync(pastaEngine, { withFileTypes: true }); } catch { return null; }
  return itens.filter(i => i.isDirectory() && VERSAO.test(i.name)).map(i => i.name);
}

// Lê o manifesto de uma pasta instalada. A versão declarada tem de ser a do nome da pasta, e
// o server.js tem de existir: pasta pela metade (download interrompido) é manifesto inválido.
function lerManifesto(raiz, nome) {
  let texto;
  try { texto = fs.readFileSync(path.join(raiz, 'package.json'), 'utf8'); } catch { return null; }
  const m = parseJson(texto, null);
  if (!m || typeof m !== 'object' || Array.isArray(m) || m.version !== nome) return null;
  if (!fs.existsSync(path.join(raiz, 'server.js'))) return null;
  return m;
}

// A versão vem do nome da pasta (conferido contra o manifesto), então a pasta antiga é
// descartada antes de ler o manifesto: pasta velha quebrada não vira aviso, vira poda.
function motivoDaPasta(raiz, nome, semeada, versaoCasca) {
  if (cmpVersion(nome, semeada) <= 0) return 'abaixo-da-semeada';
  const manifesto = lerManifesto(raiz, nome);
  if (!manifesto) return 'manifesto-invalido';
  const faixa = faixaDaCasca(manifesto);
  if (!faixa) return 'sem-farolShell';
  if (!cascaAceita(versaoCasca, faixa)) return 'casca-incompativel';
  return '';
}

function escolherMotor({ semeada, raizSemeada, pastaEngine, versaoCasca }) {
  const nomes = pastasDeVersao(pastaEngine);
  const ficar = (motivo, ignoradas) => ({ raiz: raizSemeada, versao: semeada, motivo, ignoradas });
  if (nomes === null) return ficar('sem-pasta', []);
  if (!nomes.length) return ficar('semeada', []);
  const ignoradas = [];
  let melhor = null;
  for (const nome of nomes) {
    const raiz = path.join(pastaEngine, nome);
    const motivo = motivoDaPasta(raiz, nome, semeada, versaoCasca);
    if (motivo) ignoradas.push({ pasta: raiz, motivo });
    else if (!melhor || cmpVersion(nome, melhor.versao) > 0) melhor = { raiz, versao: nome };
  }
  return melhor ? { ...melhor, motivo: 'instalada', ignoradas } : ficar('nenhuma-compativel', ignoradas);
}

// Sobra de update interrompido (update-casca.js copia para `<versão>.tmp` e renomeia): quando
// o bootstrap roda, o motor que a criou já saiu, então ela é lixo por definição.
const SOBRA_DE_UPDATE = /^\d+\.\d+\.\d+\.tmp$/;
function sobrasDeUpdate(pastaEngine) {
  let itens;
  try { itens = fs.readdirSync(pastaEngine, { withFileTypes: true }); } catch { return []; }
  return itens.filter(i => i.isDirectory() && SOBRA_DE_UPDATE.test(i.name)).map(i => i.name);
}

// Apaga as pastas de versão abaixo de TODAS as de `manter` (a escolhida e a semeada) e toda
// sobra `X.Y.Z.tmp`. Só filhos diretos de `pastaEngine` com esses nomes exatos; o resto nunca
// é tocado. Devolve os nomes removidos. Falha ao apagar não impede o boot: sobra para a
// próxima poda.
function podarMotores({ pastaEngine, manter }) {
  const abaixo = (pastasDeVersao(pastaEngine) || []).filter(nome => manter.every(v => cmpVersion(nome, v) < 0));
  const removidas = [];
  for (const nome of [...abaixo, ...sobrasDeUpdate(pastaEngine)]) {
    try {
      fs.rmSync(path.join(pastaEngine, nome), { recursive: true, force: true });
      removidas.push(nome);
    } catch { /* fica para a próxima poda; o motor escolhido não depende disto */ }
  }
  return removidas;
}

export default { escolherMotor, podarMotores };
export { escolherMotor, podarMotores };
