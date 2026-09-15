# Anexo C1: contrato de dados v2, cifragem e regras

**Natureza:** anexo **normativo** da spec `../2026-09-15-operacao-multidispositivo-design.md`, gerado a partir de `../../handoff/2026-09-15-operacao-multidispositivo/evidencias/02-c1-contrato-dados-cifragem.json` (campo `sintese`).

**Precedência:** a spec prevalece sobre este anexo. Cada seção lista, no topo, os trechos superados por decisões posteriores do dono. Campos inteiramente superados (decisões apresentadas, cortes, resumo, enxertos, recomendações não adotadas) **não** foram trazidos para cá e continuam só como histórico na evidência.

---

## Modelo de ameaça (`modelo_de_ameaca`)

> **Trechos superados neste campo, que NÃO valem.** Onde o texto abaixo divergir destes itens, vale a spec.
>
> - A linha "Outro processo local, outro app no Android ou página com DNS rebinding": o token por inicialização entregue no fragmento do endereço foi substituído pela A4 (pareamento por código, token em `localStorage`, cabeçalho `Authorization`) e pela C1a (allowlist de Host).
> - A linha "Aparelho perdido": `live/control/revokedBefore` está fora desta iniciativa (spec 9.2); a revogação disponível é a da C2.

- **ameaca:** Quem lê o banco sem saber a senha: export, colaborador no console, Admin SDK (que ignora as regras) ou regra publicada errada
- **protegido:** parcial
- **como:** Sobem em envelope AES-256-GCM:
  - título, URL, autor, relatório e resumo das revisões;
  - andamento, Panorama, Meus PRs com autoanálise e Precisa de você;
  - políticas, perfis e status dos aparelhos.
  
  Os identificadores novos são HMAC com K_id secreta.
  
  Continuam legíveis:
  - horários, custo e tokens por sessão;
  - tamanho aproximado (preenchimento de 256 bytes) e quantidade de itens;
  - deviceId, plataforma e versão;
  - os caminhos de coordenação com SHA-256 sem sal e o fingerprint sha256(head) (lib/sync/keys.js:28-52);
  - eventos de consumo legados não migrados (lib/sync/keys.js:71-78, lib/sync/outbox.js:79-90).
  
  O keyring permite ataque offline à senha.

- **ameaca:** Google ou quem opera o Firebase Authentication
- **protegido:** nao
- **como:** A senha vai no corpo do signInWithPassword (lib/sync/auth.js:68-73). Com ela e o keyring, deriva-se a KEK. Só uma frase separada, que nunca sai do aparelho, fecharia isso. A decisão 1 manteve a senha, e o slot 'pp' do keyring fica reservado.

- **ameaca:** Quem sabe a senha ou controla o e-mail da conta (a redefinição por e-mail é uma troca de senha)
- **protegido:** nao
- **como:** Abre o keyring, vira admin e liga e executa a limpeza. O desenho não finge o contrário, e a frase da tela diz isso.

- **ameaca:** Refresh token copiado sem o cache da chave (arquivo de credencial vazado ou cliente modificado)
- **protegido:** parcial
- **como:** Não lê conteúdo: só ciphertext. Não forja política, teto ou batimento, porque o aparelho confere a assinatura Ed25519.
  
  Não grava keyring, admin, revokedBefore ou lastCleanup, nem apaga pela limpeza. REC exige auth_time de login por senha com até 5 min, e renovar o token não muda auth_time (documentado). Depende do gate do operador *.
  
  Não apaga histórico, catálogo nem aparelhos, porque o .write do registro exige newData.exists(). Na variante A também não apaga consumo.
  
  Consegue, de forma cooperativa como hoje:
  - apagar operações vivas e pendências (só exibição);
  - sobrescrever índice, catálogo e Panorama com lixo bem formado, que o GCM detecta e que é regenerável;
  - rebaixar usageDaily;
  - apagar lease vivo;
  - apagar campos de exibição do aparelho;
  - atacar a senha offline.

- **ameaca:** Aparelho perdido com refresh token, cache da chave e chave privada de admin
- **protegido:** parcial
- **como:** A troca de senha expira os refresh tokens (documentado).
  
  Se o dono decidir, live/control/revokedBefore corta na regra os ID tokens ainda válidos por até 1 h.
  
  A rotação de K_enc protege o conteúdo futuro, e uma nova geração de admin invalida as assinaturas antigas.
  
  O que o cache já abriu não volta a ser protegido.

- **ameaca:** Aparelho na v2.59.x apertando 'Apagar dados sincronizados' (DELETE em /users/{uid}, lib/engine/sync.js:436-445)
- **protegido:** sim
- **como:** As regras v2 não têm .write em users/$uid nem acima. O DELETE é negado e vira toast, sem registrarFalha (lib/engine/sync.js:438-440).
  
  Antes da republicação, o conteúdo cifrado nem nasce, porque a sonda deixa a C1 dormente.

- **ameaca:** Cliente modificado reescrevendo custo ou apagando consumo, aparelhos ou histórico
- **protegido:** parcial
- **como:** Na variante A, o evento só aceita escrita com at, kind e costUsd iguais aos gravados. Remoção só pela LIMPA, ou de legado cuja cópia conservada já exista.
  
  Histórico usa corpos write-once por versão, e o registro do aparelho não pode ser apagado.
  
  Na variante B (se o emulador reprovar a A), um PUT no nó do aparelho substitui todos os eventos dele. É risco declarado.

- **ameaca:** Troca, adulteração ou tag truncada de ciphertext
- **protegido:** sim
- **como:** A AAD amarra uid, caminho lógico, campo, geração e esquema. Operações amarram também x, dev e t0, e o consumo amarra os números.
  
  A decifragem usa authTagLength 16 e confere 12 bytes de iv e 16 de tag antes de setAuthTag. Sem isso o Node aceita tag truncada (DEP0182, medido pela crítica).

- **ameaca:** Replay de envelope antigo no mesmo caminho
- **protegido:** parcial
- **como:** Nós permanentes são write-once por versão, então não há o que reescrever.
  
  Nos efêmeros de remoção livre (operações, pendências), o x dentro da AAD faz o envelope antigo aparecer vencido, e o leitor descarta r menor que o maior já visto. O impacto se limita à exibição.

- **ameaca:** Política, teto único ou batimento forjados por quem não é admin
- **protegido:** sim
- **como:** A assinatura Ed25519 da geração vigente é conferida antes de decifrar e aplicar.
  
  A regra recusa generation diferente da do admin, e beatAt fora de mais ou menos 60 s do relógio do servidor, o que barra o replay do batimento.
  
  Sem assinatura válida vale a configuração local.

- **ameaca:** Admin agindo sobre um aparelho que não autorizou
- **protegido:** sim
- **como:** A política só é aplicada com config.sync.aceitarAdmin ligado localmente. É um campo novo do saneador (lib/sync/config.js:67-78), fora de qualquer payload remoto e sem caminho de escrita a partir do banco.
  
  Nenhuma política toca chaves do gate de postagem nem config.json.

- **ameaca:** Dicionário de logins e owner/repo#n
- **protegido:** parcial
- **como:** Nos identificadores novos está protegido, porque o HMAC usa chave secreta.
  
  Não está protegido nos caminhos de coordenação (accountHash, prHash e fingerprint sem sal, mantidos para a frota mista) nem no consumo enviado sem a chave (eventId e refHash legados).

- **ameaca:** Ataque offline à senha a partir do keyring
- **protegido:** parcial
- **como:** scrypt N=16384 r=8 p=5, sal de 16 bytes por embrulho, com parâmetros e sal na AAD.
  
  O Firebase aceita senha de 6 caracteres por padrão (documentado), e uma senha curta cai mesmo assim. O piso de 12 caracteres para criar o embrulho fica para o dono decidir.

- **ameaca:** Outro processo local, outro app no Android ou página com DNS rebinding lendo 127.0.0.1 (GET /api/state e /api/events sem autenticação, lib/http-server.js:84-87 e 113-120)
- **protegido:** parcial
- **como:** Allowlist de Host (127.0.0.1:porta e localhost:porta) antes de qualquer rota, que derrota o rebinding.
  
  Com o compartilhamento ligado, exige-se também um token por inicialização. O Electron o recebe do processo principal; no navegador do celular, o lançador imprime o endereço com o token no fragmento, e ele fica fora de disco lido por terceiros.
  
  O alcance de outros apps ao loopback no Android é NÃO VERIFICADO.

- **ameaca:** Revisão paga em dobro por frota mista
- **protegido:** sim
- **como:** Na C1, v1 e v2 disputam o mesmo caminho legado de lease e recibo, e não há corte de coordenação. Migrar para tags fica para uma entrega com corte conduzido pelo servidor.

- **ameaca:** Limpeza com operação em curso
- **protegido:** parcial
- **como:** O servidor recusa a LIMPA enquanto existir live/operations.
  
  O cliente confere, com o token do ato, leases vivos (que cobrem a sessão v1), sessões locais e a outbox. A trava cleanupLock é honrada só pelas admissões v2.
  
  Um aparelho v1 que admita entre a checagem e o DELETE não é barrado, mas não perde dado.

- **ameaca:** Título e autor de PR de colegas no Firebase pessoal
- **protegido:** parcial
- **como:** Sobem só cifrados (decisão 1).

---

## Gestão de chave (`gestao_de_chave`)

> **Trechos superados neste campo, que NÃO valem.** Onde o texto abaixo divergir destes itens, vale a spec.
>
> - "TROCA DE SENHA" e "PERDA DA SENHA": valem na forma do ciclo de recuperação de CT-ENV (três situações), inclusive a regra de nunca apagar o cache quando a credencial do Firebase fica inválida e de manter a época antiga intacta.
> - "APARELHO PERDIDO", passo 3 (gravar `revokedBefore`): fora da iniciativa.

MATERIAL (só node:crypto):
- **K_id**: 32 bytes de randomBytes, estável por época de chave. Serve só como chave HMAC dos identificadores e não gira numa rotação comum, para o histórico continuar ligável.
- **K_enc[gN]**: 32 bytes aleatórios por geração (g1, g2...). Não deriva de K_id, para a rotação valer contra um cache vazado.
- **K_adm**: par Ed25519 (crypto.generateKeyPair('ed25519')), que nasce e mora só no aparelho admin. A chave pública sobe em live/control/admin.
- **KEK**: crypto.scrypt ASSÍNCRONO, no threadpool, nunca scryptSync no event loop do engine. Entrada: a senha como digitada, em UTF-8. Sal de 16 bytes por embrulho e saída de 32 bytes, com N=16384, r=8, p=5. É a linha equivalente da tabela OWASP, com cerca de 16 MiB, e cabe no maxmem padrão do Node. A crítica mediu 91 a 95 ms no desktop; no Termux é NÃO MEDIDO e precisa ser medido antes da release. Se passar de 3 s, cai para N=8192, r=8, p=10, também da tabela. Parâmetros e sal ficam no embrulho, então mudam sem migração.

KEYRING (users/{uid}/keyring, nó único):
{v:1, rev, updatedAt, epochSince, cur:'g2', kids:{g1:criadoEm}, kcv:{g1:'<16 hex>'}, slots:{pw:{kdf:{alg:'scrypt',N,r,p,salt}, blob:'w1.<iv>.<ct>.<tag>', by:<deviceId>}}}
- **blob**: AES-256-GCM(KEK, iv de 12 bytes, JSON {v:1, id:K_id, enc:{g1,g2}}), com authTagLength 16. A AAD é 'farol|wrap|1|<uid>|pw|scrypt|<N>|<r>|<p>|<salt>|<rev>', então trocar custo ou sal no banco invalida o embrulho.
- **kcv[g]**: 16 primeiros hex de HMAC-SHA256(K_enc[g], 'farol|kcv'). Prova, sem senha, que o cache local confere com o banco.
- Senha errada gera tag GCM inválida.
- O slot 'pp' aceita frase separada no futuro, sem migração.

CRIAÇÃO:
1. Só depois de signInWithPassword responder ok (lib/sync/auth.js:68-88), o que garante que senha errada nunca embrulha nada.
2. Com o idToken desse login, GET com ETag e PUT com if-match null_etag e rev 1.
3. 412 quer dizer que outro aparelho criou antes: relê, abre o embrulho do vencedor e descarta as próprias chaves, que ainda não cifraram nada.

Keyring ausente depois de já ter sido visto por este aparelho NUNCA é recriado sozinho. Vira o estado 'chave do conjunto perdida', com saída explícita e senha.

CACHE LOCAL: ~/.farol/sync-key.json. Fica em HOME, fora do config.json e fora de state/, que é o cwd das sessões.
- Gravação atômica com chmod 0600 em TODA gravação, no molde de lib/sync/credentials.js:20-33.
- Conteúdo: {v, uid, destino (outboxTarget, lib/sync/outbox.js:149-153), keyringRev, cur, id, enc, savedAt}. uid ou destino diferente descarta o cache.
- O boot só lê o arquivo: sem scrypt e sem rede, preservando lib/engine/sync.js:139-153.
- A cada conexão confere o kcv. Se divergir, descarta o cache e pede a senha; nunca cifra com chave fora do conjunto.
- 'Sair deste aparelho' apaga credencial e cache. Desligar não apaga nenhum dos dois (lib/engine/sync.js:242-251 e 400-405).

Chave privada de admin: ~/.farol/sync-admin.json, modo 0600, com {uid, destino, generation, jwk}. É apagada quando a geração muda.

Chaves e senha nunca vão para config, snapshot, log, toast, state/ ou resposta de rota. A senha é descartada logo depois do uso, mas não se promete apagá-la da memória: ela passa por string JS imutável (lib/sync/auth.js:72).

APARELHO LOGADO ANTES DA FEATURE (tem refresh token, não tem senha): com o compartilhamento ligado, fica 'bloqueado neste aparelho' e opera exatamente no modo legado até a pessoa digitar a senha uma vez.
- A rota nova POST /api/sync/unlock {password} usa o e-mail já guardado (lib/sync/credentials.js:35-42).
- Ela faz signInWithPassword, grava o refresh token novo e abre ou cria o keyring.

TROCA DE SENHA:
1. Os refresh tokens expiram (documentado), e cada aparelho cai em credencial_invalida, que já é permanente (lib/engine/sync.js:36-44).
2. No login com a senha nova o embrulho antigo não abre. O primeiro aparelho com cache válido (kcv confere, keyringRev igual ao do banco) reembrulha com sal novo, rev+1 e o token desse login.
3. Sem cache em lugar nenhum, pede UMA vez a senha anterior. Ela só roda no scrypt local e não vai ao Google.

PERDA DA SENHA: a redefinição por e-mail recupera, se algum aparelho tiver cache. Sem nenhum, o ato explícito 'Gerar chave nova', com senha:
- cria K_id e K_enc novas;
- grava epochSince;
- deixa o conteúdo antigo retido e marcado 'cifrado com chave indisponível'.

Consumo e coordenação seguem. A outbox nunca reenfileira, com id novo, sessão anterior a epochSince.

ROTAÇÃO: g(n+1) aleatória, com cur trocado e rev+1. As gerações antigas ficam para ler o histórico; nada é recifrado em massa.

APARELHO PERDIDO:
1. Trocar a senha.
2. Reembrulhar num aparelho confiável.
3. Gravar revokedBefore, se o dono decidir.
4. Rotacionar K_enc.
5. Se o perdido era admin, emitir nova geração de admin.

---

## Envelope cifrado (`envelope_cifrado`)

> **Trechos superados neste campo, que NÃO valem.** Onde o texto abaixo divergir destes itens, vale a spec.
>
> - O esquema `prof1` (perfis por `profileTag`) é substituído pelo esquema do grupo de consumo (CT-GRUPO). O dado autenticado do candidato inclui `orgTag` (S3-4).

FORMATO: string única 'e1.<kid>.<iv>.<ct>.<tag>', em base64url sem preenchimento.
- **kid**: 'g' + dígitos.
- **iv**: 12 bytes de randomBytes, nunca reusado.
- **tag**: 16 bytes.

Cifra e decifra com createCipheriv e createDecipheriv('aes-256-gcm', K_enc[kid], iv, { authTagLength: 16 }). Antes de setAuthTag, confere que o iv decodifica em 12 bytes e a tag em 16.

AAD (UTF-8, ordem fixa): 'farol|e1|<uid>|<caminho lógico relativo a users/uid>|<campo>|<kid>|<esquema>'.
- live/operations acrescenta '|<x>|<dev>|<t0>', então um envelope antigo regravado com x novo falha.
- usageEvents v2 acrescenta at|kind|costUsd|inputTokens|outputTokens|cacheReadTokens|cacheCreationTokens|costSource|pf.
- recentReviews acrescenta t|d.

Mover o envelope para outro nó, uid ou campo, ou trocar o kid, falha no GCM.

TEXTO CLARO:
- JSON {s: esquema, v:1, r: revisão monotônica do item, ...campos da allowlist}.
- Esquemas: pr1, op1, pend1, idx1, body1, pano1, mypr1, self1, dev1, pol1, prof1, use1.
- Completado com espaços até múltiplo de 256 bytes.
- SEM compressão: a decisão 9 fecha em node:crypto, e o relatório mistura texto de terceiros, então o tamanho comprimido vazaria conteúdo.
- Projeções saem das allowlists existentes (decisionForUi, lib/engine/public-review.js:396-442), nunca de objeto serializado inteiro. quality da autoanálise nunca sobe.

LEITURA, FALHA FECHADA: o item inteiro é descartado em qualquer destes casos:
- prefixo errado ou kid desconhecido;
- iv ou tag com tamanho errado;
- tag inválida ou JSON inválido;
- esquema diferente do esperado para o caminho;
- r menor que o maior r visto para o mesmo caminho.

O item descartado é contado como 'não verificável' no Diagnóstico, fica fora do orçamento e de qualquer decisão, e nunca aparece como texto parcial.

TETOS (caracteres da string final): quem cifra serializa, preenche, calcula o base64url e só então compara. Um teste de fronteira usa relatório cheio de quebras de linha.

| nó | teto |
|---|---|
| live/operations | 2048 |
| live/pending | 4096 |
| live/deviceStatus | 2048 |
| live/devicePolicies | 2048 |
| live/profiles | 1024 |
| catalog | 2048 |
| recentReviews | 1024 |
| reviewBodies | 48000 (relatório cortado antes, com truncated: true; o típico medido é 5,2 KB, lib/engine/decision.js:93-99) |
| panorama | 2048 |
| myPrs | 8192 |
| selfAnalyses | 48000 |
| usageEvents | 1024 |

Na regra, ENC(n) = newData.child('enc').isString() && newData.child('enc').val().matches(/^e1[.]g[0-9]+[.][A-Za-z0-9_-]+[.][A-Za-z0-9_-]+[.][A-Za-z0-9_-]+$/) && newData.child('enc').val().length <= n. Usa só + e classes, porque o quantificador {n} não está confirmado. O .length é item do emulador; se não valer, o teto fica só no cliente.

CATÁLOGO: catalog/{prTag} = {v:2, u, enc}, com enc {key 'owner/repo#n', url, title até 300, author, repo, number, isDraft}.
- Quem conhece o PR regrava quando o texto claro muda; vale a última escrita, pelo r.
- É regenerável: o corpo de cada revisão carrega a própria referência do PR.
- Leitura por GET pontual com LRU de 500 entradas em memória, sem cópia decifrada em disco.

ASSINATURA (políticas, perfis, chave de limpeza e batimento): Ed25519.
- Sobre 'farol|sig|1|<uid>|<caminho>|<generation>|' + sha256hex(enc ou valor canônico).
- O batimento assina 'farol|beat|1|<uid>|<dev>|<generation>|<beatAt>'.
- sig tem 86 caracteres.
- A assinatura é conferida com a chave pública da geração vigente antes de decifrar.

---

## Identificadores e migração (`identificadores_e_migracao`)

> **Trechos superados neste campo, que NÃO valem.** Onde o texto abaixo divergir destes itens, vale a spec.
>
> - **`profileTag` derivado de e-mail ou de hash de chave: superado.** A identidade de consumo é o grupo explícito de CT-GRUPO (S3-1).
> - No evento v2, o campo `pf: profileTag` é substituído pelo identificador do grupo de consumo, quando houver vínculo.
> - "MIGRAÇÃO DO LEGADO", os três casos de "Correção de desfecho" que falam de sessão migrada e "Corte e lista de migrados": **sem migração automática** de eventos legados (spec 9.2). Eventos antigos ficam identificados como legado.
> - Domínio novo `org` para `orgTag` (S3-4), com a mesma construção HMAC.

PRINCÍPIO: sal público não resolve contra dicionário, porque quem lê o banco lê o sal junto. O 'sal' é a chave secreta K_id:
- tag(domínio, valor) = hex(HMAC-SHA256(K_id, 'farol' NUL 'v2' NUL domínio NUL valor)), cortado em 32 hex (128 bits);
- tag64 é o hex inteiro, com 64 caracteres;
- tudo passa em assertRtdbKey (lib/sync/keys.js:84-90).

TAGS:
- **acctTag** = tag('acct', login.trim().toLowerCase()).
- **prTag** = tag('pr', canonicalPrKey), a mesma normalização de lib/sync/keys.js:32-36.
- **scopeTag** = acctTag da conta monitorada.
- **profileTag** = tag('profile', 'claude' NUL e-mail do oauthAccount em minúsculas | 'apikey' NUL sha256(chave) | 'openrouter' NUL sha256(chave) | 'codex' NUL conta). É derivado e nunca gravado no config: dá identidade estável entre aparelhos sem reescrever o id sorteado no front (ui/app.js:574-576). Reescrever esse id quebraria resolveClaudeAuth, que cai calado no diretório legado (server.js:1563-1572). O e-mail já é lido em server.js:1628-1638; sem e-mail, profileTag fica vazio.
- **reviewId** = tag('review', deviceId NUL id local da decisão), sobre lib/engine/decision.js:21. Determinístico, portanto idempotente.
- **itemId** = tag('pending', deviceId NUL id).
- **opId** = 16 bytes de randomBytes em hex. O 'a' + sessionSeq (lib/engine/review.js:1113) reinicia a cada boot e colidiria entre aparelhos.
- **deviceId** continua o UUID de lib/sync/device.js.

(a) FROTA MISTA: A COORDENAÇÃO NÃO MUDA DE CAMINHO NA C1.
leases/{accountHash}/{prHash}, receipts/{accountHash}/{prHash}/{fingerprint} e dailyRounds/{accountHash}/{prHash}/{dia} continuam com SHA-256 sem sal (lib/sync/keys.js:28-52). O caminho É a exclusão mútua (lib/sync/lease.js:18-20, lib/sync/receipts.js:20-26, lib/sync/rounds.js:24-30): um v2 com HMAC e um v1 com SHA-256 se dariam por sozinhos e pagariam a mesma análise duas vezes.

Com o compartilhamento ligado, muda só o corpo:
- lease.headSha vai ''. buildLease já aceita (lib/sync/lease.js:43), e só lib/sync/coordinator.js:177 escreve esse campo.
- receipt.materialVersion vai 'h1:' + tag('mat', materialVersion). O campo é exigido pela regra (firebase/database.rules.json:27), mas receiptBlocks e receiptOrphanState não o leem (lib/sync/receipts.js:48-66).

O fingerprint do caminho continua sha256(materialVersion) cortado (lib/sync/keys.js:47-52), para o v1 enxergar o recibo do v2. Por isso a tela declara que o commit é casável.

Migrar a coordenação para tags é outra entrega. Ela só pode cortar quando uma sonda provar regras v3 que recusam escrita legada, e precisa de dupla aquisição (legado, depois novo) até lá. Uma bandeira do admin abriria a janela de análise em dobro, e a regra v3 travaria outbox v1 com pendências.

(a) CONSUMO: o eventId legado é tão reversível quanto o refHash. A pré-imagem de eventIdFor (lib/sync/keys.js:71-78) tem deviceId (no caminho, lib/sync/outbox.js:133), at, kind, model, tokens e custo (em claro, lib/sync/outbox.js:79-90) e o localId 'a' + contador. A única incógnita é o ref, que se enumera. Anular refHash não fecha nada: só trocar a chave fecha.

Evento v2 (sessão nova de aparelho desbloqueado):
- chave = tag64('event', mesma pré-imagem), mantendo EVENT_ID_RE (lib/sync/outbox.js:17);
- em claro: {v:2, at, day, kind, costUsd, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, costSource, status, farolVersion, pf: profileTag}, com esses campos amarrados na AAD;
- cifrado: {acctTag, prTag, model, localId};
- accountHash, refHash, profileId e localId em claro deixam de existir.

O consolidado v1 soma só at, day, custo, tokens e costSource (lib/sync/consolidated.js:47-68), então não perde nem duplica. Aparelho bloqueado envia exatamente o formato v1.

MIGRAÇÃO DO LEGADO (se o dono aceitar): ato explícito por aparelho, nunca efeito de update (docs/PLANO-SINCRONIZACAO-DISPOSITIVOS.md:50). Vale só para os PRÓPRIOS eventos que têm sessão no log local permanente (lib/engine/usage.js:201). É feita em lotes, retomável e idempotente, com três pedidos por evento e nenhum PATCH multi-caminho:
1. PUT, com if-match null_etag, da cópia v2 em tag64('legacy', legacyId), refeita a partir da sessão local.
2. PUT de usageEvents/{dev}/{legacyId}/migratedTo com a chave nova.
3. DELETE do legado. A regra só aceita se a cópia JÁ gravada, lida por data.parent() no estado anterior, tiver at, kind e costUsd iguais.

Correção de desfecho (lib/engine/usage.js:136-144):
- sessão já migrada usa tag64('legacy', legacyId);
- sessão anterior ao corte e não migrada usa o legado;
- sessão posterior ao corte usa tag64('event', ...).

Corte e lista de migrados ficam em ~/.farol/sync-migracao.json. Eventos de aparelho antigo ou aposentado ficam, e a tela conta quantos carregam identificador legado. O valor nunca some.

---

## Nós do banco (`nos`)

> **Trechos superados neste campo, que NÃO valem.** Onde o texto abaixo divergir destes itens, vale a spec.
>
> - `live/control/beat`: o vencimento "beatAt + 360 s pelo relógio corrigido pelo desvio" é substituído pela regra de frescor de CT-ADM-POL (mudança de sequência observada pelo relógio local). O batimento da C2 é a **autoridade do admin**; a prontidão do distribuidor é sinal separado, da C5.
> - `live/control/revokedBefore`: fora da iniciativa.
> - `live/profiles/{profileTag}`: substituído por `live/groups/{grupo}` (CT-GRUPO).
> - `live/deviceStatus`: "perfis (profileTag)" passa a ser "grupos de consumo vinculados" e ganha o resumo da admissão local (reserva, fila, execução) de CT-ADM.
> - `usageDaily`: o rollup é por grupo de consumo, não por `profileTag`.
> - `usageEvents`, variante A: a cláusula de remoção de legado por `migratedTo` não se aplica (sem migração).
> - `live/devicePolicies`: "batimento vivo" passa a ser "autoridade fresca" (CT-ADM-POL).
> - `live/queue, live/commands, commandReceipts, checkpoints`: `live/queue` e `live/assignments` pertencem à C5; o registro de postagem de CT-POST mora no recibo da operação.

- **caminho:** users/{uid}
- **proposito:** Raiz da árvore do usuário: aqui só a leitura é concedida.
- **quem_escreve:** Ninguém escreve na raiz.
- **cifrado:** não se aplica
- **retencao:** não se aplica
- **regra:** '.read': U && NR
  
  Sem '.write': hoje ele está em firebase/database.rules.json:6. O DELETE da v2.59.x (lib/engine/sync.js:439) passa a 401, e todo nó sem concessão é negado.
- **leitura:** Streams e GETs dos filhos, como hoje.
- **novo_ou_existente:** existente-alterado

- **caminho:** users/{uid}/keyring
- **proposito:** Guarda K_id e K_enc embrulhadas pela KEK da senha.
- **quem_escreve:** Um aparelho com login por senha recente, em três momentos: criação, reembrulho e rotação.
- **cifrado:** blob é cifrado; v, rev, cur, kids, kcv e kdf ficam em claro.
- **retencao:** Permanente. Não há remoção pela API e a limpeza protegida não o alcança.
- **regra:** '.write': U && NR && REC && H(['v','rev','updatedAt','epochSince','cur','kids','kcv','slots'])
    && newData.child('rev').isNumber()
    && ((!data.exists() && newData.child('rev').val() == 1) || newData.child('rev').val() == data.child('rev').val() + 1)
    && newData.child('updatedAt').val() <= now + 60000
    && newData.child('updatedAt').val() + 60000 > now
  
  É a única concessão da subárvore, então escrita parcial num filho não sobe o rev e é recusada.
  
  Filhos:
  - slots/$s com $s.matches(/^(pw|pp)$/);
  - blob isString;
  - $other .validate false.
- **leitura:** GET com ETag só no login, no desbloqueio e no reembrulho.
- **novo_ou_existente:** novo

- **caminho:** users/{uid}/live/control/admin
- **proposito:** Diz qual aparelho é o admin (o agendador), a geração e a chave pública Ed25519.
- **quem_escreve:** O próprio aparelho que se torna admin, logo depois de reautenticar com a senha.
- **cifrado:** não (deviceId aleatório, generation, publicKey de 43 caracteres, setAt)
- **retencao:** Permanente, sobrescrito a cada nova geração.
- **regra:** '.write': U && NR && REC && H(['deviceId','generation','publicKey','setAt'])
    && newData.child('publicKey').isString()
    && ((!data.exists() && newData.child('generation').val() == 1) || newData.child('generation').val() == data.child('generation').val() + 1)
  
  Não há remoção.
- **leitura:** Stream SSE único em /users/{uid}/live.
- **novo_ou_existente:** novo

- **caminho:** users/{uid}/live/control/beat
- **proposito:** Batimento do agendador. Quando vence (beatAt + 360 s), cada aparelho volta à configuração local e à revisão automática por lease (decisão 5).
- **quem_escreve:** O admin vigente, a cada 120 s, com assinatura.
- **cifrado:** não: {dev, generation, beatAt, sig}
- **retencao:** Sobrescrito a cada batimento.
- **regra:** '.write': U && NR && H(['dev','generation','beatAt','sig'])
    && GEN
    && newData.child('dev').val() == C.child('admin').child('deviceId').val()
    && newData.child('beatAt').isNumber()
    && newData.child('beatAt').val() + 60000 > now
    && newData.child('beatAt').val() < now + 60000
  
  Não há remoção.
- **leitura:** Stream live. O leitor confere a assinatura e compara com o relógio corrigido pelo desvio (lib/engine/sync.js:295-296).
- **novo_ou_existente:** novo

- **caminho:** users/{uid}/live/control/cleanup
- **proposito:** Chave 'Permitir limpeza de dados sincronizados'. Ausente conta como desligada.
- **quem_escreve:** O admin, sem senha (decisão 7), com assinatura.
- **cifrado:** não: {enabled, generation, rev, sig}
- **retencao:** Permanente.
- **regra:** '.write': U && NR && H(['enabled','generation','rev','sig'])
    && newData.child('enabled').isBoolean()
    && GEN
  
  A chave sozinha não apaga nada: a LIMPA exige também REC.
- **leitura:** Stream live. O botão só aparece com assinatura válida.
- **novo_ou_existente:** novo

- **caminho:** users/{uid}/live/control/cleanupLock e live/control/lastCleanup
- **proposito:** cleanupLock: trava cooperativa durante o ato de limpeza. lastCleanup: corte da outbox depois da limpeza.
- **quem_escreve:** O admin, durante o ato, com o token do login do próprio ato.
- **cifrado:** não: lock {dev, x}; lastCleanup {at, dev, categorias}
- **retencao:** A trava vence em 10 min e é apagada no fim. lastCleanup é sobrescrito.
- **regra:** cleanupLock:
  '.write': U && NR && (!newData.exists() || (REC && C.child('cleanup').child('enabled').val() == true && H(['dev','x']) && newData.child('x').val() <= now + 600000))
  
  lastCleanup:
  '.write': U && NR && REC && H(['at','dev','categorias'])
- **leitura:** Stream live. Aparelho v2 recusa admissão nova com a trava viva, e a outbox v2 só envia sessão com at maior que o corte.
- **novo_ou_existente:** novo

- **caminho:** users/{uid}/live/control/revokedBefore
- **proposito:** Corte de sessões: token com auth_time anterior deixa de ler e de escrever. Só entra se o dono decidir.
- **quem_escreve:** Um aparelho com login recente, no fluxo 'aparelho perdido', depois da troca de senha.
- **cifrado:** não (número em segundos)
- **retencao:** Permanente; o valor só cresce.
- **regra:** '.write': U && NR && REC && newData.isNumber()
    && newData.val() < auth.token.auth_time
    && (!data.exists() || newData.val() >= data.val())
- **leitura:** Lido pela própria regra (NR).
- **novo_ou_existente:** novo

- **caminho:** users/{uid}/devices/{deviceId}
- **proposito:** Presença, como hoje. Com o compartilhamento ligado ganha contract (2) e keyReady.
- **quem_escreve:** O próprio aparelho: PATCH a cada 5 min e PUT de createdAt (lib/engine/sync.js:274-298).
- **cifrado:** Não. Com o compartilhamento ligado, o hostname não sobe; a forma do nome depende da decisão do dono.
- **retencao:** Permanente. Só a limpeza protegida remove.
- **regra:** devices: '.write': U && NR && LIMPA
  $device: '.write': U && NR && (newData.exists() || LIMPA)
  
  Novos filhos:
  - contract: '.validate': newData.isNumber()
  - keyReady: '.validate': newData.isBoolean()
  
  Nenhuma validação em name, platform, farolVersion, lastSeenAt ou createdAt. É a regra de ouro: lastSeenAt sobe como {'.sv':'timestamp'}.
- **leitura:** GET na janela de presença, como hoje (lib/engine/sync.js:314-323).
- **novo_ou_existente:** existente-alterado

- **caminho:** users/{uid}/live/deviceStatus/{deviceId}
- **proposito:** Capacidade e telemetria do aparelho.
  
  Conteúdo: nome escolhido, contas cobertas (acctTag), token presente, IA pronta, perfis (profileTag), paralelismo efetivo, RAM livre resumida, aceitarAdmin (espelho informativo) e keyReady.
- **quem_escreve:** O próprio aparelho, no tick de presença e só quando algo muda. Cooperativo.
- **cifrado:** enc é cifrado; v e u ficam em claro.
- **retencao:** Sobrescrito. Só a limpeza protegida remove.
- **regra:** '.write': U && NR && ((H(['v','u','enc']) && ENC(2048)) || LIMPA)
- **leitura:** Stream live.
- **novo_ou_existente:** novo

- **caminho:** users/{uid}/live/devicePolicies/{deviceId}
- **proposito:** Política por aparelho: prioridade, teto 1 a 4, pausa, contas elegíveis (acctTag) e tipos de operação.
- **quem_escreve:** O admin, com assinatura.
- **cifrado:** enc é cifrado; v e generation ficam em claro, junto com a assinatura.
- **retencao:** Sobrescrito. Só a limpeza protegida remove.
- **regra:** '.write': U && NR && ((H(['v','generation','enc','sig']) && GEN && ENC(2048)) || LIMPA)
  
  Para aplicar, o aparelho exige:
  - aceitarAdmin ligado localmente;
  - assinatura válida;
  - batimento vivo;
  - chaves dentro da allowlist;
  - o clamp local de lib/engine/review.js:426-429.
- **leitura:** Stream live.
- **novo_ou_existente:** novo

- **caminho:** users/{uid}/live/profiles/{profileTag}
- **proposito:** Valor do teto único por assinatura: budgetDaily, budgetTotal, budgetSince, budgetByWeekday e budgetDates.
- **quem_escreve:** O admin, com assinatura.
- **cifrado:** enc é cifrado, junto com a assinatura.
- **retencao:** Permanente. Só a limpeza protegida remove.
- **regra:** '.write': U && NR && ((H(['v','generation','enc','sig']) && GEN && ENC(1024)) || LIMPA)
- **leitura:** Stream live.
  
  O número vale só com aceitarAdmin e batimento vivo; fora disso vale o teto local.
  
  O gasto contado é sempre o do conjunto: gasto local mais usageDaily do dia dos outros aparelhos com o mesmo profileTag, mais a reserva das operações vivas desse perfil.
- **novo_ou_existente:** novo

- **caminho:** users/{uid}/live/operations/{opId}
- **proposito:** Andamento ao vivo de review, self e pushback.
  
  Conteúdo: etapa num vocabulário único mapeado em lib/sync (a partir de stageOfLine, lib/engine/review.js:1011-1026; a autoanálise, sem etapa, lib/engine/selfpr.js:1090, aparece como desconhecido e sem percentual), tempo por etapa, subagentes, modelo, prTag e acctTag.
  
  Nunca sobe linha de feed, caminho, comando ou prosa (lib/engine/session.js:643-651).
- **quem_escreve:** O executor, em PUT coalescido fora do onEvent: mínimo de 10 s entre escritas, renovação a cada 60 s e DELETE ao terminar.
  
  Só publica se houver outro aparelho com contract 2 e keyReady visto nas últimas 24 h.
- **cifrado:** enc é cifrado; v, dev, t0 e x ficam em claro e amarrados na AAD.
- **retencao:** TTL curto: x = agora + 150 s. Vencida, aparece como 'interrompida em <aparelho>' e qualquer aparelho pode apagar.
- **regra:** '.write': U && NR && (
    !newData.exists()
    || (H(['v','dev','t0','x','enc'])
        && $op.matches(/^[0-9a-f]+$/)
        && newData.child('x').isNumber()
        && newData.child('x').val() > now
        && newData.child('x').val() <= now + 300000
        && ENC(2048)
        && (!data.exists() || (newData.child('dev').val() == data.child('dev').val() && newData.child('t0').val() == data.child('t0').val())))
  )
  
  A remoção é livre e cooperativa: afeta só a exibição.
- **leitura:** Stream live. O motor emite o delta como evento SSE 'sync-live', nunca como pushState, e o tempo corre no ticker local.
- **novo_ou_existente:** novo

- **caminho:** users/{uid}/live/pending/{itemId}
- **proposito:** Precisa de você em todos os aparelhos. Na C1 é só visível: a ação acontece só no aparelho dono, porque o dedup de postagem é por processo (lib/engine/decision.js:661-682).
- **quem_escreve:** O aparelho que tem a decisão local. Cria o item e o apaga quando a pendência resolve.
- **cifrado:** enc (até 4096) com prTag, acctTag, veredito, motivos com kind e bloqueio; at e dev ficam em claro.
- **retencao:** Só enquanto está aberta. O histórico definitivo vai para recentReviews.
- **regra:** '.write': U && NR && (
    !newData.exists()
    || (H(['v','at','dev','enc'])
        && $i.matches(/^[0-9a-f]+$/)
        && ENC(4096)
        && (!data.exists() || (newData.child('at').val() == data.child('at').val() && newData.child('dev').val() == data.child('dev').val())))
  )
  
  A remoção é cooperativa.
- **leitura:** Stream live. Todo aparelho notifica pendência nova que ainda não tenha visto.
- **novo_ou_existente:** novo

- **caminho:** users/{uid}/live/seen/{itemId}
- **proposito:** Visto sincronizado: o primeiro visto cala a notificação nos outros aparelhos (decisão 4).
- **quem_escreve:** Qualquer aparelho, uma vez só. Não precisa de chave.
- **cifrado:** não: {at, dev}
- **retencao:** Apagável quando a pendência não existe mais, num pedido separado depois dela, ou com 30 dias.
- **regra:** '.write': U && NR && (
    (!data.exists() && H(['at','dev']) && newData.child('at').isNumber() && newData.child('at').val() <= now + 60000)
    || (!newData.exists() && (!root.child('users').child($uid).child('live').child('pending').child($i).exists() || data.child('at').val() + 2592000000 < now))
  )
- **leitura:** Stream live.
- **novo_ou_existente:** novo

- **caminho:** users/{uid}/live/rev/{recentReviews|panorama|myPrs}/{deviceId ou scopeTag}
- **proposito:** Ponteiros pequenos: dizem que um nó grande mudou.
- **quem_escreve:** Quem escreve o nó grande correspondente.
- **cifrado:** não (número)
- **retencao:** Sobrescrito.
- **regra:** '.write': U && NR && newData.isNumber()
  
  Isso impede remoção.
- **leitura:** Stream live. Quando o ponteiro muda, o aparelho faz GET incremental do nó grande.
- **novo_ou_existente:** novo

- **caminho:** users/{uid}/catalog/{prTag}
- **proposito:** Catálogo cifrado que nomeia qualquer PR em qualquer aparelho.
- **quem_escreve:** Qualquer aparelho desbloqueado que conhece o PR, só quando o texto claro muda.
- **cifrado:** enc (até 2048): key, url, title, author, repo, number, isDraft.
- **retencao:** Permanente e regenerável. Só a limpeza protegida remove.
- **regra:** catalog: '.write': U && NR && LIMPA
  $pr: '.write': U && NR && ((H(['v','u','enc']) && $pr.matches(/^[0-9a-f]+$/) && ENC(2048)) || LIMPA)
- **leitura:** GET pontual por prTag, com LRU de 500 entradas em memória.
- **novo_ou_existente:** novo

- **caminho:** users/{uid}/recentReviews/{reviewId}
- **proposito:** Índice das Revisões recentes com filtro por aparelho.
- **quem_escreve:** O aparelho que revisou: ao resolver e a cada mudança de status.
- **cifrado:** enc (até 1024): veredito, status, ação, contagens e prTag. Em claro: v, t, d e dt, sendo dt = deviceId + '|' + t com 13 dígitos.
- **retencao:** Permanente. Só a limpeza protegida remove.
- **regra:** '.indexOn': ['t','dt'], num nó fixo e não sob curinga.
  
  recentReviews: '.write': U && NR && LIMPA
  $r: '.write': U && NR && (
    (H(['v','t','d','dt','enc'])
      && $r.matches(/^[0-9a-f]+$/)
      && newData.child('t').isNumber()
      && ENC(1024)
      && (!data.exists() || (t, d e dt iguais aos gravados)))
    || LIMPA
  )
- **leitura:** - Todos os aparelhos: GET com orderBy t e limitToLast=30.
  - Um aparelho: orderBy dt, startAt '<dev>|', endAt '<dev>|~' e limitToLast=30.
  - Novidade: ponteiro mais startAt <último t + 1>.
  
  O resultado vem sem ordem, então ordena no cliente. Índice ilegível cai no corpo.
- **novo_ou_existente:** novo

- **caminho:** users/{uid}/reviewBodies/{reviewId}/{versao}
- **proposito:** Corpo da revisão a partir de decisionForUi: review humanizado, motivos, etapas, checkpoint e a referência do PR na hora.
- **quem_escreve:** O aparelho que revisou. Toda mudança de status cria uma versão nova.
- **cifrado:** enc (até 48000)
- **retencao:** Permanente e write-once por versão. Só a limpeza protegida remove.
- **regra:** reviewBodies e $r: '.write': U && NR && LIMPA
  $r/$v: '.write': U && NR && (
    (!data.exists() && H(['v','enc']) && $v.matches(/^[0-9]+$/) && ENC(48000))
    || LIMPA
  )
- **leitura:** GET sob demanda ao abrir a revisão. Vale a maior versão que decifra.
- **novo_ou_existente:** novo

- **caminho:** users/{uid}/panorama/{scopeTag}_{prTag} e panoramaMeta/{scopeTag}
- **proposito:** Panorama por conta monitorada, uma linha por PR.
- **quem_escreve:** Um publicador por conta. O meta é disputado por CAS com ETag e vale 15 min sem renovação.
  
  O publicador escreve só as linhas cujo ctag (HMAC do texto claro) mudou, por PUT na linha. PR que sai vira tombstone del.
  
  Só publica com outro aparelho v2 visto nas últimas 24 h.
- **cifrado:** enc (até 2048): key, título, autor, rascunho, selos. Em claro: su (scopeTag + '|' + u com 13 dígitos), u, del e ctag.
- **retencao:** Projeção regenerável. O tombstone pode ser apagado 24 h depois.
- **regra:** '.indexOn': ['su'] em panorama.
  
  panorama: '.write': U && NR && LIMPA
  $item: '.write': U && NR && (
    (H(['v','su','u','ctag']) && newData.child('u').isNumber() && (newData.child('del').val() == true || ENC(2048)))
    || (!newData.exists() && data.child('del').val() == true && data.child('u').val() + 86400000 < now)
    || LIMPA
  )
  
  panoramaMeta/$scope: '.write': U && NR && ((H(['dev','x']) && newData.child('x').val() <= now + 1200000) || LIMPA)
- **leitura:** Ponteiro no stream, depois GET com orderBy su, startAt '<scope>|<último u + 1>' e endAt '<scope>|~'. Só com a aba aberta.
- **novo_ou_existente:** novo

- **caminho:** users/{uid}/myPrs/{scopeTag}_{prTag} e myPrsMeta/{scopeTag}
- **proposito:** Meus PRs, com estado de merge e ponteiro para a autoanálise. O botão Merge nunca é habilitado por dado remoto.
- **quem_escreve:** O publicador da conta, com o mesmo esquema do Panorama.
- **cifrado:** enc (até 8192)
- **retencao:** Igual ao Panorama.
- **regra:** Igual ao Panorama, com ENC(8192) e '.indexOn': ['su'].
- **leitura:** Igual ao Panorama.
- **novo_ou_existente:** novo

- **caminho:** users/{uid}/selfAnalyses/{prTag}/{versao}
- **proposito:** Parecer bruto da autoanálise e observed resumido. quality continua derivado.
- **quem_escreve:** O aparelho que rodou a autoanálise.
- **cifrado:** enc (até 48000)
- **retencao:** Write-once por versão. A recomendação é permanente, mas a retenção é decisão do dono.
- **regra:** Igual a reviewBodies, com ENC(48000).
- **leitura:** GET sob demanda.
- **novo_ou_existente:** novo

- **caminho:** users/{uid}/usageEvents/{deviceId}/{eventId}
- **proposito:** Consumo por sessão, nos formatos legado v1 e v2.
- **quem_escreve:** A outbox do próprio aparelho, por PATCH em lote (lib/sync/outbox.js:129-145), mais a migração explícita.
- **cifrado:** v2: enc (até 1024) com acctTag, prTag, model e localId; números e pf em claro, amarrados na AAD. Legado: como hoje.
- **retencao:** Permanente. O valor nunca some.
- **regra:** VARIANTE A (preferida, só se o emulador aprovar o PATCH v1 literal).
  
  usageEvents e $dev: '.write': U && NR && LIMPA
  
  $dev/$event: '.write': U && NR && (
    (newData.exists() && H(['at','kind','costUsd'])
      && newData.child('at').isNumber()
      && newData.child('costUsd').isNumber()
      && (!data.exists() || (at, kind e costUsd iguais aos gravados)))
    || (!newData.exists()
      && data.child('migratedTo').isString()
      && data.parent().child(data.child('migratedTo').val()).child('at').val() == data.child('at').val()
      && data.parent().child(data.child('migratedTo').val()).child('kind').val() == data.child('kind').val()
      && data.parent().child(data.child('migratedTo').val()).child('costUsd').val() == data.child('costUsd').val())
    || LIMPA
  )
  
  Mantém a .validate de hoje (firebase/database.rules.json:44).
  
  VARIANTE B.
  
  $dev: '.write': U && NR && (newData.exists() || LIMPA)
  
  A imutabilidade de at, kind e costUsd vai na .validate de $event. O resíduo é declarado.
- **leitura:** - v2 consolidado: usageDaily.
  - Aparelho v1: GET da subárvore dele, como hoje (lib/engine/sync-usage.js:138-148), porque .indexOn sob curinga não está confirmado.
- **novo_ou_existente:** existente-alterado

- **caminho:** users/{uid}/usageDaily/{deviceId}/{dia}
- **proposito:** Rollup diário por profileTag. Sustenta o teto único e o consolidado v2 sem GET inteiro.
- **quem_escreve:** O próprio aparelho, com um PUT do dia inteiro a partir da verdade local no fim de cada sessão.
- **cifrado:** não (números com chaves profileTag)
- **retencao:** Permanente. Só a limpeza protegida remove.
- **regra:** usageDaily e $dev: '.write': U && NR && LIMPA
  $dev/$day: '.write': U && NR && ((newData.exists() && $day.matches(/^[0-9]+-[0-9]+-[0-9]+$/)) || LIMPA)
- **leitura:** - Teto: GET direto de usageDaily/{dev}/{hoje}.
  - Consumo: orderBy $key com startAt <dia>. A chave é indexada automaticamente.
- **novo_ou_existente:** novo

- **caminho:** users/{uid}/leases/{accountHash}/{prHash}
- **proposito:** Posse exclusiva da operação, na coordenação de hoje.
- **quem_escreve:** v1 e v2, com CAS por ETag (lib/sync/lease.js:55-110). O v2 com compartilhamento grava headSha ''.
- **cifrado:** não
- **retencao:** TTL de 120 s por protocolo. A limpeza protegida nunca toca.
- **regra:** '.write': U && NR no nó leases.
  
  As .validate ficam BYTE A BYTE as de hoje (firebase/database.rules.json:9-20). Nenhuma validação nova e nenhuma trava de limpeza.
- **leitura:** Stream de /leases com a coordenação ligada, como hoje (lib/engine/sync-stream.js:304-313).
- **novo_ou_existente:** existente-alterado

- **caminho:** users/{uid}/receipts/{accountHash}/{prHash}/{fingerprint}
- **proposito:** Prova de análise concluída.
- **quem_escreve:** v1 e v2, com PUT e DELETE condicionados. O v2 com compartilhamento grava materialVersion 'h1:' + tag.
- **cifrado:** não
- **retencao:** 180 dias pela faxina (lib/engine/sync-faxina.js:67-89). A limpeza protegida nunca toca.
- **regra:** '.write': U && NR no nó receipts.
  
  A .validate fica byte a byte a de hoje (firebase/database.rules.json:27).
- **leitura:** GET com ETag na admissão.
- **novo_ou_existente:** existente-alterado

- **caminho:** users/{uid}/dailyRounds/{accountHash}/{prHash}/{dia}
- **proposito:** Teto compartilhado de rodadas.
- **quem_escreve:** v1 e v2: PUT com ETag e PATCH de poda (lib/sync/rounds.js:66-137).
- **cifrado:** não
- **retencao:** 8 dias por protocolo. A limpeza protegida nunca toca.
- **regra:** '.write': U && NR no nó dailyRounds.
  
  A .validate fica byte a byte a de hoje (firebase/database.rules.json:36). Nenhum campo novo no nó do dia.
- **leitura:** GET com ETag.
- **novo_ou_existente:** existente-alterado

- **caminho:** users/{uid}/rulesProbe/v2/{deviceId}
- **proposito:** Prova, pelo servidor, de que as regras v2 estão publicadas.
- **quem_escreve:** O cliente v2 com compartilhamento ligado: PUT e em seguida DELETE, logo depois de uma presença bem-sucedida.
- **cifrado:** não (número)
- **retencao:** Sobrescrito.
- **regra:** '.write': U && newData.isNumber()
  
  DELETE 401 significa regras v2. DELETE 200 significa a cascata v1, e aí a C1 fica dormente com aviso no Diagnóstico.
- **leitura:** nenhuma
- **novo_ou_existente:** novo

- **caminho:** users/{uid}/live/queue, live/commands, commandReceipts, checkpoints, live/control/coordination
- **proposito:** Reservados para entregas posteriores: fila distribuída, comandos, checkpoint compartilhado cifrado com lojas review e self separadas, e corte da coordenação.
- **quem_escreve:** Ninguém na C1.
- **cifrado:** Sim, quando existirem.
- **retencao:** A definir na entrega de cada um.
- **regra:** Sem concessão: o servidor nega qualquer escrita até existir regra própria.
- **leitura:** nenhuma
- **novo_ou_existente:** novo

---

## Estratégia de regras (`estrategia_de_regras`)

> **Trechos superados neste campo, que NÃO valem.** Onde o texto abaixo divergir destes itens, vale a spec.
>
> - A macro `NR` (com `revokedBefore`) não entra, porque `revokedBefore` está fora da iniciativa.
> - Variante A do consumo: sem a cláusula de remoção de legado migrado.

MACROS: um gerador em Node puro expande as macros textualmente. tools/sync-rules.js lê firebase/database.rules.template.json e escreve firebase/database.rules.json. Um teste reprova se o JSON não for byte a byte o gerado.

Aritmética: só aparece +, que as regras publicadas já exercitam (firebase/database.rules.json:10). A única exceção é REC.

- **U** = auth != null && auth.uid == $uid
- **C** = root.child('users').child($uid).child('live').child('control')
- **NR** = !C.child('revokedBefore').exists() || auth.token.auth_time > C.child('revokedBefore').val()
- **REC** = auth.token.firebase.sign_in_provider == 'password' && auth.token.auth_time * 1000 + 300000 > now
- **LIMPA** = !newData.exists() && REC && C.child('cleanup').child('enabled').val() == true && !root.child('users').child($uid).child('live').child('operations').exists()
- **GEN** = newData.child('generation').val() == C.child('admin').child('generation').val()
- **H(l)** = newData.hasChildren(l)
- **ENC(n)**: como descrito no envelope.

PRINCÍPIOS:

1. **Raiz só com leitura.** users/$uid fica só com '.read': U && NR, e o '.write' sai dali. O motivo é documentado: .read e .write cascateiam, a regra filha não revoga a concessão do pai, e sem regra no caminho ou acima o acesso é negado. Resultado: o apagão da v2.59.x e qualquer nó não listado são negados.

2. **Regra de ouro dos nós legados.**
   - leases, receipts e dailyRounds recebem '.write': U && NR na categoria, com .validate byte a byte.
   - devices recebe só o '.write' descendo, e .validate apenas nos campos NOVOS.
   - Motivo: o RTDB responde 401 para regra e para token (lib/sync/errors.js:55-58). O 401 é transitório (lib/engine/sync.js:47), derruba o status (108-118) e segura a automação (465-476).
   - A única condição nova tocando escrita v1 é a imutabilidade do consumo na variante A. Todo PATCH v1 real a satisfaz: payloadFor sempre preenche at, kind e costUsd, e marcarDesfecho reenvia os mesmos valores (lib/engine/usage.js:136-144).
   - Travas: um teste monta os payloads reais (buildLease, buildReceipt, presencaDe, payloadFor, comReserva) e o emulador responde 200 a cada escrita v1 literal.

3. **Nós novos: uma concessão de '.write' por registro.** A concessão carrega as invariantes sobre newData, que é o resultado mesclado (documentado), e H(obrigatórios). Com isso:
   - vale para escrita em qualquer profundidade;
   - não depende da dúvida sobre .validate de ancestral;
   - recusa o DELETE de um filho obrigatório.

4. **Remoção sempre explícita.** A .validate não roda em DELETE (documentado), então toda remoção permitida é uma cláusula com !newData.exists() dentro do '.write'. A limpeza ganha '.write': U && NR && LIMPA na categoria e '|| LIMPA' no registro. Como LIMPA exige !newData.exists() no nível avaliado, ela não cascateia para escrita comum.

5. **Nada novo depende de PATCH multi-caminho.** A avaliação por caminho não está documentada. Por isso nós novos são escritos por PUT no registro ou na folha, e a migração e a limpeza usam pedidos separados.

6. **Sem REVUP de servidor em nós de vários escritores.** Uma corrida viraria 401 indistinguível de token vencido.
   - A ordem vai no r dentro do envelope.
   - Nós de escritor único usam CAS por ETag, que vale para PUT e DELETE (documentado).
   - Falha de projeção nunca chama registrarFalha: vira contador no Diagnóstico.

7. **Sem índice sob curinga.** O .indexOn fica em nó fixo, com chave composta (dt e su). O usageDaily usa orderBy $key, que dispensa índice (documentado).

8. **Versão das regras provada.** A sonda rulesProbe roda depois de uma presença bem-sucedida.

CONSUMO, GATE DO EMULADOR:
- **Variante A** (concessão só no evento) vale se o PATCH v1 literal responder 200.
- **Variante B** (concessão no aparelho com newData.exists() || LIMPA) entra se não responder. O resíduo fica declarado.
- Nunca 'outbox v2 por PUT', que não conserta o v1.

A NUMA ESCRITA V1, SOB AS REGRAS V2:
- PATCH e PUT de presença;
- GET de devices;
- PUT e DELETE de lease com if-match;
- PUT e DELETE de recibo, inclusive a faxina e o Refazer (lib/sync/receipts.js:80-94);
- PUT de rodada e PATCH de poda (lib/sync/rounds.js:127-136);
- PATCH de consumo;
- stream de leases.

Perde só o DELETE de /users/{uid}.

PUBLICAÇÃO: uma só, manual, pelo dono (firebase/README.md:38-45). Antes dela vem o roteiro ampliado:
- os casos de hoje (firebase/README.md:130-148);
- cada escrita v1 literal;
- as recusas esperadas;
- REC testado no emulador E num projeto real;
- .length, matches com classes e child dinâmico.

A ordem com o app é livre.

---

## Limpeza protegida (`limpeza_protegida`)

> Nenhum trecho superado neste campo.

GARANTIA DO SERVIDOR (condicionada ao gate de REC): consumo, rollup diário, aparelhos, status, políticas, perfis, catálogo, índice e corpos do histórico, Panorama, Meus PRs e autoanálise só podem ser removidos com LIMPA. A LIMPA exige três coisas:
- login por senha feito há no máximo 5 min;
- live/control/cleanup.enabled == true;
- nenhuma live/operations existente.

keyring, live/control, leases, receipts e dailyRounds NUNCA entram na limpeza:
- apagar coordenação no meio derruba sessão viva (lib/engine/sync.js:432-435);
- apagar recibo faria outro aparelho pagar a mesma análise (lib/sync/coordinator.js:75-89).

Esses nós só expiram por protocolo: lease pelo TTL, recibo pela faxina (lib/engine/sync-faxina.js:67-89) e rodada em 8 dias (lib/sync/rounds.js:125-137). Nada local é tocado.

CHAVE: fica em live/control/cleanup e é assinada; ausente conta como desligada. Liga e desliga sem senha, só no admin. A regra confere só o booleano. Quem tem só o refresh token pode ligá-la, mas não apaga nada sem REC.

ATO (só no admin, com regras v2 provadas pela sonda):
1. **Categorias.** Lista as categorias remotas escolhíveis, todas desmarcadas, e diz que nada local será apagado.
2. **Senha.** Pede a senha e faz signInWithPassword com o e-mail guardado.
   - O idToken desse login é usado SÓ neste ato, com um cliente próprio de getIdToken fixo.
   - Nunca usa o tokenSource em cache (lib/sync/auth.js:111-149).
   - Um 401 neste contexto vira 'confirme a senha de novo'.
3. **Trava.** Grava live/control/cleanupLock com x = agora + 600 s. As admissões v2 respeitam a trava.
4. **Operações vencidas.** Apaga as live/operations com x vencido, para que uma órfã de aparelho caído não trave a limpeza para sempre.
5. **Pré-checagem.** Com o token do ato, confere que não há:
   - lease vivo (GET leases, que cobre também sessão de aparelho v1);
   - operação viva;
   - sessão local ativa;
   - pendente na outbox deste aparelho.
   Se houver impedimento, lista aparelho e tipo, apaga a trava e aborta, sem cancelar nada.
6. **Confirmação.** Pede a confirmação final.
7. **DELETE.** Um pedido por subárvore, cada um avaliado no próprio caminho. Se uma categoria falhar, o ato para; as já apagadas ficam apagadas, e o ato pode ser retomado.
8. **Corte.** Grava live/control/lastCleanup com at do servidor, dev e categorias.
9. **Recibo local.** Grava um recibo sanitizado em ~/.farol, sem uid inteiro e sem e-mail.
10. **Encerramento.** Apaga a trava e o admin reassina enabled false.

Se a janela de 5 min estourar no meio, o pedido em curso toma 401 sem efeito e a tela pede a senha de novo.

PÓS-LIMPEZA: nenhum cursor é zerado. Hoje ele é zerado (lib/engine/sync.js:442), e zerar faria o histórico apagado voltar a subir.
- A outbox v2 só envia sessão com at maior que o corte.
- O consolidado v2 ignora evento com at igual ou anterior ao corte e conta à parte o que um aparelho antigo reenviar.
- O v1 tem cursor adiantado (lib/sync/outbox.js:105-113) e só reenvia se alguém apertar 'Consolidar' nele (lib/engine/sync-usage.js:150-163). Esse caso é risco residual.

REMOÇÃO DO APAGÃO: syncEraseRemote e /api/sync/erase-remote (lib/engine/sync.js:436-445, lib/http-server.js:139) saem do código. Uma varredura estática proíbe DELETE em /users/{uid}.

---

## Admin e auth_time (`admin_e_auth_time`)

> **Trechos superados neste campo, que NÃO valem.** Onde o texto abaixo divergir destes itens, vale a spec.
>
> - "O leitor verifica a assinatura e considera o admin fora com beatAt + 360 s vencido, pelo relógio corrigido": substituído pela regra de frescor de CT-ADM-POL.
> - "Para aplicar uma política, o aparelho exige batimento vivo": passa a ser autoridade fresca; com a autoridade indisponível vale a combinação mais restritiva com a última política aceita (CT-ADM-POL).

TORNAR-SE ADMIN (na C1, só 'tornar ESTE aparelho administrador'; ver decisões):
1. signInWithPassword com a senha real.
2. Com esse idToken, gera Ed25519 local.
3. Lê live/control/admin com ETag.
4. Grava {deviceId, generation: anterior + 1, publicKey, setAt} com if-match. A regra exige REC e generation +1.

A senha nunca é gravada nem sincronizada; troca e recuperação de admin só pela senha.

BATIMENTO: a cada 120 s, com assinatura.
- A regra exige GEN, dev igual ao do admin e beatAt a no máximo 60 s do relógio do servidor.
- O leitor verifica a assinatura e considera o admin fora com beatAt + 360 s vencido, pelo relógio corrigido (lib/engine/sync.js:295-296).
- Admin fora: cada aparelho volta à configuração local e à revisão automática de hoje, coordenada por lease (decisão 5).
- Admin de volta: as políticas voltam a valer só para admissões novas, e nada em curso é cancelado.

OPT-IN LOCAL: config.sync.aceitarAdmin, novo no saneador (lib/sync/config.js:67-78).
- Só liga com true explícito, e só pela tela do próprio aparelho.
- Nenhum payload remoto nem leitura do banco contém a chave.

Para aplicar uma política, o aparelho exige tudo isto:
- aceitarAdmin ligado;
- assinatura válida da geração vigente;
- batimento vivo;
- chaves dentro da allowlist;
- mesmo saneador e clamp (lib/engine/review.js:426-429).

A política nunca toca o gate de postagem nem o config.json. O valor efetivo fica em memória.

AUTH_TIME, O QUE ESTÁ CONFIRMADO:
- auth.token.auth_time é legível em regra do RTDB e está em segundos (manage-sessions).
- É a hora do login, não da renovação do token (IdTokenResult e verify-id-tokens).
- Trocar a senha exige login recente (manage-users).
- auth.token.firebase.sign_in_provider existe nas regras (rules-and-auth). Exigir 'password' impede que entrar por outro provedor vinculado conte como senha recente.

Com REC, só um idToken recém-saído de signInWithPassword consegue gravar keyring, admin, revokedBefore, cleanupLock e lastCleanup, ou apagar pela limpeza. Um refresh token copiado, renovado quantas vezes for, carrega o auth_time antigo e é recusado depois de 5 min.

O QUE NÃO ESTÁ CONFIRMADO E SEGURA A GARANTIA:
- o operador * nas regras (a referência não renderizou);
- o relato não oficial de que o emulador carimba auth_time igual a iat.

TESTE ANTES DE PUBLICAR, no emulador E num projeto real:
1. Entrar, esperar 6 min, renovar pelo refresh token e gravar live/control/admin: o esperado é 401.
2. Repetir com login novo: o esperado é 200.

Se * for recusado, testar auth.token.auth_time + 300 > now / 1000. Se nada passar, REC não é conferível pelo servidor:
- a tela não pode dizer que o servidor confere a senha;
- a limpeza não é publicada (decisão do dono);
- keyring e admin ficam protegidos só por rev +1, ETag e assinatura.

---

## Compatibilidade (`compatibilidade`)

> **Trechos superados neste campo, que NÃO valem.** Onde o texto abaixo divergir destes itens, vale a spec.
>
> - "O token local só é exigido com o compartilhamento ligado": substituído pela A4 (exigido pelo modo de execução, com ou sem sincronização).
> - Passo 5, "migrar a chave do próprio consumo": fora da iniciativa.
> - O invariante "Sincronização desligada = hoje" é refinado por CT-COMPAT (a) e (b): as melhorias universais são exceções explícitas.

INVARIANTES:

1. **Sincronização desligada = hoje.**
   - bootSync volta antes de ler credencial (lib/engine/sync.js:139-153).
   - Nenhum módulo novo lê ou cria arquivo, e não há fetch.
   - A allowlist de Host é invisível, porque o servidor já só escuta 127.0.0.1 (lib/http-server.js:200).
   - O token local só é exigido com o compartilhamento ligado.

2. **Sincronização ligada com compartilhamento desligado = rede de hoje.**
   - Novo interruptor sync.shared.enabled, que só liga com true explícito, pelo mesmo saneador (lib/sync/config.js:59-78).
   - Nenhum update o liga (docs/PLANO-SINCRONIZACAO-DISPOSITIVOS.md:50).
   - Desligado: headSha, materialVersion, nome do aparelho, presença e payload de consumo ficam idênticos, sem sonda, keyring nem stream live.

3. **Um aparelho só, com compartilhamento ligado.**
   - Revisão, gates, fila e telas ficam iguais.
   - Andamento e Panorama só são publicados com outro aparelho com contract 2 e keyReady visto nas últimas 24 h.
   - Histórico e consumo sobem.

4. **Versão antiga ignora o novo.**
   - Projeta devices por allowlist (lib/engine/sync.js:302-305).
   - Nenhum filho novo nasce sob leases, receipts, dailyRounds ou usageEvents/{dev}; o consolidado v1 conta todo filho como sessão (lib/sync/consolidated.js:92-95).
   - Nenhum campo novo no nó do dia de rodada (lib/sync/rounds.js:66-73).
   - O lease não ganha campo.

5. **Nada local é apagado.**

SEQUÊNCIA:
0. Contrato v2, gerador de regras, testes estáticos e roteiro do emulador.
1. Sai o app C1, tudo desligado por padrão, sem o apagão e com a allowlist de Host.
2. O dono publica as regras v2, que aceitam cada escrita v1 listada na estratégia de regras.
3. Cada aparelho liga o compartilhamento localmente, e a sonda decide:
   - regras v1: fica dormente com aviso de regras desatualizadas e nada cifrado nasce numa árvore apagável;
   - regras v2: pede a senha e cria ou abre o keyring.
4. Admin: 'tornar este aparelho administrador'.
5. Atos explícitos, com contagem e confirmação: enviar o histórico local e migrar a chave do próprio consumo.
6. Sem corte de coordenação na C1.

FROTA MISTA:
- v1 e v2 coordenam pelo mesmo caminho legado.
- O v2 bloqueado segue analisando e sobe consumo v1.
- Andamento e histórico de aparelho v1 não aparecem, e a tela o nomeia como versão antiga.
- A outbox v1 com pendências segue válida, porque nenhuma regra da C1 exige formato v2.
- Correção de desfecho do v1 reenvia o mesmo eventId legado, que continua aceito.

ROLLBACK: voltar para a v2.59.x funciona.
- As regras v2 aceitam o v1.
- Os nós novos ficam retidos, custando só armazenamento.
- shared e aceitarAdmin são ignorados pelo saneador antigo.
- Os arquivos novos ficam só em ~/.farol (sync-key.json, sync-admin.json, sync-migracao.json, recibo de limpeza).
- Não há migração local reversa. O único efeito perdido é o apagão.

---

## Custo e banda (estimativa, não medição) (`custo_e_banda`)

> Nenhum trecho superado neste campo.

LIMITES CONFIRMADOS:
- Spark do RTDB: 1 GB armazenado, 10 GB/mês de download e 100 conexões simultâneas. Não há teto de 360 MB/dia no Spark do banco; esse valor é a franquia diária do Blaze.
- O download cobra overhead de protocolo e cerca de 3,5 KB por handshake TLS, e operação negada também é cobrada.
- Resposta de PUT e PATCH pelo REST devolve o dado gravado, então o eco entra na conta.
- O que acontece ao estourar a cota do Spark não está documentado.

HIPÓTESE (desenho, NÃO MEDIDO): 3 aparelhos, 30 revisões por dia no conjunto, revisão de 10 min. O medido, cerca de 15 por dia só no Windows, é o piso de UM aparelho (docs/PLANO-SINCRONIZACAO-DISPOSITIVOS.md:73-79 e 92-94).

CONEXÕES: no máximo 2 por aparelho, o stream de leases (que já existe) e um stream live, ou seja, 6 de 100. Nó grande nunca tem stream.

ESTIMATIVA POR OBSERVADOR:

| Fonte | Mecânica | Volume |
|---|---|---|
| Andamento | escreve na troca de etapa, de subagentes, na detecção do modelo e numa renovação a cada 60 s; mínimo de 10 s entre escritas; o último vence; nunca aguardado no onEvent (lib/engine/session.js:557-570); tempo decorrido corre no ticker local; cerca de 20 escritas de ~1 KB por revisão | ~600 KB/dia por observador; o mesmo de eco no executor |
| Batimento | 120 s, ~0,4 KB | ~290 KB/dia por observador; o mesmo de eco no admin |
| Reconexão | snapshot live de ~10 KB mais handshake; celular instável com 50 quedas | ~0,7 MB/dia |
| Histórico | índice ~0,6 KB mais corpo ~7,5 KB por revisão | ~240 KB/dia de upload mais eco; observador baixa ~20 KB/dia de índice e o corpo ao expandir |
| Envio do histórico local (ato explícito) | até 3000 decisões, em lotes de 20; sem print=silent, porque o cliente recusa corpo vazio (lib/sync/rtdb.js:151 e 161) | ~25 MB de upload e ~25 MB de eco, uma vez |
| Panorama e Meus PRs | só linhas alteradas, ~50 por conta por dia | ~150 KB/dia no publicador; ~75 KB/dia no observador, só com a aba aberta |
| Consumo | evento v2 ~0,9 KB com eco, mais usageDaily regravado no fim da sessão | desprezível |

O consolidado v2 lê usageDaily por orderBy $key, e abandona o GET inteiro de usageEvents (lib/engine/sync-usage.js:138-148). Esse GET continua o maior risco para aparelho v1 com a visão aberta, com no mínimo 30 s entre buscas (ui/app.js:3195).

TOTAL: ~2 MB/dia típico e ~15 MB/dia no pior caso por aparelho. Com 3 aparelhos, ~180 MB/mês típico (2% dos 10 GB) e ~1,35 GB/mês no pior caso (13%).

MEDIÇÃO OBRIGATÓRIA antes de ligar no celular: 24 h com dois aparelhos, com contador de bytes por stream e por escrita exposto no Diagnóstico.

ARMAZENAMENTO SEM APAGAR: corpos ~80 MB/ano, índice ~7 MB, consumo ~10 MB, catálogo e rollups ~5 MB. São ~100 MB/ano, e 1 GB chega em cerca de 10 anos. O aviso aparece a partir de 70% do estimado.

UI: eventos SSE 'sync-live' (delta) e 'sync-lists' (sinal) no broadcast de lib/http-server.js:57-72. Nunca pushState, que reenvia o snapshot inteiro (server.js:2055) e é o que o stream de leases usa hoje (lib/engine/sync-stream.js:138-150).

CELULAR (RAM):
- espelho live abaixo de 100 KB;
- LRU de 500 entradas;
- conteúdo decifrado só da página visível;
- scrypt de ~16 MiB, assíncrono, só no desbloqueio.

---

## Modos de falha (`modos_de_falha`)

> **Trechos superados neste campo, que NÃO valem.** Onde o texto abaixo divergir destes itens, vale a spec.
>
> - "revokedBefore gravado sem troca de senha": fora da iniciativa.
> - "Migração interrompida" e "Correção de desfecho de sessão migrada gravada com id legado": fora (sem migração).
> - "UI local aberta sem token com o compartilhamento ligado": substituído pela A4.
> - "Admin some: o batimento vence em 6 min": vale com a regra de frescor e com a restrição mantida de CT-ADM-POL.

- Regras velhas publicadas: a sonda recebe DELETE 200. O compartilhamento fica dormente, com o Diagnóstico dizendo que as regras do banco estão desatualizadas.
- O emulador reprova o PATCH v1 na variante A. Publica-se a variante B, com o resíduo declarado. Nunca se publica a A 'para ver'.
- REC não é conferível pelo servidor (operador * ou auth_time do emulador). A tela rebaixa a promessa, a limpeza não é publicada, e keyring e admin ficam só com rev, ETag e assinatura.
- .length ou matches não suportados: os tetos de tamanho ficam só no cliente.
- Senha errada: signInWithPassword recusa antes do scrypt, e nenhum embrulho é criado.
- Dois aparelhos criam o keyring ao mesmo tempo: o segundo toma 412, relê e abre o embrulho do vencedor.
- Keyring sumido ou corrompido (apagão v1 antes das regras v2, ou console): estado 'chave do conjunto perdida'. Aparelhos com cache seguem, e recriar exige ato explícito com senha.
- Tag GCM inválida, kid desconhecido ou esquema errado: o item vira 'não verificável', fora de orçamento e de decisão.
- kcv do cache diverge do banco: o cache é descartado e a senha é pedida.
- Troca de senha sem nenhum cache: pede a senha anterior. Sem ela, o conteúdo cifrado se perde, e consumo e coordenação continuam.
- scrypt falha por memória no celular: o conteúdo compartilhado fica bloqueado e o engine segue.
- Relógio adiantado ou atrasado mais de 60 s: batimento, x e updatedAt são recusados. Um 401 repetido em escrita de projeção vira contador 'relógio' no Diagnóstico, nunca registrarFalha nem automação segurada.
- A janela de 5 min do login estoura no meio de um ato: 401 sem efeito naquele pedido, a senha é pedida de novo e o ato é retomável.
- Admin some: o batimento vence em 6 min e cada aparelho volta à configuração local. Admin volta com geração velha: o batimento é recusado e ele se rebaixa.
- revokedBefore gravado sem troca de senha: o v1 entra em 401 transitório em laço (lib/engine/sync.js:47 e 365-374). O v2 reconhece 401 logo após um token renovado e pede a senha.
- Executor cai: a operação vence em 150 s e aparece como 'interrompida'; qualquer aparelho pode apagar.
- Operação órfã impediria a limpeza: o ato apaga as vencidas antes.
- Migração interrompida: fica migratedTo sem remoção. Repetir recria a mesma cópia, porque o id é determinístico.
- Correção de desfecho de sessão migrada gravada com id legado (cache perdido ou versão antiga): contagem dupla temporária no consolidado.
- 'Consolidar' num v1 depois da limpeza: reenvio legado, que o consolidado v2 ignora antes do corte.
- Envelope acima do teto: é cortado antes, com truncated. Se a regra ainda recusar, vira contador e nunca derruba a conexão.
- Dois publicadores disputam uma conta do Panorama: o CAS no meta decide, e o perdedor não publica.
- PR sem entrada no catálogo: a tela diz 'PR sem nome disponível'.
- Stream live recebe cancel ou auth_revoked: fecha, renova o token e reabre com backoff de 5 a 60 s (lib/constants.js:92-93).
- UI local aberta sem token com o compartilhamento ligado: 401 com a instrução de abrir pelo endereço que traz o token.
- Cota do Spark: aviso a partir de 70%; o comportamento ao estourar é desconhecido.
- Autoanálise sem etapa estampada: aparece com etapa desconhecida e sem percentual.
- Pendência criada em outro aparelho: só visível; a ação acontece só no dono.

---

## Contraprovas (`contraprovas`)

> **Trechos superados neste campo, que NÃO valem.** Onde o texto abaixo divergir destes itens, vale a spec.
>
> - "Tirar a conferência da cópia na remoção do legado": fora (sem migração).
> - "Teto único: o usageDaily de B com o mesmo profileTag precisa bloquear a admissão em A": vale reescrita como critério da C4b (mesmo grupo de consumo).
> - "Loopback: ... /api/state sem token com o compartilhamento ligado, 401": substituída pelos critérios da C1a (Host) e da A4 (modo que exige autenticação).

- Voltar '.write' para users/$uid: test/sync-rules-contrato.test.js (estático sobre o JSON gerado) reprova. No emulador, o DELETE de /users/{uid} precisa responder 401.
- Mudar um byte das .validate de leases, receipts ou dailyRounds: o teste estático compara com as strings de hoje.
- Condição nova que recuse escrita v1: um teste monta buildLease, buildReceipt, presencaDe, payloadFor e comReserva reais e confere contra a allowlist gerada. O emulador precisa responder 200 a cada escrita v1 literal.
- Tirar newData.exists() ou H(...) do '.write' de recentReviews, catalog ou devices: o teste estático reprova. No emulador, DELETE do registro e DELETE de filho obrigatório precisam responder 401.
- Tirar a imutabilidade de costUsd ou at: no emulador, PUT com costUsd diferente num evento existente precisa responder 401.
- Tirar a conferência da cópia na remoção do legado: no emulador, DELETE com cópia de costUsd diferente precisa responder 401, e com cópia igual, 200.
- Esquecer o *1000 em REC: o caso POSITIVO (keyring com login feito agora) passa a 401 e reprova. O caso negativo sozinho não pegaria.
- Tirar REC de keyring ou admin: com token renovado 6 min depois do login, precisa responder 401, no emulador e no projeto real.
- Tirar sign_in_provider de REC: no emulador, login por outro provedor gravando keyring precisa responder 401.
- Tirar o +1 de generation: PUT repetindo a geração atual precisa responder 401.
- Tirar a janela de beatAt: batimento assinado reenviado 2 min depois precisa responder 401.
- LIMPA alcançando keyring ou leases: DELETE com a chave ligada e login novo precisa responder 401.
- LIMPA sem a checagem de operações: DELETE de recentReviews com operação viva precisa responder 401.
- AAD sem o caminho: test/sync-envelope.test.js move um envelope de catalog/A para catalog/B e exige falha.
- AAD sem x nas operações: regravar o mesmo envelope com x novo precisa falhar.
- Remover authTagLength: uma tag de 4 bytes precisa ser recusada.
- IV fixo: 1000 envelopes da mesma mensagem precisam ter IVs distintos, e trocar 1 bit do ct ou da tag precisa falhar.
- Compressão introduzida ou preenchimento removido: o teste exige texto claro com tamanho múltiplo de 256, e uma varredura estática proíbe importar node:zlib em lib/sync.
- HMAC trocado por SHA-256: test/sync-tags.test.js exige tag('pr', k) diferente de sha256Hex('pr:' + k), e diferente sob outra K_id.
- Coordenação passando a usar tag: há vetores dourados de leasePath e accountHash. No fake-rtdb, o coordinator v1 atual e o v2 disputam o mesmo PR e só um adquire.
- headSha ou materialVersion em claro com o compartilhamento ligado: o teste inspeciona o PUT e exige '' e o prefixo 'h1:' sem 40 hex. Com o compartilhamento desligado, o objeto precisa ser idêntico ao de hoje.
- Mudança em eventIdFor: vetor dourado sobre uma sessão literal.
- consolidatedSummary sobre eventos v1 e v2 misturados precisa dar os mesmos totais que os eventos só v1.
- Filho que não é evento sob usageEvents/$dev: uma varredura das escritas do fake-rtdb exige chave de 64 hex.
- Sincronização desligada: com FAROL_HOME temporário e import dinâmico, zero fetch e nenhum arquivo novo depois de boot e tick.
- Compartilhamento desligado: a presença precisa ser byte a byte a de hoje, sem contract e com o nome de hoje.
- Senha persistida: desbloquear com uma senha marcada e varrer FAROL_HOME, farol.log e o snapshot atrás dela.
- KEK derivada antes do login: com fake identity respondendo INVALID_PASSWORD, nenhum PUT em keyring pode chegar.
- Keyring perdido: o fake apaga um keyring já visto, e o teste exige estado 'chave-perdida' e zero PUT.
- Corrida na criação: dois runtimes precisam terminar com um único keyring e a mesma K_id, e um deles registra 412.
- Troca de senha: com cache no mesmo rev, precisa haver PUT rev+1 com sal novo. Com cache velho, a senha anterior é exigida e nada é gravado.
- Cache sem 0600: teste posix (pula no Windows, como o de credencial) confere o modo depois de CADA gravação.
- Opt-in local: política assinada válida com aceitarAdmin false não muda o paralelismo. Payload remoto contendo aceitarAdmin não altera o config.
- Assinatura: política com enc alterado, geração antiga ou chave pública diferente precisa ser recusada antes de decifrar.
- Sonda: com um fake que aceita DELETE, nenhum PUT pode chegar em catalog, recentReviews ou live.
- Andamento pela UI: um espião em pushState exige zero chamadas e N emissões de 'sync-live'.
- Coalescência: 100 mudanças em 10 s geram no máximo 2 PUT.
- Um aparelho só: sem par v2 visto em 24 h, zero escritas em live/operations e em panorama.
- Limpeza que reenvia: o cursor fica inalterado e a outbox não envia sessão com at igual ou anterior a lastCleanup.
- Visto compartilhado: dois engines no fake; o visto em A fecha a notificação em B.
- Teto único: o usageDaily de B com o mesmo profileTag precisa bloquear a admissão em A.
- Chave vazando para a tela: o snapshot e statusForUi são varridos atrás do base64 de K_id e de K_enc.
- Loopback: Host estranho precisa responder 403, e /api/state sem token com o compartilhamento ligado, 401.
- Honestidade: as regras não rodam no CI (o fake-rtdb não avalia regra, D8). Todo item marcado como emulador entra na lista manual do firebase/README.md.

---

## Fatos do Firebase (verificados e não verificados) (`fatos_firebase`)

> Nenhum trecho superado neste campo.

- **afirmacao:** auth.token.auth_time pode ser usado em regras do Realtime Database e está em segundos
- **fonte:** https://firebase.google.com/docs/auth/admin/manage-sessions
- **verificado:** true

- **afirmacao:** auth_time é a hora em que o usuário fez login, não a hora em que o token foi renovado
- **fonte:** https://firebase.google.com/docs/reference/js/auth.idtokenresult (texto obtido pelo índice de busca) e https://firebase.google.com/docs/auth/admin/verify-id-tokens
- **verificado:** true

- **afirmacao:** Trocar a senha exige que o usuário tenha feito login recentemente
- **fonte:** https://firebase.google.com/docs/auth/web/manage-users
- **verificado:** true

- **afirmacao:** Refresh tokens expiram com mudança importante da conta, como troca de senha ou de e-mail; o ID token dura uma hora
- **fonte:** https://firebase.google.com/docs/auth/admin/manage-sessions
- **verificado:** true

- **afirmacao:** auth.token.firebase.sign_in_provider existe nas regras
- **fonte:** https://firebase.google.com/docs/rules/rules-and-auth
- **verificado:** true

- **afirmacao:** A tabela de campos de auth.token não lista auth_time; o uso vem do exemplo oficial de manage-sessions
- **fonte:** https://firebase.google.com/docs/rules/rules-and-auth
- **verificado:** true

- **afirmacao:** .read e .write cascateiam, regra filha não revoga a concessão do pai, e sem regra no caminho ou acima o acesso é negado
- **fonte:** https://firebase.google.com/docs/database/security/core-syntax
- **verificado:** true

- **afirmacao:** .validate não cascateia e é ignorada quando a escrita apaga dados
- **fonte:** https://firebase.google.com/docs/database/security/rules-conditions e https://firebase.google.com/docs/rules/data-validation
- **verificado:** true

- **afirmacao:** newData é o resultado mesclado da escrita com o dado existente; data e root são o estado anterior
- **fonte:** https://firebase.google.com/docs/database/security/rules-conditions
- **verificado:** true

- **afirmacao:** Atualização em múltiplos caminhos é atômica
- **fonte:** https://firebase.google.com/docs/database/web/read-and-write
- **verificado:** true

- **afirmacao:** O padrão $other com .validate false recusa filhos não listados
- **fonte:** https://firebase.google.com/docs/database/security/core-syntax
- **verificado:** true

- **afirmacao:** Spark do Realtime Database: 100 conexões simultâneas, 1 GB armazenado e 10 GB/mês de download; os 360 MB/dia são franquia do Blaze, não limite do Spark do banco
- **fonte:** https://firebase.google.com/pricing e https://firebase.google.com/docs/database/usage/limits
- **verificado:** true

- **afirmacao:** O download cobrado inclui overhead de protocolo e cerca de 3,5 KB por handshake TLS, e operações negadas pelas regras também são cobradas
- **fonte:** https://firebase.google.com/docs/database/usage/billing
- **verificado:** true

- **afirmacao:** O Admin SDK lê e escreve tudo, independentemente das regras
- **fonte:** https://firebase.google.com/docs/database/admin/start
- **verificado:** true

- **afirmacao:** ETag pode ser pedido em qualquer método exceto PATCH; if-match vale em PUT e DELETE, com 412 na divergência; {'.sv':'timestamp'} grava milissegundos
- **fonte:** https://firebase.google.com/docs/database/rest/save-data
- **verificado:** true

- **afirmacao:** PUT e PATCH pelo REST respondem com o dado gravado; print=silent devolve 204 e fecha a conexão
- **fonte:** https://firebase.google.com/docs/database/rest/save-data
- **verificado:** true

- **afirmacao:** orderBy por filho exige .indexOn no REST; a chave do nó é indexada automaticamente
- **fonte:** https://firebase.google.com/docs/database/security/indexing-data
- **verificado:** true

- **afirmacao:** Resultado filtrado volta sem ordem, startAt e endAt são inclusivos, e shallow não se combina com filtro
- **fonte:** https://firebase.google.com/docs/database/rest/retrieve-data
- **verificado:** true

- **afirmacao:** Chave até 768 bytes, profundidade menor que 32, string até 10 MB e escrita REST até 256 MB
- **fonte:** https://firebase.google.com/docs/database/usage/limits
- **verificado:** true

- **afirmacao:** A senha mínima padrão do Firebase Auth é de 6 caracteres
- **fonte:** https://firebase.google.com/docs/auth/web/password-auth
- **verificado:** true

- **afirmacao:** .validate de ancestral não roda em escrita de descendente: a medição do projeto contraria o texto 'All validate rules must be satisfied at all levels'. O desenho não depende disso; é item do emulador
- **fonte:** NÃO VERIFICADO (https://firebase.google.com/docs/database/security/core-syntax contra firebase/README.md:137-142)
- **verificado:** false

- **afirmacao:** Num PATCH multi-caminho, as regras são avaliadas em cada caminho escrito: decide entre as variantes A e B do consumo
- **fonte:** NÃO VERIFICADO, item do emulador
- **verificado:** false

- **afirmacao:** O operador * e String.length funcionam nas regras do RTDB: sustenta REC e os tetos de tamanho
- **fonte:** NÃO VERIFICADO (https://firebase.google.com/docs/reference/security/database não renderizou), item do emulador
- **verificado:** false

- **afirmacao:** matches() aceita o quantificador {n}; o desenho evita e usa só + e classes
- **fonte:** NÃO VERIFICADO (https://firebase.google.com/docs/database/security/regex)
- **verificado:** false

- **afirmacao:** O valor {'.sv':'timestamp'} já está resolvido para número quando a regra avalia newData; o desenho não valida lastSeenAt
- **fonte:** NÃO VERIFICADO
- **verificado:** false

- **afirmacao:** .indexOn sob curinga funciona; o desenho usa índice em nó fixo
- **fonte:** NÃO VERIFICADO
- **verificado:** false

- **afirmacao:** child() com nome vindo de val() (data.parent().child(data.child('migratedTo').val())) funciona na regra
- **fonte:** NÃO VERIFICADO, item do emulador
- **verificado:** false

- **afirmacao:** O emulador de Auth carimba auth_time igual a iat; por isso o teste de REC roda também num projeto real
- **fonte:** NÃO VERIFICADO (https://github.com/firebase/firebase-tools/issues/3608, não é documentação oficial)
- **verificado:** false

- **afirmacao:** O que acontece no Spark ao estourar armazenamento ou download
- **fonte:** NÃO VERIFICADO (https://firebase.google.com/pricing não diz)
- **verificado:** false

- **afirmacao:** O RTDB responde 401 tanto para token vencido quanto para regra que recusa
- **fonte:** NÃO VERIFICADO na documentação; afirmado em lib/sync/errors.js:55-58
- **verificado:** false

- **afirmacao:** O stream REST aceita parâmetros de consulta; o desenho não depende disso
- **fonte:** NÃO VERIFICADO
- **verificado:** false

---

## Riscos residuais (`riscos_residuais`)

> **Trechos superados neste campo, que NÃO valem.** Onde o texto abaixo divergir destes itens, vale a spec.
>
> - "REC depende do operador *": continua; e, se não for provado, a limpeza não é publicada (D8).

- O Google, ou quem opera o Firebase Authentication, recebe a senha a cada login e pode derivar a KEK (decisão 1).
- Quem sabe a senha ou controla o e-mail da conta tem controle total: abre a chave, vira admin e limpa.
- Um aparelho comprometido, ou uma cópia da pasta ~/.farol com sync-key.json, abre todo o conteúdo das gerações em cache. A rotação só protege o conteúdo futuro.
- Ataque offline à senha a partir do keyring: senha fraca cai, mesmo com scrypt.
- Metadados ficam visíveis: horários, custo e tokens por sessão, tamanhos, quantidades, deviceId, plataforma e versão.
- A coordenação continua com SHA-256 sem sal e fingerprint sha256(head), então dá para descobrir conta, PR e commit por dicionário. Aparelhos v1 sobem hostname e head em claro.
- Eventos de consumo de aparelho antigo, aposentado ou não migrado ficam reversíveis para sempre, salvo pela limpeza.
- deviceId não é credencial. Quem tem só o refresh token consegue: apagar operações e pendências da exibição, sobrescrever índice, catálogo e Panorama com lixo detectável, rebaixar usageDaily (furando o teto único), apagar lease vivo (como hoje) e apagar campos de exibição do aparelho.
- Na variante B do consumo, um PUT no nó do aparelho substitui todos os eventos dele, e um PATCH com null apaga um evento isolado.
- REC depende do operador *, não confirmado, e do auth_time do emulador, com relato de inconsistência. Sem prova, keyring e admin ficam protegidos só por rev, ETag e assinatura.
- Tetos por .length não confirmados: sem prova, o armazenamento só é limitado pelo cliente.
- Contagem dupla temporária: correção de desfecho gravada com id legado depois de perder o cache, ou 'Consolidar' num v1 depois da limpeza.
- Um aparelho v1 que admita revisão entre a checagem e o DELETE da limpeza não é barrado; a trava é cooperativa.
- Replay de envelope efêmero afeta só a exibição, e aparece vencido.
- Perda da senha sem nenhum cache torna o conteúdo cifrado ilegível para sempre.
- O alcance de outros apps ao loopback no Android é NÃO VERIFICADO. O token mitiga, mas o ambiente não foi medido.
- O comportamento do Spark ao estourar a cota é desconhecido. O armazenamento sem apagar chega a 1 GB em cerca de 10 anos no volume estimado.
- Toda a banda é estimativa, não medição.
- A senha passa por strings JS imutáveis e não há como garantir apagá-la da memória.
- A autoanálise não estampa etapa, então o andamento dela aparece sem etapa.
