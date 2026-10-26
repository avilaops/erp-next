# Arquitetura inicial

O inventário integral de superfícies web, rotas e critérios de conclusão está em `docs/frontend-erp-roadmap.md`. A trilha detalhada de Preferências permanece em `docs/frontend-preferences-roadmap.md`.

## Decisões

1. O ERP é um monólito modular. Serviços independentes só surgem com evidência operacional.
2. Toda operação empresarial carrega um `tenant_id` validado na API e reforçado pelo PostgreSQL.
3. Auth Ávila Ops prova identidade; o ERP controla empresa, associação, papéis e permissões.
4. Movimentos financeiros, fiscais e de estoque usam cancelamento ou estorno, nunca exclusão destrutiva.
5. Eventos externos são gravados na mesma transação do domínio usando outbox.
6. Integrações precisam de chave de idempotência e reconciliação para efeitos de resultado desconhecido.

## Limites dos domínios

| Domínio | Responsabilidade inicial |
| --- | --- |
| Plataforma | Empresas, identidade, associação, permissões, auditoria e outbox |
| Cadastros | Produtos, pessoas, vendedores, funcionários e tabelas auxiliares |
| Comercial | Propostas, pedidos, PDV, anúncios e loja virtual |
| Estoque | Saldos derivados, movimentos, depósitos, compras e produção |
| Financeiro | Obrigações, liquidações, conciliação, caixa e comissões |
| Fiscal | NF-e, NFC-e, CT-e, NFS-e, eventos e monitoramento |
| Logística | Expedição, etiquetas, postagem e reversa |
| Serviços | Contratos, ordens, medições e cobranças |

## Primeiro fluxo vertical

O primeiro fluxo funcional será `Preferências > Empresa`. Ele deve estabelecer o contexto multiempresa usado por todos os demais domínios antes da implementação dos fluxos operacionais.

Ordem inicial:

1. shell autenticado e identificação da empresa ativa;
2. central de preferências;
3. dados cadastrais, fiscais, endereço, contatos e marca da empresa;
4. usuários, papéis e permissões por empresa;
5. configurações do sistema e integrações;
6. importação, exportação e recuperação de dados;
7. pedido de venda com reserva de estoque como primeiro fluxo operacional completo.

Exportação de dados não será apresentada como backup recuperável sem política de retenção, verificação de integridade e teste de restauração.

O detalhamento executável da trilha está em `docs/frontend-preferences-roadmap.md`. Agentes devem seguir a ordem, os limites de arquivos e os critérios de aceite registrados nesse documento.

Os limites de Documentos e Assinaturas, Monitor de Notas e Garantias estão em
`docs/modules-assinaturas-fiscal-garantias.md`. Esses módulos compartilham
outbox e auditoria, mas permanecem domínios separados; o n8n não assume o
estado canônico nem as transações do ERP.

## Padrão obrigatório de interface

Todas as telas e módulos do ERP devem compartilhar o mesmo sistema visual. Nenhum domínio deve criar uma identidade paralela ou importar outra biblioteca de componentes sem uma decisão arquitetural registrada.

O CI deve permanecer simples e ter orçamento de até um minuto em execução com cache aquecido. Fila do provedor e primeira instalação em runner frio não fazem parte desse tempo controlável. Validações independentes podem executar em paralelo, sem duplicar instalações ou criar pipelines por módulo.

### Fundação

- Next.js, React, TypeScript e Tailwind CSS.
- `shadcn/ui` como base dos componentes reutilizáveis.
- Direção visual e critérios de qualidade definidos pelo plugin Apple Ávila.
- Tokens centralizados para cores, tipografia, espaçamento, raios, sombras, elevação, foco e movimento.
- Suporte consistente aos modos claro e escuro.

### Estrutura comum

Todas as áreas autenticadas devem reutilizar:

- shell principal;
- barra superior;
- navegação principal horizontal com menus por domínio no desktop;
- navegação principal em painel lateral no celular;
- navegação lateral apenas dentro de áreas hierárquicas, como Preferências;
- seletor e identificação da empresa ativa;
- busca global;
- cabeçalho de página;
- breadcrumbs;
- área padronizada de ações;
- comportamento responsivo para desktop, tablet e celular.

### Componentes comuns

| Categoria | Componentes previstos |
| --- | --- |
| Navegação | Sidebar, Sheet, Breadcrumb, Tabs, Command e Dropdown Menu |
| Formulários | Field, Input, Select, Checkbox, Switch e Textarea |
| Ações | Button, Dialog e Alert Dialog |
| Dados | Table, Badge, Avatar, Card e paginação |
| Retorno | Alert, Skeleton, Progress e Sonner |
| Ajuda | Tooltip e Popover |
| Datas | Calendar e seletor de data quando exigidos pelo fluxo |

Os componentes devem ser adicionados sob demanda. Catálogos externos podem servir como referência, mas o código incorporado precisa usar os tokens, variantes e critérios de acessibilidade do ERP.

### Estados obrigatórios

Cada fluxo deve tratar explicitamente, quando aplicável:

- carregamento;
- conteúdo vazio;
- erro recuperável;
- erro impeditivo;
- sucesso;
- ausência de permissão;
- conteúdo desabilitado;
- confirmação de ação destrutiva;
- alterações não salvas.

### Consistência e acessibilidade

- Preservar hierarquia, densidade, alinhamento e posicionamento de ações entre módulos.
- Não misturar Flowbite, daisyUI, Aceternity UI ou outro sistema visual com a base principal.
- Garantir foco visível, navegação por teclado, rótulos acessíveis e contraste verificável.
- Respeitar redução de movimento configurada pelo usuário.
- Usar tabelas, filtros e paginação com o mesmo comportamento em todos os domínios.
- Apresentar ações destrutivas de forma explícita e separada das ações principais.
- Validar cada componente reutilizável nos modos claro, escuro e responsivo antes de considerá-lo estável.

## Referência visual: dados da empresa

Esta seção inventaria a tela de referência enviada para o cadastro empresarial. Textos cortados na captura são registrados como aparecem, sem completar conteúdo não visível.

### Estrutura global

- Tema escuro.
- Logotipo `bling` no canto superior esquerdo.
- Barra superior com os menus `Meu Negócio`, `Cadastros`, `Vendas`, `Estoque` e `Financeiro`.
- Campo global `Pesquisar`, com ícone de lupa.
- Ações superiores representadas por ícones: ferramenta/atalho, aplicativos, notificações, ajuda e configurações.
- Breadcrumb: `Home > Preferências > Alterar dados da empresa`.
- Conteúdo em duas colunas: navegação lateral e formulário principal.

### Navegação lateral

| Grupo | Opções visíveis |
| --- | --- |
| Minha conta | `Dados da empresa` (selecionado), `Dados do sócio(a)`, `Alterar senha` (link externo), `Controle de horários` (link externo) |
| Pagamento | `Formas de pagamento`, `Extrato da conta` |
| Gerenciamento | `Espaço e armazenamento`, `Importações de pedidos` |
| Preferências da conta | `Alteração de plano`, `Cancelamento de conta` |

### Formulário: Dados da empresa

- Título: `Dados da empresa`.
- Legenda: campos marcados com asterisco vermelho são obrigatórios.

| Campo | Obrigatório | Tipo/estado visível | Conteúdo visível |
| --- | --- | --- | --- |
| Nome | Sim | Texto | `P.L. REPRESENTACOES COMERCIAIS LTDA` |
| Nome Fantasia | Não indicado | Texto | `P.L. REPRESENTACOES COMERCIAIS L` (cortado) |
| Tipo da Pessoa | Não indicado | Seleção | `Pessoa Jurídica` |
| CNPJ | Sim | Texto | `60.067.738/0001-06` |
| Inscrição Estadual | Não indicado | Texto, com ícone de informação | `154.665.624.118` |
| Isento | Não indicado | Checkbox desmarcado | — |
| Inscrição Municipal | Não indicado | Texto | Vazio |
| Inscrição Suframa | Não indicado | Texto | Vazio |
| CNAE | Não indicado | Texto | `4619200` |
| Atividade principal | Não indicado | Seleção | `Outros` |
| Descreva sua atividade | Não indicado | Texto | `REPRESENTACOES COME` (cortado) |
| Código de regime tributário | Sim | Seleção | `Simples Nacional` |
| Tamanho da empresa | Não indicado | Seleção | `Pequena` |
| Seu segmento | Sim | Grupo de checkboxes | `Comércio`, `E-commerce` e `Serviços` marcados; `Indústria` desmarcado |
| Faturamento do último ano | Não indicado | Seleção | Sem valor visível |
| Quantidade de funcionários | Não indicado | Seleção | Sem valor visível |

### Endereço

| Campo | Obrigatório | Tipo/estado visível | Conteúdo visível |
| --- | --- | --- | --- |
| CEP | Sim | Texto, com ação de busca | `15.080-430` |
| UF | Sim | Seleção | `SP` |
| Cidade | Sim | Texto | `São José do Rio Preto` |
| Bairro | Sim | Texto | `Parque Quinta` |
| Endereço | Sim | Texto | `Rua Bonucesso` |
| Número | Sim | Texto | `563` |
| Complemento | Não indicado | Texto | Vazio |

### Contato

| Campo | Obrigatório | Tipo/estado visível | Conteúdo visível |
| --- | --- | --- | --- |
| Pessoas de contato | Não indicado | Texto | Vazio |
| Telefone | Não indicado | Texto | Vazio |
| Celular | Não indicado | Texto | `17992848502` |
| E-mail | Não indicado | E-mail validado, com indicador verde | `domiriodistribuidora@gmail.com` |
| E-mail de Cobrança | Não indicado | E-mail, com ícone de informação | `domiriodistribuidora@gmail.c` (cortado) |
| Site | Não indicado | URL | `https://www.facebook.com` |

### Inscrições Estaduais dos substitutos tributários

- Área em formato de lista editável.
- Colunas: `Estado` e `Inscrição Estadual`.
- Uma linha vazia visível.
- O seletor de estado exibe `U...` (conteúdo cortado).
- Campo de inscrição estadual vazio.
- Ação de excluir representada por ícone de lixeira vermelho.
- Ação `Adicionar outra inscrição`, acompanhada de ícone de adição.

### Sua marca

- Orientação: `A resolução mínima indicada da imagem é de 120 x 56 pixels`.
- Prévia da marca `DOMÍRIO DISTRIBUIDORA`.
- Ação `Alterar imagem`, com ícone de edição.
- Separador vertical entre a marca atual e a geração de marca.
- Texto: `Caso deseje, podemos gerar uma logo para você, basta clicar no botão abaixo!`.
- Botão `Gerar nova logo`.

### Comportamentos sinalizados pela interface

- Campos obrigatórios identificados visualmente.
- Seletores com seta de expansão.
- Checkboxes multisseleção para segmentos.
- Busca de endereço a partir do CEP.
- Validação visual de e-mail.
- Ajuda contextual por ícones de informação.
- Coleção dinâmica de inscrições estaduais, com inclusão e exclusão de linhas.
- Substituição da imagem da marca e geração de uma nova marca.

## Referência visual: central de preferências

Origem exibida na captura: `https://www.bling.com.br/preferencias.php#empresa`.

### Estrutura e navegação

- A página mantém o tema escuro e a barra global descrita anteriormente.
- À direita da barra global também aparecem o avatar da empresa e a identificação abreviada `P.L.`.
- Breadcrumb principal: `Home > Preferências`.
- Cabeçalho da área: `Escolha uma das opções abaixo`.
- Campo de busca contextual com placeholder `Pesquise aqui...` e ícone de lupa verde.
- Abaixo do cabeçalho há uma seta de retorno e o contexto `Preferências / Empresa`.
- O conteúdo é dividido entre um menu vertical de categorias e a lista de opções da categoria ativa.

### Categorias visíveis

Cada categoria possui um ícone circular próprio. `Empresa` está ativa e usa destaque verde.

| Ordem | Categoria | Estado |
| ---: | --- | --- |
| 1 | `Empresa` | Ativa |
| 2 | `Sistema` | Inativa |
| 3 | `Cadastros` | Inativa |
| 4 | `Suprimentos` | Inativa |
| 5 | `Vendas` | Inativa |
| 6 | `Notas Fiscais` | Inativa |
| 7 | `Certificado Digital` | Inativa |
| 8 | `Finanças` | Inativa |
| 9 | `Serviços` | Inativa |
| 10 | `Integrações` | Inativa |
| 11 | `Logística` | Inativa |
| 12 | `Contabilidade` | Inativa |
| 13 | `Importações de Dados` | Inativa |

A captura termina logo após `Importações de Dados`; portanto, não comprova que essa seja a última categoria existente.

### Opções da categoria Empresa

| Grupo | Opção | Apresentação |
| --- | --- | --- |
| Configurações da empresa | `Geral` | Linha navegável com chevron verde |
| Tabelas e configurações adicionais | `Alterar dados da empresa` | Linha navegável com chevron cinza |

### Comportamentos sinalizados

- A busca contextual deve filtrar ou localizar opções de preferências.
- A seleção de uma categoria deve trocar o conjunto de opções exibido à direita.
- As opções `Geral` e `Alterar dados da empresa` levam a telas de configuração específicas.
- A área usa rolagem vertical; há conteúdo fora do enquadramento.

## Referência visual: edição de usuário e permissões

Esta captura mostra uma tela longa de edição de usuário. A barra fixa de ações cobre parte dos campos de autenticação; esses valores não podem ser determinados pela imagem.

### Cabeçalho e avisos

- Breadcrumb parcial: `... > Usuários`.
- Legenda no canto superior direito indicando os campos obrigatórios.
- Painel informativo azul com ícone de informação.
- Bloco `Permissões`: ao alterar as permissões do usuário, ele deve sair da conta e entrar novamente com login e senha para que as novas permissões sejam atualizadas.
- Bloco `Usuário API`: a criação de usuário API foi desabilitada; o painel direciona para a documentação da nova versão da API e apresenta o link externo `Saiba mais`.

### Informações da conta

| Campo | Obrigatório | Conteúdo/estado visível |
| --- | --- | --- |
| Nome | Sim | `domiriodistribuidora` |
| E-mail | Não indicado | `paulodomirio@gmail.com` |
| Celular | Não indicado | `(17) 99284-8502` |
| Login | Não determinável | O rótulo começa com `Login@domiriodistribuidora` e possui ícone de informação; o campo está encoberto |
| Senha atual | Não determinável | Campo encoberto pela barra fixa |
| Senha | Não determinável | Campo encoberto pela barra fixa |
| Confirmação da senha | Não determinável | Campo encoberto pela barra fixa |

### Barra fixa de ações

- Título `Usuário` à esquerda.
- Botão secundário contornado `Cancelar`.
- Botão primário verde `Salvar`.
- A barra permanece sobre o conteúdo durante a rolagem e, na captura, encobre parte do formulário.

### Preferências do usuário

Dois checkboxes aparecem desmarcados:

- `Receber comunicações sobre novidades do Bling`.
- `Restringir horários de acesso`.

### Organização das permissões

As permissões são separadas nas abas:

1. `Cadastros`.
2. `Suprimentos`.
3. `Vendas`.
4. `Finanças`.
5. `Serviços`.
6. `Preferências`.
7. `Contabilidade`.
8. `Outros`.

A aba `Outros` está selecionada, identificada por texto e sublinhado verdes.

### Permissões visíveis na aba Outros

Todos os itens abaixo aparecem marcados na captura.

| Permissão principal | Subpermissões ou detalhes marcados |
| --- | --- |
| `Acesso aos dados da empresa` | `Gerenciar dados da empresa` |
| `API Para Web Services` | — |
| `Borderôs` | `Exclusão` |
| `Cadastro de grupos de tags` | — |
| `Cadastro de tags` | — |
| `Chat do WhatsApp no Bling` | — |
| `Compra de certificado digital` | — |
| `Controle de Horários para Login` | — |
| `Emissão de Boletos` | — |
| `Enviar GNRE` | — |
| `Etiquetas customizadas` | — |
| `Gerenciador de Arquivos` | — |
| `Importação de NFe através de arquivo XML` | — |
| `Imprimir ordem de produção` | — |
| `Integração Loja Virtual` | `Fornece a validação de produtos em canais de vendas` |
| `Relatórios customizados` | `CURVA ABC MAIS VENDIDOS`, `CLIENTES ATIVOS`, `ABC com Data Venda`, `Vendas ALEX` |
| `Upgrade de conta` | — |
| `Usuários e Usuário API` | — |
| `Visualizar os dados básicos da empresa` | — |

### Modelo funcional indicado pelas permissões

- Permissões podem ter relação hierárquica entre uma capacidade principal e ações subordinadas.
- A seleção visual usa checkbox verde tanto no nível principal quanto no nível subordinado.
- Algumas capacidades separam leitura de gerenciamento, como `Acesso aos dados da empresa`, `Gerenciar dados da empresa` e `Visualizar os dados básicos da empresa`.
- Algumas capacidades expõem ações destrutivas separadamente, como `Borderôs > Exclusão`.
- Relatórios customizados são concedidos individualmente, e não apenas por uma permissão genérica do módulo.
- Alterações só passam a valer para uma sessão nova do usuário, conforme o aviso da própria tela.

