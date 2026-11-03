# AVL-111 — conferência individual de CT-e recebido

## Objetivo

Completar o caminho de conferência dos CT-e já preservados pela distribuição:
interpretar o documento, registrar resultado isolado e mostrar transportadora,
tomador, frete e documentos transportados antes de qualquer vínculo comercial.
A meta dos seis tickets continua integral; esta etapa não prova homologação.

O XML armazenado é imutável. A conferência é uma operação offline, independente
do cursor, que nunca consulta SEFAZ, transmite evento ou move estoque/financeiro.
Documento inválido ou de formato não coberto continua disponível na central.

## Fontes e alcance

- [Catálogo oficial de schemas](https://www.cte.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=0xlG1bdBass%3D).
- [MOC 4.00, Anexo I](https://www.cte.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=6aFNuknaWsc%3D).
- [Pacote NT 2026.004 v1.00 republicado em 16/10/2026](https://www.cte.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=zeylq8Ib5E0%3D),
  ZIP SHA-256 `c8f8915adfe7730da43b0ec57d6a1a26130ef25e23c847f334af3bc5ad969a66`.
- [Aviso de 16/10/2026](https://www.cte.fazenda.gov.br/portal/informe.aspx?informe=181)
  informa homologação até 26/10. O [aviso de 27/10](https://www.cte.fazenda.gov.br/portal/informe.aspx?informe=183)
  adia produção para 14/12. Publicação de schema não comprova disponibilidade.

Primeiro perfil: `procCTe_v4.00.xsd`, CT-e modelo 57 convencional, no ambiente
de homologação já suportado pela captura, tipos normal, complementar e
substituição. Validar também o XSD específico do
modal: o schema principal usa `processContents="skip"` para esse bloco.
Outros envelopes/versões, eventos e CT-e simplificado continuam preservados
sem serem promovidos a documentos conferidos por esse perfil.

## Contrato e invariantes

- Entrada privada: XML original, CNPJ congelado da coleta e ambiente explícito.
  Limite de 2 MiB, XML 1.0/UTF-8, sem DTD/entidades e sem caminho/URL de schema
  fornecido pelo chamador. Arquivos locais fixos com SHA-256 e closure completa.
- Conferir chave/DV/modelo e campos, ambiente, protocolo e digest correlatos.
  Consistência XMLDSig com o certificado embutido não equivale a confiança
  ICP-Brasil, situação fiscal atual ou autenticidade independente do protocolo.
- Separar emitente/transportadora, remetente, expedidor, recebedor,
  destinatário, tomador e autorizados XML. `toma3` referencia o participante
  indicado; `toma4` usa sua própria identidade. Não inferir tomador pelo CNPJ
  do chamador nem pelo primeiro participante coincidente.
- Valores exatos em centavos como strings. Chaves NF-e transportadas são
  referências do XML, nunca vínculos comerciais automáticos.
- A API autoriza antes e depois da inspeção, valida a correlação com o XML
  original e persiste conferência/auditoria/outbox atomicamente. Nenhum
  resultado de inspeção pode alterar o cursor ou o documento original.
- A central exibe os fatos e limites verificados e mantém empresa fixada
  durante leituras e ações. Vínculos dependem de conferência explícita e
  referências existentes no mesmo tenant; sem geração de compra/venda.

## Etapas

- [x] Escrever testes de XML sintético assinado, XSD/modal, papéis, protocolo,
  adulteração e falhas, observando a falha antes do código.
- [x] Versionar schemas oficiais e implementar inspeção privada offline.
- [x] Integrar API com persistência de resultados, isolamento e auditoria.
- [ ] Integrar central e conferência/vínculos comerciais explícitos.
- [ ] Validar testes Node, Rust somente em GitHub Actions e UI em cinco tamanhos.
- [ ] Revisão independente, PR draft, CI e evidência em AVL-111.
- [ ] Homologação externa por empresa/papel antes de habilitação operacional.

Nenhuma compilação, formatação, análise ou execução Rust local. Não abrir
certificados reais, escolher alvos fiscais ou contratar fornecedor nesta etapa.

## Primeiro checkpoint

Motor privado implementado com 15 casos novos aprovados e suíte Node completa
de 87 testes aprovada. A fixture HTTP compartilhada com Rust foi conferida
usando a inspeção real e o hash exato do arquivo, incluindo LF final.
Os 11 schemas locais coincidem byte a byte com o ZIP oficial após a normalização
declarada (UTF-8 sem BOM, LF e um LF final).

A revisão independente encontrou omissões nas referências de substituição,
documentos anteriores, serviço multimodal e contêineres aquaviários. Os casos
reproduziram a falha antes da correção. A extração agora percorre somente o
`infCte` assinado após validar o modal e deduplica referências, sem alterar o
XML. Regressões incluem DVs inválidos em documentos reassinados. Os achados
foram encerrados por releitura da correção; a suíte completa acima passou.

O teste HTTP Rust da rota de conferência foi escrito antes da implementação
pública. O CI `41663360290`, job Rust `126013102778`, confirmou a falha esperada:
HTTP 404 em vez de 403. Os 235 testes anteriores da API passaram. Essa execução
não comprova a integração ainda em implementação e não foi executada localmente.

## Integração da API

Rotas GET `documents/{id}/inspection` e POST `documents/{id}/inspect` sob
`/api/v1/fiscal/cte-distribution`. O POST recebe apenas `{}` e exige leitura,
permissão nova `fiscal.cte.inspect` e Idempotency-Key. A permissão não entra no
bootstrap/onboarding automático. O XML é lido do documento preservado, nunca do
payload do navegador. Consulta ou falha de conferência não altera cursor.

`fiscal_cte_inspections` é append-only, com RLS forçada e referência ao documento
do mesmo tenant. Metadados tipados são correlacionados novamente com XML/hash,
papéis, valores, referências e protocolo na API, sem fingir verificação de
confiança ou situação atual. A transação libera o lock antes da chamada ao motor;
no retorno, tenant/permissões/CNPJ/arquivo são revalidados. Resultado, comando,
auditoria e outbox são atômicos. Replay e perfil já conferido não reinspecionam.

Os testes HTTP acrescentados cobrem permissões separadas, chave obrigatória,
tenant/imutabilidade, replay e conflito de comando, metadados forjados, revogação,
troca de CNPJ durante I/O, falha do motor e do outbox e concorrência. Compilação,
formatação, Clippy e execução ainda dependem do novo GitHub Actions.

No commit `946567a`, o job Rust `126024529701` compilou e executou os testes:
242 aprovados, um Ollama ignorado e uma falha na expectativa histórica de
contagem OpenAPI (153 caminhos atuais versus 151 esperados). Os novos casos
HTTP de inspeção passaram. A expectativa foi atualizada para 153, com as duas
operações explicitadas; os contratos do catálogo agora têm 207 operações.
Os 17 testes locais de contratos/contexto passaram e a arquitetura permaneceu
com 335 rotas web, sem erros. A formatação foi aplicada a partir do artefato
`13244813469`, produzido por rustfmt no GitHub Actions; nenhum Rust local.

No commit `4b166a5`, o job Rust `126032286463` aprovou 243 testes da API,
com um Ollama ignorado, e mais sete testes auxiliares. A etapa rustfmt apontou
somente a quebra de linhas da lista de status OpenAPI; a alteração exata do
log remoto foi aplicada sem executar Rust localmente. Clippy aguarda nova execução.

Dois casos escritos antes da UI falharam no job de navegador `126033954998`:
GET do BFF retornou 404 e o botão de conferência não existia. Os dez casos
anteriores do monitor passaram. A central agora lê e registra a conferência,
mostra transportadora/tomador/valores/referências e os limites de confiança.
Os novos casos também cobrem resposta divergente, leitura sem capacidade de
inspecionar, retry com a mesma chave, troca de empresa durante GET/POST e
cinco tamanhos de tela. A validação de navegador ainda depende do Actions.

Os cinco testes locais de modelos web (três novos de CT-e) e os 17 testes
de contratos/contexto passaram. Foram mapeados os dois BFFs para `/fiscal/ctes`;
a arquitetura tem 337 rotas e nenhum erro. Vínculos comerciais explícitos
e homologação externa permanecem pendentes no escopo integral.
