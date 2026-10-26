"use client";

import { useState } from "react";
import { Braces, CheckCircle2, Link2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DetailCard, Fact, PurchasingDetailShell } from "./details-shell";

const xmlPreview = `<nfeProc versao="4.00">\n  <NFe>\n    <infNFe Id="NFe352610...8421">\n      <emit><xNome>Aço Rio Preto</xNome></emit>\n      <total><vNF>48320.00</vNF></total>\n    </infNFe>\n  </NFe>\n</nfeProc>`;

export function EntryInvoiceDetail({ id }: { id: string }) {
  const [linked, setLinked] = useState(true);
  const [validated, setValidated] = useState(false);
  return (
    <PurchasingDetailShell
      back="/compras/notas-entrada"
      eyebrow="Compras / Notas de entrada"
      title={`NF-e ${id.toUpperCase()}`}
      description="Leitura demonstrativa do XML, vínculo e divergências. Nenhum documento foi escriturado."
      actions={
        <>
          <Button
            variant="outline"
            onClick={() => setLinked((current) => !current)}
          >
            <Link2 />
            {linked ? "Desvincular pedido" : "Vincular ao PC-00482"}
          </Button>
          <Button onClick={() => setValidated(true)} disabled={validated}>
            <CheckCircle2 />
            Validar localmente
          </Button>
        </>
      }
    >
      {validated && (
        <p
          className="mt-6 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm"
          role="status"
        >
          Estrutura validada somente na interface; nenhum evento fiscal foi
          transmitido.
        </p>
      )}
      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <DetailCard title="Documento">
          <dl className="grid gap-4 sm:grid-cols-2">
            <Fact label="Emitente" value="Aço Rio Preto" />
            <Fact label="CNPJ" value="38.***.***/0001-**" />
            <Fact label="Chave" value="352610…8421" />
            <Fact label="Valor" value="R$ 48.320,00" />
            <Fact
              label="Pedido vinculado"
              value={linked ? "PC-00482" : "Não vinculado"}
            />
            <Fact
              label="Situação"
              value={validated ? "Validada localmente" : "Aguardando validação"}
            />
          </dl>
        </DetailCard>
        <DetailCard title="Conferência">
          <div className="flex gap-3 rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm">
            <TriangleAlert className="size-5 shrink-0 text-amber-700 dark:text-amber-300" />
            <p>
              Frete no XML difere em R$ 120,00 do pedido. Revise antes do
              recebimento.
            </p>
          </div>
          <div className="mt-4 grid gap-2 text-sm">
            <div className="flex justify-between">
              <span>Tubo aço 50 × 50 mm</span>
              <strong>54 un.</strong>
            </div>
            <div className="flex justify-between">
              <span>Valor dos produtos</span>
              <strong>R$ 48.200,00</strong>
            </div>
            <div className="flex justify-between">
              <span>Frete</span>
              <strong>R$ 120,00</strong>
            </div>
          </div>
        </DetailCard>
      </div>
      <DetailCard className="mt-5" title="Prévia segura do XML">
        <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Braces className="size-4" />
          Conteúdo sanitizado e reduzido para demonstração.
        </div>
        <pre
          className="max-w-full overflow-x-auto rounded-xl bg-muted p-4 text-xs leading-6"
          aria-label="Prévia do XML"
        >
          {xmlPreview}
        </pre>
      </DetailCard>
    </PurchasingDetailShell>
  );
}
