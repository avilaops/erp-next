# Arquitetura e matriz de capacidades fiscais — AVL-69

<!-- markdownlint-configure-file {"MD013": {"tables": false}} -->

## Escopo, base e coordenação

Snapshot documental de 03/11/2026, código-base
`c3340aa3798da8433025151306291a527ce45b38`, repositório `avilaops/erp-next`.
Entrega da [AVL-69](https://linear.app/avilaops/issue/AVL-69), parte da
[AVL-62](https://linear.app/avilaops/issue/AVL-62).

Este documento complementa a
[reconciliação das 25 tarefas no PR #62](https://github.com/avilaops/erp-next/pull/62),
head `3c75ab3d880be8452f648d473e270d527e005915`. Não substitui aquele inventário
nem modifica seus três arquivos. Agente responsável: Agente de engenharia ·
AVL-69; escopo exclusivo desta rodada: este arquivo. Não houve delegação nesta
rodada. O arquivo preexistente `codex-session-01a.md` permanece fora da entrega.

A issue foi lida com seus quatro critérios, pai, relações, comentários e anexos.
Não tem bloqueadores anteriores nem subtarefas próprias cadastradas; as tarefas
de execução são filhas da AVL-62. O MCP `get_agent_context` retornou
`McpServerError: Tool get_agent_context not found`; foram usadas as descrições,
comentários, fontes do código e GitHub. As referências `src/lib/db/issue-nfe.ts`,
`invoices.ts` e `send-nfe-mail.ts` das issues pertencem ao ERP legado.

## Decisão de arquitetura

Preservar o [mapa de responsabilidades](../../../architecture/README.md): interface →
BFF de sessão → API Rust → adaptador fiscal privado. Consolidar responsabilidades
nos serviços internos existentes, sem criar um microserviço, cursor ou banco por
documento nesta entrega. A API é a autoridade sobre empresa, permissões,
numeração, snapshots, estados, auditoria e persistência. O motor Node adapta
XML/A1/XSD/SOAP; não é dono de pedidos, banco ou fila.

| Serviço interno / fronteira | Implementação atual | Regra de evolução |
| --- | --- | --- |
| Preparação de NF-e 55 e vínculo comercial | [mod.rs](../../../apps/api/src/domains/fiscal/mod.rs), [model.rs](../../../apps/api/src/domains/fiscal/model.rs), [order_source.rs](../../../apps/api/src/domains/fiscal/order_source.rs) | Manter snapshots e revisão do pedido; regras fiscais declaradas não podem ser inferidas do CNPJ ou de recebimentos. |
| Ciclo do documento NF-e e eventos | [emission.rs](../../../apps/api/src/domains/fiscal/emission.rs), [emission_events.rs](../../../apps/api/src/domains/fiscal/emission_events.rs) | Separar a intenção persistida do transporte; preservar a mesma chave e número na recuperação de resultado incerto. |
| Adaptação SEFAZ SP em homologação | [engine_client.rs](../../../apps/api/src/domains/fiscal/engine_client.rs), [engine.ts](../../../apps/fiscal-engine/src/engine.ts), [contrato do motor](../../../apps/fiscal-engine/README.md) | Reutilizar `prepare`, `authorize`, `consult`, `event`, `void`, `distribute`, `manifest`; não adicionar UF alterando somente uma URL. |
| Distribuição/manifestação nacional de NF-e | [monitor.rs](../../../apps/api/src/domains/fiscal/monitor.rs), [sefaz_client.rs](../../../apps/api/src/domains/fiscal/sefaz_client.rs), [incoming.rs](../../../apps/api/src/domains/fiscal/incoming.rs) | Monitor canônico para produção; distribuição do motor para homologação. Não ligar dois coletores do mesmo CNPJ/ambiente. |
| XML recebido e conversão em compra | [received.rs](../../../apps/api/src/domains/fiscal/received.rs), [incoming_reconciliation.rs](../../../apps/api/src/domains/fiscal/incoming_reconciliation.rs) | Importação/conversão não confirma recebimento físico, estoque ou pagamento. Preservar mapeamento explícito e compra única. |
| Cofre A1 | [certificates.rs](../../../apps/api/src/domains/fiscal/certificates.rs), [certificate_crypto.rs](../../../apps/api/src/domains/fiscal/certificate_crypto.rs) | Empresa e versão da chave acompanham a criptografia; o navegador não recebe senha, PFX nem credencial do motor. |
| Distribuição de e-mail fiscal | `send-nfe-mail.ts` no legado, conforme AVL-87/77 | Reaproveitamento no Next depende da AVL-87; não confundir campo de e-mail do XML, outbox ou envio de contrato comercial com SMTP fiscal. |

Para futuras capacidades, a identidade de seleção será documento + operação +
UF do emitente + município IBGE quando aplicável + autorizador + ambiente +
versão do contrato. Esta é uma decisão documental; não existe um registro
genérico executável com essa estrutura no runtime auditado. Credenciamento do
tenant, permissão atual e recorte tributário continuam sendo verificações
adicionais. Autorizador de emissão, distribuidor nacional e contingência são
papéis diferentes; um certificado válido não habilita todos eles.

Novos adaptadores devem ser internos ao mecanismo existente e começar
desabilitados. NFS-e terá identidade municipal/DPS e contrato próprio: não
reutilizar automaticamente tabelas, chave de 44 dígitos ou sequência de NF-e.
O contrato público atual permanece a [API/OpenAPI](../../../apps/api/src/http/openapi.rs),
sem novo endpoint ou promessa de API geral de jobs neste documento.

## Inventário: implementação, publicação e evidência externa

| Requisito / capacidade | Classificação no Next | Publicação / merge observado | Evidência externa e limite |
| --- | --- | --- | --- |
| NF-e 55/SP, consulta e eventos | Parcial: código e testes existem, recortes CRT 1/3 explícitos | Histórico integrado na `main`; release atual do servidor não foi consultado nesta rodada | AVL-77 registra autorização, CC-e, cancelamento e SMTP reais em homologação no legado. Não comprova execução do motor/BFF/Rust atual. |
| Distribuição/manifestação de NF-e e entradas | Parcial: cursor, leases, XML, manifestação e compra vinculada existentes | PRs #34/#43/#48 integrados; fonte atual preservada | Primeira coleta/manifestação e aceite operacional no Next não foram comprovados nesta rodada. Não executar para completar a matriz. |
| E-mail fiscal já existente | Implementado historicamente no legado; integração no Next ausente no domínio fiscal inspecionado | AVL-77 registra publicação do legado `431e3b9`; não há evidência equivalente de SMTP fiscal do Next nesta rodada | Comentários de 23/10/2026 registram envio de nota, CC-e e cancelamento por SMTP. Aceitação SMTP não comprova leitura/entrega ao destinatário. Reutilizar AVL-87, sem criar demanda duplicada. |
| Configuração real da Ludus, AVL-12 | Referência externa histórica; não são defaults do Next | AVL-12 está Done e tem comentário posterior à descrição antiga confirmando a configuração | Não copiar CST, CFOP ou alíquotas para outro tenant ou operação. Registro de 23/10 pertence ao legado; cadastros atuais não foram consultados. |
| Regras por nota, AVL-28 | Implementado/publicado historicamente no legado; paridade integral não comprovada no Next | AVL-28 está Done; descrição registra `08a4b53`, PR #16 do legado, publicação e conferência autenticada | A declaração explícita do rascunho Next não comprova todas as etapas, herança/restauração e concorrência aceitas na AVL-28. Preservar documentos já assinados. |
| NFC-e, NFS-e e CT-e recebidos | Ausentes no contrato operacional fiscal inspecionado; não liberados | Sem publicação correspondente verificada | Fontes públicas e renderização de documento auxiliar não comprovam integração, credenciamento ou autorização. |

Fontes privadas de rastreabilidade, sem copiar CNPJ, chave, protocolos ou
destinatários reais: [AVL-12](https://linear.app/avilaops/issue/AVL-12),
[AVL-28](https://linear.app/avilaops/issue/AVL-28),
[AVL-77](https://linear.app/avilaops/issue/AVL-77) e
[AVL-87](https://linear.app/avilaops/issue/AVL-87). O estado Done dessas issues
não transfere automaticamente seu aceite para o ERP-Next. As descrições antigas
de AVL-12/77 ainda narram pendências superadas pelos comentários posteriores.

## Matriz por documento, autorizador e jurisdição

Fontes oficiais públicas consultadas em 03/11/2026. Versão publicada de serviço,
leiaute XML e pacote de schemas são campos diferentes. Custo **não apurado**
significa ausência de tabela/contratação comprovada nesta auditoria, nunca custo
zero. Certificado, infraestrutura e fornecedor opcional não foram cotados.

| Documento / operação | UF / município / autorizador | Versão oficial ou adotada | Acesso e custo | Limitação / condição no ERP-Next |
| --- | --- | --- | --- | --- |
| NF-e 55: emissão, consulta, cancelamento, CC-e, inutilização | Emitente SP; SEFAZ SP; município do emitente validado no cadastro | Serviços 4.00 em [S1]; NF-e/inutilização XML 4.00, evento XML 1.00; pacotes adotados na seção seguinte | A1, vínculo com empresa e configuração fiscal explícita; custo não apurado | Implementação restrita à homologação; CRT 1/3 apenas nos recortes do motor. Produção bloqueada no código auditado. |
| NF-e 55: emissão fora de SP | Demais 26 UFs; autorizadores próprios, SVRS ou SVAN conforme [S2] | Referência nacional 4.00; nenhum adaptador adicional adotado | Credenciamento e certificado devem ser verificados por UF/ambiente; custo não apurado | Desabilitada; AVL-101 deve validar cada autorizador, tributação e retorno, sem extrapolar SP. |
| NF-e 55: contingência | SVC-AN/SVC-RS; elegibilidade por UF em [S2] | Serviços publicados não constituem suporte ao modo de emissão | Ativação e condições do autorizador precisam de validação específica; custo não apurado | Não há capacidade de contingência homologada no contrato auditado; não usar como fallback automático. |
| NF-e 55: distribuição e manifestação | Ambiente Nacional; empresa interessada; UF de emissão não implica adaptador de saída para essa UF | Serviço de distribuição 1.00 no catálogo [S2]; `distDFeInt` 1.01 no código. Manifestação usa evento XML 1.00 | A1 e papel fiscal/empresa autorizados; custo não apurado; sem acesso irrestrito por chave | Produção: monitor próprio; homologação: motor. Cooldown/NSU e confirmação explícita; obter XML não autoriza manifestação automática. |
| NFC-e 65 | SP como primeiro recorte proposto; demais UFs sem seleção de adaptador | Serviços de geração 4 no catálogo SP [S3]; nenhum leiaute/pacote NFC-e adotado pelo ERP | Credenciamento e CSC indicados no portal [S4], além de certificado e requisitos aplicáveis; custo não apurado | Ausente/desabilitada, AVL-110. Não reutilizar a emissão NF-e 55 sem QR Code, CSC, contingência e testes próprios. |
| NFS-e Nacional: DPS, emissão, consulta e eventos | Sefin Nacional + parâmetros do município IBGE; nenhum município habilitado no ERP | Catálogo [S5]: XSD e leiaute DPS/NFS-e `v1.01-20260209`, eventos `v1.01-20260122`; nenhuma versão adotada | Acesso/credencial e elegibilidade devem ser confirmados no contrato do ambiente e contribuinte, [S6]/[S7]; custo não apurado | Ausente/desabilitada, AVL-104. Adesão municipal [S8] não comprova uso do emissor público por toda empresa. |
| NFS-e municipal / NFS-e recebida | Nenhum município/provedor selecionado; não há cobertura municipal implícita | Não adotada; exige manual/esquema do município ou API ADN aplicável | Credencial, papel, prazo de captura, custo e eventual licença ainda não definidos | Ausente/desabilitada, AVL-108/112. Selecionar município IBGE e registrar fonte oficial municipal antes de implementar. |
| CT-e 57 recebido | Distribuidor Ambiente Nacional do CT-e; não é o autorizador de emissão SP/SVRS/SVSP | [S9] distingue serviços de emissão 4.00 e `CTeDistribuicaoDFe` 1.00; nenhum pacote CT-e adotado | Certificado, ator autorizado e contrato específico da distribuição devem ser validados; custo não apurado | Ausente/desabilitada, AVL-111. Não compartilhar cursor NF-e, importar XML como NF-e nem tratar DACTE como prova de captura. |

### Cobertura de NF-e por UF: catálogo versus suporte

O agrupamento de autorizadores normais abaixo vem do conteúdo público indexado
do Portal NF-e [S2]. A página de serviços retornou laço de redirecionamento em
duas URLs; a relação de autorizadores foi conferida na página oficial de
disponibilidade. Não foram consultados serviços fiscais nem WSDL com certificado.
Este snapshot precisa de nova conferência antes da AVL-101;
não alimenta roteamento.

| Autorizador normal de NF-e | UFs do emitente | Suporte de emissão no ERP-Next |
| --- | --- | --- |
| SEFAZ SP | SP | Homologação no recorte tributário explícito; produção bloqueada |
| Autorizadores próprios das respectivas UFs | AM, BA, GO, MG, MS, MT, PE, PR, RS | Desabilitado para todas as nove UFs |
| SVRS | AC, AL, AP, CE, DF, ES, PA, PB, PI, RJ, RN, RO, RR, SC, SE, TO | Desabilitado para todas as dezesseis UFs |
| SVAN | MA | Desabilitado |

São 27 UFs únicas. A divisão é para autorização normal de **NF-e**, não para
consulta cadastral, NFC-e, CT-e ou contingência. Receber XML emitido em outra UF
não habilita emissão naquela UF. Para NFS-e, o conjunto de municípios habilitados
no ERP é vazio; os futuros municípios precisam de código IBGE, ambiente, versão,
credencial, custo e aceite próprios, sem assumir paridade com NF-e/SP.

### Fontes oficiais e versões

- **S1**: [SEFAZ SP — URLs NF-e](https://portal.fazenda.sp.gov.br/servicos/nfe/Paginas/URL-WEBSERVICES.aspx).
  Lista separada de homologação e produção. O serviço RecepcaoEvento4 não muda
  a versão 1.00 do envelope XML de evento.
- **S2**: [Portal NF-e — disponibilidade e autorizadores](https://www.nfe.fazenda.gov.br/portal/disponibilidade.aspx/listaConteudo.aspx?AspxAutoDetectCookieSupport=1&tipoConteudo=sNOtscnJo6w%3D)
  e [catálogo nacional de serviços](https://www.nfe.fazenda.gov.br/portal/webservices.aspx?AspxAutoDetectCookieSupport=1).
  O catálogo foi acessível pelo índice público, mas sua abertura direta falhou
  nesta consulta. Não declarar disponibilidade operacional ou roteamento testado.
- **S3**: [SEFAZ SP — serviços NFC-e](https://portal.fazenda.sp.gov.br/servicos/nfce/Paginas/WebServices.aspx).
- **S4**: [SEFAZ SP — credenciamento e CSC](https://portal.fazenda.sp.gov.br/servicos/nfce/).
- **S5**: [NFS-e — documentação atual de produção](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual).
  Catálogo atualizado em 31/10/2026; versões de produção não autorizam usar o
  mesmo pacote em produção restrita sem conferência.
- **S6**: [NFS-e — APIs por ambiente](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/apis-prod-restrita-e-producao).
  Distingue Sefin, ADN, contribuintes e parametrização municipal.
- **S7**: [NFS-e — manual do contribuinte, arquivo v1.2/out2025](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/manual-contribuintes-emissor-publico-api-sistema-nacional-nfs-e-v1-2-out2025.pdf).
  Descreve DPS, parâmetros municipais e recuperação da chave; nome do arquivo
  e histórico interno de versão não substituem a versão do XSD.
- **S8**: [NFS-e — acompanhamento das adesões](https://www.gov.br/nfse/pt-br/municipios/monitoramento-adesoes).
- **S9**: [Portal CT-e — serviços e distribuidor nacional](https://www.cte.fazenda.gov.br/portal/webServices.aspx).

O [manifesto adotado](../../../apps/fiscal-engine/src/lib/fiscal/schemas/manifest.json)
registra NF-e `PL_010f v1.04`, evento/inutilização `PL_010d v1.03` e
`sourceCheckedAt: 2026-10-10`. São 13 arquivos com SHA-256. Integridade local
não comprova vigência normativa; não houve atualização de pacote nesta entrega.
As referências do catálogo NFS-e acima não foram instaladas no motor.

## Contratos, persistência e estados preservados

| Invariante | Fonte atual / decisão |
| --- | --- |
| Empresa, ambiente e documento | [preparação](../../../migrations/202610270004_fiscal_preparation.sql) e [operações](../../../migrations/202611010002_fiscal_operations.sql): emissor/rascunho congelam snapshots; schema de saída só aceita `homologation`, modelo 55 no contrato. |
| Sequência e chave | `fiscal_number_sequences`: PK tenant/ambiente/série. Documento: unicidade tenant/ambiente/série/número e tenant/ambiente/chave. Chave NF-e de 44 dígitos, série 1–999, número 1–999999999. Reservar uma vez e persistir XML assinado antes de transmitir. |
| Estados NF-e | `preparing`, `prepared`, `unknown`, `authorized`, `rejected`, `cancelled`. XML/protocolo exigidos pelos estados aplicáveis; preservar rejeição/retorno e não converter timeout em autorização ou recusa. |
| Estados de eventos | `pending`, `registered`, `rejected`, `unknown`; identidade por documento/tipo/sequência. Inutilização desconhecida mantém faixa reservada e exige reconciliação; não há consulta integrada que resolva todos os casos. |
| Cursor de produção | [monitor](../../../migrations/202610310006_fiscal_monitor.sql): PK tenant e CNPJ armazenado, ambiente de produção implícito no transporte fixo. Não existe coluna de ambiente nesse cursor. |
| Cursor de homologação | [incoming](../../../migrations/202611010003_fiscal_incoming.sql): PK tenant/ambiente, restrito a ambiente 2. Não renomear/reaproveitar o cursor de produção como migração automática. |
| Recebidas canônicas | [persistência de recebidas](../../../migrations/202610280005_received_nfe_integrations.sql): ambiente 1/2, XML/hash e unicidade tenant/chave; a [extensão do monitor](../../../migrations/202610310006_fiscal_monitor.sql) aceita emitente CPF/CNPJ. Lote e cursor devem confirmar juntos. |
| Revisão, replay e erros | API fiscal usa sessão/identidade, empresa autorizada, permissões, `If-Match`/`Idempotency-Key` onde exigidos. Contrato por rota no OpenAPI; não universalizar headers de uma rota para todas. `403/404/409/412/428/503` distinguem acesso, inexistência, conflito, revisão, precondição e indisponibilidade conforme o handler. |
| Isolamento e auditoria | RLS forçada nas tabelas fiscais; contexto `app.tenant_id`, chaves compostas e auditoria/outbox transacionais. Aplicação sem superusuário/BYPASSRLS; não executar testes com identidade real. |
| Pedidos e compras | Concluir venda não autoriza NF-e; cancelar venda não cancela documento sem resposta correlacionada. Criar compra de recebida não movimenta estoque/financeiro antes do recebimento físico. Ver [continuidade fiscal](../../telas/fiscal/nfe/referencias/RETORNOS-E-CONTINUIDADE-FISCAL.md). |

Permissões granulares e reautorização em voo são escopo da AVL-71; não presumir
separação apenas pelo nome do evento na auditoria. O monitor reautoriza antes
de aplicar o lote; a política da via de homologação ainda precisa ser reconciliada.
Essa diferença não é motivo para criar outro consumidor ou contornar a API.

## Migração reversível e critérios de liberação

Esta entrega não aplica nem cria migration. A evolução por documento/autorizador
seguirá etapas compatíveis com as tabelas e processos atuais:

1. Acrescentar o contrato/capacidade desabilitada e seu adaptador por revisão,
   com dono único da migration se houver alteração de schema. Não reescrever
   migrations publicadas, XML, hash, número, cursor ou protocolo anteriores.
2. Validar em banco isolado RLS, permissões, revisão, idempotência, concorrência,
   perda de resposta, reinício e rejeição; ensaiar restauração das chaves antigas
   e documentos sem repetir chamada externa. Teste sintético deve ser identificado.
3. Conferir fonte/versão do autorizador, cadastro/credenciamento do tenant,
   certificado, tributos aprovados e consumidor único. Sem configuração completa,
   a capacidade continua recusada. Não usar a configuração Ludus como padrão.
4. Homologar somente com autorização explícita e cenário designado. Registrar
   ambiente, revisão/imagem, XML/hash, retorno e protocolo em local privado;
   vincular a evidência sem publicar dados reais no repositório.
5. Liberar por documento/operação/empresa/ambiente após aceite da AVL-117.
   Rollback desliga novos trabalhos e reverte apenas binário compatível; conserva
   intenções incertas, XML, números e cursores. Não restaurar sequência/cursor
   antigo, apagar auditoria nem reenviar documento para simular reversão.

Prioridade: completar NF-e/SP e entradas já existentes. AVL-71 fecha segurança;
AVL-73/75 fecham vigência/recuperação; AVL-77/320 registram aceites específicos
do Next; AVL-87 integra e-mail. Expansão fica em AVL-101/104/108/110/111/112,
desabilitada até validação própria. A matriz não altera flags nem libera produção.

## Evidência e aceite desta rodada

Entrega exclusivamente documental. Não houve alteração de runtime, dependência,
schema, UI, permissão ou workflow; nenhum documento fiscal real, consulta
autenticada de produção, envio de e-mail, deploy ou migration foi executado.

O CI do PR #62 é evidência separada: [inventário aprovado](https://github.com/avilaops/erp-next/actions/runs/41571309116)
e [CI com falha](https://github.com/avilaops/erp-next/actions/runs/41571309122).
O job `web-browser` passou 142 testes gerais e 3 do monitor; a etapa seguinte
não iniciou o servidor de sessão: `EADDRINUSE`, `127.0.0.1:33128`.
Isso não é aprovação integral daquele PR nem falha fiscal demonstrada.
Sua correção depende do responsável pela configuração de testes; nenhum arquivo
do PR #62 foi alterado para contornar o gate.

Verificações locais executadas em Node 24.21.0, sem credencial fiscal:

- `node --test scripts/architecture/check.test.mjs`: 5 testes aprovados.
- `node scripts/architecture/check.mjs`: nenhuma violação, 301 rotas preservadas.
- `node --test verification/test/*.test.mjs`: 39 testes aprovados.
- Em `apps/fiscal-engine`, `node --import ./scripts/register.mjs --test
  tests/fiscal-local-layout.test.ts`: 7 testes aprovados com fixtures sintéticas.
- Conferência documental por Python: 25 links relativos existentes, 9 referências
  oficiais definidas, 27 UFs únicas e SHA-256 dos 13 XSDs iguais ao manifesto.
- `npm exec --yes --package=markdownlint-cli2@0.24.0 -- markdownlint-cli2
  docs/historico/registros/MATRIZ-CAPACIDADES-FISCAIS-AVL-69.md`: nenhuma ocorrência. A regra de
  largura de linha mantém a exceção explícita apenas para tabelas.
- Hash do arquivo preexistente conferido sem alteração; diff restrito a este
  documento. As saídas locais ficam em `artifacts/consolidacao/avl-69-*.log`.

Rastreabilidade dos quatro critérios da AVL-69: inventário separado nesta
matriz; contratos/persistência/estados e migração nas seções próprias; cobertura,
versões, fontes/acesso/custo por documento e jurisdição; prioridade NF-e/SP e
entradas com expansão desabilitada. Aceite documental, CI do novo PR e merge
devem ser registrados na issue separadamente. Recomendar In Review após a
validação documental; não inferir Done ou conclusão dos aceites externos.

[S1]: https://portal.fazenda.sp.gov.br/servicos/nfe/Paginas/URL-WEBSERVICES.aspx
[S2]: https://www.nfe.fazenda.gov.br/portal/disponibilidade.aspx/listaConteudo.aspx?AspxAutoDetectCookieSupport=1&tipoConteudo=sNOtscnJo6w%3D
[S3]: https://portal.fazenda.sp.gov.br/servicos/nfce/Paginas/WebServices.aspx
[S4]: https://portal.fazenda.sp.gov.br/servicos/nfce/
[S5]: https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual
[S6]: https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/apis-prod-restrita-e-producao
[S7]: https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/manual-contribuintes-emissor-publico-api-sistema-nacional-nfs-e-v1-2-out2025.pdf
[S8]: https://www.gov.br/nfse/pt-br/municipios/monitoramento-adesoes
[S9]: https://www.cte.fazenda.gov.br/portal/webServices.aspx
