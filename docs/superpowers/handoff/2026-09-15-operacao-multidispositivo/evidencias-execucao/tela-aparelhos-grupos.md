# Evidência: as seções Aparelhos e Grupos de consumo (brief B2, itens 2.5, 2.6 e 2.10)

Branch `md/tela-aparelhos`, cortada de `md/integracao` em `e9f8183`. Desenho de referência:
`C2Aparelhos.html`, `C4Grupos.html` e `CelAparelhos.html` (pasta
`docs/superpowers/specs/2026-09-15-operacao-multidispositivo-anexos/B2-design/quadros/`).
Nenhuma instância do app foi aberta e o navegador embutido não foi usado: a jornada visual
fica para depois da integração, com quem coordena.

Depois do corte, `md/integracao` recebeu `md/sync-tela` (`bb51db8`, `85bf7fc`) e dois commits
de documentação. `git merge-tree --write-tree HEAD md/integracao` não dá conflito textual, e no
resultado a contagem de `settingsIgnoradasTexto(r)` nas telas continua 4 (o `sistema-sync.js`
de lá segue com uma ocorrência só).

## 1. O que passou a existir

| Peça | Onde |
|---|---|
| Duas seções novas no Sistema, entre Sincronização e Plano e chaves | `ui/index.html` (`data-section="devices"` e `"groups"`, containers `#devicesManager` e `#groupsManager`), `SYS_INDEX` e registro em `ui/telas/sistema.js` |
| HTML puro da seção Aparelhos | `ui/pure/aparelhos.js`: `aparelhosSecaoHtml`, `aparelhosAdminHtml`, `aparelhosDesignacaoHtml`, `aparelhosListaHtml`, `aparelhosContasNaoCobertas`, `aparelhosConsentimentoHtml`, `aparelhoPoliticaHtml`, `aparelhosNavegadoresHtml`, `aparelhosLimpezaHtml`, `aparelhosSouAdmin` |
| HTML puro e corpo de rota dos grupos | `ui/pure/grupos.js`: `gruposSecaoHtml`, `grupoCartaoHtml`, `gruposPerfisHtml`, `grupoFormHtml`, `grupoTipoDoPerfil`, `grupoNovoId`, `grupoCorpoDaRota`, `grupoCorpoDoGrupo` |
| Fiação (DOM, cliques, rotas) | `ui/telas/sistema-aparelhos.js` e `ui/telas/sistema-grupos.js`, importados por `ui/telas/sistema.js` (o `ui/app.js` não foi tocado) |
| CSS | fim de `ui/app.css`, só tokens existentes, quebras 860, 720 e 620, alvo de 44 px no estreito |
| Superfície pública | os 18 nomes novos na lista congelada de `test/ui-pure-superficie.test.js` |

Quando cada leitura acontece: o snapshot (`sync.devices`, `sync.admin`,
`sync.coberturaPostagem`, `sync.designacaoAdmin`, `sync.gruposDeConsumo`) repinta as duas
seções a cada estado; as leituras sob demanda (`GET /api/auth/status`,
`POST /api/auth/sessions`, `POST /api/sync/cleanup-state`) só rodam ao entrar na aba Sistema e
depois de um ato que as muda. Ler o banco a cada snapshot faria uma chamada de rede por ciclo
(travado em teste e em mutação).

### 2.5 Aparelhos e administração

- **Lista** a partir de `sync.devices`: nome, sistema, versão (`desconhecida` quando o aparelho
  não publica), visto por último, e os selos `este`, `admin`, `aposentado` e
  `garantia não coberta`. Ações por linha: Renomear e Aposentar ou Reativar
  (`POST /api/sync/device` com `{ deviceId, nome }` ou `{ deviceId, aposentar }`), e Política
  só para o admin. Aparelho aposentado não recebe Aposentar de novo. Aposentar confirma pelo
  modal, com o que NÃO acontece (nada apagado, nenhuma chave retirada, admin não deposto,
  sessão não encerrada); reativar não confirma, porque só desfaz.
- **Garantia não coberta**: `coberturaPostagem` é por conta e nomeia os aparelhos por nome, ou
  pelo id quando não há nome (`lib/sync/cobertura-postagem.js`). A tela casa pela mesma regra,
  põe o selo no aparelho e escreve uma nota com as contas afetadas.
- **Administração** a partir de `sync.admin`: sem admin, "Ninguém administra"; admin em outro
  aparelho com e sem batimento; este aparelho admin com e sem batimento. `fresca: false`
  aparece sempre como "admin sem sinal de vida", com a frase de que nada do que ele publica é
  aplicado. "Tornar este aparelho admin" (`POST /api/sync/admin` com `{ password }`) aparece
  para todos, menos para quem já é o admin com batimento.
- **"Sou o admin"** (`aparelhosSouAdmin`) exige `souEu` E `fresca`. É o que libera Política e
  a chave de limpeza. Admin sem batimento não recebe esses botões.
- **Pedido de designação** (`sync.designacaoAdmin`): cartão próprio com campo de senha;
  aceitar é o mesmo `POST /api/sync/admin` (o engine confirma a designação dentro dele).
- **Consentimento** `sync.aceitarAdmin`: interruptor salvo por `POST /api/settings` com o
  objeto de sync INTEIRO, e a recusa passa por `settingsIgnoradasTexto`, como na
  Sincronização. Na recusa, a seção repinta com o valor salvo.
- **Política de um aparelho** (só para o admin): pausado, teto de 1 a 4 e os cinco tipos da
  allowlist (`review`, `self`, `pushback`, `chat`, `tool`), publicada por
  `POST /api/sync/policy` `{ deviceId, politica }`. A recusa da rota aparece no próprio
  formulário, com o motivo.
- **Navegadores pareados**: com `exigida: false`, a seção diz que a API local não exige
  credencial; com `exigida: true`, lista as sessões (rótulo, pareado, usado, "este
  navegador") e revoga por `POST /api/auth/revoke` `{ id }`, com confirmação. `eraAtual: true`
  recarrega a página (e o boot cai no pareamento); revogar outra só relê a lista. Carregando,
  vazio, falha com motivo e não exigida são saídas diferentes.

### 2.6 Grupos de consumo e teto

- **Cartão por grupo** de `sync.gruposDeConsumo`: nome, período, gasto do período com o teto,
  requisitos que faltam (frases próprias; código desconhecido sai como está), perfis
  controlados pelo rótulo da config (ou pelo id, se o perfil sumiu), e os não controlados numa
  lista própria, com "o provedor não informa custo, e o perfil não entra na soma nem no teto".
- **Estados**: `nao-identificado`; `sem-teto` ("só soma, nada segura"); `configurado` ("teto
  configurado, ainda não ativo", sem selo de protegido); `ativo` com requisito faltando ("marcado
  ativo, sem efeito neste aparelho", porque `gruposAtivos` o descarta); ativo e
  `verificavel: true` ("verificado"); `verificavel: false` ("não verificável", segura o
  automático e o clique, sem estacionar); `verificavel: null` ("soma ainda não calculada").
  `custoUsd: null` é "gasto ainda não calculado", nunca US$ 0.00. `parcialmenteEstimado` ganha
  selo.
- **Criar e editar** (só o admin): formulário com nome, período (`dia`, `semana`, `mes`) e teto
  opcional. Grupo novo nasce com id de 32 hex a partir de `crypto.getRandomValues`
  (`grupoNovoId`); teto vazio ou negativo é omitido, nunca zero. Editar um grupo ativo reenvia
  `ativo: true`, senão republicar desativaria o teto.
- **Ativar e desativar** (só o admin): Ativar só aparece com a lista de requisitos vazia e
  estado `configurado`, e confirma pelo modal com o que acontece e o que não acontece. A
  recusa `ativacao-bloqueada` sai no aviso com o motivo do engine, que já lista o que falta.
  Desativar não confirma.
- **Vínculo** (qualquer aparelho): perfil com vínculo conhecido mostra o grupo e Desvincular
  (confirma; `POST /api/sync/link` `{ perfilId, desvincular: true }`); sem vínculo conhecido,
  seletor de grupo e Vincular (`{ perfilId, grupo, tipo }`, tipo derivado do `kind`: pasta é
  `assinatura`, `apikey` é `api`, `openrouter`, `codex`; kind desconhecido não vincula).
- **Por que a lista pode estar vazia**: compartilhamento desligado e aparelho sem
  consentimento ganham aviso próprio (este com atalho `data-goto="sys:devices"`); sincronização
  desligada leva a `sys:sync`. Só sem nada disso aparece "Nenhum grupo de consumo neste
  aparelho".

### 2.10 Limpeza protegida e revogação

- **Chave de limpeza** por `POST /api/sync/cleanup-state`: `desligada` (Ligar, só o admin),
  `ligada` (Desligar e "Limpar com a senha…", só o admin), `desligada-ou-nao-verificavel`
  ("não confirmada", sem botão nenhum), `compartilhamento-desligado` ("não se aplica"), e os
  dois da tela: carregando e falha com o motivo da rota. A falha nunca vira "desligada".
- **Limpar** (`POST /api/sync/cleanup` `{ password }`) e **Revogar o conjunto**
  (`POST /api/sync/revoke` `{ password }`) passam pelo `confirmModal`, com a senha dentro do
  modal e o texto do que acontece e do que NÃO acontece. Cancelar não chama a rota, mesmo com a
  senha digitada; sem senha também não.
- A senha é lida do campo na hora do clique (ou do elemento do modal, guardado no instante em
  que ele abre, porque o `confirmModal` remove o próprio DOM antes de resolver) e nunca vai
  para variável de módulo (travado em teste).

## 2. Divergências entre o desenho e o contrato

O contrato mandou em todas. Nenhuma foi resolvida inventando dado na tela.

1. **Estado da política no aparelho de destino** ("aceita pelo aparelho", "versão 5",
   "recusada: assinatura não confere", "ignorada: sem consentimento", "geração antiga"): a
   recusa da ordem comum acontece no aparelho que lê e não volta para o admin; o snapshot não
   traz política nem aceite por aparelho. A tela mostra só a recusa da PUBLICAÇÃO (`nao-e-admin`,
   `sem-chave`, `compartilhamento-desligado`, indisponível, conflito).
2. **Valor atual da política**: não é legível pela tela, então o formulário abre com os valores
   mínimos (não pausado, teto 1, os cinco tipos marcados). Publicar substitui a política
   inteira. Vale revisar na jornada se o teto inicial deveria ser outro.
3. **"Recusar" o pedido de designação**: não existe rota; o cartão só oferece aceitar.
4. **"Sem batimento há 18 minutos"**: `sync.admin` traz só `fresca`, sem horário; a frase não
   tem duração.
5. **Número da versão mínima e link "Como atualizar o Farol"**: a versão da arbitragem
   (`POSTAGEM_COORDENADA_DESDE`) não está no snapshot, e não há destino navegável para o link;
   a nota fala em "versão anterior à da postagem coordenada", sem número e sem link.
6. **"Sem presença" e "Primeiro aparelho"** como estados próprios: não há sinal de presença
   separado de `lastSeenAt`; a tela mostra "visto por último" e a lista com um aparelho só.
7. **Chave "bloqueada"** (servidor não confere senha recente): o contrato devolve
   `desligada-ou-nao-verificavel`, que a tela mostra como "não confirmada" com o motivo
   possível. O link "Como limpar pelo console" ficou de fora (sem destino).
8. **"Limpeza em andamento" (trava de 10 minutos)**: a trava vive no banco e não aparece no
   snapshot nem no estado da chave; o botão só espera a resposta da rota.
9. **Categorias da limpeza**: a lista positiva não está no contrato. A tela não a repete (seria
   segunda fonte) e manda o pedido sem categorias, que o engine lê como "todas as alcançáveis";
   o modal diz isso. A resposta da rota passa por `syncResult` e chega só com `ok`, então a
   tela não sabe quais categorias falharam.
10. **"Revogar o conjunto retira o consentimento deste aparelho"** (texto do desenho):
    `syncRevogar` só grava o corte; a retirada é outra função sem rota. A tela não promete.
11. **Grupos**: o motivo do "não verificável" (lacuna, rollup inválido, aparelho sem dados,
    reserva vencida, retrato velho), o "teto atingido" com a projeção das reservas, o gasto por
    perfil e a hora da soma ("soma fechada às 10:02") não estão em `resumoParaTela`. A tela não
    mostra nenhum deles, e o botão "Ver aparelhos" do cartão não verificável ficou de fora por
    não ter motivo para apontar.
12. **Vínculos fora do snapshot**: eles só chegam pelos grupos aceitos aqui. Perfil vinculado a
    um grupo que não chegou aparece como "sem grupo conhecido". A resposta de `/api/sync/link`
    também não traz o vínculo (passa por `syncResult`).
13. **Grupo publicado só aparece depois do aceite**, e o aceite exige consentimento também no
    próprio admin. O aviso de sucesso diz que o grupo aparece no próximo ciclo; o admin sem
    consentimento vê o aviso de consentimento na seção.
14. **"Não identificado: perfil sem id estável"** (desenho) é, no engine, grupo sem id; a tela
    usa o sentido do engine.
15. **Duplicação registrada**: a seção Sincronização continua com a sua lista de aparelhos
    (`syncAparelhosHtml`); não foi tirada, por instrução.
16. **Cartão "O que ainda não está valendo"** no topo da versão estreita: continua só no topo
    da Sincronização, não foi repetido em Aparelhos.
17. **Olho da senha**: `syncOlhoHtml` não é exportado; os campos de senha novos são
    `type="password"` sem o olho, e o markup não foi duplicado.
18. **Datas dos navegadores no estreito**: a lista reaproveita `.sync-linha`, cuja regra de 720
    px esconde a segunda e a terceira coluna (pareado e usado). A confirmar na jornada.

## 3. Testes

| Arquivo | Casos | O que prova |
|---|---|---|
| `test/ui-pure-aparelhos.test.js` | 25 | cobertura por nome e por id; lista (selos, versão desconhecida, vazio, escape, botões por papel); admin nos quatro casos; designação; consentimento que não se presume; política (teto 1 a 4, tipos da allowlist, recusa); navegadores nos cinco estados; limpeza nos seis estados e por papel; seção desligada e ligada; admin sem batimento sem ato de admin |
| `test/ui-pure-grupos.test.js` | 24 | tipo do perfil; os sete estados do cartão; soma ausente não vira zero; Codex em seção própria; ativar só para o admin e sem requisito; perfis e vínculo; id sorteado; corpo da rota (teto omitido, ativo preservado); formulário; os três motivos de lista vazia |
| `test/ui-telas-aparelhos-grupos.test.js` | 25 | com rede e modal de mentira: rota e corpo de cada ato, cancelamento com senha digitada, recarga só ao revogar a própria sessão, falha que não vira vazio, sync inteiro no consentimento, ativo preservado na edição, `abrirPolitica` recusando quem não é admin com batimento, desenho com o DOM de mentira, a costura com `sistema.js` (fatia do `registrarTela`) e a ordem na barra lateral |
| `test/ui-pure-superficie.test.js` | alterado | 18 nomes novos |
| `test/ui-semantics.test.js` | alterado | a barra lateral passa de 12 para 14 seções |
| `test/settings-ignoradas.test.js` | alterado | os salvamentos com o texto das ignoradas passam de 3 para 4 (o consentimento de Aparelhos) |

TDD, com a ordem real: os dois arquivos de funções puras foram escritos antes do código e
rodaram vermelhos (`P.aparelhosSecaoHtml is not a function`; grupos com 0 aprovados e 24
reprovados). O arquivo da fiação foi escrito DEPOIS de `sistema-aparelhos.js` e
`sistema-grupos.js`, e por isso a garantia dele vem da contraprova abaixo, não de ter nascido
vermelho.

## 4. Contraprova por mutação

Script em `verificacoes-saidas/tela-aparelhos-mutacoes-script.mjs.txt`: cada mutação troca um
trecho que casa exatamente uma vez, roda os três arquivos de teste, restaura o arquivo e
compara o SHA-256 com o original.

- **Rodada 1** (`verificacoes-saidas/tela-aparelhos-mutacoes-rodada1.txt`): 25 mutações, 23
  mortas, **2 inertes**, todas restauradas byte a byte.
  - M18 (revogar o conjunto sem a guarda do cancelamento): o modal falso devolvia a senha vazia
    quando cancelado, então a guarda do campo vazio escondia a falta da guarda do `ok`.
    Reforço: o modal falso devolve a senha também na desistência, e os casos de cancelamento
    de limpar e revogar passam a ter senha digitada.
  - M25 (abrir a política sem ser admin): a guarda estava num handler de clique sem teste.
    Reforço: `abrirPolitica` exportada e testada com admin sem batimento e com batimento.
- **Rodada 2** (`verificacoes-saidas/tela-aparelhos-mutacoes-rodada2.txt`): as 25 mais M26
  (renomear ignorando o cancelamento, que entrou junto com o reforço do cancelamento): **26
  mortas, 0 inertes**, todas restauradas. `git status` limpo depois das duas rodadas, fora os
  reforços de teste, que foram para o commit `c4438a3`.

O que as mutações cobrem: autoridade que exige batimento (M1, M9, M25), limpeza oferecida sem
chave confirmada (M2), tornar admin oferecido a quem já é (M3), cobertura por id (M4), falha
que vira vazio (M5, M15, M20), teto de paralelismo (M6), aposentar duas vezes (M7),
consentimento presumido (M8), ativo sem requisito como protegido (M10, M14), soma e teto que
viram zero (M11, M12), kind desconhecido (M13), recarga indevida (M16), ato sem senha ou sem
confirmação (M17, M18, M21, M23, M26), sync parcial no consentimento (M19), edição que desativa
o teto (M22) e leitura de rede a cada snapshot (M24). O CSS não tem mutação: não há teste de
layout, e a verificação dele é a jornada visual.

## 5. Gates

| Rodada | Comando | Resultado | Código | Saída |
|---|---|---|---|---|
| 1 | `npm run check` | 543 arquivos | 0 | `verificacoes-saidas/tela-aparelhos-rodada1-check.txt` |
| 1 | `npm run lint` | sem regressão | 0 | `tela-aparelhos-rodada1-lint.txt` |
| 1 | `npm test` | 4032 testes, 4002 aprovados, **2 reprovados**, 28 pulados | 1 | `tela-aparelhos-rodada1-test.txt` |
| 2 | `npm run check` | 543 arquivos | 0 | `tela-aparelhos-rodada2-check.txt` |
| 2 | `npm run lint` | sem regressão | 0 | `tela-aparelhos-rodada2-lint.txt` |
| 2 | `npm test` | 4032 testes, 4003 aprovados, **1 reprovado**, 28 pulados | 1 | `tela-aparelhos-rodada2-test.txt` |
| 3 | `node --import memoria-folgada --test --test-force-exit` | 4032 testes, 4004 aprovados, 0 reprovados, 28 pulados | 0 | `tela-aparelhos-rodada3-test-memoria-folgada.txt` |

A queda nativa intermitente do Node (exitCode 3221226505) não apareceu em nenhuma rodada.

**Rodada 1, as duas reprovações:**

1. `test/settings-ignoradas.test.js`, "os três salvamentos da tela…": **causada por esta
   entrega**. A contagem de `settingsIgnoradasTexto(r)` nas telas passou de 3 para 4 com o
   consentimento de Aparelhos, que usa o mesmo texto de propósito. O teste foi atualizado para
   4, nomeando o quarto salvamento (commit próprio).
2. `test/sync-device-status.test.js`, "a RAM viaja em faixa…": **ambiental, não desta
   entrega**. O teste simula `os.freemem` em 8 GB, mas `memoriaLivreMb`
   (`lib/engine/admissao.js`) usa o MENOR entre `process.availableMemory()` e `os.freemem()`, e
   nesta máquina `process.availableMemory()` media 1120 MB, abaixo de `3 × PISO_MEMORIA_MB`
   (3072), o que dá a faixa `media` em vez de `alta`. Provas: `lib/`, `server.js` e o arquivo de
   teste são idênticos aos do corte (`git diff --stat e9f8183 -- lib server.js
   test/sync-device-status.test.js` vazio); o arquivo isolado reprova do mesmo jeito (8 de 9);
   e com `process.availableMemory` fixado em 16 GB por `--import`
   (`verificacoes-saidas/tela-aparelhos-memoria-folgada.mjs.txt`) o arquivo passa 9 de 9 e a
   suíte inteira passa (rodada 3). O defeito real é do teste, que não isola a segunda fonte de
   memória; fica registrado aqui e não foi corrigido nesta entrega, por estar fora do escopo.

**Rodada 2:** só a reprovação ambiental acima.

## 6. O que ficou de fora

- Jornada visual nos dois tamanhos e nos dois temas: por instrução, depois da integração.
- Tudo o que a seção 2 lista como fora do contrato (itens 1 a 14), por não haver dado.
- Correção do teste de RAM, por estar fora do escopo desta tela.
- `npm run eng` não foi rodado: ele mora no pre-push, e esta entrega não empurra nada.

## 7. Resolução das divergências

Branch `md/tela-divergencias`, cortada de `md/integracao` em `da736f5`. Regra aplicada item a
item: dado derivável foi implementado (engine, rota ou snapshot, e tela); o que o produto não
pode determinar virou ajuste de desenho, com o texto exato; o resto foi apresentação. Nenhum
item ficou bloqueado. Os quadros estão em
`docs/superpowers/specs/2026-09-15-operacao-multidispositivo-anexos/B2-design/quadros/` (os
arquivos são `.html`, não `.dc.html`).

| # | Decisão | O que mudou | Teste que prova |
|---|---|---|---|
| 1 | ajustar desenho (versão publicada implementada) | `POST /api/sync/policy` devolve `versao`; o aviso diz "publicada na versão N ... se aceitar admin"; o formulário diz que o aceite acontece no destino e não volta | `sync-telas-divergencias` (itens 1 e 2), `ui-pure-divergencias` e `ui-telas-divergencias` (item 1) |
| 2 | implementado | `lerPoliticaPublicada` (`sync-politicas.js`: forma, geração e assinatura, sem frescor porque é exibição), rota nova `POST /api/sync/policy-read` (`leitura-sensivel`); `aparelhos-politica.js` abre com o valor vigente (lendo, sem política, não se prova, falha), teto "não definir (vale o do aparelho)", `aparelhoPoliticaParaPublicar` preserva `contasElegiveis`; resposta atrasada de outro aparelho é descartada | `sync-telas-divergencias` (3), `ui-pure-divergencias` (5), `ui-telas-divergencias` (4) |
| 3 | implementado | requisito da C6 ("com recibo de desfecho"): `recusarDesignacao` em `sync-comandos.js` fecha o pedido, grava o feito e responde recibo `recusado`/`recusado_no_aparelho`; rota nova `POST /api/sync/designation-decline` (`demais`); botão Recusar com confirmação | as três famílias (item 3) |
| 4 | implementado | `sync.admin.ultimoBatimentoEm` (instante local do último batimento fresco; 0 sem observação); a tela diz "sem batimento há 18min" ou "nenhum batimento observado desde que este aparelho conectou" | `sync-telas-divergencias`, `ui-pure-divergencias` (item 4) |
| 5 | implementado | `sync.versaoPostagemCoordenada` (de `POSTAGEM_COORDENADA_DESDE`, que mora em `lib/sync/cobertura-postagem.js`, não em `constants.js`); a nota diz "anterior à 2.59.4" e "Como atualizar o Farol" leva a `sys:overview:#updateBox` (Verificar atualização) | `sync-telas-divergencias`, `ui-pure-divergencias` (item 5) |
| 6 | implementado | `devices[].semPresenca` em `sync-projecao.js`, pela janela da frota (`SYNC.FROTA_JANELA_MS`), falso para este aparelho e para o aposentado; selo "sem presença"; nota de primeiro aparelho quando o único ativo é este | `sync-telas-divergencias` (item 6), `ui-pure-divergencias` (2) |
| 7 | ajustar desenho | nada no produto: o servidor só recusa a senha recente no próprio ato, e nenhuma leitura prévia distingue "bloqueada"; nenhum guia que viaja com o app descreve a limpeza pelo console | estado já coberto em `ui-pure-aparelhos` |
| 8 | implementado | `cleanup-state` lê `live/control/cleanupLock` e devolve `travada: { dev, ate }` só com trava viva; a tela mostra "limpando" com o aparelho e o prazo, e também enquanto a limpeza pedida daqui espera a rota (`aoLimpar`); sem botão de limpar nos dois casos | as três famílias (item 8) |
| 9 | implementado | `cleanup-state` devolve `categorias` e `nuncaApagadas` de `lib/sync/limpeza.js`; `/api/sync/cleanup` devolve `apagadas`, `falharam`, `corteGravado`; `aparelhos-limpeza.js` só rotula (id desconhecido sai cru) e `aparelhosResultadoDaLimpeza` trata falha parcial e corte não gravado como erro; o texto fixo "Nunca apagados..." saiu da tela | `sync-telas-divergencias` (2), `ui-pure-divergencias` (2), `ui-telas-divergencias` |
| 10 | ajustar desenho | a spec (7.C2) separa acesso, autorização do aparelho e processos, e `syncRevogar` só grava o corte; a tela ganhou a dica de que revogar não retira o consentimento, e o modal repete | `ui-pure-divergencias` (item 10) |
| 11 | implementado, com ajuste de desenho parcial | `resumoParaTela` devolve `motivos`, `calculadoEm`, `tetoAtingido` e `projecaoUsd` pelo MESMO `veredito` do gate, e trata retrato velho como não verificável (antes a tela mostrava verificado enquanto o gate segurava); a tela diz o motivo com o nome do aparelho, "Ver aparelhos" só com aparelho a apontar, "soma fechada às HH:MM", selo "teto atingido" e a projeção separada. O gasto POR PERFIL entre aparelhos não é derivável: o rollup publicado é por grupo | `sync-telas-divergencias` (4), `ui-pure-divergencias` (3) |
| 12 | implementado | `/api/sync/link` devolve `vinculo`; snapshot ganha `vinculosDePerfis`; perfil vinculado a grupo que não chegou mostra o próprio selo com Desvincular; sem vínculo, selo "sem grupo" | as três famílias (item 12) |
| 13 | apresentação resolvida | `/api/sync/group` devolve `versao`; a tela guarda o publicado como "esperando o aceite" até ele chegar pelo snapshot (e poda ao chegar), com texto próprio quando o admin não tem consentimento | as três famílias (item 13) |
| 14 | implementado | "perfil sem id estável" é a assinatura em uso sem perfil salvo (o engine a trata como `perfil-nao-identificado`): selo "não identificado" e atalho `sys:plans`; grupo sem id segue "não identificado" no cartão, no sentido do engine | `ui-pure-divergencias` (item 14), `ui-pure-grupos` |
| 15 | ajustar desenho (atalho implementado) | a lista da Sincronização fica, porque a versão por aparelho ali foi pedido do dono (16/09/2026); ela ganhou "Administrar em Aparelhos" (`sys:devices`) | `ui-pure-divergencias` (item 15) |
| 16 | apresentação resolvida | `aparelhosSecaoHtml` recebe `capacidades` e repete o cartão dentro de `.apar-so-estreito`, visível só a 720 px | `ui-pure-divergencias`, `ui-telas-divergencias` (itens 16 e 18) |
| 17 | apresentação resolvida | `syncOlhoHtml(visivel, alvo)` exportado (sem alvo, o da Sincronização fica igual); olho nos campos de admin, designação e nos dois modais (`aparelhosCampoSenhaModal`); `alternarOlho` troca o tipo do campo nomeado sem repintar; 44 px a 620 px | `ui-pure-divergencias` (2), `ui-telas-divergencias` (2) |
| 18 | apresentação resolvida | a linha do navegador ganhou `.apar-sessao`; a 720 px ela empilha e mostra pareado e usado (regra depois da que esconde) | `ui-pure-divergencias`, `ui-telas-divergencias` (item 18) |

### Ajustes de desenho (texto e estado exatos)

- **C2Aparelhos, "Política do Desktop antigo" (item 1):** os selos "aceita pelo aparelho" e "versão 5" viram um só, `publicada, versão 5`. A descrição termina com "Esse aceite acontece no aparelho de destino e não volta para esta tela." As células "Recusada pelo aparelho", "Sem consentimento" e "Geração antiga" saem, e entram as quatro saídas da leitura: `lendo` ("lendo a política vigente no banco…"), `sem política` ("Ainda não há nenhuma política publicada para este aparelho: ele vale pela própria configuração."), `não se prova` ("A política que está no banco não se prova como do admin vigente (outra geração ou assinatura que não confere), então não é mostrada. Publicar substitui a política inteira.") e `falha na leitura` ("Não deu para ler a política atual: <motivo>. Publicar substitui a política inteira pelo que está abaixo."). O teto ganha a opção "não definir (vale o do aparelho)".
- **C2Aparelhos, "Chave de limpeza" (item 7):** selo `bloqueada` vira `não confirmada`; texto: "O banco não dá para confirmar a chave de limpeza agora (ela pode estar desligada, ou a autoridade do admin não está verificável). Enquanto isso a limpeza não é oferecida, e apagar dado compartilhado fica no console do Firebase." O link "Como limpar pelo console" sai. A dica fixa vira duas linhas vindas do engine: "Alcança: <categorias>." e "Nunca apagados pelo app: chaveiro, controle do conjunto, posses, recibos, rodadas do dia."
- **C2Aparelhos, "Revogar o conjunto" (item 10):** descrição "Corta todos os acessos anteriores a agora e obriga cada aparelho a entrar de novo. Não cancela sessão em andamento em outro aparelho, não apaga o que eles já receberam e não depõe o admin." e dica "Revogar não retira o consentimento deste aparelho: isso é o interruptor "Aceitar políticas e comandos do admin", acima, e vale só aqui."
- **C2Aparelhos, "Limpeza em andamento" (item 8):** selo `limpando` (chip) e texto "Uma limpeza está em andamento, disparada pelo <aparelho>. A trava vale até <quando>, e enquanto isso nenhuma outra é oferecida."
- **C4Grupos, "Grupo do time" (item 11):** a coluna "Gasto" por perfil sai (as linhas ficam só com o nome); o gasto é só o do grupo. A linha do Codex diz "o provedor não informa custo, e o perfil não entra na soma nem no teto". No não verificável, "…com segurança: o Desktop antigo não enviou dados do período.", e "Ver aparelhos" só quando o motivo aponta um aparelho. No teto atingido, "Nenhuma sessão nova abre por estes perfis até o período virar ou o teto mudar."; a célula "Ativo e verificável" mantém "soma fechada às 10:02".
- **C4Grupos, estados (item 13):** célula nova "Esperando o aceite", selo `esperando o aceite`, texto "Grupo publicado na versão 1; aparece aqui quando o próximo ciclo o aceitar." (sem consentimento: "Grupo publicado na versão 1; mas este aparelho não aceita configuração de admin, então o grupo não volta para esta lista enquanto o consentimento estiver desligado.").
- **C4Grupos, "Perfil sem vínculo" e "Não identificado" (itens 12 e 14):** célula nova "Vinculado a grupo ausente", selo `vinculado a um grupo que não chegou a este aparelho`, botão Desvincular. "Não identificado" vira a linha "Assinatura em uso" com o botão "Abrir Plano e chaves" e a nota "Nenhum perfil salvo em Plano e chaves: a assinatura em uso fica sem id estável e não entra em grupo nenhum."
- **C1Sincronizacao (item 15):** a seção ganha a lista "Aparelhos" (aparelho, versão, sistema, visto por último) e, logo abaixo, o botão "Administrar em Aparelhos".

### Testes

- Novos: `test/sync-telas-divergencias.test.js` (16, servidor HTTP real, banco e identidade falsos, `FAROL_HOME` temporário), `test/ui-pure-divergencias.test.js` (25) e `test/ui-telas-divergencias.test.js` (14).
- Vermelho antes do código, saídas preservadas: `tela-divergencias-vermelho-engine.txt` (16 de 16 reprovados), `-vermelho-pure.txt` (25 de 25), `-vermelho-telas.txt` (11 de 13; os dois verdes eram a guarda de admin, que já existia, e o vínculo, que a camada pura já entregava). O caso da resposta atrasada nasceu depois, como reforço da contraprova.
- Ajustes declarados em testes antigos: `contrato-telas` (o `deepEqual` do admin ganhou `ultimoBatimentoEm`), `local-auth-inventario` (69 para 71 rotas), `ui-pure-aparelhos` (a chave ligada passa a lista das nunca apagadas como o engine manda), `ui-pure-superficie` (seis nomes novos: `aparelhoPoliticaParaPublicar`, `aparelhosCampoSenhaModal`, `aparelhosResultadoDaLimpeza`, `syncOlhoDesenho`, `syncOlhoHtml`, `syncOlhoRotulo`).

### Contraprova por mutação

Script `verificacoes-saidas/tela-divergencias-mutacoes-script.mjs.txt`: 49 mutações, seis arquivos de teste, teto de 4 minutos cada, restauração conferida por SHA-256.

- Rodada 1 (`tela-divergencias-mutacoes-rodada1.txt`): 46 mortas, **3 inertes**, todas restauradas byte a byte. D22 (política que não se prova reaproveitada): os casos de inválida não traziam objeto de política; agora trazem. D40 (resposta atrasada desenhada): não havia duas aberturas; agora a leitura do primeiro chega depois de o segundo abrir. D47 (pendente nunca podado): o filtro puro escondia a falta da poda; agora o grupo chega, sai da lista aceita e o pendente não volta.
- Rodada 2 (`tela-divergencias-mutacoes-rodada2.txt`): **49 mortas, 0 inertes**, todas restauradas; `git status` limpo depois, fora os reforços, que foram para o commit `e169923`.

### Gates

Rodados no commit `e169923`, com as saídas em `verificacoes-saidas/tela-divergencias-{check,lint,test}.txt`:

| Comando | Resultado | Código |
|---|---|---|
| `npm run check` | sintaxe validada em 556 arquivos | 0 |
| `npm run lint` | sem regressão (baseline intocada) | 0 |
| `npm test` | 4155 testes, 4127 aprovados, 0 reprovados, 28 pulados | 0 |

A queda nativa do Node (3221226505) não apareceu, e a reprovação ambiental de RAM da seção 5 também não. `npm run eng` não foi rodado: mora no pre-push, e esta entrega não empurra nada.
