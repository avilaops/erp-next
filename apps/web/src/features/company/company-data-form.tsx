"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { ImagePlus, Info, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

const segments = ["Comércio", "E-commerce", "Serviços", "Indústria"];
const initialRegistrations = [{ id: 1, state: "", value: "" }];

export function CompanyDataForm() {
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [stateRegistrations, setStateRegistrations] = useState(initialRegistrations);
  const [selectedSegments, setSelectedSegments] = useState<string[]>(["Comércio"]);

  useEffect(() => {
    const preventLoss = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", preventLoss);
    return () => window.removeEventListener("beforeunload", preventLoss);
  }, [dirty]);

  function markDirty() {
    setDirty(true);
    setSaved(false);
  }

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDirty(false);
    setSaved(true);
  }

  function addRegistration() {
    setStateRegistrations((current) => [
      ...current,
      { id: Date.now(), state: "", value: "" },
    ]);
    markDirty();
  }

  function removeRegistration(id: number) {
    setStateRegistrations((current) =>
      current.filter((item) => item.id !== id),
    );
    markDirty();
  }

  function resetLocalState() {
    setStateRegistrations(initialRegistrations);
    setSelectedSegments(["Comércio"]);
    setDirty(false);
    setSaved(false);
  }

  return (
    <form className="space-y-6" onChange={markDirty} onSubmit={save}>
      <div className="form-actions flex-wrap" aria-label="Ações do formulário">
        <span
          className="mr-auto basis-full text-sm text-muted-foreground sm:basis-auto"
          role="status"
          aria-live="polite"
        >
          {saved
            ? "Alterações salvas localmente"
            : dirty
              ? "Alterações não salvas"
              : "Nenhuma alteração pendente"}
        </span>
        <Button
          variant="outline"
          type="reset"
          onClick={resetLocalState}
        >
          Cancelar
        </Button>
        <Button type="submit" disabled={!dirty || selectedSegments.length === 0}>
          Salvar alterações
        </Button>
      </div>

      <section className="form-section" aria-labelledby="identificacao-title">
        <SectionTitle
          eyebrow="Identificação"
          id="identificacao-title"
          title="Dados cadastrais"
        />
        <div className="form-grid">
          <label className="field span-2">
            Nome empresarial *
            <input
              name="legalName"
              defaultValue="LUDUS EQUIPAMENTOS PARA MUSCULAÇÃO LTDA"
              required
            />
          </label>
          <label className="field span-2">
            Nome fantasia
            <input name="tradeName" defaultValue="Ludus Equipamentos" />
          </label>
          <label className="field">
            Tipo de pessoa
            <select name="personType" defaultValue="juridica">
              <option value="juridica">Pessoa jurídica</option>
              <option value="fisica">Pessoa física</option>
            </select>
          </label>
          <label className="field">
            CNPJ *
            <input name="taxId" defaultValue="66.058.955/0001-08" required />
          </label>
          <label className="field">
            Inscrição estadual
            <input name="stateRegistration" defaultValue="718.319.130.117" />
          </label>
          <label className="field">
            Inscrição municipal
            <input name="municipalRegistration" />
          </label>
          <label className="field">
            Inscrição SUFRAMA
            <input name="suframa" />
          </label>
          <label className="field">
            CNAE
            <input name="cnae" placeholder="Não informado" />
          </label>
          <label className="field">
            Atividade principal
            <select name="mainActivity" defaultValue="">
              <option value="">Selecione</option>
              <option value="outros">Outros</option>
              <option value="comercio">Comércio</option>
              <option value="servicos">Serviços</option>
            </select>
          </label>
          <label className="field">
            Regime tributário *
            <select name="taxRegime" defaultValue="" required>
              <option value="">Selecione</option>
              <option value="simples">Simples Nacional</option>
              <option value="presumido">Lucro Presumido</option>
              <option value="real">Lucro Real</option>
            </select>
          </label>
          <label className="field">
            Porte
            <select name="companySize" defaultValue="">
              <option value="">Selecione</option>
              <option value="micro">Microempresa</option>
              <option value="pequena">Pequena</option>
              <option value="media">Média</option>
              <option value="grande">Grande</option>
            </select>
          </label>
          <label className="field span-2">
            Descrição da atividade
            <input name="activityDescription" placeholder="Não informado" />
          </label>
        </div>
        <fieldset className="mt-5">
          <legend className="mb-3 text-sm font-medium">Segmentos *</legend>
          <div className="flex flex-wrap gap-3">
            {segments.map((segment) => (
              <label className="check-card" key={segment}>
                <input
                  checked={selectedSegments.includes(segment)}
                  name="segments"
                  type="checkbox"
                  onChange={(event) => {
                    setSelectedSegments((current) =>
                      event.target.checked
                        ? [...current, segment]
                        : current.filter((item) => item !== segment),
                    );
                    markDirty();
                  }}
                />
                {segment}
              </label>
            ))}
          </div>
          {selectedSegments.length === 0 && (
            <p className="mt-2 text-sm text-destructive" role="alert">
              Selecione ao menos um segmento.
            </p>
          )}
        </fieldset>
      </section>

      <section className="form-section" aria-labelledby="endereco-title">
        <SectionTitle
          eyebrow="Localização"
          id="endereco-title"
          title="Endereço"
        />
        <div className="form-grid">
          <label className="field">
            CEP *<input name="postalCode" defaultValue="15.505-058" required />
          </label>
          <label className="field">
            UF *
            <select name="state" defaultValue="SP" required>
              <option>SP</option>
              <option>MG</option>
              <option>PR</option>
              <option>RJ</option>
            </select>
          </label>
          <label className="field span-2">
            Cidade *<input name="city" defaultValue="Votuporanga" required />
          </label>
          <label className="field span-2">
            Endereço *
            <input name="street" defaultValue="Rua Copacabana" required />
          </label>
          <label className="field">
            Número *<input name="number" defaultValue="4108" required />
          </label>
          <label className="field">
            Bairro *
            <input
              name="district"
              defaultValue="Parque Santa Felícia"
              required
            />
          </label>
          <label className="field span-2">
            Complemento
            <input name="complement" />
          </label>
        </div>
      </section>

      <section className="form-section" aria-labelledby="contato-title">
        <SectionTitle
          eyebrow="Comunicação"
          id="contato-title"
          title="Contato"
        />
        <div className="form-grid">
          <label className="field span-2">
            Pessoa de contato
            <input name="contactName" />
          </label>
          <label className="field">
            Telefone
            <input name="phone" type="tel" />
          </label>
          <label className="field">
            Celular
            <input name="mobile" type="tel" placeholder="Não informado" />
          </label>
          <label className="field">
            E-mail
            <input name="email" type="email" placeholder="Não informado" />
          </label>
          <label className="field">
            E-mail de cobrança
            <input
              name="billingEmail"
              type="email"
              placeholder="Não informado"
            />
          </label>
          <label className="field span-2">
            Site
            <input name="website" type="url" placeholder="Não informado" />
          </label>
        </div>
      </section>

      <section className="form-section" aria-labelledby="substitutos-title">
        <SectionTitle
          eyebrow="Fiscal"
          id="substitutos-title"
          title="Inscrições estaduais substitutas"
        />
        <div className="space-y-3">
          {stateRegistrations.map((registration, index) => (
            <div className="registration-row" key={registration.id}>
              <label className="field">
                <span>Estado {index + 1}</span>
                <select
                  aria-label={`Estado da inscrição ${index + 1}`}
                  defaultValue=""
                >
                  <option value="">Selecione</option>
                  <option>SP</option>
                  <option>MG</option>
                  <option>PR</option>
                  <option>RJ</option>
                </select>
              </label>
              <label className="field">
                <span>Inscrição estadual</span>
                <input aria-label={`Inscrição estadual ${index + 1}`} />
              </label>
              <Button
                aria-label={`Excluir inscrição ${index + 1}`}
                variant="ghost"
                size="icon"
                type="button"
                onClick={() => removeRegistration(registration.id)}
                disabled={stateRegistrations.length === 1}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
        </div>
        <Button
          className="mt-4"
          variant="outline"
          type="button"
          onClick={addRegistration}
        >
          <Plus />
          Adicionar inscrição
        </Button>
      </section>

      <section className="form-section" aria-labelledby="marca-title">
        <SectionTitle
          eyebrow="Identidade visual"
          id="marca-title"
          title="Marca da empresa"
        />
        <div className="brand-upload">
          <span className="brand-preview">
            <Image
              alt="Logotipo Ludus"
              height={72}
              src="/brand/ludus-wordmark.png"
              width={200}
            />
          </span>
          <div className="min-w-0 flex-1">
            <strong className="block text-sm">Ludus Equipamentos</strong>
            <p className="mt-1 text-sm text-muted-foreground">
              PNG, JPEG ou WebP. Resolução mínima de 120 × 56 pixels.
            </p>
          </div>
          <Button variant="outline" type="button" onClick={markDirty}>
            <ImagePlus />
            Alterar imagem
          </Button>
        </div>
      </section>

      <aside className="flex gap-3 rounded-2xl border border-primary/20 bg-primary/10 p-4 text-sm text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0 text-primary" />
        <p>
          Esta interface usa dados simulados. O botão salvar demonstra o estado
          do frontend; nenhuma informação é enviada ou persistida até a
          integração com o backend.
        </p>
      </aside>
    </form>
  );
}

function SectionTitle({
  eyebrow,
  id,
  title,
}: {
  eyebrow: string;
  id: string;
  title: string;
}) {
  return (
    <div className="mb-5">
      <p className="text-sm font-medium text-primary">{eyebrow}</p>
      <h2 className="mt-1 text-lg font-semibold" id={id}>
        {title}
      </h2>
    </div>
  );
}
