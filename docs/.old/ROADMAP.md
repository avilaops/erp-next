\# Roadmap de Desenvolvimento — Ávila ERP 2.0

> A trilha detalhada do primeiro fluxo vertical está em
> `docs/frontend-preferences-roadmap.md`. Ela define as 15 entregas de
> Preferências, suas dependências, arquivos proprietários e critérios de aceite.



\*\*Projeto:\*\* Avila-Next 

\*\*Arquitetura:\*\* Rust + Axum + PostgreSQL + Next.js  

\*\*Plataformas:\*\* Web, Android e iOS  

\*\*Modelo:\*\* SaaS multiempresa e multiusuário  



\# Fase 1 — Cadastros



\*\*Objetivo:\*\* implementar os registros fundamentais utilizados por todos os módulos.



\### 1.1 Cadastros principais



| Funcionalidade | Escopo |

|---|---|

| Produtos | Cadastro, edição, variantes, GTIN, NCM, imagens e preços |

| Clientes e fornecedores | Pessoas físicas e jurídicas, documentos e contatos |

| Vendedores | Cadastro, metas, comissões e vínculo com empresas |

| Funcionários | Cadastro, funções, equipes e permissões |

| Contas financeiras | Contas bancárias, caixas e contas internas |

| Categorias financeiras | Classificação de receitas e despesas |

| Formas de pagamento | Pix, dinheiro, cartões, boletos e outras modalidades |



\### 1.2 Ferramentas



\*\*Categorias de produtos:\*\* hierarquia de categorias, subcategorias, organização e filtros.



\*\*Listas de preços:\*\* tabelas específicas por cliente, canal, empresa ou período, com regras de desconto e vigência.



\### Requisitos obrigatórios



Todos os cadastros terão pesquisa, filtros rápidos, ordenação, paginação, importação e exportação quando aplicável.



A exclusão deverá respeitar vínculos existentes e exigências de auditoria.



\*\*Marco M1:\*\* cadastros completos e disponíveis para utilização pelos demais módulos.



\---



\# Fase 2 — Estoque e Compras



O estoque será implementado antes da operação comercial completa para garantir que pedidos, reservas e movimentações possuam consistência.



\### 2.1 Compras



| Funcionalidade | Escopo |

|---|---|

| Pedidos de compra | Solicitações, aprovações, fornecedores e recebimentos |

| Notas fiscais de entrada | Importação e processamento de XML |

| Fornecedores | Histórico comercial, condições e relacionamento |

| Sugestão de compras | Estoque mínimo, demanda e reposição |

| Check-in de recebimentos | Conferência física, divergências e entrada |

| Estoque | Consulta de saldos e disponibilidade |



\### 2.2 Gestão de estoque



| Funcionalidade | Escopo |

|---|---|

| Lançamentos de estoque | Entradas, saídas, transferências e ajustes |

| Conferência de estoque | Inventários e divergências |

| Ordens de produção | Insumos, etapas, consumo e produtos acabados |

| Depósitos | Armazéns, localizações e movimentações |

| Multiempresa | Controle independente por empresa |



\### Regras fundamentais



O estoque utilizará um livro de movimentações auditável.



Uma operação não poderá gerar saldo incorreto por concorrência entre usuários ou integrações.



Produtos, depósitos e empresas serão entidades independentes.



\*\*Marco M2:\*\* gestão de estoque, compras e recebimentos validada com testes de concorrência e rastreabilidade.



\---



\# Fase 3 — Vendas e Operação Comercial



\### 3.1 Gestão comercial



| Funcionalidade | Escopo |

|---|---|

| Gestão de anúncios | Catálogo e publicação em canais integrados |

| Loja Virtual | Integração com Ávila Lojas |

| Pedidos de venda | Criação, edição, aprovação e cancelamento |

| Frente de caixa | PDV, pagamentos e fechamento |

| Importar pedidos manualmente | Importação validada de arquivos |

| Propostas comerciais | Orçamentos, versões e aprovação |

| Relatório avançado de vendas | Indicadores, filtros e comparações |

| Garantia | Prazos, solicitações e acompanhamento |

O modelo de garantia, assistência técnica e seus efeitos em estoque, fiscal,
financeiro e logística estão definidos em
`docs/modules-assinaturas-fiscal-garantias.md`.



\### 3.2 Fiscal de vendas



\*\*Notas fiscais de saída:\*\* emissão e acompanhamento de NF-e.



\*\*NFC-e:\*\* emissão vinculada ao PDV, com contingência conforme regras aplicáveis.



\*\*Monitor de Notas:\*\* consulta automatizada dos documentos fiscais vinculados ao CNPJ, com armazenamento de XML e representações PDF apropriadas.

O desenho canônico do coletor, cursor `ultNSU`, manifestação e integração com
o Lojas está em `docs/modules-assinaturas-fiscal-garantias.md`.



O monitor deverá respeitar as regras de distribuição de documentos e os limites dos serviços oficiais.



\### 3.3 Logística



| Funcionalidade | Escopo |

|---|---|

| Objetos de postagem | Etiquetas, rastreamento e acompanhamento |

| Logística reversa | Devoluções e autorizações |

| Checkout de pedidos | Conferência antes da expedição |

| Impressão automática de etiquetas | Filas e impressoras configuradas |

| Ávila Envios | Cotação, contratação e acompanhamento de fretes |



\### 3.4 Serviços



| Funcionalidade | Escopo |

|---|---|

| Contratos | Criação, assinatura, vigência e renovação |

Documentos, assinaturas e a integração por adaptador com a Clicksign estão
definidos em `docs/modules-assinaturas-fiscal-garantias.md`.

| Ordens de serviço | Abertura, execução, materiais e conclusão |

| CT-e | Emissão e acompanhamento conforme perfil fiscal |

| Notas de serviço | NFS-e e integrações municipais/nacionais |

| Cobranças | Cobrança por serviços executados |

| Relatórios de serviço | Produtividade, custos e resultados |



\*\*Marco M3:\*\* uma venda pode percorrer o fluxo completo de pedido, reserva de estoque, faturamento, cobrança e expedição.



\---



\# Fase 4 — Financeiro



\### 4.1 Gestão financeira



| Funcionalidade | Escopo |

|---|---|

| Caixas e bancos | Contas, saldos e movimentações |

| Contas a pagar | Obrigações, vencimentos e pagamentos |

| Contas a receber | Recebíveis, baixas e inadimplência |

| Remessas e retornos | Integrações bancárias CNAB e equivalentes |

| Ficha financeira | Histórico consolidado por cliente ou fornecedor |

| Comissões | Cálculo, aprovação e liquidação |

| Controle de caixa | Abertura, movimentações e fechamento |

| Faturamento agrupado | Agrupamento de cobranças elegíveis |



\### 4.2 Tributos e contabilidade



\*\*DAS MEI:\*\* acompanhamento, consulta e emissão por integração autorizada.



\*\*GNRE e DARE-SP:\*\* cálculo, emissão, acompanhamento e armazenamento de comprovantes.



\*\*Espaço meu contador:\*\* ambiente de colaboração com contadores, documentos, relatórios e permissões próprias.



\### 4.3 Soluções financeiras



\*\*Conta digital:\*\* desenvolver uma integração bancária desacoplada de fornecedores específicos.



A opção solicitada como \*Bling Conta Digital\* dependerá da disponibilidade de APIs, autorização e condições comerciais. Não devemos tratar funcionalidades de terceiros como garantidas.



\*\*Relatórios financeiros:\*\* fluxo de caixa, DRE gerencial, receitas, despesas, inadimplência e análises por empresa.



\### Regras de segurança financeira



Valores monetários serão armazenados com precisão decimal.



Pagamentos precisarão de idempotência e trilhas de auditoria.



Alterações e cancelamentos deverão seguir processos de estorno ou compensação quando necessário.



\*\*Marco M4:\*\* ciclo financeiro completo, conciliado e auditável.



\---



\# Fase 5 — Integração entre os módulos



Esta fase consolida fluxos que precisam funcionar entre domínios.



| Processo | Integração |

|---|---|

| Venda | Pedido → Estoque → Fiscal → Financeiro |

| Compra | Pedido → Recebimento → Estoque → Financeiro |

| Serviço | Contrato → Ordem de serviço → Fiscal → Cobrança |

| Expedição | Pedido → Checkout → Etiqueta → Rastreamento |

| Produção | Ordem → Consumo de insumos → Produto acabado |

| Comissão | Venda elegível → Cálculo → Aprovação → Pagamento |



A comunicação assíncrona utilizará outbox transacional, eventos versionados, retentativas e prevenção de duplicidade.



O n8n poderá orquestrar integrações externas, mas não será responsável por garantir a consistência das transações financeiras ou de estoque.



\*\*Marco M5:\*\* processos completos funcionando sem ajustes manuais no banco.



\---



\# Fase 6 — ERP Web



A interface seguirá os padrões gerais de experiência definidos para a Ávila Ops.



\*\*Diretrizes:\*\*



\- Design responsivo com suporte a tema claro e escuro.

\- Navegação compacta e consistente.

\- Filtros rápidos, busca, agrupamento e paginação.

\- Listas densas no desktop e adaptadas ao celular.

\- Indicadores essenciais visíveis sem navegação desnecessária.

\- Operações completas de criação, edição, cancelamento e consulta.

\- Estados claros de carregamento, erro e confirmação.

\- Atalhos de teclado e acessibilidade.



O ERP deverá permitir que o usuário conclua tarefas sem precisar navegar por dezenas de páginas.



\*\*Marco M6:\*\* todos os módulos acessíveis e operacionais pela interface web.



\---



\# Fase 7 — Aplicativos Android e iOS



O ERP será integrado ao Ávila App Builder.



| Recurso | Android | iOS |

|---|---|---|

| Dashboard | Jetpack Compose | SwiftUI |

| Cadastros | Nativo | Nativo |

| Vendas | Nativo | Nativo |

| Estoque | Nativo | Nativo |

| Financeiro | Nativo | Nativo |

| Câmera e leitura de códigos | Android | iOS |

| Biometria | Android | iOS |

| Notificações | FCM | APNs |



As APIs, permissões e regras de negócio serão compartilhadas.



O App Builder controlará as definições de interface compatíveis com seu contrato AAD. Componentes avançados e recursos específicos terão implementação nativa.



\*\*Marco M7:\*\* aplicativos homologados em Android e iOS, com publicação nas lojas mediante aprovação.



\---



\# Fase 8 — Segurança, escala e operação



Esta fase inclui as verificações necessárias para disponibilização comercial em larga escala.



\*\*Segurança:\*\* autenticação forte, MFA, sessões, segregação por empresa, criptografia, controle de acesso e auditoria.



\*\*Escalabilidade:\*\* testes com centenas de milhares de contas e empresas simuladas, planejamento de capacidade PostgreSQL, cache, filas e múltiplas instâncias.



\*\*Confiabilidade:\*\* backups automáticos, testes periódicos de restauração, observabilidade, alertas, procedimentos de recuperação e metas de disponibilidade.



\*\*Qualidade:\*\* testes unitários, integração, concorrência, isolamento multiempresa, processos fiscais, cenários financeiros e testes de ponta a ponta.



\*\*Marco M8:\*\* plataforma preparada para operação comercial monitorada e expansão progressiva.



\---



\## Cronograma de referência



Este cronograma é uma estimativa inicial, não um compromisso de entrega. Pressupõe uma equipe dedicada, integrações disponíveis e requisitos de negócio suficientemente definidos.



| Fase 

|---|---|

| Fundação ||

| Cadastros | 

| Estoque e Compras |

| Vendas e Serviços | 

| Financeiro |

| Integração e estabilização |

| Interface e experiência web | 

| Android e iOS |

| Segurança e escala | 



Várias etapas podem avançar em paralelo, mas isso depende da equipe disponível.



Um \*\*MVP operacional\*\* pode ser planejado para aproximadamente 6–9 meses. O ERP completo, incluindo fiscal, logística, serviços, produção e aplicativos, deverá ser tratado como um programa de desenvolvimento de 12–24 meses ou mais, conforme o nível de maturidade exigido.



\## Critérios obrigatórios para considerar uma funcionalidade concluída



Uma funcionalidade somente poderá receber o status \*Done\* quando possuir:



1\. Regras de negócio e contrato de API implementados.

2\. Persistência e migrations testadas.

3\. Permissões e isolamento multiempresa verificados.

4\. Interface completa, incluindo edição e cancelamento quando aplicáveis.

5\. Testes automatizados aprovados.

6\. Auditoria dos eventos relevantes.

7\. Documentação de operação e recuperação.

8\. Validação em homologação.



\### Decisão arquitetural



O \*\*ERP-next\*\* deve nascer como um sistema novo, com banco, código e implantação independentes do ERP atual.



O backend será um monólito modular em Rust. O frontend web será Next.js, e os aplicativos móveis utilizarão SwiftUI e Jetpack Compose.



O ERP antigo continuará operando separadamente até existir um processo de migração testado e aprovado.



\*\*A principal regra do projeto será não confundir uma tela pronta com um módulo concluído.\*\* O que define a entrega é o processo de negócio funcionando de ponta a ponta, com dados consistentes e possibilidade de recuperação.

