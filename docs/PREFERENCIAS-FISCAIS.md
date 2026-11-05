# Preferências fiscais

O usuário preenche os dados e escolhe os parâmetros. Salvar configuração não
emite documentos nem transmite eventos à SEFAZ.

## Configurações de NFC-e

`/preferencias/fiscal/nfce` mantém ambiente, UF, série, próximo número e
identificador do CSC, declarados pelo usuário. O CSC é obrigatório no primeiro
cadastro e ao mudar ambiente, UF, identificador ou documento da empresa.
Nas demais edições, omitir o código preserva o segredo existente.

O armazenamento usa AES-256-GCM e o chaveiro fiscal já existente. Dados
autenticados vinculam o segredo à empresa, CNPJ, ambiente, identificador e
revisão. Nenhuma consulta ou auditoria retorna o CSC. O formulário o limpa
após confirmação de gravação. Um chaveiro ausente bloqueia a gravação segura.
O próximo número é uma configuração; salvar não reserva nem consome números.

Essa entrega configura o modelo 65. A emissão NFC-e tem integração própria e
não se torna operacional apenas por existir uma configuração persistida.

## Naturezas de operação

`/preferencias/fiscal/naturezas` cadastra código, descrição, entrada/saída,
modelo, finalidade, CFOP interno/interestadual/exterior e situação ativa.
IDs e códigos duplicados são recusados; CFOPs opcionais devem corresponder à
direção e ao destino. Não há escolha automática de regime, CST ou alíquotas.
Desativar preserva o cadastro e os documentos anteriores.

O editor de NF-e oferece naturezas ativas de saída normal, modelo 55,
compatíveis com o fluxo existente. Aplicar copia descrição e referência da
revisão; o usuário confere os CFOPs dos itens conforme o destino. Outras
finalidades podem ser cadastradas, mas não são convertidas em emissão normal.

## Consultas

`/preferencias/fiscal/inutilizacoes` e `/preferencias/fiscal/correcoes` consultam
`fiscal_nfe_events`, com paginação por cursor, situação efetiva, solicitação e
retorno gravados, ambiente e vínculo com a NF-e quando existente.
Não há consulta externa ou transmissão ao abrir/atualizar a lista. Uma falha
de consulta remove os registros anteriores e mostra erro, sem simular vazio.

## Contratos e validação

- `GET/PUT /api/v1/fiscal/settings/{section}`: `nfce` ou `operation-natures`.
- `GET /api/v1/fiscal/nfe-events?kind=correcao|inutilizacao&limit=25&cursor=...`.
- BFF correspondente em `/api/erp/fiscal/`, sem cache e com origem/empresa
  verificadas na escrita.
- Consulta de configuração exige `fiscal.config.read`; escrita também exige
  `fiscal.config.manage`. Eventos exigem `fiscal.nfe.read`.
- Gravação exige `If-Match`, serializa por empresa e registra auditoria/outbox.
- Migração nova cria somente armazenamento com RLS; não preenche dados fiscais.
- Testes verificam segredo, contexto criptográfico, revisão, permissões,
  isolamento, CFOP, duplicações, paginação, persistência e celular.

Liberação de produção NF-e e emissão NFC-e permanecem etapas distintas desta
base de configuração. Não executar emissão, inutilização ou correção real para
validar formulários.
