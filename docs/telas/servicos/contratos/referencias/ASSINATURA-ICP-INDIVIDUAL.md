# Assinatura ICP-Brasil individual — requisito de implementação

Requisito confirmado pelo usuário: exigir certificado pessoal ICP-Brasil de **cada participante**. Este documento organiza o desenho de 13/11/2026; não declara o recurso implementado nem homologado. Contratos antigos e o contrato técnico Nicolas permanecem preservados.

## Fluxo completo pretendido

O DocuSeal continua responsável pelo preenchimento, consentimentos, convites e trilha do portal. Antes da primeira criação/convite, o ERP congela a política e as identidades dos participantes. Ao concluir a etapa do portal, confere novamente todos os PDFs finais e seus hashes, congela esses bytes e abre uma etapa própria de assinaturas pessoais sequenciais com as mesmas identidades. Cada pessoa baixa a versão atual, assina localmente com seu próprio e-CPF e devolve o PDF. O ERP nunca recebe chave privada, PFX, senha ou PIN do titular.

Cada participante deve assinar todos os documentos contratuais. O próximo só é liberado depois da validação de todos os documentos da etapa anterior. O selo da conta DocuSeal e o A1 da Ludus não satisfazem esse requisito. Um representante usa seu e-CPF; CNPJ representado e comprovação de poderes são dados separados. E-mail, nome, link ou consentimento visual não provam assinatura ICP.

## Componentes e ordem de implementação

1. **Núcleo do validador:** biblioteca isolada com validação criptográfica de PDF, identidade, confiança, evidências e alterações incrementais; corpus sintético positivo e negativo. Não depende de servidor disponível nem de acesso a certificados pessoais reais.
2. **Serviço de validação:** interface interna autenticada, obtenção restrita de revogação, limites de execução e imagem; reutiliza o mesmo núcleo. Nenhuma função de assinatura nem acesso ao banco, DocuSeal ou vault fiscal.
3. **Fluxo no ERP e portal:** política tipada, participantes congelados, documentos imutáveis, fila transacional com leases, sessões próprias e telas administrativas/participante. Preservar revisão, idempotência, autorização por empresa e permissões existentes.
4. **Pacote e distribuição:** todos os PDFs finais e evidências, integração de imagens/manifestos, retenção e restauração. Manter os bytes fora da limpeza de releases.
5. **Homologação real:** documento autorizado sem valor comercial, versão efetiva do DocuSeal e assinaturas incrementais dos titulares de teste. Não liberar links produtivos antes de comprovar compatibilidade e as demais condições abaixo.

Cada componente deve funcionar e ter testes antes da integração seguinte. Uma biblioteca aprovada não equivale ao fluxo completo nem a homologação ICP real.

## Invariantes do núcleo

- Entradas e saídas ligadas por identificadores, hash do pai/candidato, hash da política, hash do bundle de confiança e horário UTC observado pelo chamador confiável.
- Vereditos distintos: `accepted`, `invalid`, `indeterminate`, `unsupported`. Qualquer verificação obrigatória ausente impede `accepted`; exceções, parser incompatível e falta de evidência nunca viram sucesso.
- Raízes ICP revisadas e fixadas. Intermediárias ajudam a construir a cadeia e nunca viram âncoras. Certificados enviados no PDF, raízes TLS do sistema ou confiança Adobe não substituem a confiança configurada.
- Verificar CMS, ByteRange, cobertura, cadeia, validade, algoritmos, extensões críticas, uso e revogação assinada/fresca. A nova assinatura precisa identificar exatamente o CPF esperado em estrutura ASN.1 apropriada e ser pessoal. e-CNPJ, certificado de aplicação/selo, identidade ambígua ou CPF diferente não satisfazem a política.
- O candidato preserva todo o prefixo do pai e acrescenta exatamente uma assinatura pessoal nova sobre a versão correta. Isso é necessário, mas não suficiente: analisar alterações de objetos e formulários, assinaturas anteriores, DocMDP, FieldMDP, Lock e seed values.
- Não permitir mudança de preço, cláusulas, páginas, conteúdo, recursos, campos comerciais ou aparências que recubram o contrato. Não permitir reparo, impressão/reescrita, merge, flatten, remoção de restrições ou assinaturas anteriores. Alterações incompatíveis ou não explicadas bloqueiam a etapa.
- O selo técnico existente é inventariado e verificado separadamente; sua integridade continua necessária, mas ele nunca conta como assinatura pessoal. Assinaturas pessoais anteriores permanecem válidas no candidato.
- Sem timestamp confiável, registrar validade somente no instante observado e `longTermValidation=not_established`. Não tratar `/M`, horário do computador ou `signingTime` como carimbo qualificado; não apresentar relatório próprio como veredito ITI.
- Evidências DER/JSON, cadeia e contexto devem permitir reprodução offline no instante registrado. Isso não prova validade atual futura. Evidência insuficiente, expirada, não autenticada ou incompatível resulta em `indeterminate` ou `invalid`, conforme a causa.

## Limites e segurança da integração

PDF base até 20 MiB; candidato até 32 MiB; até 10 documentos e 10 participantes por envelope. Dois uploads pendentes por participante; 1 GiB de revisões por envelope. Quarentena de falhas expira em sete dias; revisões aceitas e evidências seguem retenção documental. Medir consumo e impor limites de objetos, páginas, descompressão, tempo e memória; arquivo pequeno comprimido não autoriza consumo ilimitado.

A obtenção de CRL/OCSP/AIA será restrita a destinos públicos revisados, com DNS/IP conferidos na conexão, sem redirects privados, credenciais, metadata, localhost, LAN, `file:` ou LDAP. Limitar tamanho, número de consultas e duração; verificar criptograficamente as respostas, incluindo emissor/responder e freshness. Não usar download irrestrito da biblioteca.

O núcleo inicial recebe evidências explicitamente e permanece sem rede. O serviço posterior só poderá reunir evidências por um adapter próprio aprovado; a ausência desse adapter não pode habilitar modo permissivo.

## Estado e acesso no ERP

Novas emissões Ludus exigirão `icp_each_participant`, sem redução por modelo, valor ou JSON. Política e identidades são congeladas antes da primeira criação/convite no provider. O caminho antigo permanece identificado como `legacy_docuseal`, sem validade ICP retroativa.

Novas tabelas terão tenant/RLS forçada, FKs compostas, evidências append-only, estado operacional separado e CAS de head/participante. Upload concorrente, replay ou worker tardio não pode avançar uma revisão nova ou duplicar evidência. CPF deve ser validado e protegido, mascarado na leitura comum e ausente de logs.

Acesso do participante usará grant opaco curto, de uso único, sessão própria e escopo estreito por envelope/documento. Reaplicar as verificações efetivas do portal, incluindo 2FA quando exigida; não conceder membership ERP nem permitir impersonação administrativa. Link comprova acesso; o CMS e o CPF esperado decidem a assinatura.

O pacote final usará todos os heads concluídos e suas provas. Não escolher somente o primeiro PDF nem cair para preview quando a política exige ICP. Documentos e comprovantes acrescentados depois continuam separados dos bytes assinados.

## Critérios de validação

Testar três pessoas sintéticas e dois PDFs, identidade errada, e-CNPJ/selo, cadeia desconhecida/incompleta, validade e revogação, CRL/OCSP inválidos/velhos/ausentes, prefixo alterado, append que muda preço, cauda não coberta, múltiplas assinaturas novas, PDF criptografado, DocMDP/FieldMDP, objetos não justificados, quotas e restauração por hash.

Testar também concorrência, replay, stale, tenant e sessão cruzados, permissões revogadas, delegação, 2FA, falha do validador e pacote incompleto. Certificados/chaves sintéticos são apenas fixtures, explicitamente NÃO ICP, e nunca entram no bundle ou imagem de produção.

Antes de liberar links reais: preflight do PDF efetivamente produzido pelo DocuSeal instalado; corpus negativo aprovado; duas assinaturas incrementais sucessivas com os certificados pessoais dos respectivos titulares, preservadas até o final; evidência de identidade e revogação. Sem titulares/certificados disponíveis, registrar a implementação de software separadamente e manter a homologação pendente.

## Fontes e desenho anterior

Desenho e checklist locais que originaram esta especificação: `artifacts/contract-ludus-20261113/individual-icp-integration-design.md`, `individual-icp-implementation-checklist.md` e `individual-icp-docuseal-compatibility.md`. Auditoria do DocuSeal fixada no commit `8f8f69f0bc6ac2e59746cd6efac54a852289bec3`.

Fontes primárias: [FAQ DocuSeal On-Premises](https://www.docuseal.com/faq/how-to-use-qes-signing-with-docuseal-on-premises), [repositório de raízes ITI](https://www.gov.br/iti/pt-br/assuntos/repositorio/repositorio-ac-raiz), [identificação ASN.1 ITI](https://www.gov.br/iti/pt-br/assuntos/legislacao/documentos-principais/IN2020_15_DOCICP_04.01.pdf), [pyHanko](https://pypi.org/project/pyHanko/), [API de validação](https://docs.pyhanko.eu/en/latest/api-docs/pyhanko.sign.validation.html). Na implementação, usar versões fixadas e testar as APIs reais; documentação `latest` pode descrever versão de desenvolvimento.
