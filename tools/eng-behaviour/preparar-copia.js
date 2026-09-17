// Monta a cópia do eng-behaviour que o gate do Farol usa: a versão e o commit de
// tools/eng-behaviour/ferramenta.json, num checkout próprio ao lado do Farol
// (`eng-behaviour@<versão>`), construído com o comando registrado no mesmo arquivo.
//
// Existe porque o clone `eng-behaviour` ao lado é de quem desenvolve o pacote e pode estar
// com trabalho em andamento. Esta cópia não toca aquele clone: só lê os objetos dele, ou da
// origem pública, para um repositório novo.
//
// Uso:
//   node tools/eng-behaviour/preparar-copia.js [--origem <url ou caminho>] [--destino <caminho>]
//
// Nunca apaga nada. Destino que já existe só é aceito se já for a cópia certa.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { executadoDireto } from '../../lib/paths.js';
import { envSemRepositorioHerdado } from '../git-env.js';
import { TEMPOS } from '../../lib/constants.js';
import gate from './gate.js';

function argumento(nome, argv) {
  const i = argv.indexOf(nome);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : '';
}

function executar(comando, args, cwd) {
  // pnpm e npm são shims .cmd no Windows; os argumentos são fixos, vindos do arquivo versionado
  const r = spawnSync(comando, args, {
    cwd, env: envSemRepositorioHerdado(), encoding: 'utf8', stdio: 'inherit',
    shell: process.platform === 'win32', timeout: TEMPOS.CONSTRUCAO_FERRAMENTA_MS,
  });
  return r.status === 0;
}

function preparar(argv = process.argv.slice(2)) {
  const ferramenta = gate.ferramentaAdotada();
  if (!ferramenta || !ferramenta.commit || !Array.isArray(ferramenta.construcao)) {
    console.error('preparar-copia: tools/eng-behaviour/ferramenta.json incompleto.');
    return 2;
  }
  const destino = path.resolve(argumento('--destino', argv) || gate.candidatosDeHome({ explicito: '' })[0]);
  const origem = argumento('--origem', argv) || ferramenta.origem;
  if (fs.existsSync(destino)) {
    const id = gate.conferirIdentidade(destino, ferramenta);
    if (id.erro) {
      console.error(`preparar-copia: ${destino} ja existe e nao e a copia adotada: ${id.erro}`);
      console.error('Nada foi apagado. Escolha outro --destino ou remova esse diretorio a mao.');
      return 2;
    }
    console.log(`preparar-copia: ${destino} ja e eng-behaviour ${id.versao} @ ${id.commit}.`);
    return 0;
  }
  console.log(`preparar-copia: ${origem} -> ${destino}, commit ${ferramenta.commit}`);
  if (!executar('git', ['clone', '--no-hardlinks', '--quiet', origem, destino], process.cwd())) return 2;
  if (!executar('git', ['-c', 'advice.detachedHead=false', 'checkout', '--quiet', ferramenta.commit], destino)) return 2;
  for (const passo of ferramenta.construcao) {
    if (!executar(passo[0], passo.slice(1), destino)) {
      console.error(`preparar-copia: a construcao falhou em: ${passo.join(' ')}`);
      return 2;
    }
  }
  fs.writeFileSync(path.join(destino, gate.CARIMBO_DO_BUILD), `${ferramenta.commit}\n`);
  const id = gate.conferirIdentidade(destino, ferramenta);
  if (id.erro) {
    console.error(`preparar-copia: a copia montada nao passou na conferencia: ${id.erro}`);
    return 2;
  }
  console.log(`preparar-copia: pronto, eng-behaviour ${id.versao} @ ${id.commit} em ${destino}.`);
  return 0;
}

if (executadoDireto(import.meta.url)) process.exit(preparar());

export default { preparar };
export { preparar };
