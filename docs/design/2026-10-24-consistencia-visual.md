# Consistência visual dos fluxos de revisão

Revisão feita no [Claude Design](https://claude.ai/design/p/d613880d-af9a-4b58-bc9d-f3daee2fdee5), usando o HTML/CSS público da v2.77.0 e o padrão do Farol. O handoff revisado orienta hierarquia, agrupamento e tokens.

## Integração

O CSS complementar fica limitado a raízes review-tools; CSS reconstruído e scripts do protótipo não foram incorporados. Renderizadores puros, IDs, tipos e ações existentes foram preservados. Fontes, dados técnicos e políticas avançadas ficam recolhíveis; riscos e confirmações permanecem visíveis.

A caixa agrupa intervenções do snapshot e mantém a ação de abertura, sem dispensa persistida. A fila mantém details/summary, teclado e persistência. Custos aparecem com a origem informada pela API. Voz permanece opt-in e suas opções são ocultadas quando desligada.

## Evidência

As jornadas tools/electron-smoke-*.js exercitam DOM, SSE, HTTP, disco e janela reais. GitHub, provedor pago, cota e processos externos usam dados sintéticos. As capturas cobrem claro/escuro em 1280, 1024 e 390 pixels, início/final de cada área; o teste recusa controles fora da largura da tela.

O autor do protótipo declarou inspeção em 924 pixels e simulação em 390 pixels, sem testar cada estado. Isso não substitui capturas do produto, CI nativa ou aceitação humana. O projeto de design recebeu apenas código público e contexto sintético.
