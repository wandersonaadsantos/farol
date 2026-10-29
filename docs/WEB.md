# Farol hospedado: operação da web

Guia do operador e da pessoa para rodar o Farol num servidor Linux (VPS), acessado pelo
navegador por HTTPS, com uma instância por pessoa. É o plano 5 do Farol nativo
(`docs/superpowers/plans/2026-10-28-farol-nativo-5-web.md`, 29/10/2026).

Este guia **não viaja com o app instalado** (fica fora da allowlist dos guias distribuídos): é
documentação de quem opera o servidor, e os scripts que ele descreve (`tools/web/`) também não
viajam. Tudo roda a partir de um clone do repositório na VPS.

<!-- indice:inicio (mantido à mão, no formato dos guias distribuídos) -->

## Índice

- [O que é e o desenho](#o-que-é-e-o-desenho)
- [Pré-requisitos e dimensionamento](#pré-requisitos-e-dimensionamento)
- [Operador: provisionar uma pessoa](#operador-provisionar-uma-pessoa)
- [Operador: Caddy e DNS](#operador-caddy-e-dns)
- [Pessoa: primeiro acesso e pareamento](#pessoa-primeiro-acesso-e-pareamento)
- [Pessoa: logins do Claude e do GitHub](#pessoa-logins-do-claude-e-do-github)
- [Update](#update)
- [Backup e restauração de ~/.farol](#backup-e-restauração-de-farol)
- [Quando a assinatura bate o limite](#quando-a-assinatura-bate-o-limite)
- [Smoke e diagnóstico](#smoke-e-diagnóstico)
- [O que ainda não foi validado numa VM](#o-que-ainda-não-foi-validado-numa-vm)
- [Pendências para o motor](#pendências-para-o-motor)

<!-- indice:fim -->

## O que é e o desenho

O modo servidor (`node server.js`, sem Electron) já é a versão web do Farol: o motor serve a
`ui/` por HTTP e SSE. O que este guia acrescenta é operação. O desenho está na seção 4.6 de
`docs/superpowers/specs/2026-10-27-farol-nativo-swiftui-winui-design.md`, e o dimensionamento,
na seção 5 de `docs/superpowers/specs/2026-10-27-farol-nativo-mac-win-web-estrategia.md`.

```
navegador ──HTTPS──> Caddy (443, TLS automático)
                       ├─ ana.farol.<dominio>  ──> 127.0.0.1:47170  (node server.js, usuário ana)
                       └─ beto.farol.<dominio> ──> 127.0.0.1:47171  (node server.js, usuário beto)
```

- **Um motor por pessoa.** Cada pessoa é um usuário Linux, com o próprio `~/.farol` (o
  `FAROL_HOME`), a própria porta, o próprio `gh auth login` e o próprio login do Claude. É por
  desenho: o Farol age no GitHub com a identidade de quem o roda, e a assinatura do Claude que
  paga a revisão é a dessa pessoa. Dividir um motor entre duas pessoas misturaria as duas coisas.
- **O motor fica em loopback.** `config.bind` continua no padrão `127.0.0.1`; quem chega da
  rede é só o Caddy. O `bind` fora do loopback (seção "Modo casca e bind" do
  `docs/CONFIGURATION.md`) existe para quem expõe o motor sem proxy, e não é o caminho deste guia.
- **A autenticação local (A4) é exigida.** O provisionamento grava `localAuth: "exigir"` no
  `config.json`, porque com o motor em loopback nenhum outro sinal liga a exigência sozinho: para
  o motor, o pedido vem de `127.0.0.1`. Sem token, `GET /api/state` devolve `401`. O token sai só
  no corpo do `POST /api/auth/pair`, viaja no cabeçalho `Authorization` e nunca em cookie ou URL.
- **Supervisão pelo systemd de usuário**, com linger: o serviço sobe no boot da VPS sem
  ninguém abrir sessão, e o `Restart=always` religa o motor quando ele sai (inclusive depois de um
  update).

O que o plano 1 do Farol nativo entregou e este guia usa: `config.bind`, a allowlist de Host
de `lib/http-guard.js` e a exigência da A4 fora do loopback. O que este plano entregou:
`tools/web/` (provisionamento, Caddyfile, smoke) e este guia. Nenhuma mudança de produto.

## Pré-requisitos e dimensionamento

| peça | versão | de onde |
|---|---|---|
| Ubuntu | 24.04 LTS | a imagem da VPS |
| Node | 24 LTS, `>=24.22.1 <25` (o contrato do motor) | pacote do sistema (NodeSource), com `/usr/bin/node` do root |
| `gh` | atual | repositório apt oficial do GitHub CLI (`cli.github.com/packages`) |
| `claude` | atual | instalador oficial, por pessoa (vai para `~/.local/bin`, que o motor põe na frente do PATH) |
| Caddy | 2 (validado com 2.11.7) | repositório apt oficial do Caddy (o do Ubuntu é antigo) |
| `git`, `curl`, `unzip` | do Ubuntu | `apt install` |

**O node do root precisa ser do sistema.** Os scripts rodam como root e executam
`tools/web/portas.js` e `tools/web/caddyfile.js` com o `node` do PATH do root, e recusam um node
cujo arquivo real não pertence ao root ou aceita escrita de grupo ou outros. O root nunca executa
o node de uma pessoa (um nvm dentro da pasta dela, por exemplo): seria rodar como root um binário
que ela controla. A pessoa pode ter o próprio node (nvm), e aí é ele que a unidade dela usa.

**Dimensionamento.** O estudo de 26/10 dimensionou **4 vCPU e 8 GB para até 4 revisões
paralelas** no servidor. O que consome é a sessão de IA (o `claude` e o que ele roda), não o
motor parado. Como cada instância tem os próprios limites (`parallelReviews` por conta e "Teto
total deste aparelho", `globalParallelReviews`, em Sistema > Automação), o total da VPS é a SOMA
das instâncias: com duas pessoas, ponha o teto total de cada uma em 2; com mais gente, aumente a
máquina ou baixe os tetos. Nenhum motor enxerga o vizinho, então quem garante a soma é o operador.

**Rede.** Abra só 22, 80 e 443 (`ufw allow OpenSSH`, `ufw allow 80,443/tcp`, `ufw enable`). A
80 é do ACME e do redirecionamento para HTTPS. As portas dos motores (47170 em diante) escutam só
em `127.0.0.1` e não precisam de regra.

**Não instale emulador de terminal** (`xterm`, `gnome-terminal`) na VPS. O login do Claude não
depende disso: no modo servidor o motor nunca procura terminal para ele (`spawnLoginConsoleLinux`,
`lib/engine/session.js`) e o botão "Abrir sessão de login" abre sempre o painel na própria tela
(ver [Pessoa: logins do Claude e do GitHub](#pessoa-logins-do-claude-e-do-github)). O motivo são
os outros caminhos que ainda escolhem um emulador quando acham um, como o login do Codex e a
sessão interativa de revisão no terminal: numa VPS sem tela, a janela não aparece para ninguém, e
sem emulador nenhum esses caminhos avisam alto em vez de abrir o vazio.

## Operador: provisionar uma pessoa

Clone o repositório numa pasta do root que ninguém mais escreve (os scripts rodam como root a
partir dela):

```bash
sudo gh auth login                     # o gh do root: clone e download da release
sudo gh repo clone wandersonaadsantos/farol /opt/farol
```

Depois, uma vez por pessoa:

```bash
sudo bash /opt/farol/tools/web/provisionar-pessoa.sh ana
```

`tools/web/provisionar-pessoa.sh <login-linux> [porta] [opcoes]`:

| opção | o que faz |
|---|---|
| `[porta]` | pede essa porta; sem ela, a próxima livre a partir de 47170 |
| `--pacote <zip\|pasta>` | instala deste pacote leve (`farol-vX.Y.Z.zip` ou a pasta extraída); sem ele, baixa `farol-v*.zip` da última release com o `gh` do root |
| `--clone <pasta git>` | liga `~/.farol/app` a um clone (link simbólico) e marca a unidade com `FAROL_UPDATE_MANAGER=external` |
| `--forcar` | aceita login que já existe (usuário Linux ou linha em `/etc/farol/portas`): reaproveita a porta, troca o app e a unidade e reinicia o serviço, preservando o resto de `~/.farol` |
| `FAROL_NODE=/caminho/absoluto/node` | o node que a unidade usa; sem ele, o que o usuário criado enxerga (com o nvm dele, se houver) |

**O login vira subdomínio.** Use minúsculas, dígitos e hífen, sem hífen na ponta e sem `_`:
`ana`, `joao-silva`. O provisionamento aceita `_` (é a regra do `useradd`), mas
`gerar-caddyfile.sh` recusa, porque não sai certificado para um nome de host com `_`.

O que ele faz, nesta ordem, e onde grava:

1. confere tudo antes de tocar algo: Linux, root, comandos presentes, login válido, node do root
   do sistema, e que o login ainda não existe (sem `--forcar`);
2. cria o usuário (`useradd --create-home --shell /bin/bash`);
3. resolve o node da unidade, caminho absoluto (o systemd de usuário tem PATH mínimo e não vê o nvm);
4. aloca a porta em **`/etc/farol/portas`** sob uma trava (`/etc/farol/portas.lock`): uma linha
   `<login> <porta>` por pessoa. `tools/web/portas.js` é o único leitor e escritor desse formato;
   login repetido, porta repetida ou linha fora do formato são recusados, porque dois motores na
   mesma porta deixariam o segundo em laço de religar. Para ver a tabela:
   `sudo node /opt/farol/tools/web/portas.js listar /etc/farol/portas`;
5. instala o app em **`~/.farol/app`** (cópia do pacote leve inteiro, ou o link para o clone);
6. grava **`~/.farol/config.json`** com `{ "port": <porta>, "localAuth": "exigir" }`, modo 0600.
   Se o arquivo já existe (`--forcar`), ele é mantido, e o script só pede para conferir a porta e
   o `localAuth`: ali moram as contas e a política da pessoa;
7. instala **`~/.config/systemd/user/farol.service`** (de `tools/web/farol.service.template`:
   `FAROL_HOME=%h/.farol`, `ExecStart=<node> %h/.farol/app/server.js`, `Restart=always`,
   `RestartSec=10`);
8. liga o linger (`loginctl enable-linger <login>`), espera o systemd de usuário subir e roda
   `daemon-reload`, `enable` e `restart` do serviço como a pessoa, conferindo `is-active`.

**O root não escreve no que a pessoa controla.** Tudo dentro da pasta pessoal (app,
`config.json`, unidade) é escrito COMO a pessoa (`sudo -u <login>`), então um link simbólico
plantado ali só alcança o que ela já alcança.

No fim, o script imprime a porta e os próximos passos: `gh auth login` como a pessoa, o comando do
código de pareamento e o proxy.

**Instale o `claude` da pessoa** logo depois do provisionamento (o script não instala, e a pessoa
não tem shell na VPS para fazer isso ela mesma). O login do Claude pela tela roda
`claude auth login` como o usuário dela, e sem o binário o painel não abre. Com o instalador
oficial, rodado COMO a pessoa:

```bash
sudo -iu ana bash -c 'curl -fsSL https://claude.ai/install.sh | bash'
sudo -iu ana bash -c '~/.local/bin/claude --version'
```

Ele precisa cair no `~/.local/bin` desse usuário: é a pasta que o `server.js` põe na FRENTE do
PATH do motor (e que o login pela tela também usa), então nenhum outro `claude` da máquina ganha
dele. Um `claude` instalado só para o root, ou em outra pasta fora do PATH mínimo do systemd de
usuário, não é visto pelo motor da pessoa.

**Pacote ou clone.** O padrão é o pacote leve da release, que se atualiza sozinho (ver
[Update](#update)). `--clone` é para quem opera o servidor a partir do código: o motor roda do
clone, e `FAROL_UPDATE_MANAGER=external` impede o motor de tentar se atualizar (ele recusaria de
todo jeito: o update automático não sobrescreve um checkout git). A pessoa precisa conseguir LER o
clone (o script confere).

**Para tirar alguém:** `sudo -u <login> XDG_RUNTIME_DIR=/run/user/$(id -u <login>) systemctl --user disable --now farol`,
`sudo loginctl disable-linger <login>`, apagar a linha dela de `/etc/farol/portas` à mão e gerar o
Caddyfile de novo. Apagar o usuário e a pasta é decisão à parte (ver o backup antes).

## Operador: Caddy e DNS

**DNS.** Um registro A curinga `*.farol.<dominio>` apontando para o IP da VPS, ou um registro A
por pessoa (`ana.farol.<dominio>`). Com curinga, pessoa nova não pede mudança de DNS.

**Só subdomínio, nunca caminho** (decisão de 29/10/2026). `https://farol.<dominio>/ana/` não
funciona e não é suportado: o `index.html` carrega tudo pela raiz (`/app.js`, `/app.css`) e a
rota da tela mora no caminho (`/radar/pra-mim`, `ui/pure/rota.js`), então um prefixo por pessoa
quebraria os dois. O subdomínio também dá a cada pessoa uma origem própria no navegador: o token
de uma instância, guardado pelo navegador, não fica ao alcance da página da outra.

**Gerar o Caddyfile:**

```bash
sudo bash /opt/farol/tools/web/gerar-caddyfile.sh --dominio exemplo.com.br
```

`tools/web/gerar-caddyfile.sh [--dominio <dominio>] [--saida <arquivo>]`:

- lê `/etc/farol/portas` e escreve um bloco por pessoa (`tools/web/Caddyfile.template`, montado
  por `tools/web/caddyfile.js`) em `<pessoa>.farol.<dominio>`;
- `--dominio` fica lembrado em **`/etc/farol/dominio`** depois de uma geração que deu certo; nas
  próximas vezes, sem `--dominio`, ele é lido de lá (o smoke também lê);
- grava ao lado e renomeia, valida com `caddy validate` (como o usuário `caddy`, para os arquivos
  de log não nascerem do root) e recarrega o serviço (`systemctl reload caddy`) só quando a saída
  é a padrão e o Caddy está ativo;
- **o `/etc/caddy/Caddyfile` passa a ser do Farol** e é sobrescrito inteiro a cada geração. Outro
  site na mesma VPS exige juntar os arquivos à mão (e perder isso na geração seguinte), ou uma
  máquina separada. Com a tabela vazia, a geração apaga todos os sites.

Rode de novo a cada pessoa provisionada ou removida.

**TLS automático.** O nome do site basta: o Caddy pede o certificado pelo ACME na primeira vez
que o bloco aparece, e renova sozinho. As portas 80 e 443 precisam estar abertas e o DNS já
apontando para a VPS.

**Host e Origin: por que o proxy mexe nos dois** (29/10/2026). O motor tem uma allowlist de Host e
Origin (`lib/http-guard.js`): no bind loopback ele aceita só o Host `127.0.0.1:<porta>` ou
`localhost:<porta>`, e Origin ausente ou `http://127.0.0.1:<porta>`/`http://localhost:<porta>`.
Pelo proxy, o navegador manda `Host: ana.farol.<dominio>` e, em todo POST,
`Origin: https://ana.farol.<dominio>`. Sem tratamento, toda chamada daria
`403 { error: 'forbidden', motivo: 'host' }` e, corrigido o Host, todo POST da tela daria
`motivo: 'origin'`. O bloco de cada pessoa então:

1. **confere o Origin na borda**: Origin presente e diferente de `https://<pessoa>.farol.<dominio>`
   leva `403` do próprio Caddy (corpo vazio, o motor nem vê o pedido);
2. **retira o Origin aceito** (`header_up -Origin`), porque o motor aceita Origin ausente;
3. **reescreve o Host** para `127.0.0.1:<porta>` (`header_up Host`);
4. **não bufferiza o SSE** (`flush_interval -1`): o `/api/events` precisa entregar cada evento na
   hora, senão a tela acha que a conexão caiu (90 s sem nada, `ui/transporte.js`).

A proteção entre sites não depende de o motor ver o Origin: o token da A4 viaja no cabeçalho
`Authorization`, que outro site não consegue pôr num pedido para cá. Mesmo assim, o motor deixar
de conferir a origem ele mesmo é uma perda de defesa em profundidade, e está nas
[pendências](#pendências-para-o-motor).

**Log sem query.** Cada pessoa tem um arquivo, `/var/log/caddy/farol-<pessoa>.log`, em JSON, com
a query string cortada da URI: nada que viaje em query chega ao disco. O Caddy já mascara o
`Authorization` nos cabeçalhos registrados. O token nunca vai em URL de todo jeito; o corte é a
segunda linha. O log de ERRO do próprio Caddy (no journald) não passa por esse filtro.

## Pessoa: primeiro acesso e pareamento

1. Abra `https://<seu-login>.farol.<dominio>`. Antes do pareamento a tela inteira é o painel
   "Parear este navegador": nada do estado, dos relatórios, do log ou do chat aparece antes.
2. Peça o código ao operador. Ele roda, na VPS, como você (o comando que o provisionamento
   imprimiu):

   ```bash
   sudo -u ana FAROL_HOME=/home/ana/.farol /usr/bin/node /home/ana/.farol/app/tools/farol-parear.js
   ```

   (com o node e a pasta da sua unidade). A saída é
   `Código de pareamento: XXXXXXXXXX` e `Vale por 10 minutos e funciona uma vez só.`
   O `FAROL_HOME` é o que faz o código valer para a SUA instância: sem ele, o código iria para a
   pasta errada.
3. Digite o código, dê um nome ao navegador e clique em Parear. O token fica guardado só neste
   navegador; nenhum cookie é criado.

**O código é credencial.** Ele passa do terminal do operador para você por um canal em que você
confia (pessoalmente, ou por um mensageiro com quem já falam), **nunca** num chat aberto, num
ticket, numa URL ou num e-mail. Ele vale uma vez e por 10 minutos, e cinco tentativas erradas o
invalidam. O painel diz para rodar o comando "no terminal deste aparelho": no Farol hospedado,
quem tem o terminal é o operador (ver as [pendências](#pendências-para-o-motor)).

**Quanto dura.** A sessão de um navegador vence com 30 dias sem uso ou 90 dias depois do
pareamento, e aí o painel volta.

**Revogar.** A lista de navegadores pareados, com a revogação um a um, fica em Sistema >
Aparelhos, mas só aparece com a sincronização entre dispositivos LIGADA (sem ela, a seção mostra
só "A sincronização entre dispositivos está desligada"). Numa instância hospedada a sincronização
fica desligada enquanto ninguém configura o Firebase, então o caminho do hospedado é o operador
rodar, como a pessoa e com o `FAROL_HOME` dela:

```bash
sudo -u ana FAROL_HOME=/home/ana/.farol /usr/bin/node /home/ana/.farol/app/tools/farol-parear.js --revogar-todas
```

Isso revoga TODAS as sessões e códigos daquela instância, inclusive os navegadores que a pessoa
ainda usa: cada um volta ao painel e pareia de novo com um código novo. É o que fazer com um
navegador perdido, roubado ou de uma máquina que a pessoa deixou de usar.

## Pessoa: logins do Claude e do GitHub

Nesta ordem, depois do pareamento: primeiro o Claude, que paga as revisões, e depois o GitHub,
que é o que faz a conta aparecer e a fila começar a andar. Na ordem inversa, as primeiras revisões
automáticas morreriam sem login do Claude.

**Claude (pela tela).** O `claude` é instalado por pessoa, pelo operador, no passo
"Instale o `claude` da pessoa" de [Operador: provisionar uma pessoa](#operador-provisionar-uma-pessoa). O login é pela própria tela, sem terminal (`lib/engine/login-web.js`,
20/10/2026):

1. Sistema > Plano e chaves, cartão "Login padrão desta máquina": liste o login padrão como
   perfil. Ele vira o perfil `maquina` (id fixo, nome editável), que usa o `~/.claude` do usuário
   Linux da pessoa, sem `CLAUDE_CONFIG_DIR`.
2. No cartão do perfil, "Abrir sessão de login". Sem terminal na VPS, abre um painel na tela: o
   motor roda `claude auth login` e mostra o link de autorização.
3. Abra o link (no computador da pessoa: o retorno é uma página da Anthropic que mostra um
   código, então o navegador não precisa estar na VPS), autorize e cole o código no painel.
4. O sucesso é a saída 0 do CLI, conferida pelo diagnóstico; o perfil passa a mostrar a conta em
   uso.

O código colado vai só para a entrada padrão do CLI, nunca para log, snapshot ou toast. Perfis
com pasta própria (uma assinatura do trabalho e uma pessoal, por exemplo) entram pelo mesmo
painel, e a ordem de uso fica em Plano e chaves > Ordem de uso.

**GitHub (no servidor, como a pessoa).** O Farol age no GitHub com o login do `gh` do usuário
Linux dele:

```bash
sudo -iu ana gh auth login
```

Escolha GitHub.com, HTTPS e o login pelo navegador: o `gh` imprime um código de uso único e o
endereço `https://github.com/login/device`. A PESSOA abre esse endereço no computador dela,
logada na conta dela do GitHub, e digita o código. O operador nunca vê a senha nem o token. Numa
VPS sem chaveiro, o `gh` guarda o token em `~/.config/gh/hosts.yml` (ele avisa), legível só pelo
usuário: entra no [backup](#backup-e-restauração-de-farol).

**A conta nasce revisando e aprovando sozinha.** Ela aparece em Sistema > Contas no ciclo
seguinte, com a política padrão de conta nova (desde 01/10/2026: revisa sozinha, aprova com ou sem
ressalvas e reprova sozinha; ver "Uma decisão, uma configuração" no `docs/CONFIGURATION.md`). O
`config.json` do provisionamento não diz nada sobre isso. Quem quer começar devagar tem dois
caminhos: a pessoa troca os seletores da conta logo depois do login, ou, ANTES do `gh auth login`,
o operador acrescenta `"autoReview": false` ao `~/.farol/config.json` da pessoa (editando como
ela, com `sudo -u ana`, e reiniciando o serviço dela, porque o motor lê o arquivo no boot), e a
conta detectada nasce sem revisar sozinha: os PRs só entram na fila. A chave só cobre ISSO. As
outras três decisões da conta nascem no padrão (`onClean: approve`, `lib/engine/contas-migracao.js`),
então um clique manual em Revisar num PR limpo ainda posta um APPROVE no GitHub. Para nada sair
sem a pessoa decidir, ela põe também "espera você" nos seletores de aprovar e reprovar da conta,
em Sistema > Contas, antes da primeira revisão.

Com Antigravity ou Codex na cadeia, os logins deles seguem o mesmo princípio (por pessoa); o do
Antigravity também entra pela tela.

**Nunca como root.** O serviço de cada pessoa roda como o usuário dela, nunca como root: o Claude
Code recusa `--dangerously-skip-permissions` com uid 0, e toda revisão headless passa essa flag.

## Update

**Pacote leve (padrão).** O motor se atualiza sozinho no modo servidor
(`lib/engine/update-servidor.js`): baixa o pacote da release com o `gh` DA PESSOA (que precisa
ler o repositório da release), troca no lugar, em `~/.farol/app`, só o que o pacote traz (pasta
por pasta, cópia ao lado e rename, `package.json` por último) e sai. O systemd religa em 10 s
(`Restart=always`, `RestartSec=10`). O script destacado que o motor deixa para religar quando não
há supervisor espera 30 s pela porta e, achando o motor de pé, se cala. Cada pessoa atualiza a
própria instância, no ritmo da própria config (Sistema > Automação).

**Clone (`--clone`).** A unidade leva `FAROL_UPDATE_MANAGER=external` e o motor não se atualiza
(a tela diz que a atualização é administrada por fora). O operador atualiza:

```bash
sudo git -C /opt/farol pull --ff-only
sudo -u ana XDG_RUNTIME_DIR=/run/user/$(id -u ana) systemctl --user restart farol
```

(um `restart` por pessoa ligada ao clone). Os scripts de `tools/web/` também vêm do clone: depois
de um `pull` que os mude, gere o Caddyfile de novo.

**Reprovisionar** (`--forcar`) também troca o app, mantendo `config.json` e os dados.

## Backup e restauração de ~/.farol

Tudo da pessoa mora na pasta dela (invariante 2). O backup de uma pessoa:

| o quê | onde |
|---|---|
| config, estado, histórico, sessões pareadas (só hash), chave do compartilhamento | `~/.farol` (o app, `~/.farol/app`, é reinstalável e pode ficar de fora) |
| login do GitHub | `~/.config/gh` |
| login do Claude (perfil `maquina`) | `~/.claude` e `~/.claude.json` |
| perfis do Claude com pasta própria | a pasta de cada um |
| a unidade | `~/.config/systemd/user/farol.service` (regenerável pelo provisionamento) |

E do servidor: `/etc/farol/portas` e `/etc/farol/dominio`. Os certificados do Caddy saem de novo
pelo ACME.

Com o serviço parado, para o estado não mudar no meio:

```bash
U=ana; R=/run/user/$(id -u $U)
sudo install -d -m 700 /root/backup
sudo -u $U XDG_RUNTIME_DIR=$R systemctl --user stop farol
sudo tar -C /home/$U --exclude=.farol/app -czpf /root/backup/farol-$U-$(date +%F).tar.gz \
  .farol .config/gh .claude .claude.json
sudo -u $U XDG_RUNTIME_DIR=$R systemctl --user start farol
```

Tire da lista o que não existir para aquela pessoa (o `tar` reclama do caminho ausente e sai com erro) e
acrescente as pastas dos perfis com pasta própria. O arquivo leva tokens e credenciais: guarde com
0600, fora da VPS, em armazenamento cifrado.

**Restaurar** (outra VPS, ou a mesma depois de um desastre): provisione a pessoa **na mesma
porta** de antes (`provisionar-pessoa.sh ana 47170`), porque o `config.json` do backup substitui
o que o provisionamento gravou e traz a porta antiga. Se você também restaurou o
`/etc/farol/portas` do backup, a pessoa já está na tabela e o provisionamento recusa
("ja tem porta em /etc/farol/portas"): rode com `--forcar`, que reaproveita a porta gravada (e,
na mesma máquina, aceita o usuário Linux que já existe). Pare o serviço, extraia
COMO a pessoa (o arquivo precisa ser legível por ela, por exemplo copiado para uma pasta dela) e
suba de novo:

```bash
sudo -u ana XDG_RUNTIME_DIR=/run/user/$(id -u ana) systemctl --user stop farol
sudo -u ana tar -C /home/ana -xzpf /home/ana/farol-ana.tar.gz
sudo -u ana XDG_RUNTIME_DIR=/run/user/$(id -u ana) systemctl --user start farol
```

Os navegadores pareados continuam valendo (as sessões estão no backup). Confira com o smoke.

## Quando a assinatura bate o limite

O limite do plano do Claude é da ASSINATURA, não do PR (`lib/engine/limite-plano.js`): o Farol
guarda em disco até quando ela está no limite e segura a fila automática até o reset, em vez de
cada PR abrir sessão para redescobrir o limite. Reiniciar o serviço não apaga a espera.

O que a pessoa vê: em Sistema > Plano e chaves > Ordem de uso, o perfil "No limite" com a hora em
que volta (ou "(estimado)", uma hora, quando o provedor não diz a hora); na fila, os PRs esperando
sem estacionar; com todos os perfis ligados no limite, o aviso de que as revisões esperam o
primeiro reset. O clique manual em Revisar continua passando (e bate no limite de novo, se ele
ainda valer).

O que fazer:

- **esperar**: passado o reset, o perfil prioritário volta sozinho;
- **pôr outra assinatura na cadeia**: um segundo perfil (pasta própria, outra conta do Claude, ou
  Antigravity e Codex) em Plano e chaves > Ordem de uso; quando o primeiro bate o limite, a
  revisão segue no seguinte sem clique (ver "Cadeia de perfis e provedores" no
  `docs/CONFIGURATION.md`);
- **reduzir o ritmo**: menos revisões paralelas, ou um orçamento por perfil.

O operador não tem o que fazer no servidor: o limite é da conta do Claude da pessoa, não da VPS.
Se várias pessoas batem no limite ao mesmo tempo com assinaturas diferentes, não é a VPS.

## Smoke e diagnóstico

```bash
sudo bash /opt/farol/tools/web/smoke.sh ana [--dominio <dominio>] [--resolve <ip>]
```

Fala só com `https://ana.farol.<dominio>`, pelo proxy, e confere:

| linha | o que prova |
|---|---|
| `GET / da 200 com o index.html` | DNS, certificado, proxy e motor de pé, servindo a tela |
| `GET /api/state sem token da 401` | a A4 exigida na instância (o `localAuth: "exigir"` valendo) e o Host reescrito (Host errado seria 403) |
| `POST com Origin alheio leva 403 do Caddy` | a conferência do Origin na borda (corpo vazio: o motor nem viu) |
| `POST com a origem da pessoa passa a borda e o motor (401 sem token)` | o Origin certo é aceito e retirado antes do motor (com ele, o motor daria 403) |
| `pareado pelo proxy` | código gerado como a pessoa e trocado por token em `POST /api/auth/pair` |
| `GET /api/events com token recebe event: ping em ate 30 s` | o SSE sem buffer no proxy (o motor manda ping a cada 25 s) |
| `sessao "smoke" revogada` | a sessão aberta pelo smoke não fica viva |
| `... sem token=, sem token e sem codigo` | o log da pessoa no Caddy corta a query e não guarda o segredo |

O token vem de `FAROL_SMOKE_TOKEN`; sem ele, o smoke gera um código como a pessoa (com o node da
unidade dela), pareia com o rótulo "smoke" e revoga essa sessão no fim, inclusive se parar no meio.
Código e token nunca vão para URL, linha de comando, log ou tela. `--resolve <ip>` fala com o IP
sem depender do DNS, com o certificado ainda conferido. Termina em "Smoke verde" (saída 0) ou
"Smoke vermelho: N falha(s)" (saída 1). Se a revogação falhar, a sessão "smoke" fica viva: sem
a sincronização ligada não há revogação de uma sessão só pela tela (ver
[Revogar](#pessoa-primeiro-acesso-e-pareamento)), e o caminho é o `--revogar-todas`, que derruba
também os navegadores da pessoa.

**Quando algo não sobe:**

```bash
sudo -u ana XDG_RUNTIME_DIR=/run/user/$(id -u ana) systemctl --user status farol
sudo -u ana XDG_RUNTIME_DIR=/run/user/$(id -u ana) journalctl --user -u farol -n 50
```

O journal mostra o que o processo escreveu ao morrer (porta ocupada, node errado, módulo
faltando). O que o motor registra é o `farol.log` dele, só de falhas (invariante 3), em
`~/.farol/workspace/state/farol.log`, e o Diagnóstico da tela (Sistema > Diagnóstico) lê esse log
junto com o ambiente: `gh`, conta, `claude`, rodando como root. Do lado do proxy:
`journalctl -u caddy` (certificado, recarga) e `/var/log/caddy/farol-<pessoa>.log` (os pedidos).

Sintomas e causas comuns:

- **403 `motivo: 'host'`**: o pedido chegou ao motor sem passar pelo bloco da pessoa (Caddyfile
  não regenerado depois do provisionamento, ou porta errada na tabela);
- **403 em todo POST da tela**: o Origin não está sendo retirado, ou a pessoa abriu por outro
  nome que não `https://<pessoa>.farol.<dominio>`;
- **a tela fica "reconectando" a cada 90 s**: buffer no caminho do SSE (outro proxy ou CDN na
  frente do Caddy);
- **o serviço reinicia em laço**: porta ocupada (outro processo, ou o `config.json` com uma porta
  diferente da de `/etc/farol/portas`).

## O que ainda não foi validado numa VM

Até 29/10/2026 **nada disto rodou numa VPS ou VM Ubuntu**. A entrega foi feita num Mac, sem VM:

O que FOI validado:

- os testes das partes puras: `test/web-provisionar.test.js` (a tabela de portas: próxima livre,
  recusa de login e porta repetidos, formato) e `test/web-caddyfile.test.js` (um bloco por pessoa,
  Host e porta certos, `flush_interval -1`, conferência e retirada do Origin, log sem query,
  recusas de domínio e login);
- `bash -n` e `shellcheck` limpos nos três scripts;
- o Caddyfile gerado passou por `caddy adapt` e `caddy validate` no Caddy 2.11.7 (com o caminho
  do log trocado, porque o Mac não tem `/var/log/caddy`), e o JSON adaptado tem a recusa do Origin
  antes do proxy, a retirada do Origin, o Host reescrito e o `flush_interval -1`;
- um motor real isolado (`FAROL_HOME` temporário, `localAuth: "exigir"`) atrás de um Caddy local
  com o Caddyfile gerado e `tls internal`, com uma cópia do smoke adaptada ao Mac (sem root, porta
  local, certificado interno): todas as checagens verdes, inclusive o pareamento pelo proxy, o
  `event: ping` do SSE, a revogação e o log sem query e com o `Authorization` mascarado. O
  controle negativo, direto no motor com o Origin público, deu `403 motivo: 'origin'`, que é o
  que prova a necessidade de retirar o Origin.

O que NÃO foi validado, e como validar:

1. provisionar dois usuários e ver duas portas e dois serviços vivos (useradd, node resolvido,
   linger, `/run/user/<uid>/bus`);
2. `sudo -u <login> XDG_RUNTIME_DIR=... systemctl --user` com unidades de usuário, do jeito que os
   scripts fazem;
3. o `gerar-caddyfile.sh` rodando como root num Caddy de verdade, com `caddy validate` como o
   usuário `caddy` e o `systemctl reload caddy`;
4. o smoke pelo proxy real, com DNS e certificado do ACME;
5. o reinício da VPS, com o linger trazendo os serviços de volta sem ninguém logar;
6. (desejável) "Abrir sessão de login" abrindo o painel na tela, e um update do pacote leve sob o
   systemd.

Numa VM Ubuntu 24.04 limpa, com um domínio cujo DNS você controla, nesta ordem:

```bash
# 0. base e firewall
sudo apt update && sudo apt install -y git curl unzip
sudo ufw allow OpenSSH && sudo ufw allow 80,443/tcp && sudo ufw --force enable

# 1. Node 24 do sistema (NodeSource); prova: v24.x >= 24.22.1, dono root, sem escrita de outros
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
node --version && stat -c '%U %A' "$(readlink -f "$(command -v node)")"

# 2. gh e Caddy pelos repositórios apt oficiais (instruções em cli.github.com e caddyserver.com)
gh --version && caddy version

# 3. clone
sudo gh auth login
sudo gh repo clone wandersonaadsantos/farol /opt/farol

# 4. dois usuários; prova: "Pronto: ana na porta 47170 (127.0.0.1)." e "beto na porta 47171"
sudo bash /opt/farol/tools/web/provisionar-pessoa.sh ana
sudo bash /opt/farol/tools/web/provisionar-pessoa.sh beto
sudo node /opt/farol/tools/web/portas.js listar /etc/farol/portas   # ana 47170 / beto 47171
sudo ss -ltnp | grep -E '127.0.0.1:4717[01]'                         # dois node escutando
for u in ana beto; do sudo -u $u XDG_RUNTIME_DIR=/run/user/$(id -u $u) systemctl --user is-active farol; done   # active, active
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:47170/api/state   # 401

# 5. claude por pessoa (instalador oficial, como a pessoa)
for u in ana beto; do sudo -iu $u bash -c 'curl -fsSL https://claude.ai/install.sh | bash'; done

# 6. DNS: registro A *.farol.<dominio> -> IP da VM; prova: dig +short ana.farol.<dominio>
# 7. Caddyfile; prova: "2 pessoa(s)", "valido", "recarregado"
sudo bash /opt/farol/tools/web/gerar-caddyfile.sh --dominio <dominio>
sudo journalctl -u caddy -n 50 | grep -i certificate                 # certificado obtido

# 8. smoke; prova: "Smoke verde: https://ana.farol.<dominio>" (e o mesmo para beto)
sudo bash /opt/farol/tools/web/smoke.sh ana
sudo bash /opt/farol/tools/web/smoke.sh beto

# 9. reinício sem login; prova: Linger=yes, os dois serviços active e o smoke verde de novo
loginctl show-user ana -p Linger
sudo reboot
# depois de voltar, por SSH com o usuário do operador (nunca como ana ou beto):
sudo ss -ltnp | grep -E '127.0.0.1:4717[01]'
sudo bash /opt/farol/tools/web/smoke.sh ana && sudo bash /opt/farol/tools/web/smoke.sh beto
```

E pelo navegador, como ana: abrir a URL, parear com o código, `sudo -iu ana gh auth login`, o
login do Claude pela tela e uma revisão manual de um PR de teste. Registre o resultado (com a data
e as versões do Ubuntu, Node, Caddy, gh e claude) neste guia, nesta seção.

## Pendências para o motor

Nada aqui foi feito neste plano, que é só operação; fica registrado para quem mexer no motor e
nas ferramentas.

### No motor

1. **Origem pública na allowlist** (29/10/2026). Hoje o proxy confere o Origin e o retira, porque
   o motor em loopback só aceita as origens `http://127.0.0.1:<porta>` e
   `http://localhost:<porta>`. Uma config (por exemplo
   `origemPublica: "https://ana.farol.exemplo.com.br"`, só por arquivo, como o `bind`) faria
   `lib/http-guard.js` aceitar essa origem, e o proxy passaria o Origin adiante. Ganho: o motor
   volta a conferir a origem ele mesmo (defesa em profundidade), e um proxy mal configurado deixa
   de virar "tudo passa". O bind fora do loopback já aceita `https://<bind>`, mas exige o motor
   escutando na rede, que não é o desenho daqui.
2. **O painel de pareamento fala de terminal local.** Ele manda rodar
   `node tools/farol-parear.js` "no terminal deste aparelho", "dentro da pasta onde o Farol está
   instalado". No Farol hospedado a pessoa não tem esse terminal: o código vem do operador. Um
   texto para esse caso (o motor saberia que está atrás de proxy pela config da pendência 1, por
   exemplo) evitaria a pessoa procurar um terminal que não existe.
3. **`localAuth` só por arquivo, e a A4 do hospedado depende dele.** Com o motor em loopback, o
   único sinal que liga a exigência é `localAuth: "exigir"` no `config.json`. Apagar a chave do
   arquivo (à mão, ou numa restauração de um `config.json` de outra instalação) deixa a instância
   aberta para quem chega pelo proxy, sem aviso. O smoke pega (`GET /api/state` daria 200), mas só
   quando roda. A config da pendência 1 poderia ligar a exigência sozinha, como o `bind` fora do
   loopback já liga.
4. **Navegadores pareados só com a sincronização ligada.** A lista e a revogação de um navegador
   moram na seção Aparelhos, que com a sincronização desligada mostra só o aviso de desligada
   (`aparelhosSecaoHtml`, `ui/pure/aparelhos.js`). No hospedado, onde ela costuma ficar desligada,
   a única revogação é o `--revogar-todas` no servidor, que derruba todos os navegadores da
   pessoa. A lista deveria aparecer com a sincronização ligada ou não: a A4 não depende dela.

### Nas ferramentas de `tools/web/`

5. **A política da conta nova.** O provisionamento não escreve `"autoReview": false`, então a
   conta detectada no `gh auth login` nasce revisando, aprovando e reprovando sozinha. E a chave
   sozinha não basta: ela desliga só o revisar sozinho, e o clique manual num PR limpo continua
   aprovando (`onClean` nasce `approve`). Para a primeira decisão de postar no GitHub ficar com a
   pessoa, o provisionamento teria de escrever a conta com os quatro campos (ou a migração aceitar
   o equivalente das três decisões de postar), o que pede o login da conta antes do `gh auth login`.
6. **`config.json` não é conferido contra `/etc/farol/portas`.** Uma porta editada à mão de um
   lado só deixa o serviço em laço (porta ocupada) ou o proxy apontando para o lugar errado.
7. **Login com `_`.** O provisionamento aceita (regra do `useradd`) e só o gerador do Caddyfile
   recusa, com o usuário já criado. Recusar no provisionamento, pela regra de rótulo de DNS, fecha
   isso.
8. **A mensagem de revogação do smoke** manda revogar a sessão "smoke" em "Sistema > Seguranca",
   seção que não existe. A lista de navegadores fica em Sistema > Aparelhos e, no hospedado com a
   sincronização desligada, nem aparece (pendência 4): o caminho que a mensagem deveria dar é o
   `--revogar-todas` como a pessoa, avisando que ele derruba também os navegadores dela.
