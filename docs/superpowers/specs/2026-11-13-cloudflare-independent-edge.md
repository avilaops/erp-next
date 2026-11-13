# Cloudflare independente da VPS — primeira entrega

O usuário pediu configurar o Cloudflare para reduzir a dependência e a carga do servidor e informou que os servidores estão bloqueados financeiramente. Esta entrega prepara e publica a camada que pode funcionar sem a origem, preservando o código e os dados do ERP.

## Decisão de arquitetura

Workers e R2 atendem a entrada HTTP e os arquivos estáticos. A aplicação existente em Next.js, Rust e seus serviços auxiliares precisa de runtime Linux compatível, como Containers, e PostgreSQL gerenciado separado. A autenticação e o portal de contratos também precisam de destino independente. Não converter PostgreSQL para D1 nem anunciar o ERP completo recuperado nesta entrega.

Alternativas consideradas: apenas colocar CDN na VPS mantém a indisponibilidade atual; reescrever tudo para Workers/D1 altera SQLx/RLS e regras de negócio; preservar os runtimes com Containers e PostgreSQL externo reduz o trabalho de migração. A última é a proposta para a aplicação completa, sujeita a acesso aos dados e aprovação de custos. Containers não foi ativado nem contratado.

## Entrega autorizada agora

- Worker `erp-next-edge`, compatibilidade `2026-11-13`, sem dependências novas. Publicação inicialmente em workers.dev; rota pública somente após testes.
- Três buckets privados e separados: `avilaops-erp-next-assets` (somente arquivos públicos de builds), `avilaops-erp-next-files` (documentos privados) e `avilaops-erp-next-backups` (futuras cópias completas do banco atual).
- O Worker recebe SOMENTE o binding `PUBLIC_ASSETS`. Nenhum binding público para documentos ou backups. Nenhum domínio público de bucket, CORS genérico ou regra de expiração destrutiva.
- `ASSET_RELEASE` é o SHA exato da aplicação cujos assets foram carregados; inicialmente `fa7e1526a7c469843f1a18168ea5c0e558768ac1`. Chave no R2: `releases/<ASSET_RELEASE>/_next/static/<relative-path>`.
- GET e HEAD de `/_next/static/` podem servir apenas extensões de build explicitamente permitidas, com validação de caminho e tipos de conteúdo fixos. Não servir mapas de fonte, HTML, arquivos arbitrários ou conteúdo privado.
- Cache exclusivamente de assets públicos 200, com chave que inclui release e caminho. TTL de produção de 31.536.000 segundos; ensaio remoto usa 60 segundos. Respeitar ETag/If-None-Match e HEAD sem corpo. Falha de cache não derruba o recurso válido. Streams não devem ser armazenados em buffers completos.
- Rotas dinâmicas, APIs, OAuth, sessão e comandos financeiros nunca usam o cache ou R2. `APP_MODE=maintenance` retorna 503 verdadeiro, Retry-After 60 e Cache-Control no-store; HTML em navegação e JSON em APIs. `/api/health` retorna ok=false e 503, nunca a versão de um ERP saudável.
- O modo futuro `application` delega uma única vez ao binding de serviço `APP`, preservando método, corpo, cookies, status e cabeçalhos de autenticação; sem fallback à VPS e sem repetição automática de comandos. Sem APP, falha de forma fechada em 503.
- Observabilidade habilitada com query strings redigidas, logs sem corpos/credenciais e traces amostrados. Não transmitir cookies ou Authorization para leitura de assets/cache.
- Alterar apenas o registro A de `erp.avilaops.com` para proxied e criar a rota exata desse host, depois do ensaio. Preservar o IP registrado, demais DNS/TXT, rotas de outros Workers e configurações globais da zona. Registrar o estado anterior para reversão.

## Segurança dos dados e limites

O bucket existente `avilaops-backups` foi listado completamente: 2.016 objetos. O último dump `host-erp-20261113.sql.gz` passou descompressão integral, mas contém `erp_control`/`tenant_ludus`, não o banco `erp_next` atual. Criar bucket vazio não cria backup. O deploy antigo guarda estrutura/ledger pré-migração, não uma cópia completa dos dados. Não restaurar legado sobre o banco atual nem inicializar produção vazia como recuperação.

Sem novo plano pago, migração de dados, emissão fiscal, envio de mensagens, assinatura, compra ou estoque reais nesta entrega. A funcionalidade de encomenda antecipada permanece pausada em outra branch. Trabalhar somente no workspace existente e preservar os quatro caminhos não rastreados do usuário.

## Critérios de verificação

Testes cobrem separação público/privado, travessia e extensões inválidas, GET/HEAD/ETag, namespace por release, TTL inválido, falhas de R2/cache, 503 honesto, ausência de repetição e preservação de cookies/status em APP. Ensaiar o Worker real com um asset sintético público e excluir apenas esse objeto depois; nenhum dado de negócio. Conferir os três buckets privados e a configuração/versão real do Worker antes e depois da rota pública. Registrar separadamente camada edge disponível e aplicação ainda indisponível.
