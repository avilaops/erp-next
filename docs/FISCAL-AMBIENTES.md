# Ambientes de emissão NF-e

A escolha do ambiente pertence ao usuário, no perfil fiscal da empresa. O
software oferece homologação e produção para o recorte NF-e 55/SP existente,
com as mesmas validações de cadastro, certificado e regras tributárias.
Não há preenchimento ou alteração automática da configuração de empresas.

## Configuração e numeração

Produção exige que o usuário informe a próxima numeração da série. O servidor
consulta a sequência atual ao abrir a configuração e recusa reduzir números
já reservados. Alterar o ambiente ou a série no formulário limpa o campo da
numeração para exigir nova declaração do usuário.

As sequências e vínculos de pedido são separados por empresa, ambiente e série.
Uma nota ou inutilização de homologação não ocupa números de produção. O banco
vincula cada documento ao mesmo ambiente de seu rascunho. Depois de reservar
número, o ambiente do documento não pode mudar.

## Transmissão e eventos

O motor gera tpAmb 1 em produção e tpAmb 2 em homologação; usa os endereços SP
da matriz oficial já versionada e confere chave, XML e ambiente antes de enviar.
O backend confere ambiente no XML preparado, protocolo e recibos dos eventos.
Consulta, CC-e, cancelamento e reconciliação continuam no ambiente gravado no
documento, mesmo que o usuário altere depois o perfil da empresa.

Inutilização utiliza o ambiente persistido na solicitação; uma repetição não
troca o ambiente ao ler um perfil mais recente. Somente o comando fiscal
explícito transmite. Salvar dados não emite nota.

A variável antiga NFE_PRODUCTION_ENABLED é aceita como booleano para
compatibilidade de implantação. Ela não escolhe o ambiente nem dispara
emissão; a escolha efetiva é o perfil persistido pelo usuário.

## Escopo e evidências

Mantêm-se as validações do recorte tributário já implementado. Esta alteração
não acrescenta emissão NFC-e 65, transportes de outras UFs ou contingência.
Distribuição CT-e e a distribuição NF-e de homologação mantêm seus contratos.

Testes usam certificados e autoridades sintéticos: verificam geração,
assinatura, XSD, endpoints de cada ambiente, isolamento da numeração, sequência
informada, impossibilidade de retrocesso e eventos após trocar o perfil.
Configuração, testes, publicação e autorização real pela SEFAZ são evidências
distintas. Não transmitir documentos reais durante esta implementação.

## Ampliação do contrato

O enum de resposta passa a incluir `production`. Consumidores fiscais com enum
fechado precisam regenerar seus tipos; o frontend desta release o faz a partir
do mesmo OpenAPI. O comparador registra sete incompatibilidades formais, todas
desse acréscimo, sem remoção de campos ou endpoints. A admissão em
`scripts/contracts/reviewed-fiscal-environments.json` fixa os dois hashes e os
sete achados completos da implementação solicitada. O relatório continua
`compatible=false`; outras diferenças ou contratos continuam recusados.
