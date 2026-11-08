# Ambientes de emissão NF-e e NFC-e

A escolha do ambiente pertence ao usuário, no perfil fiscal da empresa. O
software oferece homologação e produção para o recorte NF-e 55/SP e NFC-e
65/SP implementado, com as mesmas validações de cadastro, certificado e regras
tributárias. O motor recusa UFs e combinações fora do recorte explicitamente
suportado.
Não há preenchimento ou alteração automática da configuração de empresas.

## Configuração e numeração

Produção exige que o usuário informe a próxima numeração da série. O servidor
consulta a sequência atual ao abrir a configuração e recusa reduzir números
já reservados. Alterar o ambiente ou a série no formulário limpa o campo da
numeração para exigir nova declaração do usuário.

As sequências e vínculos de pedido são separados por empresa, ambiente e série.
Uma nota de homologação não ocupa números de produção. O banco vincula cada
documento ao mesmo ambiente de seu rascunho. Depois de reservar número, o
ambiente do documento não pode mudar.

## Transmissão e eventos

O motor gera tpAmb 1 em produção e tpAmb 2 em homologação; usa os endereços SP
da matriz oficial já versionada e confere chave, XML e ambiente antes de enviar.
O backend confere ambiente no XML preparado, protocolo e recibos dos eventos.
Consulta, CC-e, cancelamento e reconciliação continuam no ambiente gravado no
documento, mesmo que o usuário altere depois o perfil da empresa.

Para emitentes paulistas, o endpoint de inutilização recusa a operação antes
de reservar numeração ou chamar a autoridade. Desde 01/11/2026, a SEFAZ-SP
determinou que não se deve solicitar inutilização de NF-e modelo 55 ou NFC-e
modelo 65 por lacunas de numeração; a empresa deve continuar da próxima
numeração e manter a quebra registrada na escrituração. Somente o comando
fiscal explícito transmite eventos autorizados. Salvar dados não emite nota.

A variável `NFE_PRODUCTION_ENABLED` é aceita como gate explícito de implantação
e assume `false` quando ausente. Quando `true`, `NFE_PRODUCTION_TENANT_ID`
também é obrigatório e restringe a liberação a um único tenant autorizado.
Essas variáveis não escolhem o ambiente nem disparam emissão; a escolha
efetiva é o perfil persistido pelo usuário e cada comando continua exigindo
A1, motor, perfil e readiness válidos.

## Escopo e evidências

Mantêm-se as validações do recorte tributário já implementado. A NFC-e 65
possui geração, assinatura, QR Code, pagamentos, troco, contingência offline e
transmissão posterior no motor, além de cancelamento, consulta e reimpressão
pelos fluxos fiscais persistentes. Transportes de outras UFs continuam fora do
recorte. Distribuição CT-e e distribuição NF-e mantêm seus contratos.

Testes usam certificados e autoridades sintéticos: verificam geração,
assinatura, XSD, endpoints de cada ambiente, isolamento da numeração, sequência
informada, impossibilidade de retrocesso e eventos após trocar o perfil.
Configuração, testes, publicação e autorização real pela SEFAZ são evidências
distintas. Não transmitir documentos reais durante esta implementação.

A implantação usa `scripts/healthcheck.mjs` da imagem fiscal para validar o
HTTP 200 autenticado e ambos os ambientes anunciados em `/healthz`. Tanto o
overlay Compose quanto a atualização do Compose privado usam essa mesma sonda;
o campo antigo `environment` não representa as capacidades atuais do motor.

## Ampliação do contrato

O enum de resposta passa a incluir `production`. Consumidores fiscais com enum
fechado precisam regenerar seus tipos; o frontend desta release o faz a partir
do mesmo OpenAPI. O comparador registra sete incompatibilidades formais, todas
desse acréscimo, sem remoção de campos ou endpoints. A admissão em
`scripts/contracts/reviewed-fiscal-environments.json` fixa os dois hashes e os
sete achados completos da implementação solicitada. O relatório continua
`compatible=false`; outras diferenças ou contratos continuam recusados.
