# Integração e entrega fiscal — AVL-396

## Objetivo

Integrar a implementação de devoluções, comissões, produção e operações fiscais
com a main `413399e`, preservar o monitor canônico publicado e preparar uma
entrega revisável pelo GitHub. Sem alteração de banco de produção ou transmissão
fiscal real nesta verificação.

## Execução

- [x] Resolver conflitos de módulos, configuração de certificados, rotas e proxies.
- [x] Preservar configurações financeiras, contratos e comportamento de entrada.
- [x] Renumerar cinco migrations não publicadas para `202611010001` a `202611010005`.
- [x] Distinguir distribuição e manifestação de produção das operações de homologação.
- [x] Permitir compra em rascunho a partir de XML autorizado do monitor de produção.
- [x] Criar regressão para conversão idempotente sem estoque, financeiro ou manifestação.
- [x] Atualizar a lista canônica de notas depois de uma coleta aplicada em produção.
- [x] Executar suíte Rust integrada, lint, build, motor e testes de navegador.
- [x] Registrar revisão e resultados reproduzíveis.
- [x] Preparar entrega versionada e gates de PR/release para publicação no GitHub.

A publicação e o resultado do CI remoto serão registrados no PR e no Linear.
As evidências locais estão em
[VERIFICACAO-INTEGRACAO-20261101.md](../../VERIFICACAO-INTEGRACAO-20261101.md).

## Verificação

PostgreSQL 18 isolado, papel de runtime sem superusuário ou BYPASSRLS. Testes
externos usam transportes/certificados sintéticos. Verificar sequencialmente
motor, modelos fiscais e navegador após a suíte Rust. O release e as migrations
de produção seguem exclusivamente os workflows existentes do GitHub.

## Limites

O motor de emissão continua em homologação e com o recorte tributário documentado.
Uma consulta de distribuição ou manifestação de produção exige ação explícita e
permissões do monitor canônico; não é ativada por este merge. A automação de
homologação permanece opt-in por empresa e responsável. Dados fiscais e material
de certificado não serão inventados ou copiados como efeito colateral da entrega.
