# Integração fiscal ERP-Next → Lojas: entrega vertical

Data: 2026-10-28. Referências: AVL-360, AVL-359, AVL-254.
Estado: recorte escolhido pelo usuário; desenho proposto para aprovação.
Não constitui evidência de implementação, testes, homologação ou autorização de deploy.

## Intenção e decisão

O ERP-Next será a fonte canônica de NF-e recebida; Lojas consulta e baixa os
documentos por credencial de leitura vinculada à empresa. O usuário escolheu
explicitamente importação de XML no primeiro incremento; distribuição SEFAZ fica
para depois. O ERP legado não será reativado nem usado como armazenamento.

Alternativas consideradas:
1. Entrega vertical (escolhida): credencial, importação idempotente, armazenamento,
   consulta, XML e DANFE. Entrega documentos importados; não descobre notas.
2. Distribuição integral: acrescenta certificado A1, NSU, distribuição e
   manifestação. Adiada por aumentar o escopo e exigir regras operacionais próprias.
3. Adaptador para armazenamento do Lojas: descartado por inverter a fonte canônica.

## Evidências do código e consequências

- main consultada: 1569e8f9e08300e2d22a36da80f6efc5b563a8d0.
- apps/api/src/http/mod.rs usa middleware OIDC nas rotas protegidas.
  As novas rotas de serviço terão middleware separado, sem ampliar acesso às
  rotas existentes nem aceitar credencial de serviço como identidade humana.
- apps/api/src/domains/fiscal/danfe.rs já inspeciona nfeProc 4.00, namespace,
  chave, protocolo e vínculo empresarial. Sua inspeção estrutural não comprova
  assinatura, XSD ou situação atual na SEFAZ.
- docs/DANFE-XML-AUTORIZADO.md documenta validação MCP de XSD, assinatura e
  renderização, com até 50 segundos mais encerramento.
- Lojas src/lib/erp-fiscal.ts, blob e1d79ec0a5b1d9b09dd74c92291d6a010d56712b:
  só envia Bearer, espera IDs numéricos, {notas, pendencias}, e downloads em
  até 15 segundos; listagem em até 10 segundos. Não percorre cursor.
- Consequência: gerar e persistir PDF durante a importação; downloads não
  chamam MCP. Não truncar silenciosamente listagem nem devolver apenas página
  inicial ao consumidor atual.
- PR #3 (preparação de produção) e PR #4 (P0) estão abertos na consulta.
  Não assumir seus arquivos integrados à main.

## Limites

Inclui gestão de credenciais por administrador OIDC, importação humana autorizada,
persistência documental, consulta e downloads. Não inclui distribuição SEFAZ,
manifestação, migração do legado, cadastro automático de fornecedor/produto,
entrada em estoque, compras, custo ou efeitos financeiros.
NFE_PRODUCTION_ENABLED permanece false. Leitura de XML autorizado de produção
não habilita emissão. Não alegar consulta fiscal online, cancelamento atualizado,
cadeia ICP-Brasil sem bundle ou validade fiscal a partir de mocks.

## Atores e autenticação

Usuário OIDC: associação ativa ao tenant e permissões explícitas verificadas no
banco; usar os padrões existentes de sessão, autorização e transação RLS.
Propostas de permissões novas: integrations.credentials.manage e
fiscal.nfe.import; fiscal.nfe.read existente para consultas humanas.
Nenhum papel recebe permissão nova implicitamente.

Serviço Lojas: token opaco com prefixo próprio e 32 bytes aleatórios de segredo.
Mostrar uma vez; guardar apenas SHA-256 do segredo, identificador público,
tenant fixo, escopos, criador, criação, expiração e revogação.
Escopos fixos desta integração: notas:read, xml:read, danfe:read.
Não guardar segredo em auditoria, logs, catálogo de idempotência ou respostas
de listagem. Não usar credenciais pessoais dos conectores como token runtime.

Resolver token por identificador público e verificar hash com comparação
constante antes de qualquer acesso documental. Credencial não permite escolher
tenant. Header X-Tenant-Id opcional só é aceito se coincidir; divergência é 403.
CNPJ da configuração do Lojas não substitui autorização no ERP.
Consulta de credencial não pode exigir papel superuser/BYPASSRLS nem acesso
irrestrito a tabelas: contrato de resolução mínimo retorna apenas identidade e
escopos necessários. Modelo físico e mecanismo exato dependem da liberação P0.

Revalidar revogação, expiração e vínculo empresarial em cada leitura. Falha de
banco é 503, nunca autenticação liberada. Token ausente/inválido/expirado/revogado
é 401; escopo insuficiente é 403. IDs de outro tenant respondem 404.

## Contratos propostos por ação

Todas as respostas de erro usam application/problem+json sem XML ou segredo.
400: formato/parâmetro/header inválido; 401: identidade ausente/inválida;
403: associação/permissão/escopo insuficiente; 503: dependência indisponível.
Método não suportado: 405. Erros não produzem efeitos de negócio.

### Criar credencial

POST /api/v1/integrations/credentials; OIDC + X-Tenant-Id +
integrations.credentials.manage + Idempotency-Key.
Entrada: {name, expiresAt}; expiração futura obrigatória, até 90 dias.
Saída 201: {id, name, scopes, expiresAt, token}; token só nesta resposta.
Transição: ausente → ativa. Auditoria na mesma transação; nunca inclui token/hash.
Repetição da chave com mesmo corpo não gera nova credencial e responde
409 secret_not_replayable com id e recuperação (revogar e emitir outra).
Corpo diferente com mesma chave: 409 idempotency_conflict.
Chave ausente: 428. Nome vazio ou expiração inválida: 422.
Escopos e tenant não são parâmetros livres do corpo.

### Listar e revogar credenciais

GET /api/v1/integrations/credentials; OIDC, tenant e permissão de gestão.
200: metadados, sem segredo nem hash. Sem alteração de estado.
DELETE /api/v1/integrations/credentials/{id}; mesmos controles.
204: ativa → revogada; repetir no mesmo tenant retorna 204.
ID ausente ou de outro tenant: 404. Revogação auditada e não exclui histórico.
Rotação: criar substituta, atualizar segredo do consumidor e revogar anterior,
apenas em operação autorizada; esta entrega não configura produção.

### Importar documento

POST /api/v1/fiscal/notas-recebidas/importacoes; OIDC + X-Tenant-Id +
fiscal.nfe.import + Idempotency-Key; JSON {xml}.
UTF-8 original até 900 KiB, corpo JSON até 1 MiB.
428 sem chave; 413 acima do limite; 422 XML/metadados inválidos ou recusa fiscal.
Apenas nfeProc 4.00 modelo 55 com protocolo 100/150 e assinatura;
resumos/eventos não são notas completas. Destinatário CNPJ deve coincidir
exatamente com o CNPJ atual do tenant; ser apenas emitente não basta.
Reusar inspeção existente, acrescentando regra específica de recebida.
Reusar cliente MCP: validar XSD → assinatura → gerar DANFE.
Falha MCP: 502/503; nenhuma nota parcial visível e nenhuma escrita fiscal.
A interface informa andamento e permite nova tentativa após falha; timeout de
importação acomoda o limite do cliente fiscal, sem alterar prazo dos downloads.

Antes de persistir, revalidar acesso/CNPJ e gravar XML original em bytes,
metadados derivados e PDF em uma transação com auditoria e recibo idempotente.
Não manter transação aberta durante chamada MCP.
201 para primeira gravação; 200 para repetição idêntica, com o mesmo ID.
Unicidade lógica: tenant + ambiente + chave; comparação do SHA-256 dos bytes.
Mesmo documento com bytes diferentes ou chave idempotente reutilizada com
outro conteúdo: 409; preservar original, sem sobrescrever ou mesclar.
Concorrência pode repetir validação externa, mas produz só um documento e
um evento de criação. Interrupção antes do commit não deixa documento visível;
após commit, retry recupera o recibo. Falhas transitórias não consomem chave
como sucesso. Serviço Lojas não pode importar.

### Consultar notas

GET /api/v1/notas-recebidas; credencial de serviço e notas:read.
200: {notas: Nota[], pendencias: []}; vazio é sucesso.
Nota: id inteiro positivo seguro em JavaScript, chave string de 44 dígitos,
numero/serie inteiros, emitida_em ISO 8601 com offset, valor numérico finito,
fornecedor {documento, nome, vinculado:false, id:null}, itens inteiro,
compra_id:null. Não fabricar vínculo com cadastro ou compra.
Precisão monetária interna decimal; número JSON é projeção exigida pelo Lojas,
não base de cálculos contábeis. ID não é UUID nem bigint acima de 2^53−1.
Ordenação determinística por ID. Sem alteração de estado.
Limite inicial proposto: 1000 notas por resposta. Buscar limite+1; acima disso
responder 409 pagination_required, nunca 200 incompleto.
Paginação e alteração correspondente do consumidor serão necessárias antes
de habilitar empresas acima desse limite. Não alegar lista vazia de pendências
como prova de ausência de documentos na SEFAZ; esta fase não faz distribuição.
Ambiente da nota fica disponível como campo adicional e nos headers de download.

### Baixar XML e DANFE

GET /api/v1/notas-recebidas/{id}/xml; xml:read.
GET /api/v1/notas-recebidas/{id}/danfe; danfe:read.
200 entrega bytes persistidos, sem regeneração nem consulta a SEFAZ.
ID inválido: 400; ausente/outro tenant: 404; inconsistência de artefato: 503,
sem entregar arquivo parcial ou recriado a partir de metadados.
XML: application/xml; PDF: application/pdf.
Content-Disposition com nome derivado da chave validada, Cache-Control:no-store,
X-Content-Type-Options:nosniff, hashes XML/PDF e ambiente.
Preservar indicação X-NFe-Authorization-Check:xml-protocol-only.
GET não cria registros de compras/estoque/financeiro. Auditoria técnica de acesso
pode registrar ator/documento/request-id, nunca conteúdo ou segredo.

### Saúde e UI/BFF

GET /api/health será alias de readiness, sem expor configuração:
200 com banco disponível, 503 caso contrário. Preservar /health/live e
/health/ready; saúde não comprova autenticação ou disponibilidade do MCP.

Parâmetros → Integrações: lista, criação com revelação única e revogação,
via BFF OIDC; ações mutáveis exigem mesma origem e tenant da sessão.
Fiscal → Recebidas: importação explícita, status de validação, resultado/erro,
lista e downloads via BFF humano com fiscal.nfe.read.
BFF humano não recebe nem guarda token de serviço do Lojas; handlers humanos
usam serviços de domínio comuns com autorização OIDC. Rotas BFF concretas serão
registradas no catálogo antes da implementação. Estado de formulário muda
apenas por resposta; trocar tenant cancela a requisição e limpa documentos.

## Persistência e preservação (contrato lógico, sem DDL)

Domínio fiscal é dono do agregado documental imutável e artefatos validados.
Plataforma é dona de credenciais. Tenant em cada agregado, unicidade por tenant,
RLS forçada e transações com contexto local, sem vazamento pelo pool.
Documentos não são localizados apenas por ID global.
CNPJ atual é conferido na importação e leitura; alteração cadastral não torna
documento antigo acessível ao CNPJ novo sem processo explícito.
Não atualizar tabelas ou dados existentes para simular recebimento.
Modelo físico, migrations e concessões SQL só após P0 integralmente liberada;
não criar migration de teste para contornar esse bloqueio.

## Aceite e evidência exigida

Cada cenário deve ligar método/rota, ator, precondição, transição, efeito,
recibo/revisão, erro e recuperação no catálogo P0. Definição não é teste aprovado.

GitHub CI exclusivamente, reutilizando pipeline existente e respeitando o teto
vigente de 90 segundos; não ampliar jobs/timeout sem decisão. Se build/testes
não couberem, registrar execução incompleta e o impedimento, sem dispensar checks.
Não rodar testes, builds ou banco no servidor de produção nem localmente.

Casos mínimos:
- ausente/inválido/revogado/expirado → 401; escopo insuficiente → 403;
- credencial não acessa rotas OIDC, não importa e não muda tenant via header;
- dois tenants com pool compartilhado e papel NOSUPERUSER NOBYPASSRLS;
- destinatário incorreto, XML emitido pela empresa para terceiro, resNFe,
  DTD/XXE, assinatura/XSD recusados, limites e indisponibilidade MCP;
- retry, concorrência, corpo conflitante, falha antes/depois do commit;
- comparação byte a byte XML/PDF e SHA-256; download não chama gerador;
- contrato real de parser do Lojas, números seguros, vazio e excesso de coleção;
- revogação/CNPJ alterados durante operação; ausência de segredo nas respostas;
- UI/BFF real, origem, troca de tenant e tela móvel;
- health alias readiness e regressões de autenticação/DANFE existentes.

Mocks MCP demonstram transporte/controle, não assinatura fiscal real.
Homologação MCP e fumaça pública ficam separadas da CI sintética.
Registrar SHA, URL das execuções, duração, resultados e limitações no Linear.
Nada de dados de cliente, chaves ou XML reais nos artefatos de CI.

## Ordem e portões

1. Registrar escolha do recorte (feita pelo usuário) e aprovar este desenho.
2. Plano e fichas contratuais com estados/erros/recuperação.
3. Implementação reversível onde a P0 permitir, sem derivar migrations antes
   da liberação integral; se persistência impedir entrega funcional, manter
   bloqueio explícito e não declarar a integração pronta.
4. Após liberação P0: DDL aditivo revisado, testes de preservação/isolamento e
   CI/builds. Nunca copiar automaticamente dados do ERP legado.
5. PR revisável; sem merge/deploy/migration ou provisionamento em produção
   até autorização operacional específica.
6. Após operação autorizada: provisionar credencial no tenant correto e
   segredos do Lojas, validar 401/lista/XML/PDF reais, registrar evidências na
   AVL-360 e AVL-254. Não encerrar incidente com base apenas em testes.
