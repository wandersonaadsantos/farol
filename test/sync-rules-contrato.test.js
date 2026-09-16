// As regras publicadas são GERADAS: o JSON no disco precisa ser byte a byte o que o
// gerador produz a partir do template, e as validações legadas precisam continuar
// idênticas às de hoje (anexo C1, "Estratégia de regras", regra de ouro dos nós legados).
//
// Estes casos são ESTÁTICOS: o dublê do banco não avalia regra (decisão 8 da spec), então
// o que se prova aqui é o texto publicado. O comportamento no servidor fica no roteiro
// manual do firebase/README.md.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const RAIZ = path.join(import.meta.dirname, '..');
const REGRAS = path.join(RAIZ, 'firebase', 'database.rules.json');
const TEMPLATE = path.join(RAIZ, 'firebase', 'database.rules.template.json');

const texto = fs.readFileSync(REGRAS, 'utf8');
const regras = JSON.parse(texto).rules.users.$uid;

test('o arquivo publicado é exatamente o que o gerador produz', () => {
  const gerado = execFileSync(process.execPath, [path.join(RAIZ, 'tools', 'sync-rules.js'), '--stdout'], { encoding: 'utf8' });
  assert.equal(gerado, texto, 'rode `node tools/sync-rules.js` e comite o resultado');
});

test('o template usa macro e o publicado não deixou nenhuma por expandir', () => {
  assert.equal(/@[A-Z]/.test(texto), false, 'sobrou macro no arquivo publicado');
  assert.ok(fs.readFileSync(TEMPLATE, 'utf8').includes('@U@'), 'o template usa macro');
});

test('a raiz perdeu o .write: o apagão de /users/{uid} deixa de existir', () => {
  assert.equal(regras['.write'], undefined);
  assert.equal(regras['.read'], 'auth != null && auth.uid == $uid');
});

test('as validações legadas continuam byte a byte as de hoje', () => {
  assert.equal(regras.leases.$acct.$pr['.validate'], "newData.hasChildren(['leaseId', 'deviceId', 'operationKind', 'expiresAt']) && newData.child('expiresAt').isNumber() && newData.child('expiresAt').val() > now && newData.child('expiresAt').val() <= now + 300000 && (!data.exists() || data.child('expiresAt').val() <= now || (data.child('leaseId').val() == newData.child('leaseId').val() && data.child('deviceId').val() == newData.child('deviceId').val()))");
  assert.equal(regras.receipts.$acct.$pr.$fp['.validate'], "newData.hasChildren(['operationKind', 'materialVersion', 'deviceId', 'completedAt', 'outcome', 'publicationState']) && newData.child('completedAt').isNumber()");
  assert.equal(regras.usageEvents.$device.$event['.validate'], "newData.hasChildren(['at', 'kind', 'costUsd']) && newData.child('at').isNumber()");
  assert.equal(regras.dailyRounds.$acct.$pr.$day['.validate'], "$day.matches(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/) && newData.child('dayPolicy').val() == 'America/Sao_Paulo'");
});

test('cada nó legado ganhou concessão própria, já que a raiz não concede mais', () => {
  for (const no of ['leases', 'receipts', 'dailyRounds', 'devices', 'usageEvents']) {
    assert.equal(regras[no]['.write'], 'auth != null && auth.uid == $uid', no);
  }
});

test('keyring: exige senha recente e rev monotônico', () => {
  const w = regras.keyring['.write'];
  assert.ok(w.includes("auth.token.firebase.sign_in_provider == 'password'"));
  assert.ok(w.includes('auth.token.auth_time * 1000 + 300000 > now'), 'o *1000 é o que faz o caso positivo passar');
  assert.ok(w.includes("newData.child('rev').val() == data.child('rev').val() + 1"));
  assert.equal(regras.keyring.slots.$s['.validate'], "$s.matches(/^(pw|pp)$/)");
});

test('só os nós listados têm concessão de escrita: nó novo sem regra é negado por construção', () => {
  const comEscrita = Object.keys(regras).filter((k) => regras[k] && regras[k]['.write']);
  assert.deepEqual(comEscrita.sort(), ['catalog', 'dailyRounds', 'devices', 'keyring', 'leases', 'myPrs', 'myPrsMeta', 'panorama', 'panoramaMeta', 'pushbacks', 'receipts', 'recentReviews', 'reviewBodies', 'usageEvents']);
  assert.equal(regras.live['.write'], undefined, 'live não concede em bloco');
  assert.equal(regras.live.control['.write'], undefined, 'control também não');
  assert.deepEqual(Object.keys(regras.live.control).sort(), ['admin', 'beat', 'cleanup', 'cleanupLock', 'lastCleanup', 'revokedBefore']);
  assert.deepEqual(Object.keys(regras.live).sort(), ['control', 'devicePolicies', 'deviceStatus', 'groups', 'operations', 'pending', 'rev', 'seen']);
});

// A geração é o que impede um admin deposto de continuar mandando: ela só anda para cima,
// uma de cada vez, e trocar de admin exige senha recente no MESMO ato (REC).
test('live/control/admin: senha recente e geração +1, sem pulo e sem volta', () => {
  const w = regras.live.control.admin['.write'];
  assert.ok(w.includes("auth.token.firebase.sign_in_provider == 'password'"));
  assert.ok(w.includes('auth.token.auth_time * 1000 + 300000 > now'));
  assert.ok(w.includes("newData.hasChildren(['deviceId', 'generation', 'publicKey', 'setAt'])"));
  assert.ok(w.includes("(!data.exists() && newData.child('generation').val() == 1)"));
  assert.ok(w.includes("newData.child('generation').val() == data.child('generation').val() + 1"));
});

// O servidor não verifica assinatura: o que ele consegue conferir é que o batimento é da
// geração vigente, veio do aparelho que é admin AGORA e tem carimbo dentro de 60 s. O
// frescor de verdade (sequência maior, observada nesta conexão) é do cliente.
test('live/control/beat: geração vigente, dono do momento e janela de 60 s', () => {
  const w = regras.live.control.beat['.write'];
  assert.ok(w.includes("newData.hasChildren(['dev', 'generation', 'sequencia', 'beatAt', 'sig'])"));
  assert.ok(w.includes(".child('live').child('control').child('admin').child('generation').val()"), 'geração presa à vigente');
  assert.ok(w.includes(".child('admin').child('deviceId').val()"), 'só o admin do momento bate');
  assert.ok(w.includes("newData.child('sequencia').isNumber()"));
  assert.ok(w.includes("newData.child('beatAt').val() + 60000 > now"));
  assert.ok(w.includes("newData.child('beatAt').val() < now + 60000"));
});

test('live/devicePolicies/$dev: forma, geração vigente e envelope de no máximo 2048', () => {
  const w = regras.live.devicePolicies.$dev['.write'];
  assert.ok(w.includes("newData.hasChildren(['v', 'generation', 'enc', 'sig'])"));
  assert.ok(w.includes(".child('admin').child('generation').val()"));
  assert.ok(w.includes("newData.child('enc').val().length <= 2048"));
  assert.ok(w.includes('/^e1[.]g[0-9]+[.]'), 'só entra o que tem forma de envelope');
  assert.ok(w.includes("newData.child('v').isNumber()"));
});

test('a sonda depende desta assimetria: rulesProbe concede em v2/{aparelho} e em mais nada', () => {
  assert.equal(regras.rulesProbe['.write'], undefined, 'o pai não pode conceder, senão a sonda nunca detecta regra velha');
  assert.equal(regras.rulesProbe.v2.$dev['.write'], 'auth != null && auth.uid == $uid');
  assert.equal(regras.rulesProbe.v1, undefined, 'v1 não existe no template: é o caminho que as regras novas negam');
});

// A chave da limpeza é assinada e tem `rev` monotônico: sem o monotônico, um valor antigo
// reentregue faria "desligada" voltar a ser "ligada" sem ninguém ter ligado nada.
test('live/control/cleanup: booleano, geração vigente e rev que só sobe', () => {
  const w = regras.live.control.cleanup['.write'];
  assert.ok(w.includes("newData.hasChildren(['enabled', 'generation', 'rev', 'sig'])"));
  assert.ok(w.includes("newData.child('enabled').isBoolean()"));
  assert.ok(w.includes(".child('admin').child('generation').val()"), 'presa à geração vigente');
  assert.ok(w.includes("newData.child('rev').val() > data.child('rev').val()"));
  assert.equal(w.includes("auth.token.firebase.sign_in_provider"), false, 'ligar a chave NÃO exige senha recente (D-b)');
});

// A trava só nasce com senha recente e com a chave ligada; sair dela é sempre permitido,
// senão um ato interrompido deixaria o conjunto travado até o vencimento.
test('live/control/cleanupLock: nasce com REC e chave ligada, e sai sem condição', () => {
  const w = regras.live.control.cleanupLock['.write'];
  assert.ok(w.includes('!newData.exists() ||'), 'apagar a trava não pode ter condição');
  assert.ok(w.includes("auth.token.auth_time * 1000 + 300000 > now"));
  assert.ok(w.includes(".child('cleanup').child('enabled').val() == true"));
  assert.ok(w.includes("newData.child('x').val() <= now + 600000"), 'a trava não pode nascer valendo mais que dez minutos');
});

test('live/control/lastCleanup: só com senha recente, e com a forma do corte', () => {
  const w = regras.live.control.lastCleanup['.write'];
  assert.ok(w.includes("auth.token.auth_time * 1000 + 300000 > now"));
  assert.ok(w.includes("newData.hasChildren(['at', 'dev', 'categorias'])"));
});

// Quem revoga não pode se cortar fora: o valor tem que ser MENOR que o auth_time do token
// do próprio ato, e só cresce.
test('live/control/revokedBefore: abaixo do auth_time do ato e sempre para cima', () => {
  const w = regras.live.control.revokedBefore['.write'];
  assert.ok(w.includes("auth.token.auth_time * 1000 + 300000 > now"), 'exige senha recente');
  assert.ok(w.includes("newData.val() < auth.token.auth_time"));
  assert.ok(w.includes("!data.exists() || newData.val() >= data.val()"));
});

test('live/groups/$grupo: mesma forma do nó de política, com envelope de 2048', () => {
  const w = regras.live.groups.$grupo['.write'];
  assert.ok(w.includes("newData.hasChildren(['v', 'generation', 'enc', 'sig'])"));
  assert.ok(w.includes(".child('admin').child('generation').val()"));
  assert.ok(w.includes("newData.child('enc').val().length <= 2048"));
});

// A remoção acontece no nó PAI da categoria, e é lá que a concessão precisa existir. Sem
// ela, a limpeza prometeria apagar algo que o banco recusa.
test('a limpeza remove pelo pai, e só sob as condições da limpeza', () => {
  for (const no of ['devicePolicies', 'groups']) {
    const w = regras.live[no]['.write'];
    assert.ok(w.includes('!newData.exists()'), `${no}: a concessão do pai é só para remover`);
    assert.ok(w.includes(".child('cleanup').child('enabled').val() == true"), `${no}: exige a chave ligada`);
    assert.ok(w.includes("auth.token.auth_time * 1000 + 300000 > now"), `${no}: exige senha recente`);
    assert.ok(w.includes(".child('live').child('operations').exists()"), `${no}: exige nenhuma operação viva`);
  }
});

test('nenhum nó protegido ganhou saída pela limpeza', () => {
  for (const no of ['keyring', 'leases', 'receipts', 'dailyRounds']) {
    assert.equal(regras[no]['.write'].includes("child('cleanup')"), false, no);
  }
  for (const filho of ['admin', 'beat', 'cleanup', 'lastCleanup', 'revokedBefore']) {
    assert.equal(regras.live.control[filho]['.write'].includes('!newData.exists()'), false, `live/control/${filho}`);
  }
});

// A presença é nó legado: a regra de ouro diz que as validações de hoje ficam intactas, e
// os campos novos ganham a sua, sem tocar nos outros.
test('devices: contract e keyReady ganham validação, e nada mais muda', () => {
  assert.equal(regras.devices['.write'], 'auth != null && auth.uid == $uid');
  assert.equal(regras.devices.$device.contract['.validate'], 'newData.isNumber()');
  assert.equal(regras.devices.$device.keyReady['.validate'], 'newData.isBoolean()');
  for (const campo of ['name', 'platform', 'farolVersion', 'lastSeenAt', 'createdAt']) {
    assert.equal(regras.devices.$device[campo], undefined, `${campo} não pode ganhar validação`);
  }
});

test('live/deviceStatus e catalog: forma, envelope de 2048 e remoção só pela limpeza', () => {
  for (const [pai, filho] of [[regras.live.deviceStatus, regras.live.deviceStatus.$dev], [regras.catalog, regras.catalog.$pr]]) {
    assert.ok(pai['.write'].includes('!newData.exists()'), 'a concessão do pai é só para remover');
    assert.ok(pai['.write'].includes("child('cleanup').child('enabled').val() == true"));
    assert.ok(filho['.write'].includes("newData.hasChildren(['v', 'u', 'enc'])"));
    assert.ok(filho['.write'].includes("newData.child('enc').val().length <= 2048"));
  }
  assert.ok(regras.catalog.$pr['.write'].includes('$pr.matches(/^[0-9a-f]+$/)'), 'a chave do catálogo é tag, e a regra exige a forma');
});

// Achado da C3a, corrigido na hora: a concessão de REMOÇÃO pela limpeza não pode se apoiar
// só na senha recente. `REC` prova que o token é de login por senha e é novo; ele NÃO prova
// que quem escreve é o dono desta conta. Sem `U`, um segundo usuário autenticado no mesmo
// projeto apagaria o catálogo, a capacidade, as políticas e os grupos de outra pessoa
// sempre que a chave de limpeza dela estivesse ligada.
test('toda concessão de escrita, inclusive a da limpeza, exige o próprio uid', () => {
  const dono = 'auth != null && auth.uid == $uid';
  const nos = [regras.catalog, regras.live.deviceStatus, regras.live.devicePolicies, regras.live.groups, regras.recentReviews, regras.reviewBodies, regras.reviewBodies.$r, regras.panorama, regras.panoramaMeta, regras.myPrs, regras.myPrsMeta, regras.pushbacks];
  for (const no of nos) {
    assert.ok(no['.write'].startsWith(dono), `concessão sem dono: ${no['.write'].slice(0, 60)}`);
  }
  const todas = [...nos.map((n) => n['.write']), regras.live.control.cleanupLock['.write'], regras.live.control.lastCleanup['.write']];
  for (const w of todas) assert.ok(w.includes(dono), w.slice(0, 60));
});

// Andamento: remoção livre (só afeta exibição), vida curta com teto de 5 minutos, e dono e
// início imutáveis, senão outro aparelho "adotaria" a operação de alguém.
test('live/operations/$op: remoção livre, x com teto, dev e t0 imutáveis', () => {
  const w = regras.live.operations.$op['.write'];
  assert.ok(w.startsWith('auth != null && auth.uid == $uid && (!newData.exists() ||'));
  assert.ok(w.includes("newData.hasChildren(['v', 'dev', 't0', 'x', 'enc'])"));
  assert.ok(w.includes("newData.child('x').val() > now && newData.child('x').val() <= now + 300000"));
  assert.ok(w.includes("newData.child('dev').val() == data.child('dev').val()"));
  assert.ok(w.includes("newData.child('t0').val() == data.child('t0').val()"));
  assert.ok(w.includes('$op.matches(/^[0-9a-f]+$/)'));
  assert.equal(regras.live.operations['.write'], undefined, 'o pai não concede');
});

test('live/pending/$i: remoção cooperativa, envelope de 4096, at e dev imutáveis', () => {
  const w = regras.live.pending.$i['.write'];
  assert.ok(w.startsWith('auth != null && auth.uid == $uid && (!newData.exists() ||'));
  assert.ok(w.includes("newData.hasChildren(['v', 'at', 'dev', 'enc'])"));
  assert.ok(w.includes("newData.child('enc').val().length <= 4096"));
  assert.ok(w.includes("newData.child('at').val() == data.child('at').val()"));
  assert.ok(w.includes("newData.child('dev').val() == data.child('dev').val()"));
});

// O visto é gravado uma vez (`!data.exists()`), e só sai quando a pendência sumiu ou com
// 30 dias: sem isso, apagar o visto faria a pendência voltar a tocar em todo aparelho.
test('live/seen/$i: grava uma vez só, e sai só sem pendência ou com 30 dias', () => {
  const w = regras.live.seen.$i['.write'];
  assert.ok(w.includes("(!data.exists() && newData.hasChildren(['at', 'dev'])"));
  assert.ok(w.includes("newData.child('at').val() <= now + 60000"));
  assert.ok(w.includes(".child('live').child('pending').child($i).exists()"));
  assert.ok(w.includes("data.child('at').val() + 2592000000 < now"));
});

// O índice é ordenável pelo banco (t e dt), e t, d e dt não mudam: é o que faz "as 30 mais
// recentes" e "as deste aparelho" serem consultas, e não download da lista inteira.
test('recentReviews: índice em t e dt, envelope de 1024, e t, d, dt imutáveis', () => {
  assert.deepEqual(regras.recentReviews['.indexOn'], ['t', 'dt']);
  const w = regras.recentReviews.$r['.write'];
  assert.ok(w.includes("newData.hasChildren(['v', 't', 'd', 'dt', 'enc'])"));
  assert.ok(w.includes("newData.child('enc').val().length <= 1024"));
  for (const c of ['t', 'd', 'dt']) assert.ok(w.includes(`newData.child('${c}').val() == data.child('${c}').val()`), c);
});

test('reviewBodies: versão write-once, numérica, envelope de 48000', () => {
  const w = regras.reviewBodies.$r.$v['.write'];
  assert.ok(w.includes("(!data.exists() && newData.hasChildren(['v', 'enc'])"));
  assert.ok(w.includes('$v.matches(/^[0-9]+$/)'));
  assert.ok(w.includes("newData.child('enc').val().length <= 48000"));
});

test('live/rev: só número, só nos três tipos, e sem remoção', () => {
  const w = regras.live.rev.$tipo.$id['.write'];
  assert.ok(w.includes('$tipo.matches(/^(recentReviews|panorama|myPrs)$/)'));
  assert.ok(w.endsWith('newData.isNumber()'), 'número exige que o nó exista: remoção é negada');
});

// Panorama e Meus PRs: linha viva cifrada OU tombstone sem conteúdo; o tombstone só sai 24 h
// depois; o meta vale no máximo 20 min à frente, para um publicador morto não prender a vez.
test('panorama e myPrs: índice su, tombstone de 24 h e meta com teto', () => {
  for (const [no, teto] of [['panorama', 2048], ['myPrs', 8192]]) {
    assert.deepEqual(regras[no]['.indexOn'], ['su'], no);
    const w = regras[no].$item['.write'];
    assert.ok(w.includes("newData.hasChildren(['v', 'su', 'u', 'ctag'])"), no);
    assert.ok(w.includes(`newData.child('enc').val().length <= ${teto}`), no);
    assert.ok(w.includes("newData.child('del').val() == true ||"), no);
    assert.ok(w.includes("(!newData.exists() && data.child('del').val() == true && data.child('u').val() + 86400000 < now)"), no);
    assert.ok(regras[`${no}Meta`].$scope['.write'].includes("newData.child('x').val() <= now + 1200000"), no);
  }
});

test('pushbacks: forma, envelope de 1024 e lápide sem conteúdo', () => {
  const w = regras.pushbacks.$pr['.write'];
  assert.ok(w.includes("newData.hasChildren(['v', 'u', 'dev'])"));
  assert.ok(w.includes("newData.child('del').val() == true ||"), 'a lápide não carrega envelope');
  assert.ok(w.includes("newData.child('enc').val().length <= 1024"));
  assert.ok(w.includes('$pr.matches(/^[0-9a-f]+$/)'));
});
