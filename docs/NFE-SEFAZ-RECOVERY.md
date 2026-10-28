# NF-e 55 — processamento de respostas e recuperação (AVL-328)

## Estado desta entrega

Componente Rust interno e ainda não conectado à rota `issue`:
`apps/api/src/domains/fiscal/sefaz_response.rs`. Não há transmissão, acesso a
certificados, reserva de números, persistência nova ou mudança de readiness.
A produção e a emissão em homologação continuam bloqueadas. O componente não
converte protocolo fornecido pelo usuário em autorização real.

O parser recebe **somente o payload fiscal**, extraído pelo futuro adaptador de
uma resposta SOAP autenticada do autorizador. Não recebe XML de upload. O
adaptador ainda precisa validar HTTPS/mTLS, endpoint por UF/ambiente, envelope
SOAP, XSD fixado e limites do transporte. O parser verifica namespace, versão,
ambiente 2, serviço esperado, unicidade dos campos, chave/modelo/DV, recibo e
digest da submissão. Nenhum texto livre da SEFAZ é incorporado aos erros.
Aceita lote com exatamente uma NF-e. Não interpreta lotes com múltiplas notas.

## Contrato interno implementado

| Entrada/resultado | Precondição e efeito calculado |
| --- | --- |
| `Expected::new` | Chave modelo 55 e DV válido, digest base64 de 20/32 bytes do XML assinado imutável, recibo opcional de 15 dígitos |
| `parse(Authorization)` | `retEnviNFe` 4.00 ambiente 2; 103 exige recibo; 104 exige protocolo individual |
| `parse(Receipt)` | `retConsReciNFe`; recibo igual ao pedido; 105 continua consulta; 104 exige protocolo |
| `parse(Situation)` | `retConsSitNFe`; chave igual ao pedido; 100/150 exigem protocolo correspondente; 101/151 indicam cancelamento atual |
| Protocolo 100/150 | Chave, ambiente, digest e número conferidos; gera intenção de persistir protocolo, sem escrever dados |
| Rejeições 215/225/297/298 | Revisão manual; nenhuma nova numeração ou retransmissão |
| Duplicidade 204/539, indisponibilidade, denegação, não localizado e códigos não classificados | Consulta pela chave e revisão posterior; nunca autorização ou reenvio automático |
| Timeout com recibo | Consulta pelo mesmo recibo |
| Timeout sem recibo | Consulta pela mesma chave; não gera nova chave/número |
| Erro de estrutura/correlação/ambiente | Não altera estado; manter resultado ambíguo e reconciliar pelo pedido original |

`Outcome::Authorized` é um resultado de correlação interna. Apenas com transporte
autenticado e validação XSD real poderá sustentar persistência de autorização.
O nome não é evidência de homologação. Cancelamento atual não apaga nem altera o
XML autorizado histórico. Datas completas ainda dependem do validador XSD.

## Contratos dependentes — propostos, não implementados

Antes de conectar qualquer efeito à API, fechar e verificar a família fiscal na
AVL-359. O PR #4 dessa tarefa ainda estava aberto na inspeção de 28/10/2026.
Não introduzir migration, banco novo ou deploy enquanto a P0 não for validada.

| Ação futura | Contrato obrigatório antes da implementação |
| --- | --- |
| Emitir (`POST .../nfe/{id}/issue`) | Bearer e empresa ativa; `fiscal.nfe.read` + `fiscal.nfe.issue`; If-Match e Idempotency-Key; vínculo atual revalidado. Empresa + ator + comando com hash canônico da intenção e revisão. Replay retorna a resposta original; intenção divergente 409. Número alocado uma vez por CNPJ/ambiente/modelo/série, comando e outbox na mesma transação. Sem efeito antes de confirmar a persistência |
| Preparar/assinar | Snapshot fiscal completo com tributos, totais, pagamentos e regras vigentes aprovadas; pacote XSD versionado/hash; A1 por tenant/alias em cofre, acesso mínimo, chave/senha nunca em API/log/outbox; verificar titularidade, validade e cadeia; XMLDSig e validação independente |
| Transmitir | XML assinado original gravado imutavelmente antes do primeiro envio; CAS por revisão/lease para um único worker; marcar tentativa durável antes do I/O. Crash após essa marca exige consulta, inclusive se não houver recibo. Sem retentativa cega |
| Consultar | Permissão e empresa revalidadas; consulta read-only por chave/recibo original. Polling com backoff, jitter e prazo; ao esgotar, estado pendente de revisão, nunca rejeição presumida |
| Persistir autorização/documentos | Chave/ambiente/digest/protocolo conferidos. R2 com chave por tenant/documento/hash e criação condicional sem sobrescrita; guardar XML original assinado, resposta bruta, nfeProc, protocolo, hashes, versão de schema e trilha de correlação. CAS/outbox para recuperação de falha entre R2 e PostgreSQL; RLS e integridade por empresa. Não declarar atomicidade distribuída |
| DANFE | Gerar a partir do nfeProc persistido e validado; PDF com hash, referência à revisão documental e mesma empresa. Falha no PDF não desfaz autorização nem dispara emissão |
| Cancelar | Evento específico, idempotência e protocolo próprios; manter histórico e documentos originais; contrato e testes próprios antes de ativar |

Erros públicos futuros: 401 identidade; 403 associação/permissão; 404 documento
fora da empresa; 409 intenção/revisão conflitante; 422 dados fiscais recusados;
503 dependência não provisionada. Timeout de envio significa resultado ambíguo,
não falha fiscal definitiva. O contrato HTTP de consulta ainda precisa ser
fechado na P0, sem inventar uma rota operacional neste incremento.

## Insumos ainda ausentes

O rascunho atual não contém bases/alíquotas/valores dos tributos, IBS/CBS/IS,
frete/descontos, pagamento ou total final da nota. Não inferir esses campos de
`productsTotal`, NCM ou CRT. Definir com o emitente a operação suportada e a
instrução fiscal, UF, pacote XSD/NT vigente, A1 autorizado e armazenamento.
O alias atual não comprova certificado provisionado.

## Verificação e evidência

Oito testes Rust sintéticos cobrem respostas síncronas/assíncronas, correlação,
duplicidade, timeout, rejeição, cancelamento, produção recusada, protocolos
múltiplos, wrappers, versão/namespace, tamanho e DTD. São executados pelo comando
Rust já existente no GitHub CI. Nenhum certificado ou segredo é necessário.
Não representam autorização real, isolamento RLS novo, persistência, mTLS ou
comunicação com SEFAZ. Não houve execução local de build/testes de aplicação.

A publicação do código no GitHub foi bloqueada pela revisão automática de
permissões nesta sessão: ela exige autorização explícita para publicar no
repositório. Não houve execução de CI desta alteração. Oito testes foram escritos,
mas continuam não executados. `git diff --check` passou; Rust/rustfmt não estão
instalados neste ambiente. A revisão e a formatação precisam ser concluídas na CI
após a liberação da publicação. O bloqueio foi registrado na AVL-328.
A falha de navegador DANFE da main continua acompanhada pela AVL-358.

Referências oficiais para semântica dos retornos (não substituem NT/XSD vigente):

- [MOC 7.0, Anexo I — códigos e leiaute](https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=J+I+v4eN00E%3D).
- [MOC 7.0 — visão geral e fluxo de consulta](https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=LrBx7WT9PuA%3D).
