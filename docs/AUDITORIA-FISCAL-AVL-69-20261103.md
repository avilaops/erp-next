# Reconciliação fiscal — AVL-69 / AVL-62

## Escopo e proveniência

Auditoria em 03/11/2026 do `avilaops/erp-next`, base
`71cfacaf737dffedd7b6f4e6652162ff05a3fa49`. Entrega documental da
[AVL-69](https://linear.app/avilaops/issue/AVL-69), vinculada à
[AVL-62](https://linear.app/avilaops/issue/AVL-62). Não cria novas issues,
endpoints, migrations ou consumidores fiscais.

Foram lidas as 25 filhas, relações e comentários, além de AVL-12, AVL-28 e
AVL-320. Código, CI histórica, publicação registrada e evidência externa são
categorias distintas. Não houve transmissão, coleta, manifestação, consulta
autenticada de produção, alteração de permissões ou migration nesta auditoria.

As referências `src/lib/fiscal` e PRs de `avilaops/ERP` nas issues são do legado.
O motor atual declara portabilidade do commit legado
`08207ac14931a4efce3036088951828916720d48`; isso não transfere os aceites externos
para o processo Rust/BFF atual. A consulta às notas compartilhadas retornou
`McpServerError: Tool get_agent_context not found`; as demais fontes funcionaram.

## Estado reconciliado das 25 tarefas

Estados consultados: 17 Backlog, 1 In Progress, 3 In Review e 4 Done.
Classificação abaixo avalia o objetivo integral, não apenas a existência da rota.
Evidência histórica de conclusão é preservada; não houve mudança de status.

| Issue | Linear | Classificação e trabalho a aproveitar / falta concreta |
| --- | --- | --- |
| [AVL-69](https://linear.app/avilaops/issue/AVL-69) | In Progress | Parcial: arquitetura legada e atual inventariadas; revisão desta matriz e aceites de liberação pendentes. |
| [AVL-71](https://linear.app/avilaops/issue/AVL-71) | Backlog | Parcial no código: cofre A1, RLS e autorização existentes; granularidade de eventos e política de revogação em voo precisam fechamento. |
| [AVL-73](https://linear.app/avilaops/issue/AVL-73) | Done | Implementado e comprovado historicamente: XSD offline legado; motor portado e CI #48. Vigência normativa dos pacotes precisa reconciliação antes de nova homologação. |
| [AVL-75](https://linear.app/avilaops/issue/AVL-75) | Done | Parcial no aceite integral: persistência/leases/recuperação existentes; evidências históricas não discriminam todos os casos de reinício e concorrência no Next. |
| [AVL-77](https://linear.app/avilaops/issue/AVL-77) | Done | Homologação real histórica no legado; falta equivalência no Next e fechamento explícito de consulta, timeout/retomada e aceite operacional. |
| [AVL-80](https://linear.app/avilaops/issue/AVL-80) | Backlog | Parcial: telas e downloads existem; filtros, consolidação de pendências e capacidades precisam conciliação com os aceites. Depende 69/71. |
| [AVL-81](https://linear.app/avilaops/issue/AVL-81) | Backlog | Parcial: API v1 e OpenAPI existentes; concluir contrato por operação, paginação, jobs e permissões. Depende 75/71. |
| [AVL-85](https://linear.app/avilaops/issue/AVL-85) | Backlog | Parcial: outbox fiscal existe; entrega externa de webhooks fiscais, assinatura e deduplicação não comprovadas. |
| [AVL-87](https://linear.app/avilaops/issue/AVL-87) | Backlog | Parcial histórico: SMTP fiscal comprovado no legado; integração equivalente central/fila do Next não localizada no domínio fiscal. |
| [AVL-89](https://linear.app/avilaops/issue/AVL-89) | Backlog | Parcial: estados, auditoria e documentação existem; alertas/reprocessamento e aceite operacional integral não comprovados. |
| [AVL-91](https://linear.app/avilaops/issue/AVL-91) | In Review | Parcial: distribuição legada e monitor Next #34/#43; reutilizar AVL-320. Primeira coleta real no Next pendente nos registros. |
| [AVL-94](https://linear.app/avilaops/issue/AVL-94) | In Review | Parcial: manifestação explícita persistente; prova externa por evento e ambiente no Next pendente. |
| [AVL-95](https://linear.app/avilaops/issue/AVL-95) | Done | Implementação/publicação histórica comprovadas; importação Next existente. Conferir aceite individual e validação externa sem presumir equivalência. |
| [AVL-97](https://linear.app/avilaops/issue/AVL-97) | In Review | Parcial: #48 converte XML em compra única; recebimento físico continua separado. Reconciliar parciais/cancelamento e aceite ponta a ponta. |
| [AVL-101](https://linear.app/avilaops/issue/AVL-101) | Backlog | Ausente no contrato de emissão do motor: outras UFs permanecem fora do recorte. |
| [AVL-104](https://linear.app/avilaops/issue/AVL-104) | Backlog | Ausente no contrato operacional auditado: NFS-e Nacional. |
| [AVL-108](https://linear.app/avilaops/issue/AVL-108) | Backlog | Ausente: adaptadores municipais; depende 104. |
| [AVL-110](https://linear.app/avilaops/issue/AVL-110) | Backlog | Ausente: NFC-e operacional, CSC e contingência. |
| [AVL-111](https://linear.app/avilaops/issue/AVL-111) | Backlog | Parcial externo: DACTE no mcp-fiscal-brasil não comprova coleta/cursor CT-e no Next. |
| [AVL-112](https://linear.app/avilaops/issue/AVL-112) | Backlog | Ausente no contrato operacional auditado: captura NFS-e. |
| [AVL-113](https://linear.app/avilaops/issue/AVL-113) | Backlog | Aceite não comprovado: consulta CEP deve ser confrontada com cache/fallback; não reconstruir cadastros por inferência. |
| [AVL-114](https://linear.app/avilaops/issue/AVL-114) | Backlog | Aceite não comprovado: consultas CNPJ/IE, suporte alfanumérico e preservação manual exigem auditoria específica. |
| [AVL-115](https://linear.app/avilaops/issue/AVL-115) | Backlog | Bloqueado por definição externa de acesso/licença/vigência IBPT; entrega não comprovada. |
| [AVL-116](https://linear.app/avilaops/issue/AVL-116) | Backlog | Parcial: OpenAPI existente; integração fiscal n8n/MCP com aceite E2E não comprovada. |
| [AVL-117](https://linear.app/avilaops/issue/AVL-117) | Backlog | Parcial documental: usar matriz abaixo; liberação depende dos aceites de cada capacidade. |

Nenhuma tarefa foi classificada como duplicada integralmente. Há sobreposição
de implementação entre AVL-91/94/95/97, AVL-320, AVL-360 e AVL-396: vincular as
evidências existentes em vez de criar outro cursor, importador ou fila.

## Arquitetura e contratos atuais

Fluxo: interface → BFF autenticado → API Rust → adaptador fiscal privado.
A API controla empresa, permissões, transação, numeração, estado e auditoria;
o motor adapta XML/A1/XSD/SOAP e não possui banco. O navegador não recebe A1,
senha nem token do motor. n8n permanece consumidor assíncrono, nunca autoridade
do estado fiscal. Ver [mapa arquitetural](../architecture/README.md).

| Responsabilidade | Fonte canônica atual |
| --- | --- |
| Configuração, preparação e snapshots | `apps/api/src/domains/fiscal/mod.rs`, `model.rs`; migration `202610270004_fiscal_preparation.sql` |
| Cofre e validação A1 | `certificates.rs`, `certificate_crypto.rs`; migration `202610290002_fiscal_a1_certificates.sql` |
| Emissão, consulta, número e recuperação | `emission.rs`, `emission_events.rs`; migration `202611010002_fiscal_operations.sql` |
| Distribuição de homologação e manifestação | `incoming.rs`, `incoming_worker.rs`; migration `202611010003_fiscal_incoming.sql` |
| Monitor de produção e recebidas canônicas | `monitor.rs`, `received.rs`; migrations `202610310006_fiscal_monitor.sql` e `202610280005_received_nfe_integrations.sql` |
| Contrato máquina | `apps/api/src/http/openapi.rs`, `/openapi.json`; não substituir por tabela manual |
| Contratos operacionais e limites | [continuidade fiscal](RETORNOS-E-CONTINUIDADE-FISCAL.md), [monitor](MONITOR-FISCAL-CANONICO.md), [motor](../apps/fiscal-engine/README.md) |

Os nomes Rust sem prefixo na tabela pertencem a `apps/api/src/domains/fiscal/`.
As fichas antigas de preparação e recebidas são registros de fases anteriores;
as rotas e semântica atuais devem ser conferidas no OpenAPI e handlers.

### Persistência, estados e recuperação

`fiscal_number_sequences` tem chave empresa/ambiente/série.
`fiscal_nfe_documents` garante unicidade empresa/ambiente/série/número e chave de
acesso, liga rascunho/pedido por chaves compostas e conserva XML assinado antes
do transporte. Estados: `preparing`, `prepared`, `unknown`, `authorized`,
`rejected`, `cancelled`. Autorização/cancelamento exigem XML e protocolo.
Eventos persistem `pending`, `registered`, `rejected` ou `unknown`.

Timeout não comprova recusa nem autoriza emitir outro número. Recuperar a mesma
intenção, consultar a mesma chave e correlacionar ambiente/digest/protocolo.
Inutilização incerta conserva a faixa; a documentação atual declara conferência
operacional pendente, sem consulta oficial integrada que comprove seu resultado.

Mutações documentadas usam revisão e idempotência; verificar cada rota no
OpenAPI, pois monitor e credenciais possuem precondições próprias. Cursor, lote
e documentos são confirmados atomicamente. Produção usa o monitor canônico;
homologação usa a distribuição do motor. Não criar um terceiro consumidor.
Os controles locais não bloqueiam um coletor de outro sistema com o mesmo CNPJ.

### Lacunas verificadas de segurança e operação

- `emission_events.rs` autoriza cancelamento, CC-e e inutilização com
  `fiscal.nfe.issue`. Os nomes `fiscal.nfe.cancel/correction/void` usados no
  fluxo não provam permissões independentes. AVL-71 deve fechar a separação
  exigida pelos aceites e a estratégia aditiva de concessão, sem ampliar papéis.
- O cofre usa `fiscal.config.manage`; avaliar o aceite específico de gestão de
  certificado antes de introduzir um novo código de permissão.
- `monitor.rs` reautoriza antes de aplicar o lote. `incoming.rs` aplica resultado
  em transação da empresa e reautoriza depois do commit. Documentar a política
  para revogação durante a chamada e testar as duas vias antes de tratá-las como
  equivalentes; esta diferença isolada não demonstra vazamento entre empresas.
- Não foi localizado envio SMTP fiscal no domínio atual. O campo de e-mail no
  XML e a outbox não implementam envio de XML/DANFE ao destinatário.
- `apps/web/src/features/fiscal/fiscal-screen.tsx:278` e `nfe-drafts.tsx:49`
  declaram indisponibilidade fixa, enquanto `nfe-draft-editor.tsx:214` usa
  `canIssue && readiness.canTransmit`. AVL-80 deve apresentar a capacidade
  efetiva, sem transformar configuração disponível em homologação comprovada.
- A listagem de saída em `nfe-drafts.tsx` consulta rascunhos; o backend
  `/issued-nfes` já existe, mas não entrega todos os filtros status/período/modelo
  da central. Recebidas já tem busca/período/paginação no banco: preservar.
- Há leases e estados por documento/evento, mas não foi localizado contrato
  fiscal geral de jobs no OpenAPI. AVL-81 não deve prometer essa API como pronta.
- Recuperação criptográfica do A1 não equivale a ensaio de restauração de
  backup. AVL-71 ainda precisa comprovar retenção e recuperação de XML,
  protocolos e cofre, incluindo disponibilidade segura das chaves antigas.

## Matriz de capacidade e fontes oficiais

Fontes públicas consultadas em 03/11/2026. A consulta documental não executa
mTLS, não comprova credenciamento e não certifica cobertura legal. Custos de
certificado, infraestrutura, licenças e fornecedores não foram cotados; nenhum
valor zero ou acesso irrestrito é presumido.

| Capacidade | UF/município e versão | Implementação / acesso | Liberação e limite |
| --- | --- | --- | --- |
| NF-e 55 e eventos | SP; NF-e/autorização/consulta/inutilização 4.00; XML evento/envEvento 1.00; [SEFAZ SP](https://portal.fazenda.sp.gov.br/servicos/nfe/Paginas/URL-WEBSERVICES.aspx) | Motor com A1, configuração explícita, recortes CRT 1/3 documentados; schemas locais NF-e `PL_010f v1.04`, eventos/inutilização `PL_010d v1.03` | Homologação no contrato; produção bloqueada. Vigência do pacote ainda deve ser reconciliada com NT vigente. Sem inferência tributária. |
| NF-e recebida / DF-e | Ambiente Nacional; separar monitor produção de distribuição homologação | A1 e empresa destinatária; cursor e cooldown persistidos; detalhes no contrato do monitor | Primeira coleta real no Next pendente no registro AVL-320. Não manifestar automaticamente para obter XML. |
| NF-e demais UFs | Matriz por autorizador pendente na AVL-101 | Contrato atual do emissor não oferece cobertura fora de SP | Não habilitar por extrapolação dos testes SP. |
| NFC-e 65 | SP publica serviços 4.00; [fonte oficial](https://portal.fazenda.sp.gov.br/servicos/nfce/Paginas/WebServices.aspx) | Sem adaptação operacional comprovada; requisitos de credenciamento/CSC devem ser fechados em AVL-110 | Desabilitada; serviço oficial disponível não significa suporte do ERP. |
| NFS-e Nacional | [Catálogo oficial de manuais, APIs e anexos](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual) | Nenhuma versão de API/leiaute adotada no ERP auditado; selecionar manual e esquema por ambiente na AVL-104 | Desabilitada. Município, adesão, acesso e custo de eventual fornecedor pendentes. |
| NFS-e municipal / captura | Municípios não selecionados | Sem adaptador comprovado; AVL-108/112 devem fixar município, versão, credencial, custo e restrições oficiais | Desabilitada; não declarar cobertura nacional com base no catálogo nacional. |
| CT-e recebido | SP publica serviços 4.00; [fonte oficial](https://portal.fazenda.sp.gov.br/servicos/cte/Paginas/Webservices.aspx) | DACTE externo histórico não implementa distribuição/cursor CT-e do ERP | Captura não liberada; AVL-111 deve definir acesso por papel e validar distribuição específica. |

O manifesto `apps/fiscal-engine/src/lib/fiscal/schemas/manifest.json` registra
`sourceCheckedAt: 2026-10-10`. Hash correto comprova integridade do pacote
versionado; não comprova que continua sendo a versão fiscal vigente.

## Evidências separadas

### GitHub e CI histórica confirmados nesta auditoria

| Entrega | Merge confirmado | CI do head consultada: success |
| --- | --- | --- |
| [PR #34](https://github.com/avilaops/erp-next/pull/34), monitor | `619bb4429ec93e71c39a08013b6083337ecb0abb` | [41250008397](https://github.com/avilaops/erp-next/actions/runs/41250008397) |
| [PR #43](https://github.com/avilaops/erp-next/pull/43), transferência A1 / grants | `086663b051202989807dcb5e2a57e1c1cc2a64b8` | [41253291865](https://github.com/avilaops/erp-next/actions/runs/41253291865) |
| [PR #48](https://github.com/avilaops/erp-next/pull/48), operações / entradas | `d9e82b3bef4e86ac6f50f79281e2a4fdaf8f2fcc` | [41277401350](https://github.com/avilaops/erp-next/actions/runs/41277401350) |

As contagens de testes constam nos PRs; não foram reexecutadas nesta auditoria
documental. A CI histórica não valida alterações posteriores nem o servidor atual.
O único PR aberto retornado na consulta foi #61, de logout, fora deste escopo.

### Publicação registrada e evidência externa

- AVL-77/12 registram em 23/10 autorização real, CC-e/cancelamento e SMTP no
  ERP legado; o comentário posterior fecha PIX. Consulta explícita,
  timeout/retomada e aceite operacional não têm fechamento individual explícito.
  Preservar os protocolos privados nas fontes originais, sem copiá-los aqui.
- AVL-28 registra implementação, publicação e verificação autenticada de regras
  por nota no legado. Não refazer essa decisão contábil por inferência.
- AVL-320 está **In Progress**, não In Review, na consulta atual. Comentário de
  01/11 registra consumidor único, legado parado e monitor habilitado, sem
  executar coleta externa. Primeira coleta/painel/XML continuam pendentes.
  Esses registros não são uma checagem atual do host ou do consumidor único.
- O PR #48 registra ausência de perfil fiscal e configuração de motor na sua
  checagem operacional histórica. Revalidar antes de concluir bloqueio atual.

## Migração, reversão e sequência executável

Esta entrega não altera schema. Preservar migrations publicadas e seus hashes;
qualquer evolução será aditiva, com um integrador responsável pela numeração.
Builds/imagens e migrations devem usar os workflows GitHub existentes.

Rollback de aplicação não desfaz documento emitido, número reservado, cursor,
protocolo ou auditoria. Antes de reverter versão, confirmar compatibilidade do
binário anterior com o schema e suspender novos trabalhos do ambiente afetado.
Conservar XML/estados incertos e reconciliar antes de retomar; nunca restaurar
sequência/cursor antigo para tentar novamente. Ensaiar em banco isolado.

1. Revisar esta matriz na AVL-69, incluindo pacote XSD/NT vigente e critérios de
   acesso/custo ainda não definidos. Manter In Progress até aceite documental.
2. AVL-71: separar permissões de eventos conforme aceite, definir revogação em
   voo e cobrir matriz negativa em banco isolado. Responsável único por migration,
   catálogo de permissões e contratos; não alterar papéis reais para testar.
3. AVL-75/73: anexar evidências do motor e testes Rust aos critérios existentes;
   fechar reinício/resultado incerto e vigência dos schemas sem recriar serviços.
4. AVL-77/12: depois das dependências, conferir prontidão em ambiente permitido e
   preparar caso de homologação explicitamente autorizado com dados aprovados.
   Registrar XML/hash, chave/protocolo privados, consulta e recuperação.
5. AVL-320/91/94/95: validar consumidor único atual e executar primeira coleta
   somente com autorização específica; manifestação exige documento/evento
   designados. Não alterar o cursor manualmente nem ligar outro coletor.
6. AVL-80/81: só iniciar implementação após resolver dependências 69/71 e 75/71,
   respectivamente; reutilizar rotas/UI/OpenAPI existentes. AVL-87 fecha a
   lacuna do e-mail, AVL-85 a entrega confiável de webhooks.

## Coordenação e validação desta entrega

Integrador: documentação AVL-69 e referências históricas. Agente Linear:
somente leitura das issues. Agente segurança: somente leitura de API fiscal e
migrations. Agente operações: somente leitura de motor, UI e contratos.
Nenhum agente recebeu propriedade concorrente de arquivo ou migration.

Checkout isolado: `docs/avl-69-fiscal-reconciliation`. Alterações preexistentes
de vendas, segurança/logout e compras foram preservadas. Validação documental:
conferir links relativos, existência das fontes, 25 issues únicas, diff e ausência
de dados privados. Testes fiscais, deploy e validações externas não executados
por esta entrega documental. Não recomendar Done para a plataforma fiscal.

O agente de operações verificou em Node 24.18.0 os SHA-256 dos 13 arquivos XSD
contra o manifesto versionado: 13 aprovados. Sem instalação de dependências e
sem chamada externa. Integridade não comprova vigência normativa dos schemas.
