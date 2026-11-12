# Uso do plano e validade do login do Claude

Data: 12/11/2026. Estado: aprovado pelo dono em conversa e implementado na v2.80.0.

## Por que

Pedido do dono: ver o consumo de cada plano sem ir ao terminal, e saber com precisão quando
o login de cada perfil precisa ser refeito. O caso que motivou: o login padrão da instalação
hospedada declarava vencimento para o mesmo dia e nada na tela dizia isso; a descoberta foi
lendo a credencial por SSH.

## O que foi medido antes de desenhar

- `claude -p "/usage" --output-format json` (Claude Code 2.1.322) responde em cerca de dois
  segundos com zero turno e zero custo. O `result` é texto, com uma linha por janela do
  plano: sessão, semana e semana por modelo, cada uma com o percentual usado e o reset.
- O mesmo JSON traz `credential_expires_at`. O valor é igual ao da validade do token de
  renovação guardado na credencial, e nos três logins com data conhecida ele fica 28
  dias depois do login e não anda quando o token de acesso é renovado.
- Login vencido responde sem linha de janela e sem `credential_expires_at`.
- O comando funciona contra a cópia efêmera da configuração (a mesma do teste de perfil),
  com a credencial lida da pasta original.

## Objetivos

1. Cada perfil do Claude por assinatura mostra, em Sistema, Plano e chaves, o uso de cada
   janela do plano com a hora em que volta.
2. Cada perfil mostra o dia e a hora em que o login vence, e quanto falta.
3. O Farol avisa antes do vencimento: a três dias e no último dia.
4. Vale para perfil ligado ou desligado na ordem de uso.

## Fora do escopo

- Usar o percentual lido para a ordem de uso trocar de perfil. Ela continua trocando só
  pelo limite registrado (`lib/engine/limite-plano.js`).
- Renovar o login sozinho. A renovação continua sendo o login do perfil, feito por gente.
- Mostrar perfis de outra instalação. Cada Farol mostra os próprios.

## O que seria falha mesmo funcionando

- Mostrar número errado quando o Claude Code mudar o texto do uso. Por isso linha que não
  casa fica de fora e, sem janela, a tela diz que o uso não foi lido.
- Escrever na configuração do perfil ou ler a credencial. Por isso a leitura roda na cópia
  efêmera, e a validade vem do JSON do CLI, não do arquivo de credencial. O que o CLI faz por
  conta própria continua acontecendo: o `/usage` consulta a API e renova o token de acesso
  vencido na credencial da pasta original (medido), como em qualquer sessão.
- Abrir o CLI de verdade nos testes. Por isso só lê o engine ligado no boot.
- Trocar as barras por um erro a cada falha de passagem. Por isso a última leitura boa fica
  na tela por até uma hora, marcada como desatualizada.
- Abrir um processo do CLI por perfil ao mesmo tempo, a cada snapshot. Por isso há cache de
  cinco minutos e uma leitura de cada vez na máquina.
- Avisar a cada leitura. Por isso o aviso é um por faixa de vencimento.

## Como ficou

- `lib/engine/uso-do-plano.js`: leitura, interpretação, cache, aviso e a projeção para a tela.
- `lib/engine/perfil-claude.js`: `rodarNaCopia`, o comando do CLI contra a cópia efêmera,
  que o teste de perfil já usava por dentro.
- `lib/engine/cadeia-perfis.js`: `cadeiaParaTela` agenda a leitura e leva `uso` em cada entrada.
- `ui/pure/uso-do-plano.js` e `ui/app.css`: a tela, pelo desenho do Claude Design
  ([handoff](2026-11-12-uso-do-plano-anexos/HANDOFF.md)).
- `test/uso-do-plano.test.js`: a saída real do CLI como fixture.

## Decisões de quem implementou

- Cache de cinco minutos e prazo de um minuto por leitura.
- O aviso é um toast do Farol. Na instalação hospedada ele só é visto com a tela aberta; a
  linha do vencimento no cartão é o que fica sempre visível.
- O aviso guarda em memória o que já avisou: depois de reiniciar, a faixa atual avisa uma
  vez de novo.
