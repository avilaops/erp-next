# Monitor fiscal — implantação e transferência do A1

## Evidências de 31/10/2026

- Release publicada: `619bb4429ec93e71c39a08013b6083337ecb0abb`.
- [Production release aprovada](https://github.com/avilaops/erp-next/actions/runs/41251508959).
- [Migration schema_only aprovada](https://github.com/avilaops/erp-next/actions/runs/41251913112).
- Migration `202610310006_fiscal_monitor.sql` e privilégios de armazenamento aplicados.
- API e painel saudáveis; `/api/health` publica a revisão esperada.
- Navegador isolado: `/entrar` respondeu 200 em 1280 e 375 pixels, sem falhas
  de assets ou rolagem horizontal. Acesso anônimo ao monitor redirecionou para
  `/entrar`; a API recusou a consulta sem autenticação com 401.
- Backup anterior à alteração: arquivo custom PostgreSQL, 40.745.135 bytes,
  SHA-256 `bd38a4187ebdd0d0389e6ee52754a13cc7b9d5ed9411fdba0bcdd9baf0adff9f`.
  Restauração integral validada em banco temporário: 169 tabelas e uma empresa.
- Configuração privada copiada da release efetivamente usada pelo contêiner.
  O arquivo compartilhado antigo não era a fonte atual. A chave existente do
  cofre foi preservada, sem gerar substituta nem registrar seu valor.
- A1 da Ludus validado e transferido para o cofre novo, revisão 1, com
  auditoria e outbox atômicas. O registro legado foi preservado.
- Papel `administrator` provisionado com os três códigos do monitor, revisão 2,
  com auditoria/outbox. O ensaio confirmou rollback em falha de outbox,
  recusa de operador sem direito, replay sem efeitos e outros papéis intactos.
- Legado original: contêiner e serviços parados; cursor zerado,
  `last_queried_at` nulo e nenhum documento distribuído. Nenhuma consulta real
  foi feita durante a implantação.

`SEFAZ_MONITOR_ENABLED=false` e `NFE_PRODUCTION_ENABLED=false` permanecem ativos
na configuração publicada. Antes de coletar, é necessário confirmar se outros
sistemas consultam o mesmo CNPJ. A parada do ERP antigo não prova a ausência
de coletores externos.

## Preparação do A1 legado

`prepare_legacy_a1` é um binário de operação, separado do servidor HTTP. Ele
inclui o mesmo módulo `certificate_crypto.rs` usado pela API. Não faz rede,
não conecta a banco e não grava arquivos.

```sh
cargo test -p erp-next-api --bin prepare_legacy_a1 --locked
cargo build -p erp-next-api --bin prepare_legacy_a1 --locked
```

O `cargo run` padrão continua iniciando `erp-next-api`. O empacotamento de testes
do CI aceita os dois alvos binários e executa os testes do preparador.

O operador deve executar o preparador no servidor que guarda o material
legado, conferindo antes o hash do executável e suas permissões. Ele recebe
`ERP_CERT_KEY` e `FISCAL_A1_KEYRING` somente no ambiente privado do processo.
Não enviar essas variáveis ao navegador, MCP ou chat.

A entrada JSON por stdin contém `tenantId`, `taxId`, próxima `revision`,
`fingerprint` original e os campos `ciphertext`, `iv`, `authTag` em base64.
Esses campos vêm da linha cifrada de `fiscal_certificates`, sem exportar o PFX
ou sua senha em texto aberto. O formato legado é AES-256-GCM sem AAD, IV de
12 bytes e tag de 16 bytes; o conteúdo autenticado contém `pfx` e `password`.

Após autenticar o envelope legado, o preparador valida CNPJ, validade, política
A1, correspondência da chave privada e cadeia ICP-Brasil. Confere o fingerprint,
cifra usando empresa/revisão/metadados como AAD e reabre o resultado para
comparar o conteúdo. O stdout contém somente metadados e o novo envelope
cifrado. Guardar essa saída com permissão `0600`; ela ainda é confidencial.

O material em texto aberto é mantido em memória com zeroização no descarte.
Erros de desserialização do payload autenticado não incluem seu conteúdo.

## Persistência controlada

`deploy/adopt-legacy-a1.sql` espera uma tabela temporária de sessão
`a1_adoption_input(payload jsonb)` com exatamente uma linha contendo:

- `prepared`: JSON emitido pelo preparador;
- `legacySchema`: `tenant_ludus`;
- `legacyCertificateId`: identificador original;
- `actorIdentityId`: identidade do operador responsável, com associação ativa
  e `fiscal.config.manage` na empresa.

Usar `COPY ... WITH (FORMAT csv)` para carregar o JSON pela entrada padrão do
psql; não interpolar metadados em comandos SQL. Executar com
`ON_ERROR_STOP=1`, por conexão administrativa local autorizada.

O script bloqueia a empresa, revalida operador, proveniência, CNPJ, validade e
revisão. Recusa sobrescrever um A1 conectado. Certificado, auditoria e outbox
pertencem à mesma transação. A auditoria identifica explicitamente a adoção do
legado; não simula upload pela interface.

O ensaio em banco restaurado comprovou recusa de operador sem direito,
rollback integral quando a outbox falha, commit conjunto e recusa de replay.
Somente depois desse ensaio a adoção foi aplicada à produção.

## Permissões do monitor

`deploy/grant-fiscal-monitor-administrator.sql` provisiona explicitamente os
três códigos do monitor no papel `administrator` já existente da empresa.
Recebe as variáveis psql `tenant_id` e `actor_id`; confere a associação do
operador, `platform.roles.manage`, autoridade fiscal do papel e instalação das
permissões. Não cria membros nem altera outros papéis.

Quando há concessão nova, incrementa a revisão do papel e grava auditoria/outbox
na mesma transação. Repetições sem mudança não geram nova revisão ou evento.
Esse provisionamento de operação é separado da migration de schema.

## Aceite restante

- [ ] Confirmar outros consumidores da distribuição para o CNPJ.
- [x] Publicar as permissões do monitor para o administrador responsável.
- [ ] Habilitar a coleta somente após a confirmação do consumidor único.
- [ ] Validar primeira coleta real, cursor, pausas e persistência do lote.
- [ ] Conferir documentos disponíveis, downloads, hashes, recebidas e pendências Lojas.
- [ ] Validar o painel autenticado em produção.
- [ ] Executar somente uma manifestação real explicitamente indicada pelo responsável
  e conferir resultado/protocolo. Não gerar evento fictício para teste.
- [ ] Registrar as evidências finais de operação e manter o roteiro de reconciliação
  de resultados desconhecidos disponível ao responsável.
