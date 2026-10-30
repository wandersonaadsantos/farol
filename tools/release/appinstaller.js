// Plano 4 do Farol nativo: o `Farol.appinstaller` da casca do Windows. É o arquivo que o
// Windows relê para achar a versão nova do MSIX: o `Uri` da raiz aponta para
// `releases/latest/download/`, então a cópia instalada sempre encontra o manifesto mais
// novo, e o `Uri` do `MainPackage` aponta para o asset da release VERSIONADA (o MSIX
// daquela versão, que nunca muda depois de publicado).
//
//   node tools/release/appinstaller.js --msix <arquivo.msix> --saida <Farol.appinstaller>
//                                      --versao X.Y.Z.W --repo <dono/nome>
//
// O `Name` e o `Publisher` vêm do `Identity` do `shell/win/Farol.App/Package.appxmanifest`
// (lidos só aqui, na linha de comando; a função pura os recebe por parâmetro), e a
// `--versao` tem de ser igual à `Version` dele. Sai 0 com o
// arquivo gravado, 1 (motivo no stderr, nada gravado) quando alguma entrada não confere.
import fs from 'node:fs';
import path from 'node:path';
import { executadoDireto } from '../../lib/paths.js';

const VERSAO = /^\d+\.\d+\.\d+\.\d+$/;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const MANIFESTO = path.join(import.meta.dirname, '..', '..', 'shell', 'win', 'Farol.App', 'Package.appxmanifest');

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
const atributo = (valor) => String(valor).replace(/[&<>"']/g, (c) => ESCAPES[c]);

function exigirTexto(valor, campo) {
  if (typeof valor !== 'string' || !valor.trim()) throw new Error(`${campo} vazio`);
  return valor;
}

function appinstallerXml({ versao, repo, nomeDoMsix, publisher, nome } = {}) {
  if (!VERSAO.test(String(versao ?? ''))) throw new Error(`versao malformada: ${versao} (esperado X.Y.Z.W)`);
  if (!REPO.test(String(repo ?? ''))) throw new Error(`repo malformado: ${repo} (esperado dono/nome)`);
  exigirTexto(nomeDoMsix, 'nome do msix');
  exigirTexto(publisher, 'publisher');
  exigirTexto(nome, 'nome do pacote');
  const curta = versao.split('.').slice(0, 3).join('.');
  const github = `https://github.com/${repo}`;
  return `<?xml version="1.0" encoding="utf-8"?>
<AppInstaller xmlns="http://schemas.microsoft.com/appx/appinstaller/2018" Uri="${github}/releases/latest/download/Farol.appinstaller" Version="${versao}">
  <MainPackage Name="${atributo(nome)}" Publisher="${atributo(publisher)}" Version="${versao}" ProcessorArchitecture="x64" Uri="${github}/releases/download/v${curta}/${atributo(nomeDoMsix)}" />
  <UpdateSettings>
    <OnLaunch HoursBetweenUpdateChecks="0" ShowPrompt="false" UpdateBlocksActivation="false" />
    <AutomaticBackgroundTask />
  </UpdateSettings>
</AppInstaller>
`;
}

// Name e Publisher do <Identity> do manifesto do pacote
function identidadeDoManifesto(xml) {
  const identidade = /<Identity\b[^>]*>/.exec(xml);
  if (!identidade) throw new Error('manifesto sem <Identity>');
  const ler = (attr) => {
    const m = new RegExp(`\\b${attr}="([^"]*)"`).exec(identidade[0]);
    if (!m) throw new Error(`manifesto sem ${attr} no <Identity>`);
    return m[1].replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  };
  return { nome: ler('Name'), publisher: ler('Publisher'), versao: ler('Version') };
}

function lerArgumentos(argv) {
  const opcoes = {};
  for (let i = 0; i < argv.length; i += 2) {
    const [nome, valor] = [argv[i], argv[i + 1]];
    if (!['--msix', '--saida', '--versao', '--repo'].includes(nome)) throw new Error(`argumento desconhecido: ${nome}`);
    if (valor === undefined) throw new Error(`falta o valor de ${nome}`);
    opcoes[nome.slice(2)] = valor;
  }
  for (const nome of ['msix', 'saida', 'versao', 'repo']) {
    if (!opcoes[nome]) throw new Error(`falta --${nome}`);
  }
  return opcoes;
}

if (executadoDireto(import.meta.url)) {
  try {
    const { msix, saida, versao, repo } = lerArgumentos(process.argv.slice(2));
    if (!fs.statSync(msix, { throwIfNoEntry: false })?.isFile()) throw new Error(`msix ausente: ${msix}`);
    const { nome, publisher, versao: doManifesto } = identidadeDoManifesto(fs.readFileSync(MANIFESTO, 'utf8'));
    // o appinstaller anuncia a versao do pacote: diferente da do MSIX, o Windows recusa a instalacao
    if (versao !== doManifesto) throw new Error(`versao ${versao} difere da Version do Package.appxmanifest (${doManifesto})`);
    const xml = appinstallerXml({ versao, repo, nomeDoMsix: path.basename(msix), publisher, nome });
    fs.mkdirSync(path.dirname(path.resolve(saida)), { recursive: true });
    fs.writeFileSync(saida, xml);
  } catch (err) {
    process.stderr.write(`appinstaller: ${err.message}\n`);
    process.exitCode = 1;
  }
}

export { appinstallerXml, identidadeDoManifesto };
