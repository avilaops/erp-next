# Plano — documento comercial e SMTP

Spec: docs/superpowers/specs/2026-11-12-order-documents-platform-mail.md. Base76b2c4f. Executar continuamente com tarefas independentes e revisão.

## Task1 — permissões de entregas (root)

- Criar migration202611130001_mail_delivery_privileges.sql e deploy/grant-commercial-email.sql: SELECT/INSERT/UPDATE em sales_order_email_deliveries e sales_proposal_email_deliveries, sem DELETE e sem alterar RLS. Aplicar somente se papel erp_next_app existir.
- Regressão com papel SQL restrito: reproduzir GET500 por falta de SELECT, aplicar grant mínimo e conferir GET200; RLS de outra empresa continua negada, SMTP ausente não grava.
- Verificar e registrar aplicação em produção e prévia do pedido real apenas por GET.

## Task2 — SMTP central (agente backend)

Files: novo platform/mail_settings.rs, platform/mail.rs, migration202611130002_platform_mail_settings.sql, novo http/mail_settings_tests.rs. Pode alterar platform/mod.rs; não editar http/mod.rs/openapi.rs, state.rs, sales/order_email.rs, proposal_email.rs ou contracts/mod.rs (root integra).

Interface proposta: GET/PUT /api/v1/platform/mail-settings, get/put handlers; resolve(&AppState) -> Result<Option<SmtpMailer>,DomainError>. Snapshot {revision,source,canManage,encryptionReady,data:{enabled,name,host,port,security,username,fromName,fromAddress,passwordSet}}. PUT mesmos campos sempasswordSet, password?:string; If-Match obrigatório. source platform/environment/unconfigured; revisão0 quando não persistido. Refinar tipo com root antes de codificar a UI.

- Modelos RED→GREEN para validação e TLS; testes API de admin versus administrador de empresa, segredo cifrado/nunca retornado, senha retida/substituída, contexto alterado exige senha, revisão concorrente e desativação sem fallback.
- Reutilizar administrators::authorized e CertificateVault settings-secret, sem nova chave ou leitura de senha no cliente. Runtime resolve não altera dados nem envia teste.
- Root substitui os três consumidores de state.mail pela mesma resolução central, preservando o SMTP injetado dos testes e a camada de comandos.

## Task3 — PDF canônico (agente backend)

Files: novo domains/sales/order_document.rs e testes próprios, módulo sales.rs, Cargo.toml/Cargo.lock e fontes/licenças em apps/api/assets/fonts. Root faz rota HTTP/OpenAPI e integra download/anexo; não editar order_email.rs nem http/mod.rs/openapi.rs.

Interface: pub async fn get(State,Extension,HeaderMap,Path<Uuid>) -> Result<Response,DomainError>; pub async fn attachment(tx:&mut Transaction<Postgres>,tenant:Uuid,current:&OrderSnapshot) -> Result<MailAttachment,DomainError>. PDF deve ter MIME application/pdf e nome pedido-PV-000004-rN.pdf. Confirmar interface com root antes da integração.

- Usar biblioteca PDF madura sem HTML/browser runtime e fontes Unicode com licença. Dados do snapshot e cadastro do emitente; somente campos comerciais permitidos. Preços registrados sem recomputar regra fiscal. Snapshot de pagamento prevalece sobre cadastro alterado.
- Testes RED→GREEN: PDF parseável/A4/texto, identidade e números corretos, múltiplas páginas com itens longos, Unicode, paginação e limites, nenhuma margem/custo/comissão, peso completo/incompleto e quitação nunca inferida de entrada prevista.
- Renderizar amostra com fixtures e entregar caminho/extração de texto; root inspeciona visualmente antes de aceite.

## Task4 — UI, integração e verificação (root)

- Preferências/sistema/e-mail e link no catálogo; BFF autenticado /platform/mail-settings. Formulário responsivo com segredo write-only, carregar/salvar/revisão/erro, sem localStorage de senha ou envio automático.
- Registrar handlers e schemas, gerar contrato web; trocar state.mail nos pedidos/propostas/contratos pelo resolve central. Anexo de pedido usa PDF, mantendo snapshot_html para trilha histórica do comando.
- Salvar PDF baixa /api/erp/orders/id/document com autenticação, erro/processamento/nome correto; nenhum window.print da tela. E-mail explica anexoPDF. Testes browser de download, permissão, erro e SMTP.
- Modelos, lint, API focada em DB isolado, build local, browser e PDF visual com extração. Revisão independente do ramo e correções agrupadas. Commit/push/PR/CI, migrations/grants seguros, publicação e verificação readonly. Scripts de operação sobscripts/.

## Task5 — levantamento de documentos por módulo (agente)

Pedido adicional explícito: levantar todos os módulos que precisam emitir relatório, gerar PDF e oferecer e-mail. Inventariar catálogo/navegação e implementações reais de relatório/documento/PDF/e-mail. Produzir docs/relatorios/mapa-documentos-modulos.md em português, com matriz por módulo/submódulo, documentos recomendados, público/destinatário, estado atual de relatório/PDF/e-mail com evidências de arquivos, lacunas e prioridade. Diferenciar PDF comercial, documentos fiscais oficiais e exportações estruturadas, sem prometer funções existentes só por haver botão. Relatórios internos sensíveis não devem ter envio externo genérico. Não implementar todos os módulos neste pedido; usar levantamento para roteiro de adoção da infraestrutura central.

## Task6 — bancos com identificação visual (agente)

Usuário enviou tela de contas financeiras com campo Banco livre e https://github.com/Tgentil/Bancos-em-SVG. Melhorar esse campo com catálogo pesquisável por nome/alias e código quando verificado, logotipo local, teclado e seleção acessíveis. Manter banco manual e valores anteriores; não alterar contrato string bank, agência, número da conta, tipo nem criar conexão bancária. Preservar o comportamento ao alternar para caixa/conta interna.

Files exclusivos: records/reference/reference-workspace.tsx, novo bank-picker.tsx e bank-catalog.ts, testes próprios, logos sob public/banks e atribuição/source manifest. Root integra apenas config de testes. Usar assets de commit fixo, revisar SVG para script/eventos/referências externas; não buscar logo remoto em runtime. README informa propriedade das marcas e uso de identificação, não alegar licença MIT inexistente. Scripts de importação somente scripts/. Registrar origem e códigos verificados, sem inventar código para todas as marcas. Testar seleção por teclado, valor legado/manual, gravação string e limpeza ao trocar tipo; imagens fallback e layout mobile.

## Review Focus

- Uma empresa comum não configura SMTP global; usuário revogado não salva. GET/log nunca revela senha.
- Desativação é persistida e não reativa ambiente; host/usuário/TLS alterado não vaza senha antiga.
- PDF e anexo usam dados autorizados da empresa, sem rede arbitrária nem custos internos; grandes pedidos não cortam texto.
- Novo resolve não muda idempotência nem faz SMTP em GET, falha ou retry incerto.
- Grants mínimos cobrem runtime real e preservam RLS; migrations novas não editam histórico já aplicado.
