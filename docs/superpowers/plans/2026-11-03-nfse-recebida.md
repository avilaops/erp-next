# Inspeção offline de NFS-e nacional — Implementation Plan

> Execução: superpowers:executing-plans, com testes antes da implementação.

**Goal:** preparar importação manual de NFS-e nacional sem confundir validação
de leiaute com assinatura, situação atual ou cobertura de captura.

**Architecture:** motor Node privado confere XSD fixado, normaliza os dados e
conserva o XML. API Rust será responsável por tenant, deduplicação e persistência
na etapa seguinte. Não utilizar parser, chave ou cursor de NF-e.

**Tech Stack:** Node 24/TypeScript nativo, xmldom e xmllint-wasm já instalados no
motor; sem novas dependências.

**Spec:** `docs/superpowers/specs/2026-11-03-nfse-recebida.md`.

## Restrições e revisão

- Meta completa continua com as seis issues, sem alegar conclusão da AVL-112.
- Branch `codex/avl-112-nfse-nacional-recebida` parte de `a19dc38`, após a
  central CT-e. PR separado deve declarar dependência do PR CT-e #69.
- Compilação, testes e lint Rust exclusivamente no GitHub Actions.
- Emitente e prestador podem ser diferentes; tomador deve ser o CNPJ da empresa.
- Valores podem ultrapassar a precisão de Number: retornar centavos como strings.
- Schemas precisam ser íntegros e inteiramente locais; sem fallback de versão.
- O perfil local 1.01 para série é derivado por hashes exatos e declarado no
  retorno; o XSD original não é alterado nem declarado aprovado indevidamente.
- Entradas hostis, versões misturadas e ausência de tomador devem falhar sem
  devolver uma inspeção parcialmente válida nem acessar serviço externo.

## Tarefa 1: protocolo local testável

Arquivos: `nfse-received.ts`, `nfse-layout.ts`, `brazilian-document.ts` em
`apps/fiscal-engine/src/lib/fiscal/`; `schemas/nfse-national/` com manifesto;
`tests/nfse-received.test.ts` e fixture sintética em `tests/fixtures/`.

- [x] Escrever casos válidos 1.00/1.01 e testes de limites, leiaute, identidade,
  valores exatos, preservação de XML e falha de integridade dos schemas.
- [x] Executar teste e confirmar falha pela ausência do módulo.
- [x] Fixar os oito XSD e manifesto com hashes e dependências fechadas.
- [x] Implementar `inspectReceivedNationalNfse({ xml, recipientTaxId })`.
- [x] Compartilhar o validador numérico CNPJ com CT-e, preservando sua lógica;
  CPF e identidades estrangeiras mantêm regras explícitas e tipos distintos.
- [x] Adicionar `inspect-nfse` no dispatch/servidor privado e testar autenticação,
  campos desconhecidos e ausência de transporte/A1.
- [x] Executar suíte completa do motor, revisar, corrigir e registrar evidências.
- [ ] Abrir PR em rascunho, anexar à tarefa e validar CI sem merge/deploy.

Evidência local: `npm test` aprovou 71 testes em 03/11/2026, incluindo os dez
casos novos NFS-e e os 19 CT-e. A revisão reproduziu aceitação de surrogates
isolados; a correção agora exige ida e volta UTF-8 idêntica antes do DOM/WASM e
usa os mesmos bytes no hash. A revisão confirmou recusa dos dois surrogates e
preservação de par válido. Nenhuma ferramenta ou teste Rust foi executado aqui.

## Etapas seguintes

- [ ] Persistência e importação manual na API Rust, com testes PostgreSQL no CI.
- [ ] Central com XML/eventos e conferência individual.
- [ ] Captura por fonte com NSU próprio e retomada; homologação externa.
