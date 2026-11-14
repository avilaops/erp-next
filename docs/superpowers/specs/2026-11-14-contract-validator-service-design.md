# Contratos • Serviço privado de validação

## Continuidade

Implementar o componente 2 de
[assinatura individual](../../telas/servicos/contratos/referencias/ASSINATURA-ICP-INDIVIDUAL.md).
Reutilizar o núcleo e transporte 0.2.0 já integrados. O usuário pediu execução
até o fim e autorizou trabalho de código sem aguardar a hospedagem. As escolhas
de implantação abaixo são do implementador; não representam contratação ou
autorização para iniciar assinatura real.

## Arquitetura

Dois containers de uma mesma imagem: gateway privado com rede e worker sem
rede. O gateway usa aiohttp 3.14.5, já fixado entre as dependências do núcleo,
agora declarado diretamente no serviço. O núcleo matemático não ganha rede.
Comunicação local por socket Unix, diretório de propriedade do worker e
grupo compartilhado; verificar SO_PEERCRED. Não montar banco, vault fiscal,
DocuSeal, socket Docker ou diretório de releases.

O gateway autentica cabeçalhos antes de ler o corpo. Após o frame completo,
repete autenticação/hash e registra a observação UTC. Faz discovery no worker,
obtém evidências num coletor separado e pede validação final offline. Parser e
coletor executam em subprocessos com limites; o supervisor pode matar seu
próprio grupo em timeout, cancelamento ou excesso de saída.

## Obtenção de evidências

- Destinos vêm de AIA/CRL/OCSP dos certificados, mas precisam coincidir com
  regras locais revisadas por origem e prefixo. Não criar regras a partir de
  um PDF recebido. Regras iniciais vêm dos certificados públicos fixados em
  deploy/fiscal, com proveniência registrada; não alteram o trust fiscal.
- Somente HTTP/HTTPS, portas 80/443 padrão, DNS ASCII, sem credenciais, query,
  fragmento, percent-encoding, dot-segments, IP literal, file ou LDAP.
- Resolver antes de conectar; todas as respostas DNS precisam ser públicas.
  Recusar localhost, redes locais/reservadas, multicast, IPs especiais e
  mecanismos IPv6 de transição/tradução. Conectar ao IP literal escolhido e
  conferir peer; HTTPS mantém SNI e validação TLS do nome original. Sem proxies.
- Nenhum redirect ou corpo comprimido. Somente status 200. Até 12 consultas,
  3 s por consulta e 12 s no coletor, até 32 MiB somados: certificado/OCSP
  256 KiB por item, CRL 8 MiB por item. Até 64 certificados, 16 CRLs e 16 OCSPs.
- Hashes e DER não são vereditos. O núcleo confere cadeia, emissor/responder,
  assinatura e freshness offline; ausência ou falha nunca autoriza aceite.
- Discovery e coleta podem ter até duas rodadas, dentro dos mesmos limites.
  Novos emissores/URLs não revisados ficam indeterminados até configuração e
  homologação próprias; não escolher automaticamente raízes enviadas no PDF.

## Isolamento e recursos

- Uma validação ativa por gateway/worker, sem fila ilimitada; ocupado responde 503.
- Leitura do upload até 10 s; execução após observação até 40 s.
- Cada subprocesso PDF: CPU 10/12 s, endereço virtual 768 MiB, saída limitada,
  sem core dump e sem escrita em arquivos; wall time até 15 s por chamada.
- Coletor separado: wall time 12 s, CPU 5/6 s, endereço virtual 512 MiB.
- Worker Linux não root; rootfs read-only, somente loopback na namespace de
  rede, capabilities removidas, no-new-privileges, pids_limit e limites de
  memória/CPU no container. Configuração incompleta falha ao iniciar.
- Encerrar subprocessos próprios e drenar pipes em timeout/cancelamento;
  não deixar coletor DNS ou filho órfão após retorno do pedido.
- Sem PDFs, CPF, subject, headers, tokens, URLs ou diagnósticos de terceiros
  nos logs. Erros externos usam códigos estáveis; métricas só contagem/duração.

## HTTP privado e saída reproduzível

POST /internal/v1/preflight e /internal/v1/increment usam o frame e HMAC
existentes. TLS de servidor é obrigatório no launcher, sem opção de downgrade
por header. Chaves HMAC dedicadas via arquivo de segredo, nunca default.
Health/readiness não revelam configuração ou material do pedido.

A resposta do serviço é um bundle binário versionado, pois DER até 32 MiB não
cabe no relatório JSON de 256 KiB. O JSON canônico autenticado do transporte
anterior continua intacto dentro do bundle. Um MAC externo vincula os bytes
completos ao mesmo contexto. O SDK de leitura verifica ambos antes de consumir.

Formato: magic AVILA-CVB1 LF, uint32 big-endian do cabeçalho ASCII até 32 KiB,
seguido de relatório e partes binárias na ordem declarada. Limite global
40 MiB; relatório até 256 KiB; evidências até 32 MiB; snapshot público de
raízes/intermediárias até 4 MiB. Tipos, tamanhos, contagens, hashes, checkedAt,
trust bundle hash e todos os hashes de evidência usados pelo relatório são
conferidos. Duplicatas, campos extras, cauda e troca de contexto são recusados.

Snapshots de confiança retornados não escolhem confiança: devem corresponder
ao hash aprovado no request/configuração. Fixtures continuam explicitamente
synthetic_not_icp e não entram na imagem. O launcher produtivo não oferece
flag/env para habilitar raízes sintéticas.

O serviço não persiste documentos nem evidências. O futuro workflow ERP deve
guardar o bundle e confirmar seus hashes antes de avançar qualquer head.
Isso preserva reprodução e evita cache/discos locais de retenção indefinida.

## Entrega e limites do objetivo completo

Criar imagem restrita, Compose privado sem portas publicadas e validação
Linux em CI, respeitando os workflows reutilizáveis existentes. Não contratar,
publicar gateway na internet, apontar DNS ou ativar links. Docker local não está
disponível; CI com Docker é evidência obrigatória do isolamento efetivo.

Continuam obrigatórios depois deste serviço: clientes Rust/BFF, congelamento
DocuSeal/política, quotas agregadas, RLS, CAS/leases, sessões/2FA, armazenamento
append-only dos bundles e PDFs, retenção/restauração, release produtivo e
homologação real dos aplicativos e titulares. Interface do ERP permanece em
manutenção até recuperação própria da hospedagem e dados.

## Fontes técnicas

[aiohttp 3.14.5](https://docs.aiohttp.org/en/stable/web_reference.html),
[limites Unix do Python 3.13](https://docs.python.org/3.13/library/resource.html),
[cliente HTTP/TLS do Python](https://docs.python.org/3.13/library/http.client.html).
