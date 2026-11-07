// Arquivo de ambiente no diff: só o que mudou, e só o que comprovadamente não é credencial.
//
// Por que existe (03/11/2026, biud-frontend#1698): `.env*` tem o patch recusado, e um PR que só
// mexe nele nunca fecha a cobertura. Liberar o patch não serve: as linhas de contexto e o título
// do hunk daquele diff traziam segredos de verdade. A régua é lista do que pode aparecer, nunca
// lista do que parece segredo: a revisão adversarial vazou comentário, base64 e host opaco pela
// primeira versão, que escondia por reconhecimento. Texto livre não tem régua que feche (três
// rodadas de revisão acharam senha em comentário e em caminho de URL): comentário nunca aparece, e
// URL só com a origem. PURO.
import { AMBIENTE_SEM_PONTO, sourcePath } from './contract.js';
import { maskSecrets, secretRanges } from '../sensitive-text.js';

const KIND = 'env-changes';
const OCULTO = '[valor oculto pelo Farol]';
const LINHA_OCULTA = '[linha oculta pelo Farol]';
const COMENTARIO_OCULTO = '# [comentário oculto pelo Farol]';
const AVISO = '# Farol: arquivo de ambiente. Só as linhas alteradas; contexto e o que pode ser credencial ficam de fora.';

const ATRIBUICAO = /^([ \t]*(?:export[ \t]+)?)([^\s=#]+)([ \t]*=)(.*)$/;
const COMENTARIO = /^[ \t]*#(.*)$/;
const CHAVE_CONVENCIONAL = /^[A-Z_][A-Z0-9_]{0,63}$/;
const CHAVE_DE_SEGREDO = /SECRET|TOKEN|PASS|PWD|PRIVATE|CREDENTIAL|API_?KEY|AUTH|SENHA|CHAVE|SIGNATURE|SESSION|COOKIE|CERT|SALT|BEARER|JWT|DSN|HASH|(?:^|_)(?:PIN|OTP|CVV|KEY|PW)(?:_|$)/;
// Atribuição comentada com rótulo e dois-pontos (`# AUTH_SECRET: valor`): conta como a de `=`.
const ROTULO_COMENTADO = /^[ \t]*([A-Za-z_][\w.-]*)[ \t]*:[ \t]*(\S.*)$/;
// URL com usuário e senha na autoridade: a credencial está na própria linha, comentada ou não.
const URL_COM_CREDENCIAL = /[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@/i;
const LOGICO = /^(?:true|false|on|off|yes|no|0|1)$/i;
const NUMERO = /^-?\d{1,5}(?:\.\d{1,3})?$/;
// Número só aparece em chave que termina dizendo medir algo: em qualquer outra ele pode ser um código.
const CHAVE_DE_MEDIDA = /(?:^|_)(?:PORT|PORTA|TIMEOUT|TTL|LIMIT|LIMITE|MAX|MIN|SIZE|RETRY|RETRIES|INTERVAL|COUNT|DELAY|DAYS|HOURS|MINUTES|SECONDS|MS|WORKERS|CONCURRENCY|THRESHOLD|VERSION|RATE|RATIO|TAXA|TEMPO)$/;
const PEDACO_DE_CHAVE = /^[A-Z]{0,14}\d?$/;
const ROTULO_DE_HOST = /^[a-z]{1,14}(?:-[a-z]{1,14})*$/;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const CONSOANTES_SEGUIDAS = /[^aeiouy\d-]{6}/i;
const NOME_SEM_PONTO = new RegExp(`^(?:${AMBIENTE_SEM_PONTO})$`, 'i');

function ehArquivoDeAmbiente(value) {
  const partes = String(value || '').split('/'), nome = partes.at(-1);
  if (!/^\.env(?:\.[a-z0-9_-]{1,32}){0,2}$/i.test(nome) && !(nome.length <= 40 && NOME_SEM_PONTO.test(nome))) return false;
  if (/pem|key|p12|pfx|kdbx|rsa|secret|credential|cert/i.test(nome)) return false;
  if (partes.length === 1) return true;
  try { sourcePath(partes.slice(0, -1).join('/')); return true; } catch { return false; }
}

function hostLegivel(host) {
  if (IPV4.test(host)) return true;
  const rotulos = host.split('.');
  return rotulos.length <= 5 && rotulos.every(rotulo => rotulo.length <= 32 && ROTULO_DE_HOST.test(rotulo) && !CONSOANTES_SEGUIDAS.test(rotulo));
}

function urlPublica(valor) {
  if (valor.includes('%')) return false;
  let url;
  try { url = new URL(valor); } catch { return false; }
  // A normalização do URL apaga `..`, tab e quebra de linha: só vale o que ela não alterou.
  if (url.href !== valor && url.href !== valor + '/') return false;
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return false;
  return url.pathname === '/' && hostLegivel(url.hostname);
}

function semAspas(valor) {
  const aspa = valor[0];
  return ['"', "'"].includes(aspa) && valor.length > 1 && valor.at(-1) === aspa ? valor.slice(1, -1) : valor;
}

function chaveLegivel(chave) {
  if (!CHAVE_CONVENCIONAL.test(chave) || maskSecrets(chave) !== chave) return false;
  // Base32 e base64 terminados em `=` têm cara de atribuição vazia: cada pedaço tem de ser palavra.
  return chave.split('_').every(pedaco => PEDACO_DE_CHAVE.test(pedaco) && !CONSOANTES_SEGUIDAS.test(pedaco));
}

function valorSeguro(chave, bruto) {
  const valor = semAspas(bruto.trim());
  if (!valor) return true;
  if (CHAVE_DE_SEGREDO.test(chave)) return false;
  if (maskSecrets(valor) !== valor || secretRanges(valor).length) return false;
  return LOGICO.test(valor) || (NUMERO.test(valor) && CHAVE_DE_MEDIDA.test(chave)) || urlPublica(valor);
}

// O comentário nunca chega à sessão, mas só conta como valor oculto (o que manda a decisão à
// pessoa) quando tem forma de credencial (07/11/2026, biud-core#548): atribuição comentada cujo
// valor não é comprovadamente seguro, URL com usuário e senha, ou o que a máscara de segredo
// reconhece. Até aqui contava todo comentário que não parecesse prosa, e um comentário que só
// explicava o token ("Token do par ... `openssl rand -hex 32`") segurava a aprovação.
function atribuicaoInsegura(chave, bruto) {
  return !(chaveLegivel(chave) && valorSeguro(chave, bruto));
}

function comentarioComCredencial(texto) {
  const atribuicao = texto.match(ATRIBUICAO);
  if (atribuicao && atribuicaoInsegura(atribuicao[2], atribuicao[4])) return true;
  const rotulo = texto.match(ROTULO_COMENTADO);
  if (rotulo && CHAVE_CONVENCIONAL.test(rotulo[1]) && atribuicaoInsegura(rotulo[1], rotulo[2])) return true;
  return URL_COM_CREDENCIAL.test(texto) || maskSecrets(texto) !== texto || secretRanges(texto).length > 0;
}

function fechaAspa(texto, aspa, desde = 0) {
  for (let i = desde; i < texto.length; i++) {
    if (texto[i] === '\\') i++;
    else if (texto[i] === aspa) return true;
  }
  return false;
}

// A aspa aberta faz as próximas linhas serem continuação do valor, não atribuições.
function abreAspa(bruto) {
  const valor = bruto.trim(), aspa = valor[0];
  if (!['"', "'", '`'].includes(aspa)) return null;
  return fechaAspa(valor, aspa, 1) ? null : aspa;
}

function aspaDepoisDoContexto(aspa, corpo) {
  if (aspa) return fechaAspa(corpo, aspa) ? null : aspa;
  const atribuicao = COMENTARIO.test(corpo) ? null : corpo.match(ATRIBUICAO);
  return atribuicao ? abreAspa(atribuicao[4]) : null;
}

function projetarLinha(sinal, corpo) {
  const visivel = { linha: sinal + corpo, oculta: false, aspa: null };
  const linhaOculta = { linha: sinal + LINHA_OCULTA, oculta: true, aspa: null };
  if (!corpo.trim()) return visivel;
  const comentario = corpo.match(COMENTARIO);
  // Comentário não muda o que o app executa: só o que tem forma de credencial decide se a pessoa olha.
  if (comentario) return { linha: sinal + COMENTARIO_OCULTO, oculta: comentarioComCredencial(comentario[1]), aspa: null };
  const atribuicao = corpo.match(ATRIBUICAO);
  if (!atribuicao) return linhaOculta;
  const [, antes, chave, igual, bruto] = atribuicao;
  if (!chaveLegivel(chave)) return { ...linhaOculta, aspa: abreAspa(bruto) };
  if (valorSeguro(chave, bruto)) return visivel;
  return { linha: sinal + antes + chave + igual + OCULTO, oculta: true, aspa: abreAspa(bruto) };
}

function projetarMudancasDeAmbiente(patch) {
  if (typeof patch !== 'string' || !patch) return null;
  const saida = [AVISO];
  // O arquivo antigo e o novo têm cada um a sua aspa; a linha de contexto vale para os dois.
  const aspas = { '+': null, '-': null };
  let ocultos = 0, alteradas = 0;
  for (const linha of patch.split(/\r?\n/)) {
    const sinal = linha[0];
    if (sinal === '@') {
      // o texto depois do segundo @@ é uma linha do próprio arquivo: fica de fora
      const hunk = linha.match(/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/);
      if (!hunk) return null;
      saida.push(hunk[0]);
      continue;
    }
    const corpo = linha.slice(1);
    if (sinal === ' ') {
      aspas['+'] = aspaDepoisDoContexto(aspas['+'], corpo);
      aspas['-'] = aspaDepoisDoContexto(aspas['-'], corpo);
      continue;
    }
    if (sinal !== '+' && sinal !== '-') continue;
    alteradas++;
    if (aspas[sinal]) {
      saida.push(sinal + LINHA_OCULTA);
      ocultos++;
      if (fechaAspa(corpo, aspas[sinal])) aspas[sinal] = null;
      continue;
    }
    const projetada = projetarLinha(sinal, corpo);
    saida.push(projetada.linha);
    if (projetada.oculta) ocultos++;
    aspas[sinal] = projetada.aspa;
  }
  return alteradas ? { text: saida.join('\n') + '\n', ocultos, alteradas } : null;
}

// Rename vindo de outro caminho protegido não entra: o patch dele traz o conteúdo de lá.
function projetarPatchDeAmbiente(caminho, anterior, patch) {
  return ehArquivoDeAmbiente(caminho) && (!anterior || ehArquivoDeAmbiente(anterior)) ? projetarMudancasDeAmbiente(patch) : null;
}

export { KIND, ehArquivoDeAmbiente, projetarMudancasDeAmbiente, projetarPatchDeAmbiente };
