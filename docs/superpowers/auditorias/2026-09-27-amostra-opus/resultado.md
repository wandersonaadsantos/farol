# Resultado: auditoria por amostra sorteada das aprovações do Opus (27/09/2026)

Protocolo em `protocolo.md`, amostra em `amostra.txt`, achados completos em `resultado.json`.
Os 16 PRs sorteados foram avaliados; nenhum ficou inconclusivo.

| classificação | PRs | proporção |
|---|---|---|
| erro (o auditor reprovaria) | 1 | 6% |
| lacuna importante | 5 | 31% |
| ok | 10 | 63% |

Com 16 de 418, a taxa de erro de 1 em 16 é compatível com uma taxa real entre cerca de 0,2% e 30%
(intervalo exato de 95%). A de "erro ou lacuna importante", 6 em 16, fica entre cerca de 15% e 65%.

## O erro

**biudtech/biud-frontend#871** (mergeado em 01/09/2026, e o trecho segue igual na `development`
em 27/09/2026). O onboarding da MIA v2 supõe que a empresa ainda não existe, mas no fluxo
Empresas > Adicionar o cookie da empresa JÁ selecionada continua valendo, e
`MiaV2ConnectionsPage.tsx` liga o modo ao vivo com o id dela. A empresa nova vê as integrações
reais da antiga como conectadas, registra essas integrações como canais dela, e o botão de
desconectar age sobre a integração da outra empresa.

## As lacunas importantes (aprovar estava certo, faltou um ponto)

| PR | o que ficou de fora |
|---|---|
| biud-esg#222 | a regra e a mensagem do gate mandam rodar `npm run migration:create`, script que não existe |
| tenant-company#134 | o contract test mede um mock sem tipo: renomear um campo no produtor mantém o teste verde |
| biud-frontend#886 | entre 640 e 1023 px o acesso a Clientes some do menu e de Configurações |
| biud-frontend#807 | o evento VIEW_COMPANY_SIZE só dispara para empresa NÃO elegível; o cenário 6 do card foi dado como atendido |
| tenant-company#136 | o inventário do `.env.example` afirma que a API não lê variáveis que ela lê |

## O padrão

Os achados que o Farol não viu têm a mesma forma dos que a auditoria de 26/09/2026 achou no Haiku
e no Sonnet: estão FORA do diff (quem chama, o estado que chega de outra tela, o script que a
documentação cita, o layout numa largura intermediária). O Opus erra menos, mas erra no mesmo
lugar. A regra de prompt de seguir quem chama o código não basta sozinha.

## Observação de processo

biud-frontend#817 saiu como `auto_approved` com `cardMet` nulo e checks ainda rodando. Isso é
permitido pela política atual (`autoApproveAll`, CI em andamento não segura), mas vale conferir
se é o que o dono quer.
