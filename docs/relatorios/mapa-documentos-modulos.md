# Mapa de relatórios, PDF e envio por e-mail

Levantamento de código em 12/11/2026. Referência funcional: commit `76b2c4f`; ramo de trabalho `feat/corporate-order-documents-smtp-20261112`. **Este documento é um inventário e roteiro proposto, não uma declaração de funcionalidades entregues.** O PDF próprio do pedido e o SMTP global em Preferências estão em desenvolvimento neste ramo e não entram como concluídos na matriz.

## Escopo e critério de contagem

Foram cruzados o [catálogo de navegação](../../apps/web/src/components/shell/navigation-catalog.ts:3), o [catálogo de Preferências](../../apps/web/src/components/shell/preference-catalog.ts:11), as páginas em `apps/web/src/app`, os componentes chamados por elas, as rotas HTTP e os produtores de anexos no backend. A presença no menu não comprova operação, relatório, PDF ou envio.

O resultado está organizado em **13 famílias e 84 linhas funcionais**. Cada linha tem um ID único; criar/editar/detalhar o mesmo recurso não aumenta a contagem. Atalhos equivalentes são agrupados: NFS-e/CT-e em Serviços usam o mesmo recurso de Fiscal; cobranças de Serviços usam Contas a receber; relatórios de Vendas/Financeiro/Serviços têm aliases. Preferências relacionadas estão agrupadas por função, incluindo opções explicitamente indisponíveis. Não são 84 modelos de PDF nem 84 módulos independentes.

| Família | IDs | Linhas |
| --- | --- | ---: |
| Meu Negócio e análises | AN01–AN06 | 6 |
| Cadastros e catálogo | CA01–CA07 | 7 |
| Vendas | VE01–VE10 | 10 |
| Compras e suprimentos | CO01–CO04 | 4 |
| Estoque e produção | ES01–ES06 | 6 |
| Logística | LO01–LO05 | 5 |
| Financeiro e contabilidade | FI01–FI11 | 11 |
| Pessoas e RH | RH01–RH03 | 3 |
| Fiscal | FS01–FS09 | 9 |
| Serviços e contratos | SE01–SE03 | 3 |
| Central de relatórios | RE01–RE07 | 7 |
| Empresa, administração e Preferências | AD01–AD10 | 10 |
| Central de trabalho e histórico | TR01–TR03 | 3 |
| **Total** | **84 IDs** | **84** |

Na coluna de estado, `T` significa consulta/tela operacional, sem relatório documental próprio; `R` significa relatório ou demonstrativo implementado; `—` significa que não foi localizado fluxo específico de PDF ou e-mail para aquela função nas fontes inspecionadas; `I` significa indisponível na própria aplicação. CSV, JSON, XML e `.doc` são citados separadamente e **não contam como PDF**. `print` significa `window.print()`, dependente do navegador. E-mail comercial existente depende de SMTP configurado e autorização; não equivale a entrega confirmada na caixa do destinatário.

Prioridades propostas: **P0** corrige documento já oferecido ao cliente ou preserva fluxo fiscal existente; **P1** atende rotina operacional/financeira frequente; **P2** amplia gestão, administração ou funções cuja operação ainda precisa ser implementada. “PDF/e-mail propostos” expressa necessidade de negócio a validar; não é afirmação de exigência legal.

## Matriz funcional

As referências E01–E25 apontam para arquivos e funções detalhados após a matriz. Toda linha distingue a situação atual da entrega proposta.

### Meu Negócio e análises — 6 linhas

| ID / submódulo | Documento/relatório e uso propostos | Estado atual: relatório / PDF / e-mail | Lacuna e prioridade |
| --- | --- | --- | --- |
| AN01 Dashboard geral e início | Resumo gerencial do período em PDF; envio interno à direção | R com fonte autorizada / — / —. E01 | Fixar período, data de posição e permissões por indicador. P1 |
| AN02 Dashboard de vendas | Pedidos, cancelamentos, ticket e evolução em PDF para gestores | R de pedidos / — / —. E01 | Não chamar valor de pedido de faturamento ou recebimento. P1 |
| AN03 Dashboard de produtos e clientes | Situação da carteira/cadastro em PDF interno | R de contagens atuais / — / —. E01 | Separar posição atual de série histórica. P2 |
| AN04 Margem por pedido | Demonstrativo de receita, custo registrado e margem em PDF restrito à direção | I neste painel / — / —. E01; dados comerciais específicos em E02 | Consolidar fonte de custo e regra; não anexar margem ao pedido externo. P1 |
| AN05 Curva ABC | Classificação por critério/período explícitos em PDF interno | I / — / —. E01 | Definir base de faturamento/produto antes de exportar. P2 |
| AN06 Metas | Metas, realizado e desvios em PDF para gestão | I, sem cadastro de metas neste painel / — / —. E01 | Implementar fonte e cálculo antes do documento. P2 |

### Cadastros e catálogo — 7 linhas

| ID / submódulo | Documento/relatório e uso propostos | Estado atual: relatório / PDF / e-mail | Lacuna e prioridade |
| --- | --- | --- | --- |
| CA01 Produtos e ficha técnica | Ficha técnica individual e lista comercial em PDF; cliente/revendedor escolhido | T com medidas, peso, fabricante e mídias / — / —. E03 | Template comercial sem custo interno; imagens e revisão identificadas. P1 |
| CA02 Catálogo e publicação | Catálogo de coleção em PDF; comercial/clientes selecionados | Prévia, exportação JSON e publicação de dados no site / — / —. E03 | O componente declara que edição PDF é gerada separadamente; integrar edição revisada. P1 |
| CA03 Custos de produto e composição | Ficha de custo e formação de preço em PDF apenas interno | T específica de custos / — / —. E03 | Permissão própria; não reutilizar versão comercial da ficha. P1 |
| CA04 Clientes, fornecedores, contatos e complementos | Ficha cadastral e relação filtrada em PDF; equipe interna, cadastro individual ao próprio interessado quando solicitado | T / — / —. E04 | Reduzir campos conforme finalidade; não enviar carteira inteira ao contato cadastrado. P2 |
| CA05 Listas de preços | Lista comercial por cliente/vigência em PDF; vendedor/cliente explicitamente escolhido | T de listas / — / —. E04 | Versão e validade; separar de tabela de cálculo interna. P1 |
| CA06 Contas, categorias financeiras e formas de pagamento | Relações de apoio em PDF para financeiro/contador | T de cadastros de referência / — / —. E04 | Exportação interna opcional; não compartilhar dados bancários em massa. P2 |
| CA07 Categorias/grupos de produtos, grupos de tags e tags | Listagens e estrutura classificatória em PDF interno | T de referências / — / —. E04 | Não precisa de botão de e-mail externo por registro. P2 |

### Vendas — 10 linhas

| ID / submódulo | Documento/relatório e uso propostos | Estado atual: relatório / PDF / e-mail | Lacuna e prioridade |
| --- | --- | --- | --- |
| VE01 Funil e oportunidades | Carteira, etapas, previsão e perdas em PDF interno | T persistida / — / —. E02 | Relatório por responsável/período, sem enviar anotações internas ao prospect. P1 |
| VE02 Tabela publicada | Tabela comercial por versão/destino fiscal em PDF; clientes/revendedores | T de tabela publicada / — / —. E02 | Congelar versão e contexto; excluir colunas internas de negociação. P1 |
| VE03 Simulador | Memória comercial da simulação em PDF interno; versão ao cliente deve originar proposta | T de simulação / — / —. E02 | Identificar simulação sem confundi-la com proposta aceita ou pedido. P1 |
| VE04 Propostas | Proposta por versão em PDF; cliente com destinatário revisado | Documento visual próprio + print / sem PDF canônico / SMTP com anexo HTML. E05 | Compartilhar gerador profissional e mesma versão no download/anexo. P0 |
| VE05 Pedidos de venda | Pedido comercial A4, itens/acabamentos, quantidades, preços registrados, entrega e pagamento previstos; cliente | T + “Salvar PDF” via print / sem PDF próprio na base / SMTP com anexo HTML. E06 | PDF canônico e anexo em desenvolvimento; corrigir acesso ao histórico de envio. P0 |
| VE06 Garantias, assistência, RMA e quarentena | Termo/política de garantia, protocolo, autorização de retorno e laudo; cliente recebe somente seu caso | T de casos, políticas, aprovação, peças, RMA/quarentena / — / —. E07 | Separar termo externo de diagnóstico/custo interno e vincular evidências. P1 |
| VE07 PDV: venda e comprovante | Comprovante comercial em PDF; consumidor explicitamente informado | T + comprovante em print / sem PDF próprio / —. E08 | Recibo comercial não substitui NFC-e; ligar ao documento fiscal correto. P1 |
| VE08 PDV: fechamento e histórico | Fechamento por caixa/operador, divergências e cancelamentos em PDF interno | T de sessões/histórico / — / —. E08 | PDF de conferência; envio restrito à gestão financeira. P1 |
| VE09 Loja virtual e anúncios | Relatórios por canal e conciliação de sincronização em PDF interno | I nas páginas de loja/anúncios / — / —. E09 | Implementar operação e fonte antes do relatório. P2 |
| VE10 Importar pedidos | Resultado de importação e inconsistências em PDF/CSV para operador | I / — / —. E09 | Não confundir com importação de produtos nem integração de lojas. P2 |

### Compras e suprimentos — 4 linhas

| ID / submódulo | Documento/relatório e uso propostos | Estado atual: relatório / PDF / e-mail | Lacuna e prioridade |
| --- | --- | --- | --- |
| CO01 Pedidos de compra | Pedido/solicitação de fornecimento em PDF; fornecedor escolhido | T de pedido, itens, estados e recebimentos / — / —. E10 | Template sem margem de venda; aprovações e revisão do pedido. P1 |
| CO02 Check-in e recebimentos | Conferência de entrada, divergências e recebimentos parciais em PDF; compras/almoxarifado; fornecedor só na contestação | T persistida / — / —. E10 | Snapshot de quantidades, itens faltantes e nota vinculada. P1 |
| CO03 Sugestões de compra | Necessidade de reposição e comparação de fornecedores em PDF interno | I / — / —. E10 | Fonte de estoque mínimo/demanda ainda necessária. P2 |
| CO04 Notas fiscais de entrada | Relação de documentos e divergências em PDF interno; XML e DANFE ao contador autorizado | Lista usa monitor fiscal; documentos efetivos em FS04; detalhe `/compras/notas-entrada/[id]` é I. E10/E17 | Usar os documentos de Fiscal; não prometer escrituração completa pela página de Compras. P1 |

### Estoque e produção — 6 linhas

| ID / submódulo | Documento/relatório e uso propostos | Estado atual: relatório / PDF / e-mail | Lacuna e prioridade |
| --- | --- | --- | --- |
| ES01 Posição e saldos | Posição por depósito/produto, reservado e disponível em PDF interno | T; relatório/CSV em RE03 / — / —. E11/E22 | Exportação completa, filtros e data de corte. P1 |
| ES02 Lançamentos de estoque | Extrato de movimentações e comprovante de ajuste/transferência em PDF interno | T persistida / — / —. E11 | Identificar origem, autor, motivo e reversão; custos somente com autorização. P1 |
| ES03 Conferência/inventários | Folha de contagem sem saldo esperado; divergências e termo de encerramento em PDF interno | T de inventário/contagem / — / —. E11 | Modelos distintos para contador e aprovador; revisão do fechamento. P1 |
| ES04 Ordens de produção | Ordem/ficha de fabricação, materiais, etapas, consumo e estornos em PDF para chão de fábrica | T com ordens/etapas/consumos / — / —. E12 | Ficha técnica de produção sem preço/margem comercial; trilha de consumo. P1 |
| ES05 Produção: produtividade e consumo | Previsto versus realizado, perdas e materiais em PDF gerencial interno | Dados operacionais em T; sem relatório consolidado próprio / — / —. E12 | Definir métricas disponíveis; não inferir horas/custos ausentes. P2 |
| ES06 Depósitos e regras de suprimentos | Relação de depósitos e parâmetros vigentes em PDF interno | T de depósitos e configurações de estoque/compras / — / —. E04/E11 | Documento de configuração opcional; versão e vigência. P2 |

### Logística — 5 linhas

| ID / submódulo | Documento/relatório e uso propostos | Estado atual: relatório / PDF / e-mail | Lacuna e prioridade |
| --- | --- | --- | --- |
| LO01 Postagens | Romaneio, volumes e comprovante de despacho em PDF; expedição/transportador, aviso ao cliente | T persistida de postagens/rastreio / — / —. E13 | Distinguir registro operacional de contratação da transportadora. P1 |
| LO02 Checkout de pedidos | Lista de separação, conferência, embalagem e packing list em PDF; operação/transportador | T de checkout e volumes / — / —. E13 | Documento por revisão, sem preços quando desnecessários. P1 |
| LO03 Etiquetas de volumes | PDF em tamanho de etiqueta, código/volume e destinatário; impressão interna | Fila de jobs persistida / sem renderer/download de etiqueta localizado / —. E13 | Fila `queued/printed/failed` não comprova impressão física nem PDF; detalhe/nova etiqueta são I. P1 |
| LO04 Logística reversa | RMA, autorização e conferência do retorno em PDF; cliente/assistência | Lista consulta casos de garantia que podem gerar RMA; detalhe/nova reversa são I; caso funcional em VE06. E07/E13 | Unificar com RMA existente e completar páginas, evitando duplicar processo. P1 |
| LO05 Ávila Envios | Cotação, contratação, coleta e acompanhamento em PDF quando houver integração | I / — / —. E13 | Integração/persistência antes do documento; configurar logística também está indisponível. P2 |

### Financeiro e contabilidade — 11 linhas

| ID / submódulo | Documento/relatório e uso propostos | Estado atual: relatório / PDF / e-mail | Lacuna e prioridade |
| --- | --- | --- | --- |
| FI01 Contas a receber e cobranças de Serviços | Demonstrativo de títulos, cobrança e recibo de baixa registrada em PDF; cliente correspondente | T de recebíveis/baixas / — / —. E14 | Não declarar pago por haver parcela ou entrada prevista. P1 |
| FI02 Contas a pagar | Agenda, posição por fornecedor e comprovante de baixa declarada em PDF; financeiro; fornecedor apenas recibo próprio | T persistida / — / —. E10/E14 | Separar obrigação, autorização e pagamento; documento não comprova transação bancária externa. P1 |
| FI03 Caixas e bancos | Extrato financeiro por conta, transferências e conciliação operacional em PDF interno | T de livro de conta/transferências / — / —. E14 | Evidenciar saldo de abertura, período, baixa e estorno. P1 |
| FI04 Controle de caixa | Abertura, movimentações e fechamento em PDF interno | I nesta página; PDV tem processo próprio em VE08 / — / —. E15 | Não reapresentar fechamento de PDV como caixa financeiro geral. P2 |
| FI05 Ficha financeira | Extrato consolidado por cliente/fornecedor em PDF; equipe e titular selecionado | I / — / —. E15 | Consolidar origens e separar dados de terceiros. P1 |
| FI06 Remessas e retornos | Protocolo de lote, rejeições e conciliação em PDF interno; arquivos CNAB ao banco | I / — / —. E15 | CNAB é arquivo estruturado, não PDF; implementar integração primeiro. P2 |
| FI07 Comissões | Demonstrativo por vendedor/competência com origem, recebimentos, ajustes, estornos e pagamentos em PDF; vendedor recebe apenas seu demonstrativo | T de livro de comissões e pagamentos declarados / — / —. E16 | Permissões `finance.commissions.*`; não enviar carteira/custos de outros vendedores. P1 |
| FI08 Faturamento agrupado | Memória do agrupamento e cobrança por cliente em PDF | I / — / —. E15 | Não substituir NF-e/NFS-e nem duplicar recebível; implementar fonte antes. P2 |
| FI09 Tributos e guias | Agenda/apuração e demonstrativo tributário em PDF ao financeiro/contador | I; guias também em FS08 / — / —. E15/E18 | Integração oficial e cálculo antes da emissão. P2 |
| FI10 Espaço do contador | Pacote por competência: relatório financeiro PDF, XML e exportações próprias | I / — / —. E15 | Criar seleção e manifesto; SPED não foi localizado como gerador implementado. P2 |
| FI11 Conta Digital | Extrato/recibos da instituição e conciliação em PDF ao titular | I / — / —. E15 | Conta/Pix/taxas e integrações de pagamento indisponíveis no catálogo; não fabricar comprovante bancário. P2 |

### Pessoas e RH — 3 linhas

| ID / submódulo | Documento/relatório e uso propostos | Estado atual: relatório / PDF / e-mail | Lacuna e prioridade |
| --- | --- | --- | --- |
| RH01 Funcionários e vendedores | Ficha funcional e lista de equipe em PDF restrito; ficha individual ao próprio funcionário quando necessário | T de cadastro / — / —. E19 | Separar ficha geral de salário/Pix e de dados comerciais de comissão. P2 |
| RH02 Salários, benefícios e pagamentos avulsos | Demonstrativo individual por competência e recibo de baixa declarada em PDF; funcionário correspondente | T de propostas, aprovação e geração de contas mensais / — / —. E19 | Não existe folha legal/holerite completo comprovado; a fonte registra obrigações e declarações manuais. P1 |
| RH03 Aprovações e recorrência de pagamentos | Relatório de alterações salariais, decisões e obrigações mensais em PDF interno | T de solicitações, lotes e geração mensal / — / —. E19 | Exigir `finance.staff.read/manage/approve`; sem botão de envio indiscriminado de lote externo. P1 |

### Fiscal — 9 linhas

| ID / submódulo | Documento/relatório e uso propostos | Estado atual: relatório / PDF / e-mail | Lacuna e prioridade |
| --- | --- | --- | --- |
| FS01 NF-e de saída | Relação de emissões e pacote XML autorizado + DANFE PDF; destinatário fiscal/contador autorizado | T de rascunho/emissão/eventos + XML; PDF pelo fluxo DANFE especializado / sem envio fiscal autônomo localizado. E17 | Preservar ambiente/status; integrar composição explícita ao SMTP. P0 |
| FS02 NFC-e | XML e documento auxiliar próprio do modelo 65; consumidor com destinatário informado | T de rascunhos modelo65/emissão compartilhada; integração DANFE aceita modelos55/65, sem homologação visual específica65 localizada / —. E17/E18 | Conferir suporte/layout/QR Code do provedor para65; não usar pedido/recibo como substituto. P1 |
| FS03 DANFE de XML autorizado | Download PDF fiel ao XML/protocolo; operador autorizado, cliente/contador se solicitado | PDF binário real via serviço fiscal especializado, com hashes / —. E17 | Reutilizar renderer existente; geração não consulta situação atual na SEFAZ nem emite nova nota. P0 |
| FS04 Monitor fiscal, NF-e recebidas e importação | Relação de documentos, XML original e DANFE existente; fiscal/compras/contador | T de monitor/importação/conciliação + downloads XML e DANFE / —. E17 | Não confundir recepção com escrituração ou pagamento; envio por documento autorizado. P1 |
| FS05 NF-e de saída importadas | Arquivo XML e DANFE da nota importada; fiscal/contador | T de importação + rotas XML/DANFE / —. E17 | Preservar origem, hash e vínculo da empresa; não reemitir. P1 |
| FS06 CT-e recebidos / Serviços CT-e | XML, demonstrativo de frete e conferência de vínculos em PDF interno; XML ao contador | Distribuição, XML, inspeção e vínculos; sem DACTE PDF localizado / —. E20 | Fluxo inspecionado é de recebidos; não prometer emissão CT-e; DACTE exige renderer especializado. P1 |
| FS07 NFS-e recebidas / Serviços notas | XML original e relação de serviços em PDF ao fiscal/contador | Importação/consulta/download XML; sem PDF oficial nem emissão NFS-e localizados / —. E20 | Fonte registra assinatura/situação atual pendentes; PDF gerencial não pode aparentar validação oficial. P1 |
| FS08 Guias tributárias | Guia oficial e comprovante apenas a partir de fonte competente; financeiro/contador | I para GNRE, DARE-SP e DAS / — / —. E18 | Não gerar guia com template comercial; implementar cálculo e integração próprios. P2 |
| FS09 Eventos, correções, inutilizações e acesso a XML | Relação/protocolo de eventos e pacote fiscal por competência; fiscal/contador | Eventos e preferências persistidos; configuração de e-mail/pessoas autorizadas não envia nem cria fila / sem PDF de evento localizado. E17/E18 | Diferenciar configuração de entrega efetiva; não há gerador SPED identificado. P1 |

### Serviços e contratos — 3 linhas

| ID / submódulo | Documento/relatório e uso propostos | Estado atual: relatório / PDF / e-mail | Lacuna e prioridade |
| --- | --- | --- | --- |
| SE01 Contratos | Contrato/assinaturas em PDF e pacote de pedido, nota e pagamentos; cliente e signatários explícitos | Prévia/PDF por provedor e envio de pacote implementados; contrato PDF + pedido `.doc`, XML, DANFE opcional e pagamento `.doc`. E21 | Uniformizar anexos comerciais em PDF sem alterar contrato assinado nem renderer fiscal. P0 |
| SE02 Modelos de contrato | Modelo versionado e campos de assinatura; equipe responsável, sem disparo externo do modelo em branco | Importação de PDF/publicação/modelos e vínculo a provedor / PDF de entrada/provedor, sem gerador genérico local / envio no contrato. E21 | Manter versão, preview e validade do modelo, sem reescrever o documento assinado. P1 |
| SE03 Ordens de serviço | Ordem, visita, peças, laudo e aceite em PDF; técnico/cliente com sua versão | Lista usa ordens de assistência/garantia; custos de mão de obra entram em RE05 / — / —. E07/E23 | Não há prova de uma OS genérica independente da garantia; separar laudo externo de custo/produtividade interna. P1 |

### Central de relatórios — 7 linhas

| ID / submódulo | Documento/relatório e uso propostos | Estado atual: relatório / PDF / e-mail | Lacuna e prioridade |
| --- | --- | --- | --- |
| RE01 Visão executiva | Caderno executivo PDF com período, posição e fontes; direção | R reutiliza dashboard geral / — / —. E01/E22 | Consolidar indicadores com cortes e permissões explícitos. P1 |
| RE02 Vendas | Relatório PDF por período/cliente/vendedor/situação; gestão comercial | R reutiliza dashboard de pedidos / — / —. E01/E22 | Detalhamento e reconciliação; pedidos não representam receita recebida. P1 |
| RE03 Estoque | Posição/movimentação/inventário em PDF; operação/gestão | R de saldos + CSV da página, até100 registros / — / —. E22 | Oferecer “página” ou “todos os filtros” explicitamente; total não pode ser só a página. P1 |
| RE04 Financeiro | Recebíveis, contas a pagar e vencimentos em PDF; direção/financeiro | R + CSV dos dados carregados, até100 recebíveis e100 contas a pagar / — / —. E22 | Carregar fonte completa para resumo consolidado; não confundir saldo pendente com fluxo realizado. P1 |
| RE05 Serviços | Carteira de OS, conclusão, espera por peça e mão de obra em PDF interno | R + CSV das primeiras100 OS carregadas / — / —. E23 | Mão de obra registrada não comprova produtividade/horas nem custo total. P1 |
| RE06 Auditoria | Relatório de eventos, atores e operações em PDF restrito a auditor autorizado | Página `/relatorios/auditoria` é I; consulta efetiva em Segurança. E22/E24 | Construir fonte/exportação autorizada; sem e-mail externo genérico. P1 |
| RE07 Relatórios customizados | Execução de definição salva, prévia e exportação PDF com filtros/permissões; autor/equipe autorizada | CRUD de definições declarativas, cinco datasets e visibilidade privada/empresa; sem executor/resultado/PDF/e-mail localizado. E24 | Ter definição salva não significa relatório executável; implementar consulta autorizada antes do renderer. P1 |

### Empresa, administração e Preferências — 10 linhas

| ID / submódulo | Documento/relatório e uso propostos | Estado atual: relatório / PDF / e-mail | Lacuna e prioridade |
| --- | --- | --- | --- |
| AD01 Empresa, dados e seleção de empresa | Ficha do emitente em PDF; administração, dados mínimos no cabeçalho comercial | T de empresa/conta / — / —. E25 | Usar identidade da empresa ativa no documento, sem misturar com remetente SMTP global. P1 |
| AD02 Plano, assinatura, limites e conta | Extrato de cobranças/consumo em PDF ao responsável financeiro | T + CSV da página de cobranças / — / —. E25 | Exportação não equivale à nota/recibo da assinatura; origem da cobrança deve ser identificada. P2 |
| AD03 Usuários, papéis e permissões | Matriz de acesso e revisão periódica em PDF interno restrito | T de usuários/papéis / — / —. E24 | Não incluir tokens/convites/segredos; não enviar lista a usuários comuns. P1 |
| AD04 Segurança, atividades e exclusões | Trilhas filtradas e registro de exclusões em PDF ao auditor/administrador | T de auditoria e exclusões / — / —. E24 | Permissão `platform.audit.read` e revisão do destinatário; evitar distribuição de logs brutos. P1 |
| AD05 Comercial, aprovações, despesas e tabelas de preço | Política de preço, alçadas, despesas e revisão de tabela em PDF interno | T de configurações, tabelas e custos; sem documento consolidado / — / —. E02/E25 | Não exportar regras internas na tabela comercial; filtrar custo/margem/alçada. P1 |
| AD06 Configurações financeiras, fiscais, cadastros e certificados | Resumo de parâmetros não secretos em PDF administrativo | T de configurações; opções indisponíveis identificadas no catálogo / — / —. E18/E25 | Excluir senha de certificado, CSC, tokens e chaves; não anexar material secreto. P2 |
| AD07 Sistema: interface, campos e transições | Dicionário de campos e processos publicados em PDF interno | T de preferências/campos/workflows / — / —. E24/E25 | Exportação documental opcional; preservar versão da configuração. P2 |
| AD08 Arquivos e etiquetas customizadas | Manifesto dos arquivos autorizados; modelos/folhas de etiqueta para impressão interna | Gerenciador de arquivos e CRUD de modelos de etiqueta / sem renderer de etiqueta localizado / —. E24 | Arquivo existente não é novo PDF gerado; definir tamanho, origem e execução do modelo. P2 |
| AD09 Importação, exportação e backup | Resultado de importação e inventário de exportação em PDF interno; dados em CSV/JSON próprios | Importação de produtos com prévia/resultado e exportação CSV; outras importações/backup são I no catálogo / — / —. E03/E25 | Não tratar exportação parcial como backup completo; não enviar base inteira por e-mail. P2 |
| AD10 Integrações, lojas e SMTP da plataforma | Estado das integrações e falhas em PDF interno; SMTP é infraestrutura compartilhada | T/configuração varia por integração; SMTP da base vinha de ambiente; Preferências SMTP global em desenvolvimento / sem relatório próprio. E09/E25 | Administração global controla SMTP; não gerar documento com credenciais nem dar configuração global a administrador de empresa. P0 |

### Central de trabalho e histórico — 3 linhas

| ID / submódulo | Documento/relatório e uso propostos | Estado atual: relatório / PDF / e-mail | Lacuna e prioridade |
| --- | --- | --- | --- |
| TR01 Eventos e notificações | Agenda e pendências em PDF interno quando houver fonte operacional; avisos têm fluxo próprio | Destinos na navegação; não localizado gerador documental/PDF/e-mail correspondente. E00 | Não transformar toda notificação em anexo; validar fonte e necessidade por tipo de evento. P2 |
| TR02 Aplicativos, assistente, novidades e ajuda | Histórico de execução/resposta ou orientação, somente quando solicitado; PDF opcional interno | Destinos/componentes próprios; sem pipeline documental/e-mail localizado. E00/E25 | Resposta do assistente não substitui relatório oficial com fonte e corte. P2 |
| TR03 Histórico importado | Consulta histórica e demonstrativo de origem em PDF interno | T de histórico legado / — / —. E25 | Identificar legado, data/origem e campos disponíveis; não reemitir documento antigo como novo. P2 |

## Evidências de implementação

Os links são relativos à raiz deste repositório a partir deste arquivo. Linhas são referências aproximadas da leitura; implementações em andamento podem deslocá-las. “Existe teste” indica cobertura encontrada no código, **não execução desses testes neste levantamento**.

- **E00 — Cobertura de navegação:** [navigation-catalog.ts](../../apps/web/src/components/shell/navigation-catalog.ts:3) contém os dez menus de negócio, Preferências, atalhos e histórico; [preference-catalog.ts](../../apps/web/src/components/shell/preference-catalog.ts:11) distingue destinos reais e `unavailable`. As páginas `page.tsx` confirmam aliases e telas indisponíveis.
- **E01 — Análises:** [dashboard-detail.tsx](../../apps/web/src/features/dashboard/dashboard-detail.tsx:14), `DashboardDetail`, limita os painéis disponíveis a geral/vendas/produtos/clientes e informa base/período; [dashboard.rs](../../apps/api/src/domains/dashboard.rs), produtores de métricas; [dashboard_tests.rs](../../apps/api/src/http/dashboard_tests.rs), cobertura da fonte autorizada.
- **E02 — Comercial:** [opportunities.rs](../../apps/api/src/domains/sales/opportunities.rs), [commercial-table.tsx](../../apps/web/src/features/sales/commercial-table.tsx:23), [commercial-simulator.tsx](../../apps/web/src/features/sales/commercial-simulator.tsx:47), [metrics.rs](../../apps/api/src/domains/sales/metrics.rs), [price_tables.rs](../../apps/api/src/platform/price_tables.rs), [commercial_settings.rs](../../apps/api/src/platform/commercial_settings.rs). São fontes operacionais/cálculos, não renderers de relatório.
- **E03 — Produto/catálogo:** [catalog-profile.tsx](../../apps/web/src/features/catalog/catalog-profile.tsx:13), `TechnicalSummary`; [catalog-publish.tsx](../../apps/web/src/features/catalog/catalog-publish.tsx:28), exportação JSON e observação de edição PDF separada; [product-costs.tsx](../../apps/web/src/features/catalog/product-costs.tsx); [catalog_publication.rs](../../apps/api/src/domains/catalog_publication.rs); [catalog-technical-sheet-ui.spec.ts](../../apps/web/tests/catalog-technical-sheet-ui.spec.ts), cobertura da ficha.
- **E04 — Cadastros:** [catalog.rs](../../apps/api/src/domains/catalog.rs), [parties.rs](../../apps/api/src/domains/parties.rs), [party_complements.rs](../../apps/api/src/domains/party_complements.rs), [price_lists.rs](../../apps/api/src/domains/price_lists.rs), [reference_data.rs](../../apps/api/src/domains/reference_data.rs), [registration_settings.rs](../../apps/api/src/domains/registration_settings.rs); páginas e detalhes em `apps/web/src/app/cadastros`.
- **E05 — Proposta:** [proposals.tsx](../../apps/web/src/features/sales/proposals.tsx:197), botão de impressão; [proposal-document.tsx](../../apps/web/src/features/sales/proposal-document.tsx:14), documento visual; [proposal_email.rs](../../apps/api/src/domains/sales/proposal_email.rs:141), `attachment` retorna `proposta-…-v….html`; `send` salva snapshot/revisão/histórico. [proposal-email-ui.spec.ts](../../apps/web/tests/proposal-email-ui.spec.ts:11) cobre destinatário, revisão, indisponibilidade e comando incerto.
- **E06 — Pedido:** [orders.tsx](../../apps/web/src/features/sales/orders.tsx:286), área de documentos; [order_email.rs](../../apps/api/src/domains/sales/order_email.rs:137), `attachment` HTML, `get`/`send` e entregas; [order-email.tsx](../../apps/web/src/features/sales/order-email.tsx:30), compositor explícito; [order_email_tests.rs](../../apps/api/src/http/order_email_tests.rs:73) cobre ausência de SMTP sem registro de envio, replay incerto, cancelado e revisão antiga; [order-email-ui.spec.ts](../../apps/web/tests/order-email-ui.spec.ts:10) cobre abertura e BFF.
- **E07 — Garantia/OS/RMA:** [warranties.rs](../../apps/api/src/domains/warranties.rs:124), `routes`, `list_service_orders`, `service_order`, `approve_case`, `create_rma`, quarentena; [warranty-workspace.tsx](../../apps/web/src/features/sales/warranty-workspace.tsx), [services-pages.tsx](../../apps/web/src/features/services/services-pages.tsx:48). São recursos persistidos; não foi localizado produtor de PDF/anexo para eles.
- **E08 — PDV:** [pos.rs](../../apps/api/src/domains/pos.rs); [pos-shared.tsx](../../apps/web/src/features/pos/pos-shared.tsx:25), comprovante chama `window.print()`; páginas `/vendas/pdv`, `/fechamento` e `/historico` usam operação de PDV.
- **E09 — Canais:** [loja-virtual/page.tsx](../../apps/web/src/app/vendas/loja-virtual/page.tsx:1), [anuncios/page.tsx](../../apps/web/src/app/vendas/anuncios/page.tsx:1), [importacao/page.tsx](../../apps/web/src/app/vendas/importacao/page.tsx:1), todos declaram capacidade indisponível. [integrations-catalog.tsx](../../apps/web/src/features/integrations/integrations-catalog.tsx) trata configurações separadamente; ter integração cadastrada não prova uma operação dessas páginas.
- **E10 — Compras:** [purchasing.rs](../../apps/api/src/domains/purchasing.rs), criação/leitura/recebimento; [purchase-detail.tsx](../../apps/web/src/features/purchasing/purchase-detail.tsx); [payables.tsx](../../apps/web/src/features/purchasing/payables.tsx); [purchasing-capability-unavailable.tsx](../../apps/web/src/features/purchasing/purchasing-capability-unavailable.tsx:3). `/compras/notas-entrada` usa `ReceivedMonitor`; a página de detalhe está indisponível.
- **E11 — Estoque:** [inventory.rs](../../apps/api/src/domains/inventory.rs), [inventory_counts.rs](../../apps/api/src/domains/inventory_counts.rs), [supply_settings.rs](../../apps/api/src/domains/supply_settings.rs); [stock-workspace.tsx](../../apps/web/src/features/inventory/stock-workspace.tsx), [inventory-counts.tsx](../../apps/web/src/features/inventory/inventory-counts.tsx).
- **E12 — Produção:** [production.rs](../../apps/api/src/domains/production.rs:69), `routes`, `list_orders`, `get_order`, `consume`, `reverse_consumption`, etapas; [production-workspace.tsx](../../apps/web/src/features/production/production-workspace.tsx).
- **E13 — Logística:** [logistics-screen.tsx](../../apps/web/src/features/logistics/logistics-screen.tsx:45) despacha postagens/checkouts/etiquetas/reversa e mantém Envios indisponível; [logistics-details.tsx](../../apps/web/src/features/logistics/logistics-details.tsx); [logistics_dispatch.rs](../../apps/api/src/domains/logistics_dispatch.rs:26), `list_labels`/`queue_labels`, persistem fila, sem resposta PDF; [logistics_checkout.rs](../../apps/api/src/domains/logistics_checkout.rs), [logistics.rs](../../apps/api/src/domains/logistics.rs). Páginas de detalhe/nova etiqueta e de detalhe/nova reversa ainda usam `CapabilityUnavailable`.
- **E14 — Financeiro:** [finance.rs](../../apps/api/src/domains/finance.rs), [payables.rs](../../apps/api/src/domains/payables.rs), [settlements.rs](../../apps/api/src/domains/settlements.rs), [financial_account_ledger.rs](../../apps/api/src/domains/financial_account_ledger.rs), [financial-account-ledger.tsx](../../apps/web/src/features/finance/financial-account-ledger.tsx), [receivables.tsx](../../apps/web/src/features/finance/receivables.tsx). Há operação/baixa, sem gerador PDF/compositor próprio encontrado nessas funções.
- **E15 — Financeiro indisponível:** páginas em `apps/web/src/app/financeiro/{controle-caixa,ficha-financeira,remessas-retornos,faturamento-agrupado,tributos,contador,conta-digital}/page.tsx` chamam [finance-capability-unavailable.tsx](../../apps/web/src/features/finance/finance-capability-unavailable.tsx:4), sem backend financeiro verificável para essas capacidades.
- **E16 — Comissões:** [commissions.rs](../../apps/api/src/domains/commissions.rs:30), permissões, livro vinculado a recebimentos, ajustes/estornos e `pay` com `source: manual_declaration`; [commissions-workspace.tsx](../../apps/web/src/features/finance/commissions-workspace.tsx); [commission_tests.rs](../../apps/api/src/http/commission_tests.rs), cobertura do domínio.
- **E17 — Documentos fiscais:** [fiscal/mod.rs](../../apps/api/src/domains/fiscal/mod.rs:58), rotas de monitor, documentos recebidos/importados, XML e DANFE; [emission.rs](../../apps/api/src/domains/fiscal/emission.rs:29), rotas de emissão/eventos/XML; [danfe.rs](../../apps/api/src/domains/fiscal/danfe.rs:257), `generate` com retorno `application/pdf`; [danfe_client.rs](../../apps/api/src/domains/fiscal/danfe_client.rs:214) aceita modelos55/65, valida o modelo retornado e escolhe renderer normal/simplificado; [danfe-download.tsx](../../apps/web/src/features/fiscal/danfe-download.tsx), [emission-actions.tsx](../../apps/web/src/features/fiscal/emission-actions.tsx:66), leitura de PDF e hashes. [danfe_tests.rs](../../apps/api/src/http/danfe_tests.rs:55) cobre autorização, empresa, PDF binário, renderer ausente e recusa de assinatura; o provedor fictício de teste usa modelo55, sem comprovar visualmente o layout65.
- **E18 — Configuração fiscal:** [fiscal-screen.tsx](../../apps/web/src/features/fiscal/fiscal-screen.tsx:29), NFC-e usa `NfeDrafts model={65}`, guias são indisponíveis; [fiscal-preferences.tsx](../../apps/web/src/features/fiscal/settings/fiscal-preferences.tsx:104) declara que salvar destinatários não envia/cria fila; [preferences.rs](../../apps/api/src/domains/fiscal/preferences.rs:176), persistência de delivery e eventos.
- **E19 — RH/pagamentos:** [staff.rs](../../apps/api/src/domains/staff.rs), [staff_payroll.rs](../../apps/api/src/domains/staff_payroll.rs:1), natureza de declaração manual, permissões `finance.staff.*`, `propose`, `review`, `generate`, `salaries`; [payroll-workspace.tsx](../../apps/web/src/features/staff/payroll-workspace.tsx:108), aprovações e recorrência; [staff-payroll-ui.spec.ts](../../apps/web/tests/staff-payroll-ui.spec.ts).
- **E20 — CT-e/NFS-e recebidos:** [cte_distribution.rs](../../apps/api/src/domains/fiscal/cte_distribution.rs), [cte_inspection.rs](../../apps/api/src/domains/fiscal/cte_inspection.rs:49), [cte_links.rs](../../apps/api/src/domains/fiscal/cte_links.rs); [received_nfse.rs](../../apps/api/src/domains/fiscal/received_nfse.rs:36), `routes`, importação e `download_xml` com observação de verificação pendente; [cte_distribution_tests.rs](../../apps/api/src/http/cte_distribution_tests.rs), [cte_inspection_tests.rs](../../apps/api/src/http/cte_inspection_tests.rs). Serviços redireciona os componentes para essas mesmas fontes.
- **E21 — Contratos/pacotes:** [contracts/package.rs](../../apps/api/src/domains/contracts/package.rs:142), `build`: anexos/MIME em linhas216–280, manifesto e hashes; [contracts/email.rs](../../apps/api/src/domains/contracts/email.rs), envio; [contracts/api.rs](../../apps/api/src/domains/contracts/api.rs), prévia/download; [templates.tsx](../../apps/web/src/features/contracts/templates.tsx:129), PDF importado; [contracts_tests.rs](../../apps/api/src/http/contracts_tests.rs:73), snapshots e reconciliação sem duplicar despacho.
- **E22 — Relatórios:** [reports-pages.tsx](../../apps/web/src/features/reports/reports-pages.tsx:84), `ReportDetail` e fallback indisponível; [use-report-data.ts](../../apps/web/src/features/reports/use-report-data.ts:7), limites de consulta; [stock-report-live.tsx](../../apps/web/src/features/reports/stock-report-live.tsx:13), CSV da página; [finance-report-live.tsx](../../apps/web/src/features/reports/finance-report-live.tsx:13), CSV dos registros carregados. Esses arquivos não geram PDF nem disparam e-mail.
- **E23 — Relatório de Serviços:** [service-reports-live.tsx](../../apps/web/src/features/services/service-reports-live.tsx:44), lê `warranty-service-orders?limit=100&offset=0`; cálculo de ativos/concluídos/mão de obra e CSV em `exportCsv`, linha69.
- **E24 — Sistema/acesso:** [custom_reports.rs](../../apps/api/src/platform/custom_reports.rs:44), cinco contratos de dataset e CRUD; [custom-reports.tsx](../../apps/web/src/features/preferences/system/custom-reports.tsx:30), interface salva definição; [custom_reports_tests.rs](../../apps/api/src/http/custom_reports_tests.rs:51), escopo/revisão/visibilidade; [label_templates.rs](../../apps/api/src/platform/label_templates.rs:136), CRUD de modelos; [label-templates.tsx](../../apps/web/src/features/preferences/system/label-templates.tsx); [audit.rs](../../apps/api/src/platform/audit.rs), [security-audit.tsx](../../apps/web/src/features/access/audit/security-audit.tsx), [access_management.rs](../../apps/api/src/platform/access_management.rs), [files.rs](../../apps/api/src/platform/files.rs), [workflows.rs](../../apps/api/src/platform/workflows.rs), [custom_fields.rs](../../apps/api/src/platform/custom_fields.rs).
- **E25 — Fundação/dados:** [company.rs](../../apps/api/src/platform/company.rs), [company_data.rs](../../apps/api/src/platform/company_data.rs), [account-panels.tsx](../../apps/web/src/features/company/account/account-panels.tsx:56), CSV da página de assinatura; [data_transfer.rs](../../apps/api/src/domains/data_transfer.rs:419), CSV de produtos autorizado por `catalog.products.export`; [legacy.rs](../../apps/api/src/domains/legacy.rs), [legacy-history.tsx](../../apps/web/src/features/data/legacy/legacy-history.tsx); [erp-assistant-module.tsx](../../apps/web/src/features/assistant/erp-assistant-module.tsx); [mail.rs](../../apps/api/src/platform/mail.rs), transporte SMTP; [spec de documento/SMTP](../superpowers/specs/2026-11-12-order-documents-platform-mail.md) e [plano em execução](../superpowers/plans/2026-11-12-order-documents-platform-mail.md) distinguem baseline de desenvolvimento.

## Infraestrutura comum recomendada

Um serviço de documentos deve receber **tipo do documento + ID da origem + empresa ativa + revisão**, carregar a fonte autorizada no backend e produzir um snapshot comercial ou interno permitido. O browser não deve fornecer HTML arbitrário nem URL para virar anexo. Download e e-mail devem reutilizar os mesmos bytes/revisão; guardar hash, nome, MIME, versão do template e referências de origem permite conferir o que foi disponibilizado.

Manter templates por finalidade: comercial externo, operação sem preço, financeiro interno, RH individual, auditoria restrita e etiquetas com tamanho próprio. A identidade visual vem do emitente/empresa do documento, com A4 quando apropriado, texto selecionável, fonte Unicode, cabeçalhos repetidos, rodapé e paginação. A identidade do remetente SMTP global não substitui o emitente. Proposta/pedido devem usar valores negociados registrados, sem recalcular preço atual ou indicar pagamento/reserva por haver previsão.

O serviço comum deve **compor** os documentos fiscais oficiais e contratos já emitidos/assinados, preservando seus bytes e renderers especializados. DANFE, DANFE NFC-e, DACTE, NFS-e e guias não são variações de um PDF comercial. XML/SPED/CNAB/CSV/JSON continuam anexos estruturados com MIME e descrição próprios. Pacotes precisam de manifesto de anexos e limites de quantidade/tamanho; documentos ausentes devem ser informados, nunca inventados.

No envio, reutilizar SMTP central, compositor com destinatário explícito, revisão da origem, chave de idempotência, histórico e estados aceito/recusado/incerto. Um resultado incerto exige reconciliação antes de novo envio. Não reenviar automaticamente ao abrir a tela nem transformar “SMTP aceitou” em “cliente recebeu”. Anexos devem vir de fontes da mesma empresa, conferidas novamente no download e no envio.

Permissões de leitura, exportação e envio precisam ser avaliadas pelo servidor. Para comissão, salário/Pix, custos, margem e auditoria, a autorização de consulta não deve resultar automaticamente em envio externo de um relatório inteiro. O uso recomendado é relatório interno restrito ou documento individual do próprio destinatário, com seleção revisada. Definição privada/compartilhada de relatório customizado não dispensa permissão no dataset ao executar ou exportar.

## Sequência proposta de adoção

1. **P0 — corrigir e consolidar o que já é oferecido:** pedido com PDF próprio e mesmo anexo, permissões das entregas, SMTP global em Preferências; em seguida proposta e pacote de contratos. Preservar DANFE e anexos fiscais existentes. Essas tarefas estão em desenvolvimento/planejamento conforme spec; este levantamento não atesta conclusão.
2. **P1 — documentos de rotina externa e de operação:** compra, garantia/OS/RMA, separação/romaneio/etiqueta, ficha técnica/lista comercial, cobrança/recibo e demonstrativos individuais de comissão/pagamento. Cada origem precisa de template, autorização e teste com dados fictícios.
3. **P1 — relatórios consolidados e restritos:** financeiro, estoque, vendas, serviços, produção e auditoria. Resolver limites/paginação e definições de indicadores antes de disponibilizar PDF consolidado ou agendamento por e-mail. Implementar execução de relatórios customizados além do CRUD de definições.
4. **P2 — administração e capacidades indisponíveis:** resumos de configuração/cadastros e novas análises; caixa geral, banco/CNAB, conta digital, contador/SPED, sugestões de compra, loja/anúncios e guias dependem da operação/fonte real. Não liberar PDF apenas para preencher botões de telas ainda sem capacidade.

## Limites e pontos a confirmar

O levantamento é estático: não houve emissão fiscal, alteração de registro de negócio, envio real, teste/build ou validação de configuração em produção. Encontrar handler/teste não demonstra provedor ativo nem disponibilidade em uma empresa específica. SMTP, motor fiscal, renderer DANFE, certificados, assinatura de contratos e integrações dependem de configuração e autorização.

Não foram localizados, nas superfícies inspecionadas, um gerador PDF transversal, um executor de relatório customizado, e-mail genérico por módulo, DACTE PDF, emissão NFS-e/CT-e, SPED ou folha legal completa. A integração DANFE aceita modelo65, mas o layout NFC-e/QR Code e a homologação visual específica desse modelo não foram comprovados pelos testes inspecionados. Isso registra ausência de fluxo ou verificação identificados, não afirma inexistência de todo suporte em serviço externo. A homologação de cada integração e o conteúdo exato dos relatórios propostos ainda devem ser confirmados durante sua implementação.

Critério reproduzível para atualizar os totais: contar apenas linhas de matriz que começam com `| AN`, `| CA`, `| VE`, `| CO`, `| ES`, `| LO`, `| FI`, `| RH`, `| FS`, `| SE`, `| RE`, `| AD` ou `| TR` seguidas de dois dígitos; agrupar pelo prefixo. Antes de alterar status, conferir novamente componente da página, rota, MIME/bytes do produtor e testes correspondentes.
