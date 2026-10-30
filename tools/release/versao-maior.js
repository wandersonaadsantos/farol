// Plano 4 do Farol nativo: o appcast da Sparkle só recebe versão MAIOR que a última
// publicada. Publicar igual ou menor faria a Sparkle ignorar o item (ou, pior, oferecer
// downgrade a quem estiver numa versão de teste). A comparação é a MESMA do update do
// motor (`cmpVersion` de `lib/engine/update.js`), para as duas regras nunca divergirem.
//
//   node tools/release/versao-maior.js <versão nova> [<appcast.xml publicado>]
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

// A maior versão publicada no appcast, ou null quando não há item (primeira release).
// Por item vale o shortVersionString (a versão que a pessoa vê); sem ele, o version.
function ultimaVersaoDoAppcast(xml) {
  if (!xml) return null;
  let maior = null;
  for (const [item] of String(xml).matchAll(/<item\b[\s\S]*?<\/item>/g)) {
    const versao = campo(item, 'shortVersionString') ?? campo(item, 'version');
    if (versao === null) continue;
    if (!VERSAO_DO_APPCAST.test(versao)) throw new Error(`versao malformada no appcast: ${versao}`);
    if (maior === null || cmpVersion(versao, maior) > 0) maior = versao;
  }
  return maior;
}

if (executadoDireto(import.meta.url)) {
  const [nova, arquivo] = process.argv.slice(2);
  try {
    const anterior = arquivo ? ultimaVersaoDoAppcast(fs.readFileSync(arquivo, 'utf8')) : null;
    if (!versaoMaior(nova, anterior)) {
      process.stderr.write(`versao ${nova} nao e maior que a ultima publicada no appcast (${anterior})\n`);
      process.exitCode = 1;
    }
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exitCode = 1;
  }
}

export { versaoMaior, ultimaVersaoDoAppcast };
