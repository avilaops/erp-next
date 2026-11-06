# Cadastro e configuração da empresa por CNPJ

O cadastro inicial consulta automaticamente um CNPJ válido após uma pausa de
600 ms na digitação. A consulta exige uma identidade autenticada, sem depender
de uma empresa selecionada. O formulário continua disponível em caso de falha.

Os campos disponíveis são preenchidos apenas quando vazios: razão social,
nome fantasia, endereço, complemento, e-mail, telefone, CNAE, descrição da
atividade e porte com correspondência exata (microempresa ou pequena empresa).
Uma única IE explicitamente ativa da UF selecionada pode preencher a inscrição
estadual. Ausência, ambiguidade ou inatividade não significam isenção.

Os campos complementares ficam acessíveis no próprio cadastro e seguem no
comando idempotente de criação. O perfil persistido é o mesmo usado pela tela
de configuração da empresa. Essa tela também consulta automaticamente o CNPJ,
preserva campos existentes e exige salvar para persistir alterações.

Uma opção explicitamente positiva pelo Simples Nacional, sem data de exclusão
informada, pode preencher o regime quando vazio. Ausência ou negativa nunca
seleciona Lucro Real ou Lucro Presumido. A data da fonte fica visível para revisão.

O preenchimento não deduz regime tributário, segmento, atividade interna,
porte médio/grande, inscrição municipal, SUFRAMA, contato responsável, celular,
e-mail de cobrança ou site. Os provedores consultados não oferecem informação
suficiente para todas essas correspondências. QSA bruto não é retornado.

Trocar o documento cancela a consulta e remove apenas valores preenchidos
automaticamente que o cliente ainda não editou. Uma resposta de outro documento,
empresa ou consulta vencida não preenche o formulário. A configuração existente
confere novamente a empresa da sessão antes de aplicar qualquer resultado.

`POST /api/v1/company-registration/lookup` recebe apenas `value`. Não cria tenant,
não concede permissões nem acessa cadastros privados. Cache e limite por usuário
ficam separados dos tenants; todos compartilham as quotas globais dos provedores.
O BFF exige sessão, origem autorizada, JSON limitado e ausência de query, sem
encaminhar um tenant informado pelo navegador.

Fontes oficiais:

- [CNPJ.ws público](https://docs.cnpj.ws/referencia-de-api/api-publica/consultando-cnpj)
- [BrasilAPI](https://brasilapi.com.br/docs#tag/CNPJ)

## Clientes e fornecedores

O mesmo endpoint cadastral existente atende o contexto `party`. Um CNPJ válido
dispara a consulta após 600 ms sem digitação. A resposta precisa corresponder ao
documento, contexto e tenant atuais, ter origem e validade e passar por uma nova
conferência da empresa da sessão antes de preencher o formulário.

Razão social, fantasia, e-mail e telefone preenchem apenas valores vazios.
Quando não há endereço ou o primeiro formulário está totalmente vazio, os dados disponíveis preenchem um endereço cadastral,
com os campos ausentes em branco para revisão. A escolha de endereço principal
permanece com o usuário. Endereços e contatos adicionais existentes são preservados.

Ao trocar o documento ou tipo de pessoa, valores gerados e ainda não editados
são removidos; alterações manuais permanecem. Falha da fonte, CPF ou documento
inválido mantêm o preenchimento manual disponível. Usuários sem edição não
disparam a consulta automática.

O preenchimento altera o formulário. A gravação continua passando por POST/PUT
de pessoas, com a mesma revisão, idempotência, autorização e RLS existentes.
O esquema de produção foi conferido em transação somente de leitura: `parties`
já contém e-mail, telefone, endereços e contatos JSONB e RLS forçada. Não é
necessária migração nem atualização em lote de cadastros existentes.
