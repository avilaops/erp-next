# Verificação da continuidade comercial/fiscal — 2026-10-31

Ticket AVL-396, branch `codex/erp-retornos-fiscal-20261031`.
Etapa 2, após reaplicação da primeira entrega sobre `main` em `f52b502`.

## Evidências locais

| Verificação | Resultado |
| --- | --- |
| Rust workspace, PostgreSQL 18 isolado | 180 aprovados, nenhuma falha, um ignorado |
| Motor fiscal Node | 42 aprovados |
| Modelo fiscal web Node | Dois aprovados |
| Playwright, sete suites afetadas | 19 cenários únicos aprovados |
| Build web, incluindo TypeScript | Aprovado |
| ESLint web | Aprovado |
| Rustfmt e Clippy `-D warnings` | Aprovados |
| OpenAPI exportado | 114 rotas, 154 operações, nenhum identificador duplicado |
| Estrutura do Compose com overlay fiscal | Validada pelo Docker Compose, sem iniciar serviços |

O teste ignorado continua sendo a integração anterior que exige Ollama local.
Certificados, sessões, XMLs e transporte usados nos testes são sintéticos. O
PostgreSQL é uma instância UTF-8 local isolada; os testes usam papéis sem
superusuário nem BYPASSRLS, com bancos separados por caso.

## Regressões de maior impacto

- Recebimento parcial gera comissão com condições preservadas; estorno após
  pagamento conserva o pagamento e cria o débito exato. Pagamento anterior ao
  recebimento ou estorno selecionado é rejeitado; antecipação após a origem é
  permitida.
- Cancelamento concluído e anterior à expedição fecha a produção e compensa os
  consumos ativos uma vez. Reserva de outra venda protege o saldo e o fluxo
  manual não pode estornar movimentos de produção.
- A cadeia conjunta força falha no outbox de produção após iniciar a reversão:
  estoque, título, comissão, produção, cancelamento e comando voltam juntos.
  Nova tentativa com a mesma chave aplica uma única compensação.
- O teste de comissão revoga UPDATE/DELETE dos livros para reproduzir o grant
  real de implantação. RED confirmou resposta 500 ao tentar pagar; a correção
  removeu `FOR UPDATE` dos lançamentos imutáveis, mantendo as travas de tenant e
  conta. GREEN confirmou pagamento e estorno com esses privilégios restritos.
- XML CRT 3 assinado passa no XSD com declarações explícitas, arredondamento por
  item, total com IPI e valores de pagamento coerentes. Combinações ou precisão
  fora do recorte são recusadas.

As revisões independentes de comissão/produção identificaram cronologia de
pagamentos, consistência de leitura e portas antigas de cancelamento/estorno.
Os ajustes correspondentes estão cobertos pela validação. A revisão final do
recorte CRT 3 não apontou bloqueio concreto; ela não é homologação na SEFAZ.

O navegador identificou que o shell ainda classificava as cinco rotas de
comissões/produção como demonstrações e desabilitava seus controles. As rotas
foram retiradas da lista de prévias, e o teste dos modelos operacionais passou
a proteger esses componentes. Na repetição, 17 cenários passaram e dois testes
de acesso negado encontraram ambiguidade entre o alerta da aplicação e o
anunciador do Next.js. Seletores específicos resolveram esses dois casos, ambos
aprovados na execução focal seguinte. O build utilizado foi o de produção.

## Configuração publicada consultada

Inspeção SSH somente leitura: API e web saudáveis, motor fiscal não configurado,
keyring de criptografia A1 presente. Consulta ao PostgreSQL com papel de runtime,
RLS da empresa padrão e transação somente leitura confirmou que essa empresa
não possui perfil fiscal nem certificado armazenado. Não foram expostos segredos
ou documentos da empresa.

O overlay Compose foi analisado com imagens/token de fixture e sem arquivos
privados de ambiente. Essa análise valida a estrutura de rede e configuração;
não constrói a imagem nem inicia o motor. Release CI e deploy não foram
executados nesta sessão.

## Limites operacionais

Homologação real requer perfil fiscal, A1 válido, motor provisionado e migrations
aplicadas pelo fluxo autorizado. Não houve alteração de produção, movimentação
bancária ou transmissão fiscal real. O recorte tributário, o corte de competência
das comissões e o consumo declarado de produção estão documentados em
[COMISSOES-PRODUCAO-E-FISCAL.md](COMISSOES-PRODUCAO-E-FISCAL.md).
