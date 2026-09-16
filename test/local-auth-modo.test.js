// Quem exige autenticação na API local (A4, spec 7.A4 item 1). O modo celular é
// propriedade do PROCESSO que serve a API: plataforma, variáveis do Termux e kernel.
// Nada que o cliente escreve (User-Agent) entra na decisão. Runner nativo, zero deps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import modoMod, { detectarModoCelular, exigeAutenticacao } from '../lib/local-auth/modo.js';
import { ATIVACAO_AUTOMATICA_A4, TEMPOS, LOCAL_AUTH } from '../lib/constants.js';

const DESKTOP = { platform: 'linux', env: { TERMUX_VERSION: '', PREFIX: '' }, osrelease: '6.8.0-45-generic\n' };

test('ATIVACAO_AUTOMATICA_A4 nasce desligada', () => {
  assert.equal(ATIVACAO_AUTOMATICA_A4, false,
    'ATIVACAO_AUTOMATICA_A4 só pode virar true quando a tela de pareamento do Claude Design (D9) existir e a detecção for validada num Termux real (spec 7.A4, Condição de ativação, e seção 13). Ligada antes, o usuário do celular fica trancado fora da interface.');
});

test('os tempos e limites da A4 são os da spec', () => {
  assert.equal(TEMPOS.PAREAMENTO_VALIDADE_MS, TEMPOS.HORA_MS / 6, 'código vale 10 minutos');
  assert.equal(TEMPOS.SESSAO_LOCAL_OCIOSA_MS, 30 * TEMPOS.DIA_MS, 'sessão expira com 30 dias sem uso');
  assert.equal(TEMPOS.SESSAO_LOCAL_ABSOLUTA_MS, 90 * TEMPOS.DIA_MS, 'sessão expira com 90 dias de vida');
  assert.equal(LOCAL_AUTH.CODIGO_TAMANHO, 10);
  assert.equal(LOCAL_AUTH.CODIGO_MAX_ERROS, 5);
  assert.equal(LOCAL_AUTH.TOKEN_BYTES, 32);
});

test('cada sinal sozinho basta para o modo celular', () => {
  assert.equal(detectarModoCelular({ ...DESKTOP, platform: 'android' }), true, 'Node nativo do Termux');
  assert.equal(detectarModoCelular({ ...DESKTOP, env: { TERMUX_VERSION: '0.118.1', PREFIX: '' } }), true, 'TERMUX_VERSION');
  assert.equal(detectarModoCelular({ ...DESKTOP, env: { TERMUX_VERSION: '', PREFIX: '/data/data/com.termux/files/usr' } }), true, 'PREFIX do Termux');
  assert.equal(detectarModoCelular({ ...DESKTOP, env: { TERMUX_VERSION: '', PREFIX: '/data/data/com.termux' } }), true, 'PREFIX na raiz do Termux');
  assert.equal(detectarModoCelular({ ...DESKTOP, osrelease: '5.10.198-android12-9-00085\n' }), true, 'kernel Android no proot');
  assert.equal(detectarModoCelular({ ...DESKTOP, osrelease: '4.19.157-Android-perf\n' }), true, 'caixa do kernel não importa');
});

test('fora do celular nenhum sinal liga o modo', () => {
  assert.equal(detectarModoCelular({ platform: 'win32', env: {}, osrelease: '' }), false, 'Windows');
  assert.equal(detectarModoCelular({ platform: 'darwin', env: {}, osrelease: '' }), false, 'macOS');
  assert.equal(detectarModoCelular(DESKTOP), false, 'Linux comum');
  assert.equal(detectarModoCelular({ ...DESKTOP, osrelease: '5.15.167.4-microsoft-standard-WSL2\n' }), false, 'WSL');
  assert.equal(detectarModoCelular({ ...DESKTOP, env: { TERMUX_VERSION: '   ', PREFIX: '/data/data/com.termuxfalso/usr' } }), false, 'prefixo parecido e versão em branco não contam');
  assert.equal(detectarModoCelular(), false, 'sem sinal nenhum');
});

test('localAuth exigir liga a autenticação em qualquer ambiente', () => {
  assert.equal(exigeAutenticacao({ modoCelular: false, config: { localAuth: 'exigir' }, ativacaoAutomatica: false }), true);
  assert.equal(exigeAutenticacao({ modoCelular: true, config: { localAuth: 'exigir' }, ativacaoAutomatica: false }), true);
});

test('desktop sem localAuth não exige (nada muda)', () => {
  assert.equal(exigeAutenticacao({ modoCelular: false, config: {}, ativacaoAutomatica: true }), false);
  assert.equal(exigeAutenticacao({ modoCelular: false, config: { localAuth: '' }, ativacaoAutomatica: false }), false);
  assert.equal(exigeAutenticacao(), false);
});

test('modo celular com a ativação desligada ainda não exige (estado desta entrega)', () => {
  assert.equal(exigeAutenticacao({ modoCelular: true, config: {}, ativacaoAutomatica: false }), false);
});

test('modo celular com a ativação ligada exige, e nenhuma config desliga', () => {
  for (const config of [{}, { localAuth: '' }, { localAuth: 'desligar' }, { localAuth: false }, { localAuth: 'nunca' }, null, undefined]) {
    assert.equal(exigeAutenticacao({ modoCelular: true, config, ativacaoAutomatica: true }), true, `config ${JSON.stringify(config)} não pode desligar`);
  }
});

test('sinaisDoModoCelular devolve o formato esperado sem lançar em nenhum sistema', async () => {
  const { sinaisDoModoCelular } = await import('../lib/paths.js');
  const s = sinaisDoModoCelular();
  assert.equal(s.platform, process.platform);
  assert.equal(typeof s.env.TERMUX_VERSION, 'string');
  assert.equal(typeof s.env.PREFIX, 'string');
  assert.equal(typeof s.osrelease, 'string');
});

test('a decisão do modo nunca lê User-Agent', () => {
  const dir = path.join(import.meta.dirname, '..', 'lib', 'local-auth');
  for (const nome of fs.readdirSync(dir).filter(n => n.endsWith('.js'))) {
    assert.doesNotMatch(fs.readFileSync(path.join(dir, nome), 'utf8'), /user-agent/i, `${nome} não pode olhar o User-Agent`);
  }
});

// Adendo de 16/09/2026: a visão compartilhada (C3) NÃO liga no modo celular enquanto a
// autenticação exigida não estiver funcionando. Sem isso, qualquer página em outra porta
// do mesmo aparelho leria o conteúdo compartilhado por uma API sem porteiro.
test('compartilhamento no celular só com autenticação exigida', () => {
  const { compartilhamentoPermitido } = modoMod;
  assert.equal(compartilhamentoPermitido({ modoCelular: false, config: {}, ativacaoAutomatica: false }), true, 'desktop segue como hoje');
  assert.equal(compartilhamentoPermitido({ modoCelular: true, config: {}, ativacaoAutomatica: false }), false, 'celular sem exigência não compartilha');
  assert.equal(compartilhamentoPermitido({ modoCelular: true, config: { localAuth: 'exigir' }, ativacaoAutomatica: false }), true);
  assert.equal(compartilhamentoPermitido({ modoCelular: true, config: {}, ativacaoAutomatica: true }), true);
});
