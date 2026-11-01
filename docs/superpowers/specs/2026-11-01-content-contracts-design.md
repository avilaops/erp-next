# Conteúdo, contratos e preferências — AVL-402

## Objetivo e limites

O Rust executa regras e autorização; o OpenAPI descreve o contrato real; a web usa tipos gerados e a ajuda explica operações existentes. MDX é código confiável versionado e compilado no build. Nenhum conteúdo recebido de usuário ou banco é compilado.

A entrega inclui contratos usados pela aplicação, ajuda operacional e persistência de favoritos, gráficos e período da página inicial. Não inclui motor de aprovações, métricas novas, publicação em produção ou alteração de regras fiscais/comerciais.

## Decisões

- Reutilizar Utoipa e o exportador de testes, sem servidor de produção para gerar contratos.
- Gerar tipos com openapi-typescript já fixado no consumidor de CI; usar schemas gerados como fonte dos aliases da web.
- Preservar os BFFs e suas verificações de origem, sessão e empresa.
- Usar @next/mdx compatível com o Next.js existente e imports estáticos de conteúdo local.
- Reaproveitar preferências pessoais com RLS por empresa/identidade, ETag e auditoria.
- Alterações de layout são salvas explicitamente. Uma revisão conflitante preserva a edição e exige releitura.
- Clientes antigos que enviam somente productPageSize preservam o layout existente.

## Alternativas consideradas

Manter tipos manuais conservaria a divergência identificada. Um novo SDK publicado ampliaria distribuição e versionamento sem necessidade atual. A escolha é geração dentro do repositório e transporte compartilhado.

MDX remoto editável exigiria um modelo distinto de confiança e publicação. A escolha é conteúdo do repositório compilado no build.

## Critérios de aceite

Compilar web com o contrato exportado do mesmo commit; rejeitar contratos ausentes/inválidos e referências remotas; preservar semântica dos comandos e downloads; renderizar e pesquisar ajuda; salvar/reler layout com isolamento e conflitos; validar CI completa e navegador.
