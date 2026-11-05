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
