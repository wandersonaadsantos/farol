// Plano 4 do Farol nativo, Task 5: o que sobe na release vX.Y.Z. Os dois modos do
// tools/publish-release.ps1 (o local, que constrói o pacote leve, o Setup.exe e o
// .command, e o FAROL_SO_ANEXAR=1 da pipeline, que não constrói nada) pedem a lista a
// esta função, então os dois nunca divergem sobre o que anexar.
//
//   node tools/release/anexos-da-release.js <X.Y.Z> <dist>
//
// Imprime { anexar, faltando, retidos, erro? } em JSON, com os caminhos relativos a <dist>.
// Ordem fixa: pacote leve, dmg, appcast, msix, appinstaller, Setup.exe, os dois .command.
// O pacote leve é OBRIGATÓRIO (é o update do motor em todo modo: Termux, servidor e as
// cascas); sem ele, `erro` e nada a anexar. Os outros entram quando existem e, ausentes,
// vão para `faltando` pelo nome. O appcast e o appinstaller só sobem junto do dmg e do
// msix que apontam: manifesto de update apontando para um asset que não está na release
// quebraria a atualização de toda cópia instalada. O dmg e o msix levam a versão no
// nome, então artefato de outra versão no dist não conta.
//
// Da 3.0.0 em diante (comparação de `cmpVersion`, a mesma do update do motor) os quatro
// nativos (dmg, appcast, msix e appinstaller) também são OBRIGATÓRIOS: a release 3.x é a
// que as cascas instaladas leem pelo `releases/latest`, e uma release sem o appcast ou sem
// o appinstaller deixaria toda cópia instalada sem update (e a próxima pipeline sem o
// appcast anterior para estender). Ausente ou retido vira `erro`, como o pacote leve.
import fs from 'node:fs';
import path from 'node:path';
import { executadoDireto } from '../../lib/paths.js';
import { safeStringify } from '../../lib/io.js';
import { cmpVersion } from '../../lib/engine/update.js';

const VERSAO = /^\d+\.\d+\.\d+$/;

// cada artefato: o nome, as pastas do dist onde ele pode estar (na ordem de preferência)
// e, para os manifestos, o artefato de que dependem
function artefatos(v) {
  return [
    { nome: `farol-v${v}.zip`, pastas: [''], obrigatorio: true },
    { nome: `Farol-${v}.dmg`, pastas: ['mac', ''], nativo: true },
    { nome: 'appcast.xml', pastas: ['mac', ''], depende: `Farol-${v}.dmg`, nativo: true },
    { nome: `Farol-${v}.msix`, pastas: ['win', ''], nativo: true },
    { nome: 'Farol.appinstaller', pastas: ['win', ''], depende: `Farol-${v}.msix`, nativo: true },
    { nome: `Farol-Setup-v${v}.exe`, pastas: [''] },
    { nome: 'Farol-Instalar-mac.command', pastas: [''] },
    { nome: 'Farol-Instalar-mac-x64.command', pastas: [''] },
  ];
}

const relativo = (pasta, nome) => (pasta ? `${pasta}/${nome}` : nome);
const PRIMEIRA_NATIVA = '3.0.0';

function anexosDaRelease({ versao, existentes } = {}) {
  if (!VERSAO.test(String(versao ?? ''))) throw new Error(`versao malformada: ${versao} (esperado X.Y.Z)`);
  const presentes = new Set((existentes || []).map((p) => String(p).replace(/\\/g, '/')));
  const achados = new Map();
  for (const a of artefatos(versao)) {
    const pasta = a.pastas.find((p) => presentes.has(relativo(p, a.nome)));
    if (pasta !== undefined) achados.set(a.nome, relativo(pasta, a.nome));
  }
  const anexar = [];
  const faltando = [];
  const retidos = [];
  for (const a of artefatos(versao)) {
    const achado = achados.get(a.nome);
    if (a.obrigatorio && !achado) return { anexar: [], faltando: [a.nome], retidos, erro: 'pacote leve ausente' };
    if (achado && a.depende && !achados.has(a.depende)) {
      retidos.push(`${a.nome} retido: aponta para ${a.depende}, que nao esta no dist`);
      faltando.push(a.nome);
    } else if (achado) anexar.push(achado);
    else faltando.push(a.nome);
  }
  if (cmpVersion(versao, PRIMEIRA_NATIVA) >= 0) {
    const nativosFaltando = artefatos(versao).filter((a) => a.nativo && faltando.includes(a.nome)).map((a) => a.nome);
    if (nativosFaltando.length) {
      return { anexar: [], faltando, retidos, erro: `artefato nativo ausente na release ${versao}: ${nativosFaltando.join(', ')}` };
    }
  }
  return { anexar, faltando, retidos };
}

// os arquivos do dist que interessam: a raiz e as pastas mac/ e win/ dos scripts nativos
function listarDist(dist) {
  const lista = [];
  for (const pasta of ['', 'mac', 'win']) {
    let nomes = [];
    try { nomes = fs.readdirSync(path.join(dist, pasta)); } catch { continue; }
    for (const nome of nomes) {
      if (fs.statSync(path.join(dist, pasta, nome)).isFile()) lista.push(relativo(pasta, nome));
    }
  }
  return lista;
}

if (executadoDireto(import.meta.url)) {
  const [versao, dist] = process.argv.slice(2);
  try {
    if (!dist) throw new Error('uso: node tools/release/anexos-da-release.js <X.Y.Z> <dist>');
    process.stdout.write(`${safeStringify(anexosDaRelease({ versao, existentes: listarDist(dist) }))}\n`);
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exitCode = 1;
  }
}

export { anexosDaRelease };
