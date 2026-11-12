# Preferências de Suprimentos

As seis opções de Preferências / Suprimentos possuem páginas conectadas ao BFF
e contratos Rust. A publicação depende das duas migrações de 02/11 e da versão
correspondente de API e web.

## Configurações

- Estoque: permitir ou bloquear lançamentos e estornos manuais; motivo mínimo
  entre 3 e 200 caracteres. Sem configuração, movimentos continuam permitidos,
  com motivo mínimo de 3 caracteres. Compras e vendas conservam seus fluxos.
- Compras: valor mínimo, prazo máximo de pagamento entre 0 e 3650 dias desde a
  confirmação (Brasília), contato do fornecedor obrigatório ou opcional.
  Sem configuração, não há restrição adicional. Compras confirmadas anteriormente
  conservam seu fluxo de recebimento.

GET/PUT em `/api/v1/inventory-settings` e `/api/v1/purchase-settings`.
PUT exige `platform.company.manage` e `If-Match`; leitura aceita permissão da
empresa ou do domínio. Revisão inicial 1, dados nulos enquanto não configurado.
Alterações concorrentes retornam 412 sem sobrescrever o formulário.

## Cadastros

Coleções `/api/v1/warehouses`, `/product-groups`, `/tag-groups` e `/tags`:
GET paginado com busca/situação, POST idempotente, GET/PUT por UUID.
Todos têm código único por empresa, nome, observações e situação ativa/arquivada.
Depósitos acrescentam localização; tags podem pertencer a um grupo da mesma empresa.

Tags ativas exigem grupo ativo. Um grupo com tags ativas não pode ser arquivado.
Arquivar preserva os registros; não existe exclusão destrutiva.
Depósitos usam `inventory.stock.read/manage`; os demais usam
`catalog.products.read/manage`. Gravações exigem chave de idempotência e
edições exigem revisão. Banco, auditoria e outbox participam da mesma transação.

## Limites

- Saldo continua por produto/empresa. Cadastro de depósito não transfere estoque
  nem implementa saldos por depósito.
- Grupos de produtos e tags são cadastros auxiliares. Não há vínculo de produtos
  a esses cadastros nesta entrega.
- Testes de navegador com fixtures verificam UI e transporte; os testes SQLx
  verificam a API com PostgreSQL e papel sem bypass de RLS.
- Implementação local e testes não comprovam publicação ou autenticação real
  em produção.

## Validação local em 03/11/2026

- Compilação Rust dos testes concluída.
- PostgreSQL local isolado: 4 testes de cadastros de suprimentos, 2 de
  configurações, 6 de regressão dos cadastros auxiliares e 7 da cadeia de compras
  aprovados. As suítes usam papéis sem bypass de RLS.
- OpenAPI exportado, validado e usado para gerar os tipos web.
- TypeScript e build Next.js de produção aprovados.
- Nove testes Playwright de suprimentos aprovados contra o build de produção
  local, com autenticação e API sintéticas, incluindo viewport móvel.
- Lint sem erros, com 12 avisos preexistentes fora dos arquivos desta entrega.
- Verificador de arquitetura aprovado para 328 arquivos de rotas.
- Revisão estática independente concluída; confirmação duplicada na navegação
  do editor corrigida.

## Continuação da interface

As listagens apresentam tabela no desktop e cartões no celular, localização dos
depósitos, edição direta, filtros controlados com limpeza e estados vazios
específicos. Os quatro cadastros de suprimentos oferecem retorno às preferências.

O botão Sair usa POST via fetch para conservar a origem sob `no-referrer`.
A navegação por formulário enviava `Origin: null` no Chromium e recebia 403.
A validação de origem no servidor permanece ativa. Falhas aparecem na interface
e permitem nova tentativa; o sucesso limpa os cookies e abre a tela de entrada.
Seis testes de navegador passaram com o handler real local: saída pela interface,
remoção dos cookies, bloqueio de origem inválida, recusa, falha de rede e
reprodução da diferença entre formulário e fetch.

O catálogo de verificação inclui 196 ações e 40 fluxos, com 40 testes aprovados.
Os quatro testes OpenAPI também passaram. Esses registros não atestam execução
ou publicação em produção.
