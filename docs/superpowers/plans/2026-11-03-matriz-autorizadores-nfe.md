# Matriz de autorizadores NF-e — AVL-101

Parte da meta AVL-101/104/108/110/111/112. Esta etapa registra e testa a matriz
oficial; habilitação das demais UFs depende de demanda e homologação externa.

## Desenho e limites

Conferir separadamente os portais nacionais de produção e homologação, conservar
URLs/versões publicadas e hashes dos documentos. Registrar 27 UFs, autorizadores
próprios/compartilhados, consulta de cadastro e contingência por ambiente.
Não remover `?wsdl` de uma URL publicada para adivinhar endereço de transporte.
Não inferir serviço ausente a partir de outro autorizador ou ambiente.

O roteamento usa a UF do emitente. A matriz publicada não habilita transporte:
os quatro resolvers existentes continuam limitados a SP, com URLs preservadas.
O motor mantém seus bloqueios de produção, regras tributárias e UF atual.
Contingência permanece somente catalogada, sem troca automática de URL.

Fontes obtidas em 03/11/2026:

- [Portal nacional de produção](https://www.nfe.fazenda.gov.br/portal/webServices.aspx?tipoConteudo=OUC%2FYVNWZfo%3D),
  SHA-256 `e865853553700166b98b06daec999781295deb4bb93c03303e092c0cb6d47d90`.
- [Portal nacional de homologação](https://hom.nfe.fazenda.gov.br/portal/webServices.aspx?tipoConteudo=OUC%2FYVNWZfo%3D),
  SHA-256 `a70092e9a7c0a8ee7ee7a47b92e19af281fb113bd29e8edae2318203faf19e1e`.
- [Catálogo da SVRS](https://dfe-portal.svrs.rs.gov.br/Nfe/Servicos), conferência
  adicional dos serviços. Diferenças não são normalizadas silenciosamente.

Os dois portais indicam contingência diferente para PI: produção SVC-AN,
homologação SVC-RS. Conservar os dois dados com sua fonte; não interpretar isso
como autorização ou prova de que qualquer fluxo de contingência foi exercitado.

## Execução

- [x] Ler ticket e limites atuais; conferir portais oficiais por ambiente.
- [x] Escrever testes e confirmar falha antes do módulo, por arquivo ausente.
- [x] Versionar matriz local e hash; distinguir URL de serviço e de definição.
- [x] Implementar consulta publicada e resolução atual restrita a SP.
- [x] Integrar quatro resolvers sem alterar regras ou cobertura operacional.
- [ ] Revisar e testar motor; validar CI e documentar limites da etapa.

Evidência local: cinco casos novos e suíte completa de 66 testes aprovados.
Revisão independente comparou as tabelas e spans com os dois HTMLs originais:
15 autorizadores e 96 serviços por ambiente, sem divergências em URLs, versões
ou rotas das 27 UFs. Hash do JSON versionado:
`95b3757d101ffe48144102d9428a9f53d1d3d60116ccf131bc260028e76dfdef`.
Os resolvers preservam SefazError e URLs de SP. Demais UFs, regras tributárias
e homologação por autorizador permanecem pendentes na AVL-101.

Worktree isolado `/home/avops/projetos/erp-matriz-autorizadores`, branch
`codex/avl-101-matriz-autorizadores`, base a19dc38 (PR #69).
Nenhuma compilação, formatação ou execução Rust local; somente GitHub Actions.
