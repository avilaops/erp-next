# Contratos • Entrega do transporte do validador

## Escopo

[PR 213](https://github.com/avilaops/erp-next/pull/213) acrescenta a versão 0.2.0
do pacote de validação. Implementa somente a comunicação interna pura:
preflight com confiança explícita, framing limitado, HMAC com rotação e
respostas correlacionadas. Não cria servidor, não envia convites e não habilita
assinatura real ou emissão produtiva. A disponibilidade do ERP é separada.

O estado final dos checks e da integração deve ser conferido na PR vinculada.
O diff mantém as dependências; o lock altera somente a versão do próprio pacote.

## Evidências locais

- Baseline anterior: 54 testes aprovados.
- Após o transporte e a revisão: 77 testes do corpus completo aprovados em
  20,941 s; os mesmos 77 passaram no wheel compilado, com rede bloqueada,
  em 14,539 s. Fixtures/chaves sintéticas foram excluídas da distribuição.
- Framing exercitou bytes exatos e limites reais de 20/32 MiB, hashes, partes,
  identificadores, JSON duplicado/inválido, configuração e participantes.
- Autenticação exercitou ambas as chaves, adulteração, método/target, janela
  temporal e cabeçalhos duplicados ou excessivos antes do decode.
- Respostas exercitaram correlação, domínio separado, confiança, ausência de
  checks, observação remota e um PDF com CMS/cadeia/revogação sintéticos reais.
  Confiança `synthetic_not_icp` não representa homologação ICP-Brasil.
- Uma revisão independente somente leitura executou 24 testes focados.
  Encontrou uma questão importante: profundidade sem limite explícito e teste
  patológico que não alcançava o JSON. Dois testes reproduziram o defeito;
  após a correção, o JSON de request/resposta limita profundidade a 16 antes
  da desserialização, respeitando strings e escapes. Não houve segunda revisão.

Comandos completos e interfaces estão no
[README](../../../../../apps/contract-signature-validator/README.md) e no
[plano](../../../../superpowers/plans/2026-11-14-contract-validation-transport.md).

## Observação menor pendente

O leitor aceita JSON equivalente com ordem/whitespace diferentes; o produtor
emite forma canônica. O MAC cobre os bytes exatos e duplicatas são recusadas;
não foi encontrado bypass. Rejeição estrita adicional ou esclarecimento da
obrigação de canonicalidade do produtor permanecem pendentes, sem alterar a
interpretação única já exigida pelo protocolo.

## Decisões e custos se estiverem erradas

- Usar a branch no checkout solicitado, sem outro worktree. Custo: exige
  staging estrito para preservar arquivos de outros trabalhos.
- Tratar o transporte como pré-requisito do serviço. Custo: expor o núcleo
  diretamente antes dos gates permitiria abuso de recursos.
- Aproveitar a execução integral já concluída, sem repeti-la apenas pelo
  wrapper task-done. Custo: parte do histórico fica no registro de ferramentas;
  logs finais e provas de distribuição são preservados separadamente.
- Reutilizar o wheel existente para os módulos puros, sem novas dependências.
  Custo: o serviço HTTP e o isolamento continuam trabalho obrigatório separado.
- Verificar hora observada com envio assinado e recebimento do cliente, sem
  exigir igualdade com o relógio do cliente. Custo: skew acima de 5 s é recusado
  e precisará de monitoração no serviço.
- Exigir perfil configurado também ao selar respostas. Custo: futuros callers
  precisam passar o perfil do bundle local, nunca o perfil de um corpo recebido.
- Manter HTTP ingress, streaming, TLS e isolamento Linux como próximos gates.
  Custo: limites de frame puros não substituem proteção do parser em execução.
- Manter autorização por tenant, origem DocuSeal, sessões, replay global e CAS
  no workflow ERP. Custo: HMAC sozinho não impede atribuição ou avanço indevidos.
- Manter revogação online, homologação pessoal e ativação como obrigações.
  Custo: testes sintéticos poderiam ser confundidos com validade real.
- Não promover testes focados da revisão a prova de CI ou distribuição.
  Custo: defeitos de Linux/empacotamento poderiam escapar sem os gates completos.
- Não refazer auditorias integrais de PDF/API/web nativos inalterados.
  Custo: problemas preexistentes precisam de investigação própria antes da ativação.

## Próximos componentes do objetivo completo

Serviço privado com limites e isolamento Linux; obtenção restrita de AIA/CRL/
OCSP; política congelada antes do provider; estado transacional e acesso dos
participantes; todos os heads/evidências no pacote final; retenção/restauração;
homologação real com o DocuSeal instalado e os certificados pessoais dos titulares.
Nenhum desses componentes é declarado concluído por esta entrega.
