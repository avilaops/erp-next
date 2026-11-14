# Contratos • Transporte interno do validador

## Intenção e continuidade

Implementar a fronteira autenticada que o serviço privado de validação e o
ERP utilizarão. É uma etapa da implementação autorizada em
[ASSINATURA-ICP-INDIVIDUAL.md](../../telas/servicos/contratos/referencias/ASSINATURA-ICP-INDIVIDUAL.md),
sem reduzir o objetivo completo ao núcleo matemático ou a este protocolo.
O usuário autorizou execução contínua; as escolhas técnicas abaixo são do
implementador, sem atribuir aprovação específica de protocolos ao usuário.

## Abordagem

Reutilizar o pacote Python e sua distribuição testada sem rede. Acrescentar
somente modelos e autenticação puros, sem nova dependência ou servidor HTTP.
JSON com PDFs em base64 amplia a memória e multipart adiciona parsing que
neste canal interno não traz benefício. Um frame binário versionado tem
cabeçalho JSON limitado, seguido dos PDFs exatos. Não é um formato de upload
do navegador. O futuro BFF produz esse frame a partir do estado autorizado.

## Contrato

- O preflight informa `icp_brasil` ou `synthetic_not_icp`, inclusive em falhas.
  Seu relatório canônico contém hashes do inventário, sem nomes de campos,
  CPF, subject ou certificados. Checks obrigatórios ausentes impedem aceite.
- Frame `AVILA-CV1\n`, comprimento de cabeçalho uint32 big-endian, JSON ASCII
  canônico de até 32 KiB, seguido das partes em ordem fixa. Sem bytes extras.
- Operações `preflight` e `increment`; POST somente em
  `/internal/v1/preflight` e `/internal/v1/increment` respectivamente.
- Contexto contém UUIDs canônicos não nulos de request, tenant, envelope e
  documento; hashes da política e do bundle configurados no serviço.
- Preflight recebe somente base até 20 MiB. Increment recebe base até 20 MiB,
  pai até 32 MiB e candidato até 32 MiB, um titular e até nove anteriores.
  Participantes/CPFs não se repetem. Tamanhos e hashes são conferidos antes
  de qualquer parser PDF. Nenhuma parte pode ser vazia.
- Nenhuma URL, caminho, raiz, política arbitrária, horário de validação,
  inventário autodeclarado ou evidência externa entra no frame. O serviço
  registra a hora UTC de observação e obtém sua própria configuração.
- JSON recusa propriedades desconhecidas/duplicadas, coerção numérica,
  identificadores alternativos, profundidade excessiva e valores não finitos.
- HMAC-SHA256 usa chave dedicada de 32 a 64 bytes, até duas chaves ativas
  identificadas. Nunca usar A1, chave pessoal, token DocuSeal ou chave de banco.
  A assinatura inclui domínio, método, target exato, key ID, horário Unix,
  request ID, SHA-256 e tamanho do corpo. Cabeçalhos duplicados, compressão,
  transfer-encoding, mais de 32 cabeçalhos ou mais de 16 KiB são recusados.
- Autenticar cabeçalhos antes de interpretar o frame. Tolerância temporal:
  no máximo 60 s de idade e 5 s no futuro. Conferir hash/tamanho antes do JSON.
  Falhas não ecoam CPF, credencial, payload ou diagnóstico de terceiros.
- Resposta canônica inclui contexto completo e relatório canônico do núcleo.
  Seu MAC tem domínio separado do request. Verificar correlação, hashes,
  operação, perfil de confiança e hora observada antes de consumir a resposta.
  Uma resposta sintética nunca é apresentada como evidência ICP real.

## Responsabilidades que continuam obrigatórias

O protocolo é interno e puro. Não afirmar que ele implementa servidor,
isolamento Linux, limites de CPU/memória, TLS, revogação online, persistência,
RLS, leases/CAS, proteção global contra replay, sessões do participante ou
homologação. O mesmo pedido matemático pode ser repetido; somente o futuro
workflow transacional poderá avançar estado. A autenticação não prova a
origem DocuSeal da base, poderes do representante ou autorização por tenant.
Nenhum endpoint público, convite ou novo custo é habilitado nesta etapa.

## Verificação

Testar round-trip binário, nulidade/duplicação de campos, limites exatos e
excedidos, bytes alterados e cauda extra, troca de operação/contexto, CPF e
participante duplicados, timestamps vencidos/futuros, rotação de chaves,
falhas de MAC, correlação da resposta e segregação de confiança sintética.
Executar o corpus completo do wheel com rede bloqueada e CI antes da integração.
