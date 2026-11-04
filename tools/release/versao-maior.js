// Plano 4 do Farol nativo: o appcast da Sparkle só recebe versão MAIOR que a última
// publicada. Publicar igual ou menor faria a Sparkle ignorar o item (ou, pior, oferecer
// downgrade a quem estiver numa versão de teste). A comparação é a MESMA do update do
// motor (`cmpVersion` de `lib/engine/update.js`), para as duas regras nunca divergirem.
//
// São DUAS versões (decisão R-L): a curta (`sparkle:shortVersionString`, o
// CFBundleShortVersionString que a pessoa vê) e o build (`sparkle:version`, o
// CFBundleVersion). A Sparkle ordena os updates pelo BUILD: curta maior com build igual
// seria um update que nenhuma cópia instalada aceita. Por isso as duas têm que subir; o
// build só é conferido quando o appcast anterior tem um.
//
//   node tools/release/versao-maior.js <curta nova> <build novo> [<appcast.xml publicado>]
//
// Sai 0 quando a versão nova pode ser publicada, 1 (com o motivo no stderr) quando não.
import fs from 'node:fs';
import { cmpVersion } from '../../lib/engine/update.js';
import { executadoDireto } from '../../lib/paths.js';

// a versão nova vem do nome do dmg e do CFBundleShortVersionString: X.Y.Z e mais nada
const VERSAO_NOVA = /^\d+\.\d+\.\d+$/;
// no appcast aceita também o sparkle:version numérico (build), mas nunca sufixo
const VERSAO_DO_APPCAST = /^\d+(\.\d+)*$/;

function versaoMaior(nova, anterior) {
  if (!VERSAO_NOVA.test(String(nova ?? ''))) throw new Error(`versao malformada: ${nova} (esperado X.Y.Z)`);
  if (anterior === null || anterior === undefined || anterior === '') return true;
  if (!VERSAO_DO_APPCAST.test(String(anterior))) throw new Error(`versao malformada no appcast: ${anterior}`);
  return cmpVersion(nova, anterior) > 0;
}

// O valor de um campo da Sparkle num item: elemento (formato atual) ou atributo do
// enclosure (formato antigo, que o generate_appcast ainda entende).
function campo(item, nome) {
  const elemento = new RegExp(`<sparkle:${nome}>\\s*([^<]*?)\\s*</sparkle:${nome}>`).exec(item);
  if (elemento) return elemento[1];
  const atributo = new RegExp(`sparkle:${nome}\\s*=\\s*"([^"]*)"`).exec(item);
  return atributo ? atributo[1].trim() : null;
}

const maiorDe = (atual, candidata) => (atual === null || cmpVersion(candidata, atual) > 0 ? candidata : atual);
function conferida(versao) {
  if (!VERSAO_DO_APPCAST.test(versao)) throw new Error(`versao malformada no appcast: ${versao}`);
  return versao;
}

// A maior versão curta e o maior build publicados no appcast, cada um por si, ou null
// quando não há item (primeira release). Item sem shortVersionString conta o
// sparkle:version como curta (é o que a Sparkle mostra); build ausente fica null.
function ultimaVersaoDoAppcast(xml) {
  if (!xml) return null;
  let curta = null;
  let build = null;
  for (const [item] of String(xml).matchAll(/<item\b[\s\S]*?<\/item>/g)) {
    const doBuild = campo(item, 'version');
    const daCurta = campo(item, 'shortVersionString') ?? doBuild;
    if (daCurta === null) continue;
    curta = maiorDe(curta, conferida(daCurta));
    if (doBuild !== null) build = maiorDe(build, conferida(doBuild));
  }
  return curta === null ? null : { curta, build };
}

// Pode publicar { curta, build } sobre o que o appcast anterior tem? Devolve o motivo da
// recusa, ou null quando pode. Versão nova malformada lança.
function motivoDaRecusa(nova, anterior) {
  if (!VERSAO_DO_APPCAST.test(String(nova?.build ?? ''))) throw new Error(`build malformado: ${nova?.build}`);
  if (!versaoMaior(nova?.curta, anterior?.curta)) {
    return `versao ${nova.curta} nao e maior que a ultima publicada no appcast (${anterior.curta})`;
  }
  if (anterior?.build && cmpVersion(nova.build, anterior.build) <= 0) {
    return `build ${nova.build} nao e maior que o ultimo publicado no appcast (${anterior.build}); a Sparkle ordena pelo build (CFBundleVersion)`;
  }
  return null;
}

if (executadoDireto(import.meta.url)) {
  const [curta, build, arquivo] = process.argv.slice(2);
  try {
    const anterior = arquivo ? ultimaVersaoDoAppcast(fs.readFileSync(arquivo, 'utf8')) : null;
    const motivo = motivoDaRecusa({ curta, build }, anterior);
    if (motivo) {
      process.stderr.write(`${motivo}\n`);
      process.exitCode = 1;
    }
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exitCode = 1;
  }
}

export { versaoMaior, ultimaVersaoDoAppcast, motivoDaRecusa };
