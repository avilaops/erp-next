# NF-e 55: preparação e bloqueio de emissão

Escopo da [AVL-328](https://linear.app/avilaops/issue/AVL-328): primeira NF-e
autorizada em homologação, com XML assinado, protocolo, persistência documental
e DANFE. **Esta implementação entrega somente a preparação persistente e a
barreira de transmissão. A emissão ainda não está implementada.**

## Fronteira arquitetural

O domínio está em `apps/api/src/domains/fiscal`, dentro do monólito Rust.
PostgreSQL contém configuração e rascunhos por empresa. As rotas usam o mesmo
Auth, contexto transacional, permissões locais e bloqueio da empresa antes de
recarregar direitos que os demais domínios.

Nenhum serviço de consulta existente recebe novas responsabilidades. O domínio
não depende do ERP legado. Os eventos `fiscal.nfe.draft.*` descrevem rascunhos;
não são comandos de transmissão e não devem acionar um emissor no n8n.

## Contrato implementado

Todas as operações exigem Bearer válido e `X-Tenant-Id`. O OpenAPI gerado pela
API descreve os corpos e as respostas efetivamente implementadas.

| Método e recurso | Permissões | Precondições |
| --- | --- | --- |
| `GET /api/v1/fiscal/config` | `fiscal.config.read` | ETag `"0"` e `data: null` quando ausente |
| `PUT /api/v1/fiscal/config` | `fiscal.config.read` e `fiscal.config.manage` | `If-Match`; `"0"` somente para criação |
| `GET /api/v1/fiscal/readiness` | `fiscal.nfe.read` | Expõe bloqueios e `canTransmit: false` |
| `GET /api/v1/fiscal/nfe` | `fiscal.nfe.read` | `limit` entre 1 e 100; paginação por `cursor` UUID |
| `POST /api/v1/fiscal/nfe` | `fiscal.nfe.read` e `fiscal.nfe.manage` | `Idempotency-Key` UUID; perfil e empresa coerentes |
| `GET /api/v1/fiscal/nfe/{id}` | `fiscal.nfe.read` | ETag da revisão atual |
| `PUT /api/v1/fiscal/nfe/{id}` | `fiscal.nfe.read` e `fiscal.nfe.manage` | `If-Match`; recaptura empresa e perfil atuais |
| `POST /api/v1/fiscal/nfe/{id}/issue` | `fiscal.nfe.read` e `fiscal.nfe.issue` | `If-Match` e `Idempotency-Key`; sempre recusa com 503 após autorização |

O corpo JSON tem limite de 1 MiB e recusa campos desconhecidos. Dados e erros
usam `Cache-Control: no-store`. Um UUID de rascunho de outra empresa retorna 404
para um operador autorizado nessa outra empresa. RLS é forçada nas duas tabelas
fiscais; o processo deve usar conta `NOSUPERUSER NOBYPASSRLS`.

Criação de rascunho, registro do comando, auditoria e outbox confirmam juntos.
A chave de criação tem escopo empresa + identidade; intenção diferente com a
mesma chave retorna 409. Repetir a mesma intenção devolve o resultado original,
inclusive sua revisão e snapshot originais, com `Idempotency-Replayed: true`.
Não representa consulta ao estado atual do rascunho. Direitos são revalidados
inclusive para repetição de comando. Registros de comando não expiram nesta
versão e incluem os dados do rascunho, sujeitos ao mesmo isolamento.

O rascunho guarda versões e cópias dos dados de empresa e perfil. Editar empresa
ou configuração não reescreve um rascunho existente. Alterar explicitamente o
rascunho exige sua revisão atual e substitui esses snapshots pelos dados atuais.
A cópia do perfil contém somente um alias de certificado, sem senha ou chave.

## Configuração do emitente

O cadastro de empresa precisa estar válido e conter CNPJ, endereço, regime e IE.
O perfil fiscal exige ambiente `homologation`, UF, código IBGE de sete dígitos,
IE sem formatação, CRT, série de 1 a 999 e `certificateReference`.
UF, IE e regime devem ser coerentes com o cadastro da empresa. Validar o prefixo
IBGE e a estrutura da IE não confirma município existente nem inscrição ativa.
CRT 1, 2 ou 4 é compatível com o agrupamento `simples` do cadastro; esse
agrupamento sozinho não escolhe entre os três. CRT 3 corresponde a
`presumido` ou `real`. A escolha fiscal deve vir da instrução do emitente.

`certificateReference` aceita apenas um alias de 3 a 100 caracteres ASCII
alfanuméricos, hífen ou sublinhado. Não aceita caminho, PEM, URL ou campo de
senha. **Um alias salvo não comprova A1 provisionado, criptografado ou válido.**
O resolvedor de segredos, a validação de cadeia/validade/CNPJ e a assinatura
ainda precisam ser implementados; `certificateVerified` permanece `false`.

`NFE_PRODUCTION_ENABLED=false` é a única configuração aceita na inicialização.
Qualquer outro valor impede a inicialização da API. Os tipos HTTP e restrições
do banco também recusam produção. Alterar uma variável não libera transmissão.

## Validações do rascunho e limites

O contrato aceita uma saída doméstica modelo 55 com destinatário, natureza da
operação, referência à instrução fiscal e de 1 a 990 itens. Cada item informa
código, descrição, unidade, NCM, CFOP, quantidade, preço, total bruto, origem,
CST ou CSOSN, CST de PIS e CST de COFINS. Não usa catálogo de produto ou preço
atual para alterar silenciosamente o documento.

Quantidades têm quatro casas decimais, preços dez e totais duas, todos em
strings com ponto. A multiplicação usa inteiros de 128 bits e arredondamento
de meio centavo para cima por item. A soma deve corresponder a `productsTotal`.
Zero, sinais, notação científica, valores fora dos limites e números JSON no
lugar das strings são recusados. O limite de tamanho do corpo pode ser atingido
antes de 990 itens, dependendo dos textos enviados.

Há validação de CPF/CNPJ por dígito, formato de NCM/CFOP, prefixo 5/6 conforme
UF, lista local de códigos e distinção entre CST e CSOSN por CRT. **Isso não
confirma existência/vigência de NCM ou CFOP, enquadramento tributário, alíquotas,
IBS/CBS/IS, situação cadastral ou conformidade com XSD.** Mesmo um rascunho
aceito retorna `fiscalValidationComplete: false`.

Descontos, frete, seguro, tributos calculados, pagamentos, operações de entrada,
exportação, devolução, importação e transporte não fazem parte deste contrato
de preparação. Não há campo de total final da NF-e: `productsTotal` representa
somente o bruto dos produtos. Nenhuma alíquota é inferida.

## O que impede a autorização

`readiness` lista explicitamente os componentes ausentes:

1. Resolução segura e verificação do A1 por emitente.
2. Validação de regras fiscais e pacote XSD vigente.
3. Construção XML e assinatura XMLDSig.
4. Transporte SEFAZ e recuperação por chave/recibo.
5. Persistência documental no R2 e DANFE.

Também informa configuração ausente ou incoerência com o cadastro atual da
empresa. A rota `issue` devolve `nfe_emission_unavailable` com HTTP 503; não
consome a chave de comando, reserva número, gera XML, transmite ou altera o
rascunho. O bloqueio é permanente nesta versão e independe dos dados enviados.

O próximo incremento precisa implementar numeração concorrente por emitente,
ambiente, modelo e série, preservar o XML assinado antes do envio e recuperar
resultados ambíguos por consulta. Timeout não pode autorizar nova numeração ou
retransmissão cega. Autorização só poderá ser persistida após conferir chave,
ambiente, status e protocolo retornados pelo autorizador. Cancelamento exige
seu evento próprio e persistência, sem apagar o XML autorizado.

Antes de transmissão real, faltam o emitente e UF escolhidos, o A1 provisionado
para o ERP-Next, o conjunto de regras aprovado para a operação e credenciais
do armazenamento. Esses insumos não substituem os componentes ainda ausentes.

## Fontes e verificação

Referências oficiais consultadas em 27/10/2026:

- [Portal Nacional: schemas XML](https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?AspxAutoDetectCookieSupport=1&tipoConteudo=BMPFMBoln3w%3D).
- [Portal Nacional: notas técnicas](https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?AspxAutoDetectCookieSupport=1&tipoConteudo=04BIflQt1aY%3D).
- [SEFAZ/SP: URLs de homologação e produção](https://portal.fazenda.sp.gov.br/servicos/nfe/Paginas/URL-WEBSERVICES.aspx).

A listagem de schemas foi localizada na busca, mas a leitura direta do Portal
Nacional entrou em redirecionamento circular. Nenhum pacote foi baixado,
fixado por hash ou validado nesta entrega. A página da SEFAZ/SP foi lida e
identifica separadamente autorização, retorno e consulta em homologação;
isso não define SP como UF do emitente nem comprova disponibilidade via mTLS.

Os testes HTTP estão em `apps/api/src/http/fiscal_tests.rs` e usam PostgreSQL
real isolado com Auth sintético, sem certificados nem chamadas SEFAZ. Cobrem
concorrência, replay, revisão, RLS, autorização, rollback da outbox e recusa de
transmissão. Os testes de modelo cobrem valores e payloads inválidos.
Não representam homologação fiscal nem login com o Auth de produção.

Resultado local desta entrega:

- `cargo test --workspace`: 33 testes aprovados, zero falhas e zero ignorados.
  Dez testes foram acrescentados: seis de integração fiscal, três de modelo
  e um da proteção de inicialização contra produção.
- `cargo fmt --all --check`: aprovado.
- `cargo clippy --workspace --all-targets -- -D warnings`: aprovado.
- PostgreSQL 18.4 temporário em loopback, sem acesso ao banco do ERP em produção.
  A instância criada para esta verificação foi encerrada após os testes.
- Sem alteração da web, implantação, envio SEFAZ, certificado real ou protocolo.

Para repetir os testes, aponte `DATABASE_URL` para uma instância PostgreSQL de
teste com usuário autorizado a criar bases e papéis. Os testes `sqlx::test`
criam bases isoladas; não use credenciais de produção. O CI existente executa
os mesmos comandos Rust com seu serviço PostgreSQL 18.
