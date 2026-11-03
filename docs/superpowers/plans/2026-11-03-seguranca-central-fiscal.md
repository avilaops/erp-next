# Segurança e Central Fiscal — plano de execução

## Objetivo e base

Iniciar AVL-71, AVL-80, AVL-81, AVL-85, AVL-87 e AVL-89 no ERP-Next.
Base inicial: `396826c`; continuidade sincronizada com `997b59c` da main.
API Rust/Axum/SQLx, PostgreSQL com RLS, web Next.js
e motor fiscal privado existentes. Referências `src/lib/db/` nas issues
pertencem ao legado; a matriz AVL-69 identifica os serviços atuais.

## Decisões do primeiro incremento

Separar permissões no autorizador existente, preservando bloqueio por empresa,
revisões, idempotência, auditoria e reconciliação de resultado incerto.
Adicionar permissões ao catálogo sem concedê-las a papéis existentes.
Não reutilizar emissão como autorização para cancelar, corrigir ou inutilizar.
Manter consulta local separada de consulta que reconcilia estado na SEFAZ.

Uma separação apenas visual deixaria os endpoints acessíveis. Uma nova camada
de autenticação duplicaria a autoridade existente. A alteração escolhida usa
`authorized` na API e reflete os mesmos códigos nos controles da interface.

## Contrato de autorização

| Operação | Leitura necessária | Permissão de comando |
| --- | --- | --- |
| Consultar documentos, XML e eventos locais | `fiscal.nfe.read` | Nenhuma |
| Emitir ou reconciliar emissão na SEFAZ | `fiscal.nfe.read` | `fiscal.nfe.issue` |
| Cancelar NF-e, inclusive por cancelamento comercial | `fiscal.nfe.read` | `fiscal.nfe.cancel` |
| Enviar CC-e | `fiscal.nfe.read` | `fiscal.nfe.correction` |
| Inutilizar numeração | `fiscal.nfe.read` | `fiscal.nfe.void` |
| Consultar metadados do A1 | `fiscal.config.read` | Nenhuma |
| Conectar, substituir e remover A1 | `fiscal.config.read` | `fiscal.certificate.manage` |

Papéis atuais continuam com os códigos anteriores. Após aplicação da migration,
um administrador deve conceder explicitamente os novos comandos conforme a
responsabilidade de cada papel. Não há concessão implícita por emissão ou
configuração. A validação A1 conserva a segunda autorização após a etapa
criptográfica, antes de gravar.

## Tarefas e verificações

- [x] Conferir seis issues, dependências AVL-69/75 e código atual.
- [x] Isolar checkout e preservar alterações preexistentes da main.
- [x] Reproduzir acesso indevido com testes HTTP de permissões.
- [x] Separar comandos fiscais e gestão A1; migration aditiva sem grants.
- [x] Refletir cancelamento e CC-e na interface, inclusive quando não há emissão.
- [x] Adicionar regressões de concessão exclusiva, revogação e ausência de efeitos.
- [ ] Validar Rust, lint, tipos e navegador; registrar resultados reais.
- [ ] Entregar incremento revisável e atualizar o Linear sem encerrar aceites.

## Continuação da frente

| Ticket | Próximo pacote verificável | Dependência / limite atual |
| --- | --- | --- |
| AVL-71 | Isolamento negativo de documentos, anexos e execução; rotação/restauração A1 | Este incremento cobre permissões; retenção e restauração integral continuam abertas |
| AVL-80 | Central paginada de emitidas, recebidas e pendências reais | Usar contratos de leitura, sem emissão ou manifestação implícita; cinco tamanhos e estados de erro/vazio |
| AVL-81 | Contratos OpenAPI de documentos, processamento e downloads | Não atribuir a fila do legado à API atual; preservar rotas de pedidos e respostas 202 incertas |
| AVL-85 | Catálogo versionado e entrega persistente após commit | Outbox existente não comprova assinatura, retentativa ou entrega de webhook fiscal |
| AVL-87 | Adaptar envio fiscal existente, anexos validados e deduplicação | SMTP fiscal do legado não está integrado ao Next; envio externo depende de destinatário de teste autorizado |
| AVL-89 | Diagnóstico correlacionado e recuperação restrita | Depende de jobs/eventos reais; testar recuperação sem retransmitir documento incerto |

## Riscos de revisão

- Permissão de leitura sem comando deve manter GET/XML disponíveis e negar POST.
- Emissor sem permissões específicas deve receber 403 antes de efeitos fiscais.
- Cancelador e corretor não precisam receber permissão de emissão.
- Repetição idempotente após revogação exige nova autorização.
- Troca de empresa ou revogação durante validação A1 não pode gravar o cofre.

## Limites de aceite

Reprodução RED confirmada no commit `bf2020e`,
[CI 41617338114](https://github.com/avilaops/erp-next/actions/runs/41617338114):
218 testes Rust aprovados, três falhas esperadas e um ignorado. Falharam o
`canEdit` do certificado, CC-e sem permissão de emissão e cancelamento com
permissão apenas de emissão. A correção acrescenta a migration
`202611030002_fiscal_permissions.sql`; as verificações GREEN são registradas
no [PR #67](https://github.com/avilaops/erp-next/pull/67) por SHA.

Iniciar a frente não conclui os seis tickets. Nenhuma operação fiscal externa,
envio de e-mail, mudança de papéis reais ou migration de produção integra este
primeiro incremento. Implementação, validação, PR, publicação e aceite externo
devem permanecer registrados separadamente.
