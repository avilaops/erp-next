# P0 — contratos das ações do ERP

Referência: [AVL-359](https://linear.app/avilaops/issue/AVL-359). A P0 vem antes de novas migrations e implantação.

## Escopo e estado

O catálogo versionado em `verification/contracts.json` descreve as 62 operações Rust já existentes e registra as três ações de autenticação e os seletores dinâmicos do BFF. As 28 famílias ainda propostas permanecem `needs_definition`; esta entrega não fecha a P0 inteira.

Cada ficha contém ator/permissões, referência do corpo Rust, headers e parâmetros, precondições, estado anterior/posterior, efeitos e limites, respostas, revisão/idempotência, recuperação, fontes, páginas/BFF quando ligados e as oito dimensões de aceite. Tipos e métodos devem ser conferidos contra o código. Não é uma segunda implementação das regras.

A ação de emissão NF-e permanece bloqueada e não declara sucesso. DANFE não equivale a emitir ou consultar situação fiscal. Contas/recebimentos declarados não equivalem a liquidação bancária.

## Matriz do núcleo

| Fluxo | Operações | UI/contrato pendente |
| --- | ---: | --- |
| company | 2 | Conferir escopo e limites nas fichas |
| danfe | 1 | Conferir escopo e limites nas fichas |
| financial-accounts | 4 | Conferir escopo e limites nas fichas |
| financial-categories | 4 | Conferir escopo e limites nas fichas |
| fiscal-config | 2 | BFF/tela fiscal persistente |
| fiscal-drafts | 6 | BFF/tela fiscal persistente |
| me | 1 | Conferir escopo e limites nas fichas |
| orders | 7 | Conferir escopo e limites nas fichas |
| parties | 4 | Conferir escopo e limites nas fichas |
| payment-methods | 4 | Conferir escopo e limites nas fichas |
| permissions | 1 | Conferir escopo e limites nas fichas |
| product-categories | 4 | Conferir escopo e limites nas fichas |
| products | 4 | Conferir escopo e limites nas fichas |
| receivables | 4 | Conferir escopo e limites nas fichas |
| roles | 5 | Conferir escopo e limites nas fichas |
| runtime | 3 | Conferir escopo e limites nas fichas |
| stock | 3 | Conferir escopo e limites nas fichas |
| users | 3 | Conferir escopo e limites nas fichas |

## Ações e estados por operação

| Método e rota | De → para | Revisão / chave |
| --- | --- | --- |
| `GET /api/v1/company` | estado atual → sem alteração de estado | If-Match: não; Idempotency-Key: não |
| `PUT /api/v1/company` | registro existente → revisão incrementada | If-Match: sim; Idempotency-Key: não |
| `GET /api/v1/financial-accounts` | estado atual → sem alteração de estado | If-Match: não; Idempotency-Key: não |
| `POST /api/v1/financial-accounts` | ausente → criado; revisão inicial | If-Match: não; Idempotency-Key: sim |
| `GET /api/v1/financial-accounts/{id}` | registro existente → sem alteração de estado | If-Match: não; Idempotency-Key: não |
| `PUT /api/v1/financial-accounts/{id}` | registro existente → revisão incrementada | If-Match: sim; Idempotency-Key: sim |
| `GET /api/v1/financial-categories` | estado atual → sem alteração de estado | If-Match: não; Idempotency-Key: não |
| `POST /api/v1/financial-categories` | ausente → criado; revisão inicial | If-Match: não; Idempotency-Key: sim |
| `GET /api/v1/financial-categories/{id}` | registro existente → sem alteração de estado | If-Match: não; Idempotency-Key: não |
| `PUT /api/v1/financial-categories/{id}` | registro existente → revisão incrementada | If-Match: sim; Idempotency-Key: sim |
| `GET /api/v1/fiscal/config` | estado atual → sem alteração de estado | If-Match: não; Idempotency-Key: não |
| `PUT /api/v1/fiscal/config` | registro existente → revisão incrementada | If-Match: sim; Idempotency-Key: não |
| `POST /api/v1/fiscal/danfe` | ausente → sem alteração de estado | If-Match: não; Idempotency-Key: não |
| `GET /api/v1/fiscal/nfe` | estado atual → sem alteração de estado | If-Match: não; Idempotency-Key: não |
| `POST /api/v1/fiscal/nfe` | ausente → criado; revisão inicial | If-Match: não; Idempotency-Key: sim |
| `GET /api/v1/fiscal/nfe/{id}` | registro existente → sem alteração de estado | If-Match: não; Idempotency-Key: não |
| `PUT /api/v1/fiscal/nfe/{id}` | registro existente → revisão incrementada | If-Match: sim; Idempotency-Key: não |
| `POST /api/v1/fiscal/nfe/{id}/issue` | rascunho da empresa com revisão compatível → rascunho preservado; resposta 503 | If-Match: sim; Idempotency-Key: sim |
| `GET /api/v1/fiscal/readiness` | estado atual → sem alteração de estado | If-Match: não; Idempotency-Key: não |
| `GET /api/v1/me` | estado atual → sem alteração de estado | If-Match: não; Idempotency-Key: não |
| `GET /api/v1/orders` | estado atual → sem alteração de estado | If-Match: não; Idempotency-Key: não |
| `POST /api/v1/orders` | ausente → draft | If-Match: não; Idempotency-Key: sim |
| `GET /api/v1/orders/{id}` | registro existente → sem alteração de estado | If-Match: não; Idempotency-Key: não |
| `PUT /api/v1/orders/{id}` | draft → draft; revisão incrementada | If-Match: sim; Idempotency-Key: sim |
| `POST /api/v1/orders/{id}/cancel` | draft ou confirmed → cancelled; reserva liberada | If-Match: sim; Idempotency-Key: sim |
| `POST /api/v1/orders/{id}/complete` | confirmed → completed; baixa de estoque e recebível na mesma transação | If-Match: sim; Idempotency-Key: sim |
| `POST /api/v1/orders/{id}/confirm` | draft → confirmed; reserva derivada do pedido | If-Match: sim; Idempotency-Key: sim |
| `GET /api/v1/parties` | estado atual → sem alteração de estado | If-Match: não; Idempotency-Key: não |
| `POST /api/v1/parties` | ausente → criado; revisão inicial | If-Match: não; Idempotency-Key: sim |
| `GET /api/v1/parties/{id}` | registro existente → sem alteração de estado | If-Match: não; Idempotency-Key: não |
| `PUT /api/v1/parties/{id}` | registro existente → revisão incrementada | If-Match: sim; Idempotency-Key: não |
| `GET /api/v1/payment-methods` | estado atual → sem alteração de estado | If-Match: não; Idempotency-Key: não |
| `POST /api/v1/payment-methods` | ausente → criado; revisão inicial | If-Match: não; Idempotency-Key: sim |
| `GET /api/v1/payment-methods/{id}` | registro existente → sem alteração de estado | If-Match: não; Idempotency-Key: não |
| `PUT /api/v1/payment-methods/{id}` | registro existente → revisão incrementada | If-Match: sim; Idempotency-Key: sim |
| `GET /api/v1/permissions` | estado atual → sem alteração de estado | If-Match: não; Idempotency-Key: não |
| `GET /api/v1/product-categories` | estado atual → sem alteração de estado | If-Match: não; Idempotency-Key: não |
| `POST /api/v1/product-categories` | ausente → criado; revisão inicial | If-Match: não; Idempotency-Key: sim |
| `GET /api/v1/product-categories/{id}` | registro existente → sem alteração de estado | If-Match: não; Idempotency-Key: não |
| `PUT /api/v1/product-categories/{id}` | registro existente → revisão incrementada | If-Match: sim; Idempotency-Key: sim |
| `GET /api/v1/products` | estado atual → sem alteração de estado | If-Match: não; Idempotency-Key: não |
| `POST /api/v1/products` | ausente → criado; revisão inicial | If-Match: não; Idempotency-Key: sim |
| `GET /api/v1/products/{id}` | registro existente → sem alteração de estado | If-Match: não; Idempotency-Key: não |
| `PUT /api/v1/products/{id}` | registro existente → revisão incrementada | If-Match: sim; Idempotency-Key: não |
| `GET /api/v1/receivables` | estado atual → sem alteração de estado | If-Match: não; Idempotency-Key: não |
| `GET /api/v1/receivables/{id}` | registro existente → sem alteração de estado | If-Match: não; Idempotency-Key: não |
| `POST /api/v1/receivables/{id}/payments` | open com saldo disponível → open com saldo restante ou paid ao zerar | If-Match: sim; Idempotency-Key: sim |
| `POST /api/v1/receivables/{id}/reverse-payment` | recebimento elegível ainda não estornado → saldo recomposto e conta reaberta quando aplicável | If-Match: sim; Idempotency-Key: sim |
| `GET /api/v1/roles` | estado atual → sem alteração de estado | If-Match: não; Idempotency-Key: não |
| `POST /api/v1/roles` | ausente → criado; revisão inicial | If-Match: não; Idempotency-Key: sim |
| `DELETE /api/v1/roles/{id}` | registro existente → excluído, se não atribuído | If-Match: sim; Idempotency-Key: não |
| `GET /api/v1/roles/{id}` | registro existente → sem alteração de estado | If-Match: não; Idempotency-Key: não |
| `PUT /api/v1/roles/{id}` | registro existente → revisão incrementada | If-Match: sim; Idempotency-Key: não |
| `GET /api/v1/stock` | estado atual → sem alteração de estado | If-Match: não; Idempotency-Key: não |
| `GET /api/v1/stock/movements` | estado atual → sem alteração de estado | If-Match: não; Idempotency-Key: não |
| `POST /api/v1/stock/movements` | ausente → criado; revisão inicial | If-Match: não; Idempotency-Key: sim |
| `GET /api/v1/users` | estado atual → sem alteração de estado | If-Match: não; Idempotency-Key: não |
| `GET /api/v1/users/{id}` | registro existente → sem alteração de estado | If-Match: não; Idempotency-Key: não |
| `PUT /api/v1/users/{id}` | registro existente → revisão incrementada | If-Match: sim; Idempotency-Key: não |
| `GET /health/live` | estado atual → sem alteração de estado | If-Match: não; Idempotency-Key: não |
| `GET /health/ready` | estado atual → sem alteração de estado | If-Match: não; Idempotency-Key: não |
| `GET /openapi.json` | estado atual → sem alteração de estado | If-Match: não; Idempotency-Key: não |

A revisão de movimentos de estoque fica no corpo; não é o cabeçalho If-Match. A edição de produto tem revisão, mas não a mesma política de chave das escritas dos cadastros auxiliares. As fichas não generalizam esses contratos.

## Próximos contratos a fechar

| Família | Ações/intenção | Decisões pendentes |
| --- | --- | --- |
| Funcionários e vendedores | Listar/criar/consultar/editar/inativar e vincular à empresa | Separar identidade Auth de cadastro profissional; desligamento não apaga histórico; regras de comissão em contrato próprio |
| Preços e catálogo completo | Categorias de produto, variantes, imagens, tabela/lista de preços, vigência e preço por canal/cliente | Definir precedência e arredondamento; preservar preço do pedido; não movimentar estoque ao cadastrar |
| Dados complementares de pessoas | Endereços, contatos e condições comerciais | Definir endereço de cobrança/entrega, versão usada no documento e limites de exposição |
| Depósitos e transferências | Cadastrar/inativar depósito; transferir produtos entre origens/destinos | Mesmo tenant; quantidade conservada; origem/destino auditáveis; não duplicar movimentos ao repetir |
| Inventário | Abrir sessão, contar/recontar, apurar diferença, aprovar/fechar | Contagem não ajusta saldo até aceite; tratar reservas e movimentações concorrentes |
| Produção | Criar ordem, reservar insumos, iniciar, consumir, apontar acabados, encerrar/cancelar | Definir ficha técnica, unidades, perdas, custo e recuperação; consumir insumos e receber acabado com rastreabilidade |
| Pedidos de compra | Criar/editar rascunho, aprovar/confirmar, cancelar, acompanhar recebimento | Aprovar pedido não aumenta saldo nem comprova obrigação financeira; definir recebimento parcial e tolerâncias |
| Recebimento de compra/XML de entrada | Importar documento, conferir fornecedor/itens, registrar recebimento e divergência | Validar vínculo fiscal; estoque apenas por recebimento confirmado; conta a pagar só pelo evento acordado; não lançar XML repetido |
| Sugestão de compra | Consultar demanda/recomendação e converter seleção em pedido | Sugestão não cria compra automaticamente; fórmula, estoque mínimo e reservas precisam de definição |
| Propostas | Criar/editar, enviar, aceitar/rejeitar/expirar, converter em pedido | Conversão idempotente; explicitar preços/vigência; proposta não reserva estoque por si |
| PDV | Abrir caixa/sessão, registrar venda, confirmar meios, cancelar/estornar e fechar | Fechamento reconciliável; não confundir pagamento declarado com liquidação; integração NFC-e separada |
| Pedidos — extensão | Desconto/frete, devolução parcial/total e vínculos fiscal/expedição | Definir cálculo/tetos, quantidades elegíveis, crédito/estorno e efeitos reversos em cada domínio |
| Anúncios/loja virtual/canais | Conectar catálogo, publicar/atualizar anúncio, importar pedido e sincronizar eventos | Credenciais protegidas; mapeamento externo; deduplicação; retentativas/reconciliação; respeitar fonte de verdade |
| Garantias/assistência | Abrir protocolo, verificar elegibilidade, triar, aprovar, encaminhar OS, reparar/trocar/devolver/encerrar | Reusar escopo AVL-319; SLA, evidências e efeitos financeiros/estoque precisam de estado e autorização claros |
| Contas a pagar | Originar/listar/detalhar, registrar pagamento parcial/integral e estorno | Origem auditável; não exceder saldo; não duplicar pagamento; não presumir execução bancária |
| Caixas/bancos/conciliação | Consultar livro/saldo, importar extrato, sugerir/confirmar/desfazer conciliação e transferir | Separar saldo calculado, extrato e liquidação; fechamento de caixa; conferir fonte/competência |
| Remessa/retorno/faturamento agrupado | Selecionar títulos, gerar lote, importar retorno, conciliar e desagrupar conforme regras | Layout/provedor contratado, autorização de envio, recuperação após timeout e mapeamento de rejeições |
| Comissões | Apurar, revisar, aprovar, originar obrigação e liquidar | Base por venda/recebimento a decidir; versão da regra; devoluções e estornos não podem manter comissão indevida |
| Fiscal NF-e 55 | Gerar XML, validar, assinar A1, enviar homologação, consultar/reconciliar e persistir autorização | AVL-328; reservar numeração pelo contrato, tratar rejeição/timeout/duplicidade; manter produção bloqueada até aceite externo |
| Monitor de Notas | Consultar distribuição, manter cursor fiscal por empresa, baixar/vincular documento e manifestar conforme contrato | AVL-320; cursor único, limites e autorização externa, XML/PDF com hashes e origem; sem confundir consulta com lançamento contábil |
| Demais documentos/tributos | NFC-e, CT-e, NFS-e, guias e rotinas contábeis | Não generalizar a NF-e para todos os modelos; regras aplicáveis, credenciamento, cancelamento/contingência e comprovação precisam de revisão específica |
| Logística/checkout | Selecionar pedido, separar/conferir, cotar, contratar, gerar/baixar etiqueta, postar, rastrear e tratar reversa | Pedido/volume e titularidade; contratação idempotente, timeout de resultado desconhecido, rastreio com fonte; etiqueta não comprova entrega |
| Serviços | Criar/versionar contrato, abrir/atribuir/executar/encerrar OS, faturar e cobrar | Medição e aprovação; materiais/horas; documento fiscal e título têm origens rastreáveis |
| Documentos/assinaturas | Criar envelope, enviar, acompanhar, cancelar e arquivar documento assinado | AVL-318/Clicksign; vínculo contratual, signatários, webhooks autenticados e evidência documental; não equiparar a assinatura NF-e |
| Relatórios/dashboards/auditoria | Consultar indicadores, detalhe, filtros e exportação | Dicionário de métricas, competência, tenant, paginação e valores conciliáveis com livros de origem |
| Eventos/notificações/assistente | Consultar eventos, marcar leitura e executar somente ações autorizadas explicitamente | Não criar ações financeiras/fiscais por inferência; origem do evento, canal, preferência e ausência de duplicação |
| Preferências e integrações | Consultar/alterar configuração por empresa; conectar/revogar, testar conexão e sincronizar | Segredos fora de responses/logs; escopo por provedor; nenhum estado “conectado” vindo apenas de lista estática |
| Importação/exportação geral | Pré-validar arquivo, revisar lote, aplicar, consultar resultado e exportar autorizado | Formato/versionamento, limites, rejeições por linha, idempotência, revisão e política transacional por domínio |

## Verificação e aceite

O workflow de inventário existente executa os testes de regressão e de cobertura; nenhum job foi acrescentado. O timeout desse job é de um minuto, abaixo do teto de 90 segundos. Testes/builds da aplicação não são executados no servidor.

O resultado `catalogued` afirma apenas que as fichas têm campos obrigatórios e correspondência estática de rotas/métodos/páginas. Não aprova ações da aplicação. `runtimeVerdict=not_verified_by_catalog` é obrigatório; `p0Ready=false` enquanto houver decisões pendentes.

Um endpoint novo exige uma ficha; um BFF novo exige ligação; rota removida não pode conservar contrato que alegue implementação. Comandos dinâmicos devem corresponder às ações da API listadas no catálogo, sem afirmar que o BFF já implementa uma allowlist em runtime.

O scanner segue a árvore convencional de módulos Rust, removendo do inventário os módulos carregados apenas por cfg(test) e os arquivos órfãos. O arquivo de suporte de teste continua participando da proveniência. Análise de macros, condições cfg complexas, atributos path e módulos inline externos não é coberta.

Nenhuma migration, modelo de banco novo, deploy, integração externa ou mudança de comportamento do ERP faz parte desta entrega.
