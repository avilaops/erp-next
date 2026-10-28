# Execução das pendências do ERP

Escopo: desenvolvimento do ERP conforme relatórios existentes, em 27/10/2026.
A estrutura de ML e o laboratório de verificação ficam com o outro agente.
Este documento acompanha entregas de produto e suas evidências.

## Primeiro lote

| Origem | Pendência comprovada | Implementação | Verificação |
| --- | --- | --- | --- |
| `STATUS-ERP.md` e `PEDIDOS-FINANCEIRO.md` | Rascunho de pedido não podia ser editado; `/editar` reutilizava a consulta | PUT Rust, formulário autenticado e snapshots preservados | Quatro novos testes Rust e dois novos cenários de navegador aprovados |
| Relatório estático, achado `empty_ui_action` | Ajuda tinha callback vazio em “Ver orientação” | Orientações expansíveis por teclado, links e resultado de busca vazio | Cenário de navegador aprovado |
| Rodadas integradas anteriores | Harness disputava portas fixas entre execuções | Origens locais configuráveis para API, web e Auth sintético | API, web e Auth exercitados em portas próprias |

Primeiro lote concluído localmente: 47 testes Rust e 29 testes de navegador
aprovados, build web e TypeScript, ESLint, Rustfmt e Clippy sem erros. O harness
também confirmou persistência após reiniciar a API. Os resultados e os limites
estão na [evidência desta entrega](../evidencias/erp-rascunhos-ajuda-2026-10-27.md).

O achado da ajuda aparecia em seis árvores de imports, mas tinha a mesma origem.
Isso não representava seis botões comprovadamente defeituosos. Os dois achados
`dynamic_forward_requires_runtime` são limitações de descoberta estática; não
justificam substituir encaminhamentos válidos sem evidência de falha.

Referência do inventário inicial: relatório
`artifacts/verification/2026-10-27T19-52-25-404Z-11000fda-5604-4f00-a410-2680c36f6733/report.json`.
Ele é uma fotografia local, não prova de integração em produção.

## Segundo lote

Em implementação: os quatro [cadastros auxiliares](CADASTROS-AUXILIARES.md),
com tabelas e permissões próprias por empresa, API Rust, BFF e telas conectadas.
Validação de PostgreSQL e navegador em execução; o estado final será registrado
após os resultados. Este lote não encerra todos os requisitos do marco M1.

## Fila de implementação por dependência

| Frente | Próximo resultado verificável | Fonte |
| --- | --- | --- |
| Pedidos | Edição de rascunho entregue; descontos, frete e devoluções permanecem pendentes | `PEDIDOS-FINANCEIRO.md` |
| Cadastros auxiliares | Persistência de categorias, contas e formas de pagamento por empresa | `STATUS-ERP.md`, arquitetura e contratos arquivados em `docs/.old/` |
| Compras | Pedido de compra e recebimento com efeitos transacionais no estoque | `STATUS-ERP.md`, `ESTOQUE-PERSISTENTE.md` |
| Pessoas | Endereços e dados complementares usados pelos próximos fluxos | `PESSOAS-PERSISTENTES.md` |
| Estoque | Depósitos e inventários com invariantes antes de lotes e produção | `ESTOQUE-PERSISTENTE.md` |
| Contas a receber | Recebimentos parciais e estornos referenciados; conciliação externa separada | `PEDIDOS-FINANCEIRO.md` |
| Financeiro restante | Contas a pagar, contas financeiras, caixa e categorias | `STATUS-ERP.md` |
| Comercial restante | Propostas, PDV e canais com regras e persistência próprias | `STATUS-ERP.md` |
| Acessos | Provisionamento/convites conforme contrato real do Auth | `API-ACESSOS.md` |
| Integrações e preferências | Configuração persistente e estado obtido do serviço, sem tratar listas estáticas como conexão | `STATUS-ERP.md` e inventário de rotas |
| Relatórios e notificações | Consultas e eventos reais dos domínios proprietários | Inventário e arquitetura |
| Logística e serviços | Contratos e operações verificadas sobre os fluxos comerciais e financeiros | `STATUS-ERP.md` |
| Implantação | Destino, migrações, identidade real, healthchecks e rollback | `STATUS-ERP.md` |

Os itens da fila não estão concluídos por constarem neste documento. Esta rodada
não implementa emissão fiscal nem altera serviços externos.
