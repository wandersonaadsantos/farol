// Ambiente para disparar `git` sem herdar o repositorio de quem chamou.
//
// POR QUE EXISTE: um hook de `git push` exporta GIT_DIR (e mais uma dezena de
// variaveis) para tudo que dispara, e o pre-push do Farol dispara `npm run eng` e
// `npm test`. Comando de git que herda isso para de falar com o repositorio que
// o chamador escolheu por `cwd` e passa a falar com o do hook.
//
// Nao e hipotese, foi medido em 30/08/2026 (ver `test/helpers/git-limpo.js` para
// o estrago do lado dos testes). Do lado do gate o efeito e mais silencioso e nao
// menos grave: `raizPrincipal` responderia pela raiz do repositorio ERRADO e o
// gate procuraria o pacote no lugar errado, reprovando o push com uma instrucao
// de conserto que nao conserta nada.
//
// A LISTA DE NOMES E DO GIT, nunca daqui: sao quinze hoje e ela cresce entre
// versoes, entao copia a mao envelhece calada. E a mesma escolha que o
// `tools/hooks/pre-push` ja faz, e pelo mesmo motivo.
//
// O que este modulo NAO faz, de proposito: mexer no config GLOBAL ou de SISTEMA.
// Em producao isso seria dano, nao protecao, porque `safe.directory` mora la e o
// git recusa repositorio de dono "duvidoso" sem ele. Teste que precisa desse
// isolamento adiciona por cima (`test/helpers/git-limpo.js`).
import { spawnSync } from 'node:child_process';
import { semAsVariaveis } from '../lib/env.js';

/**
 * Teto de espera da consulta ao git.
 *
 * Mesma fronteira que o gate ja usa nas outras chamadas, pelo mesmo motivo: isto
 * roda dentro do pre-push, e um git travado penduraria o push para sempre em vez
 * de reprovar.
 */
const TETO_MS = 5_000;

let nomes;
/**
 * Nomes das variaveis com que o git aponta para outro repositorio.
 *
 * Perguntado ao git uma vez por processo. Se a consulta falhar, devolve lista
 * vazia: sem a lista, o certo e nao mexer no ambiente em vez de adivinhar nomes,
 * porque remover o que nao devia quebra o caso legitimo e nao protege ninguem.
 */
export function variaveisDeRepositorio() {
  if (!nomes) {
    const r = spawnSync('git', ['rev-parse', '--local-env-vars'], { encoding: 'utf8', timeout: TETO_MS });
    nomes = r.status === 0
      ? String(r.stdout || '').split('\n').map(s => s.trim()).filter(Boolean)
      : [];
  }
  return nomes;
}

/** `process.env` sem o que faria o git responder por outro repositorio. */
export function envSemRepositorioHerdado() {
  return semAsVariaveis(variaveisDeRepositorio());
}
