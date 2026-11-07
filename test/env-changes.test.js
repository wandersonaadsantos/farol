// Arquivo de ambiente no diff (03/11/2026). biud-frontend#1698 alterou só o .env.dev, 4 linhas;
// a fonte recusa `.env*`, a cobertura ficava em 0 de 1 e nenhuma tentativa concluía. As linhas de
// contexto e o título do hunk desse diff traziam segredos de verdade, então a saída não é liberar
// o patch: é entregar só o que mudou, com valor visível apenas quando ele não pode ser credencial.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ehArquivoDeAmbiente, projetarMudancasDeAmbiente, KIND } from '../lib/review-source/env-changes.js';
import { parsePatchPages } from '../lib/engine/pr-scope.js';

const SEGREDO = 'Zk3vQ9pLm2Xw7Rt5Yb8Nc1Df4Gh6Jk0S';
const PATCH_REAL = [
  `@@ -150,3 +150,7 @@ AUTH_GOOGLE_CLIENT_SECRET=${SEGREDO}`,
  ` INTERNAL_PROXY_SECRET=${SEGREDO}`,
  ` AUTH_SECRET=${SEGREDO}`,
  ' NEXT_PUBLIC_CAMPANHA_NACIONAL_ENDPOINT=https://api.exemplo.com/campanha',
  '+',
  '+# Zona de LPs: as landing pages vêm da app de LPs (biud-lp-site) por rewrite.',
  '+# Para desligar, remover esta linha e publicar.',
  '+LP_ZONE_ORIGIN=https://lp-dev.biud.com.br',
].join('\n');

test('o caso medido: mostra as linhas novas por inteiro e nada do contexto', () => {
  const r = projetarMudancasDeAmbiente(PATCH_REAL);
  assert.equal(r.ocultos, 0);
  assert.ok(r.text.includes('+LP_ZONE_ORIGIN=https://lp-dev.biud.com.br'));
  assert.ok(!r.text.includes('Para desligar'), 'comentário é texto livre: não chega à sessão');
  assert.ok(r.text.includes('@@ -150,3 +150,7 @@'));
  assert.ok(!r.text.includes(SEGREDO), 'segredo do contexto ou do título do hunk vazou');
  assert.ok(!r.text.includes('AUTH_SECRET'), 'linha de contexto não entra nem pelo nome');
  assert.ok(!r.text.includes('AUTH_GOOGLE_CLIENT_SECRET'), 'o título do hunk não entra');
});

const OCULTAM = [
  ['chave com nome de segredo, mesmo com valor de URL', `+AUTH_CALLBACK_SECRET=https://a.com`],
  ['valor opaco em chave neutra', `+LP_ZONE_ORIGIN=${SEGREDO}`],
  ['URL com credencial', '+DATABASE_URL=postgres://user:senha@db.interna/app'],
  ['https com credencial', '+SERVICO=https://user:senha@api.exemplo.com'],
  ['URL com query', '+WEBHOOK=https://api.exemplo.com/x?assinatura=abc'],
  ['URL com caminho, mesmo legível', '+SERVICO=https://api.exemplo.com/v1/campanha'],
  ['URL com caminho opaco', `+WEBHOOK=https://hooks.exemplo.com/services/${SEGREDO}`],
  ['número longo em chave neutra', '+CODIGO=123456789012345678'],
  ['token conhecido', '+QUALQUER=ghp_' + 'z'.repeat(30)],
  ['entre aspas sem ser seguro', `+CHAVE_PUBLICA="${SEGREDO}"`],
  ['valor com comentário na mesma linha', '+SERVICO=https://a.com # produção'],
  ['removida com valor', `-ANTIGO=${SEGREDO}`],
];
for (const [nome, linha] of OCULTAM) {
  test(`esconde: ${nome}`, () => {
    const r = projetarMudancasDeAmbiente(`@@ -1 +1 @@\n${linha}`);
    assert.equal(r.ocultos, 1, r.text);
    const valor = linha.slice(linha.indexOf('=') + 1);
    assert.ok(!r.text.includes(valor), r.text);
    assert.ok(r.text.includes(linha.slice(0, linha.indexOf('=') + 1)), 'o nome da chave continua legível');
  });
}

const MOSTRAM = ['+FEATURE_X=true', '+PORTA=3000', '+TAXA=0.25', '+DEBUG=1', '+VAZIA=', 
  '+SERVICO="https://api.exemplo.com"', '+export FEATURE_Y=off', '-FEATURE_Z=false'];
for (const linha of MOSTRAM) {
  test(`mostra: ${linha}`, () => {
    const r = projetarMudancasDeAmbiente(`@@ -1 +1 @@\n${linha}`);
    assert.equal(r.ocultos, 0, r.text);
    assert.ok(r.text.includes(linha));
  });
}

test('comentário nunca aparece; só o que tem forma de credencial segura a aprovação', () => {
  assert.equal(projetarMudancasDeAmbiente('@@ -1 +1 @@\n+# só uma nota de teste').ocultos, 0);
  const comentada = projetarMudancasDeAmbiente(`@@ -1 +1 @@\n+# AUTH_SECRET=${SEGREDO}`);
  assert.equal(comentada.ocultos, 1);
  assert.ok(!comentada.text.includes(SEGREDO));
  // texto solto sem forma de credencial continua fora da sessão, mas não manda à pessoa
  const opaco = projetarMudancasDeAmbiente(`@@ -1 +1 @@\n+# senha antiga ${SEGREDO}`);
  assert.equal(opaco.ocultos, 0);
  assert.ok(!opaco.text.includes(SEGREDO));
});

// biud-core#548 (07/11/2026): o diff do .env.example só reescreveu o comentário que explica o
// token, com a variável vazia, e o PR foi à mesa como "valor que pode ser credencial".
test('comentário que só explica a variável não segura a aprovação', () => {
  const r = projetarMudancasDeAmbiente([
    '@@ -175,11 +175,12 @@ SMTP_URL=http://biud-smtp.dev:3000',
    ' CORE_TO_SMTP_API_KEY=change_me',
    '-# Token do par tenant-company → core (header `Authorization: Bearer`) da rota interna',
    '-# PUT /api/internal/v1/zone-identities/**. 64 caracteres hexadecimais',
    '+# Token do par tenant-company → legado (header `Authorization: Bearer`) das rotas internas',
    '+# /api/internal/v1/zone-identities/** no core e também no billing (api-payment,',
    '+# `ensure-trial`), que lê a MESMA variável. 64 caracteres hexadecimais',
    ' # (`openssl rand -hex 32`), IGUAL ao CORE_DELIVERY_SERVICE_TOKEN da zona e exclusivo deste',
    '-# local ou no Vault (`<env>/data/api-core`), nunca aqui.',
    '+# local ou no Vault (`<env>/data/api-core` e `<env>/data/api-payment`), nunca aqui.',
    ' TENANT_COMPANY_DELIVERY_TOKEN=',
  ].join('\n'));
  assert.equal(r.ocultos, 0, r.text);
  assert.ok(!r.text.includes('Authorization'), 'o comentário continua fora da sessão');
  assert.ok(!r.text.includes('change_me'), 'o contexto continua fora');
});

test('senha em comentário com cara de prosa não chega à sessão', () => {
  for (const senha of ['abcd efgh ijkl mnop', 'abcd-efgh-ijkl-mnop']) {
    const r = projetarMudancasDeAmbiente(`@@ -1 +1 @@\n+# gmail de envio ${senha}`);
    assert.ok(!r.text.includes(senha), r.text);
  }
});

test('linha que não é atribuição nem comentário sai oculta inteira', () => {
  const r = projetarMudancasDeAmbiente(`@@ -1 +1 @@\n+${SEGREDO}`);
  assert.equal(r.ocultos, 1);
  assert.ok(!r.text.includes(SEGREDO));
});

test('valor em várias linhas: tudo até fechar a aspa fica oculto, mesmo o que parece atribuição', () => {
  const r = projetarMudancasDeAmbiente(['@@ -1,0 +1,4 @@', '+PEM="-----BEGIN PRIVATE KEY-----', `+FEATURE=true`, `+${SEGREDO}"`, '+DEPOIS=true'].join('\n'));
  assert.ok(!r.text.includes('BEGIN PRIVATE KEY'));
  assert.ok(!r.text.includes(SEGREDO));
  assert.ok(!r.text.includes('FEATURE=true'), 'dentro da aspa aberta não existe atribuição');
  assert.ok(r.text.includes('+DEPOIS=true'), 'depois de fechar a aspa volta ao normal');
  assert.equal(r.ocultos, 3);
});

test('CRLF não vaza pelo fim da linha nem quebra o reconhecimento', () => {
  const r = projetarMudancasDeAmbiente(`@@ -1 +1 @@\r\n AUTH_SECRET=${SEGREDO}\r\n+FEATURE_X=true\r\n`);
  assert.equal(r.ocultos, 0);
  assert.ok(r.text.includes('+FEATURE_X=true'));
  assert.ok(!r.text.includes(SEGREDO));
});

test('sem nenhuma linha alterada legível não há representação', () => {
  assert.equal(projetarMudancasDeAmbiente('not stored'), null);
  assert.equal(projetarMudancasDeAmbiente(''), null);
  assert.equal(projetarMudancasDeAmbiente(null), null);
  assert.equal(projetarMudancasDeAmbiente(` AUTH_SECRET=${SEGREDO}`), null);
});

test('só a família .env entra; os outros caminhos protegidos continuam de fora', () => {
  for (const p of ['.env', '.env.dev', '.env.production', 'apps/web/.env.local', '.ENV.DEV', 'deploy/prod.env', 'env.production']) assert.equal(ehArquivoDeAmbiente(p), true, p);
  for (const p of ['.ssh/config', 'credentials.json', 'secrets/a.env', 'src/env.test.ts', 'src/env.js', '.env.d/x', 'chave.pem', '.git/config', 'node_modules/a/.env',
    'src/env.ts', '.environment', 'a/.envrc', '.aws/.env']) assert.equal(ehArquivoDeAmbiente(p), false, p);
  assert.equal(typeof KIND, 'string');
});

// Furos achados na revisão adversarial da primeira versão: a régua virou "só mostra o que
// comprovadamente não é credencial". Cada entrada abaixo saiu inteira naquela versão.
const FICTICIO = 'INVENTADOq7Zx2';
const VAZAVAM = [
  ['comentário com rótulo e dois-pontos', `+# AUTH_SECRET: ${FICTICIO}`],
  ['comentário com URL e credencial', `+# DB postgres://usuario:${FICTICIO}@db.interna/app`],
  ['linha base64 lida como chave vazia', '+INVENTADOZk3vQ9pLm2Xw7Rt5Yb8Nc1Df4Gh6='],
  ['linha base32 em maiúsculas lida como chave vazia', '+ABCDEFGH2345IJKLMN6789OPQRSTUV='],
  ['token conhecido como nome da chave', '+ghp_' + 'a'.repeat(30) + '=true'],
  ['host opaco', '+SERVICO=https://inventadozk3vq9plm2xw.exemplo.com'],
  ['segmento apagado pela normalização', `+SERVICO=https://a.com/${'INVENTADO'.repeat(4)}/../x`],
  ['segmento codificado', `+SERVICO=https://a.com/%2e%2e/${FICTICIO}`],
  ['tab apagado pela normalização', `+SERVICO=https://a.com/\t${FICTICIO}`],
  ['segmento opaco curto', '+SERVICO=https://a.com/T0a1B2c3D4e5/x'],
  ['PIN', '+PIN=123456'], ['OTP', '+OTP=654321'], ['CVV', '+CARD_CVV=123'],
  ['chave com hífen', '+API-KEY=123456789012'], ['chave com ponto', '+api.key=123456789012'],
  ['assinatura', '+SIGNATURE=true'], ['cookie de sessão', '+SESSION_COOKIE=1234'],
  ['número longo com decimais', '+CODIGO=123456789012.123456'],
  ['caminho de webhook só com letras', '+WEBHOOK_URL=https://hooks.exemplo.com/services/XkQzPwLvMnBtRsYuHgFdJcAeKoIuYtRe'],
  ['segredo picado em segmentos curtos', '+SERVICO=https://a.com/aB3dE9f/Gh7jK2m/Pq4rS8t/Vw1xY5z'],
  ['caminho só de dígitos', '+SERVICO=https://a.com/12345678901234567890123456789012'],
  ['host só de letras', '+SERVICO=https://kqzpwlvmnbtrsyuhgfdjcaeoiuytre.ngrok.io'],
  ['chave com cara de token', '+AKIA_IOSFODNN7EXAMPLE='],
  ['chave picada', '+X9K2M7Q4T1Z8P3V='],
  ['nome de segredo com sufixo opaco', '+API_SECRET_K9X2M7Q4T1Z8='],
  ['senha numérica', '+DB_PW=7654321'],
  ['código numérico', '+ACCESS_CODE=1234567'],
  ['CVC', '+CARD_CVC=123'],
  ['senha no caminho da URL', '+WEBHOOK_URL=https://hooks.biud.com.br/Senha123'],
  ['senha no host', '+SERVICO=https://dragon123.biud.com.br'],
  ['credencial picada no caminho', '+SERVICO=https://x.com/AKIA/IOSFODNN/EXAMPLE'],
  ['host com rótulos demais', '+SERVICO=https://aa.bb.cc.dd.ee.ff.gg.com'],
  ['número em chave que só começa por medida', '+MIN_CODE=123456'],
  ['número de seis dígitos em chave de medida', '+SMS_TIMEOUT=654321'],
  ['chave com cara de senha', '+QWERTY123='],
];
// Os mesmos furos em comentário sem forma de credencial (07/11/2026, decisão do dono): seguem fora
// da sessão, mas comentário não muda o que o app executa e não manda mais a decisão à pessoa.
const COMENTARIOS_SEM_FORMA = [
  ['comentário com a palavra senha', `+# senha antiga ${FICTICIO}`],
  ['comentário com segredo curto colado em palavra', `+# rotacionar ${FICTICIO} amanhã`],
  ['comentário em maiúsculas', '+# KXQZPWLVMNBTRSYUHGFDJCAE'],
  ['comentário de dígitos', '+# 4111 1111 1111 1111'],
  ['comentário com login', '+# login admin pass hunter'],
  ['comentário em outro alfabeto', '+# тайный пароль для доступа'],
  ['lista de palavras em comentário', '+# cavalo bateria grampo correto'],
  ['marcador TODO', '+# TODO: ajustar depois'],
  ['marcador NOTE', '+# NOTE: usar a porta da zona'],
  ['marcador OBS', '+# OBS: valor vem do Vault'],
  ['marcador IMPORTANT', '+# IMPORTANT: nunca commitar'],
  ['marcador DEPRECATED', '+# DEPRECATED: use NEW_VAR'],
  ['valor padrão explicado', '+# Default = 3000'],
  ['nome de segredo com valor de uma palavra', '+# header `Authorization: Bearer`'],
  ['nome de segredo com marcador de exemplo', '+# API_KEY=<sua chave>'],
];
// Credencial comentada com forma clara continua segurando (revisão independente do PR, 07/11/2026):
// cada caso abaixo escapava da primeira versão desta mudança.
const COMENTARIOS_COM_CREDENCIAL = [
  ['rótulo em minúscula', `+# password: ${FICTICIO}`],
  ['rótulo capitalizado', `+# Password: ${FICTICIO}`],
  ['rótulo em português', `+# senha: ${FICTICIO}`],
  ['rótulo com ponto', `+# db.password: ${FICTICIO}`],
  ['atribuição depois de um prefixo', `+# exemplo: DB_PASSWORD=${FICTICIO}`],
  ['atribuição depois de uma palavra', `+# antigo DB_PASSWORD=${FICTICIO}`],
  ['atribuição em item de lista', `+# - DB_PASSWORD=${FICTICIO}`],
  ['rótulo em item de lista', `+# * AUTH_SECRET: ${FICTICIO}`],
  ['par entre aspas', `+# "AUTH_SECRET": "${FICTICIO}"`],
  ['URL com usuário vazio', `+# redis://:${FICTICIO}@cache.interna:6379`],
  ['URL com barra na senha', `+# postgres://u:pa/${FICTICIO}@db.interna/app`],
  ['credencial sem esquema', `+# usuario:${FICTICIO}@db.interna`],
  ['JWT', '+# eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcDEF123ghiJKL'],
];
for (const [nome, linha] of COMENTARIOS_COM_CREDENCIAL) {
  test(`comentário com credencial segura: ${nome}`, () => {
    const r = projetarMudancasDeAmbiente(`@@ -1 +1 @@\n${linha}`);
    assert.equal(r.ocultos, 1, r.text);
    assert.ok(!r.text.includes(linha.slice(1)), r.text);
  });
}
for (const [nome, linha] of COMENTARIOS_SEM_FORMA) {
  test(`comentário fora da sessão sem segurar: ${nome}`, () => {
    const r = projetarMudancasDeAmbiente(`@@ -1 +1 @@\n${linha}`);
    assert.equal(r.ocultos, 0, r.text);
    assert.ok(!r.text.includes(linha.slice(1)), r.text);
    assert.ok(!r.text.includes(FICTICIO), r.text);
  });
}
for (const [nome, linha] of VAZAVAM) {
  test(`furo fechado: ${nome}`, () => {
    const r = projetarMudancasDeAmbiente(`@@ -1 +1 @@\n${linha}`);
    assert.equal(r.ocultos, 1, r.text);
    assert.ok(!r.text.includes(linha), r.text);
    assert.ok(!r.text.includes(FICTICIO), r.text);
  });
}

test('a prosa comum não segura, e as chaves convencionais continuam legíveis', () => {
  for (const linha of ['+# Zona de LPs: as landing pages vêm da app de LPs (biud-lp-site) por rewrite.', '+# Para desligar, remover esta linha e publicar.']) {
    assert.equal(projetarMudancasDeAmbiente(`@@ -1 +1 @@\n${linha}`).ocultos, 0, linha);
  }
  for (const linha of ['+SHIPPING_ENABLED=true', '+TIMEOUT_MS=30000', '+API_BASE=https://api.exemplo.com:8443', '+LOCAL=http://localhost:3000', '+IP=http://127.0.0.1:8080']) {
    const r = projetarMudancasDeAmbiente(`@@ -1 +1 @@\n${linha}`);
    assert.equal(r.ocultos, 0, r.text);
    assert.ok(r.text.includes(linha));
  }
});

test('aspa aberta atravessa o hunk seguinte', () => {
  const r = projetarMudancasDeAmbiente(['@@ -1 +1 @@', '+PEM="abre', '@@ -9 +9 @@', '+FEATURE=true', '+fecha"', '+DEPOIS=true'].join('\n'));
  assert.ok(!r.text.includes('FEATURE=true'));
  assert.ok(r.text.includes('+DEPOIS=true'));
});

test('aspa com escape não fecha, e aspa aberta no contexto vale para as linhas seguintes', () => {
  const escapada = projetarMudancasDeAmbiente('@@ -1 +1 @@\n+PEM="abc\\"\n+MIIE_ABCD_EFGH=');
  assert.ok(!escapada.text.includes('MIIE_ABCD_EFGH'), escapada.text);
  const noContexto = projetarMudancasDeAmbiente('@@ -1,2 +1,3 @@\n PEM="abc\n+MIIE_ABCD_EFGH=\n fim"\n+DEPOIS=true');
  assert.ok(!noContexto.text.includes('MIIE_ABCD_EFGH'), noContexto.text);
  assert.ok(noContexto.text.includes('+DEPOIS=true'), noContexto.text);
  const dosDoisLados = projetarMudancasDeAmbiente('@@ -1 +1 @@\n-PEM="velho\n+PEM="novo\n+MIIE_ABCD_EFGH=');
  assert.ok(!dosDoisLados.text.includes('MIIE_ABCD_EFGH'), dosDoisLados.text);
});

test('sufixo de chave ou de segredo não é arquivo de ambiente', () => {
  for (const p of ['.env.pem', '.env.key', '.env.p12', '.env.pfx', '.env.id_rsa', '.env.secrets', '.env.credentials', '.env.kdbx']) assert.equal(ehArquivoDeAmbiente(p), false, p);
  assert.equal(ehArquivoDeAmbiente('.env.production.local'), true);
});

test('a queda da autoanálise não leva caminho protegido cru ao disco da sessão', () => {
  const patch = `@@ -1,2 +1,3 @@ AUTH_SECRET=${SEGREDO}\n INTERNAL_PROXY_SECRET=${SEGREDO}\n+FEATURE=true\n`;
  const [env, protegido, comum] = parsePatchPages([[{ filename: '.env.dev', patch }, { filename: 'secrets/a.json', patch }, { filename: 'src/a.js', patch: '@@ -1 +1 @@\n+a' }]]);
  assert.ok(env.patch.includes('+FEATURE=true'));
  assert.ok(!env.patch.includes(SEGREDO));
  assert.equal(protegido.patch, '');
  assert.equal(protegido.patchStatus, 'unavailable');
  assert.equal(comum.patch, '@@ -1 +1 @@\n+a');
});

test('a queda da autoanálise olha também o nome anterior e o conteúdo', () => {
  const patch = `@@ -1,2 +1,3 @@ AUTH_SECRET=${SEGREDO}\n+FEATURE=true\n`;
  const [renomeado, comToken] = parsePatchPages([[
    { filename: 'notas.txt', previous_filename: '.env.prod', patch },
    { filename: 'src/a.js', patch: '@@ -1 +1 @@\n+GH_TOKEN=ghp_' + 'z'.repeat(36) },
  ]]);
  assert.equal(renomeado.patch, '');
  assert.equal(comToken.patch, '');
});
