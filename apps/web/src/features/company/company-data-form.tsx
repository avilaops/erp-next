"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useNavigationGuard } from "@/components/navigation-guard";
import { Info, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { brazilianStates, companyFields, type CompanyData } from "./company-types";
import { companySections, type CompanySection } from "./company-sections";

const segments = ["Comércio", "E-commerce", "Serviços", "Indústria"];
export function CompanyDataForm({ initial, canEdit, saving, conflict, onSave }: {
  initial: CompanyData;
  canEdit: boolean;
  saving: boolean;
  conflict: boolean;
  onSave: (data: CompanyData) => Promise<boolean>;
}) {
  const initialRegistrations = initial.substituteRegistrations.length
    ? initial.substituteRegistrations.map((registration, index) => ({ ...registration, id: index }))
    : [{ id: 0, state: "", value: "" }];
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [stateRegistrations, setStateRegistrations] = useState(initialRegistrations);
  const [selectedSegments, setSelectedSegments] = useState<string[]>(initial.segments);
  const formRef = useRef<HTMLFormElement>(null);
  const invalidFieldRef = useRef<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null>(null);
  const requestedSection = useSearchParams().get("secao");
  const section: CompanySection = requestedSection && Object.hasOwn(companySections, requestedSection) ? requestedSection as CompanySection : "identificacao";
  useNavigationGuard(dirty ? "Sair e descartar as alterações não salvas da empresa?" : null);

  useEffect(() => {
    const invalidField = invalidFieldRef.current;
    if (invalidField) {
      invalidFieldRef.current = null;
      invalidField.reportValidity();
      invalidField.focus();
      return;
    }
    if (!requestedSection) return;
    const heading = formRef.current?.querySelector<HTMLElement>(`#${companySections[section].heading}`);
    heading?.focus({ preventScroll: true });
    heading?.scrollIntoView({ block: "start" });
  }, [section, requestedSection]);

  function openSection(nextSection: CompanySection) {
    if (nextSection === section) return;
    const url = new URL(window.location.href);
    url.searchParams.set("secao", nextSection);
    url.hash = "";
    window.history.pushState(null, "", url);
  }

  function markDirty() {
    setDirty(true);
    setSaved(false);
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit || saving || conflict) return;
    const invalidField = event.currentTarget.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input:invalid, select:invalid, textarea:invalid");
    if (invalidField) {
      const invalidSection = invalidField.closest<HTMLElement>("[data-company-section]")?.dataset.companySection as CompanySection;
      if (invalidSection !== section) {
        invalidFieldRef.current = invalidField;
        openSection(invalidSection);
      } else {
        invalidField.reportValidity();
        invalidField.focus();
      }
      return;
    }
    if (selectedSegments.length === 0) {
      openSection("fiscal");
      return;
    }
    const form = new FormData(event.currentTarget);
    const fields = Object.fromEntries(companyFields.map((field) => [field, String(form.get(field) || "")]));
    const success = await onSave({ ...fields, segments: selectedSegments, substituteRegistrations: stateRegistrations.filter((registration) => registration.state || registration.value).map(({ state, value }) => ({ state, value })) } as CompanyData);
    if (success) { setDirty(false); setSaved(true); }
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
    setSelectedSegments(initial.segments);
    setDirty(false);
    setSaved(false);
  }

  return (
    <form ref={formRef} className="grid items-start gap-6 md:grid-cols-[220px_minmax(0,1fr)] lg:gap-8" noValidate onChange={markDirty} onSubmit={save}>
      <nav className="overflow-hidden rounded-xl border border-border" aria-label="Seções dos dados da empresa">
        <p className="border-b border-border bg-muted/40 px-4 py-3 text-sm font-semibold">Dados da empresa</p>
        {Object.entries(companySections).map(([key, value]) => <button key={key} type="button" aria-pressed={section === key} aria-controls={value.heading}
          className={`flex min-h-11 w-full items-center border-b border-border px-4 py-3 text-left text-sm transition last:border-b-0 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${section === key ? "bg-primary/10 font-semibold text-primary" : "text-muted-foreground"}`}
          onClick={() => openSection(key as CompanySection)}>{value.label}</button>)}
      </nav>
      <div className="min-w-0 space-y-6">
      <fieldset className="min-w-0 space-y-6" disabled={!canEdit || saving}>

      <section className="form-section" data-company-section="identificacao" hidden={section !== "identificacao"} aria-labelledby="identificacao-title">
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
              defaultValue={initial.legalName}
              required
            />
          </label>
          <label className="field span-2">
            Nome fantasia
            <input name="tradeName" defaultValue={initial.tradeName} />
          </label>
          <label className="field">
            Tipo de pessoa
            <select name="personType" defaultValue={initial.personType}>
              <option value="juridica">Pessoa jurídica</option>
              <option value="fisica">Pessoa física</option>
            </select>
          </label>
          <label className="field">
            CPF ou CNPJ *
            <input name="taxId" defaultValue={initial.taxId} required />
          </label>
        </div>
      </section>

      <section className="form-section" data-company-section="fiscal" hidden={section !== "fiscal"} aria-labelledby="fiscal-title">
        <SectionTitle eyebrow="Fiscal" id="fiscal-title" title="Dados fiscais e atividade" />
        <div className="form-grid">
          <label className="field">
            Inscrição estadual
            <input name="stateRegistration" defaultValue={initial.stateRegistration} />
          </label>
          <label className="field">
            Inscrição municipal
            <input name="municipalRegistration" defaultValue={initial.municipalRegistration} />
          </label>
          <label className="field">
            Inscrição SUFRAMA
            <input name="suframa" defaultValue={initial.suframa} />
          </label>
          <label className="field">
            CNAE
            <input name="cnae" defaultValue={initial.cnae} placeholder="Não informado" />
          </label>
          <label className="field">
            Atividade principal
            <select name="mainActivity" defaultValue={initial.mainActivity}>
              <option value="">Selecione</option>
              <option value="outros">Outros</option>
              <option value="comercio">Comércio</option>
              <option value="servicos">Serviços</option>
            </select>
          </label>
          <label className="field">
            Regime tributário *
            <select name="taxRegime" defaultValue={initial.taxRegime} required>
              <option value="">Selecione</option>
              <option value="simples">Simples Nacional</option>
              <option value="presumido">Lucro Presumido</option>
              <option value="real">Lucro Real</option>
            </select>
          </label>
          <label className="field">
            Porte
            <select name="companySize" defaultValue={initial.companySize}>
              <option value="">Selecione</option>
              <option value="micro">Microempresa</option>
              <option value="pequena">Pequena</option>
              <option value="media">Média</option>
              <option value="grande">Grande</option>
            </select>
          </label>
          <label className="field span-2">
            Descrição da atividade
            <input name="activityDescription" defaultValue={initial.activityDescription} placeholder="Não informado" />
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

      <section className="form-section" data-company-section="endereco" hidden={section !== "endereco"} aria-labelledby="endereco-title">
        <SectionTitle
          eyebrow="Localização"
          id="endereco-title"
          title="Endereço"
        />
        <div className="form-grid">
          <label className="field">
            CEP *<input name="postalCode" defaultValue={initial.postalCode} required />
          </label>
          <label className="field">
            UF *
            <select name="state" defaultValue={initial.state} required>
              <option value="">Selecione</option>
              {brazilianStates.map((state) => <option key={state}>{state}</option>)}
            </select>
          </label>
          <label className="field span-2">
            Cidade *<input name="city" defaultValue={initial.city} required />
          </label>
          <label className="field span-2">
            Endereço *
            <input name="street" defaultValue={initial.street} required />
          </label>
          <label className="field">
            Número *<input name="number" defaultValue={initial.number} required />
          </label>
          <label className="field">
            Bairro *
            <input
              name="district"
              defaultValue={initial.district}
              required
            />
          </label>
          <label className="field span-2">
            Complemento
            <input name="complement" defaultValue={initial.complement} />
          </label>
        </div>
      </section>

      <section className="form-section" data-company-section="contato" hidden={section !== "contato"} aria-labelledby="contato-title">
        <SectionTitle
          eyebrow="Comunicação"
          id="contato-title"
          title="Contato"
        />
        <div className="form-grid">
          <label className="field span-2">
            Pessoa de contato
            <input name="contactName" defaultValue={initial.contactName} />
          </label>
          <label className="field">
            Telefone
            <input name="phone" type="tel" defaultValue={initial.phone} />
          </label>
          <label className="field">
            Celular
            <input name="mobile" type="tel" defaultValue={initial.mobile} placeholder="Não informado" />
          </label>
          <label className="field">
            E-mail
            <input name="email" type="email" defaultValue={initial.email} placeholder="Não informado" />
          </label>
          <label className="field">
            E-mail de cobrança
            <input
              name="billingEmail"
              defaultValue={initial.billingEmail}
              type="email"
              placeholder="Não informado"
            />
          </label>
          <label className="field span-2">
            Site
            <input name="website" type="url" defaultValue={initial.website} placeholder="Não informado" />
          </label>
        </div>
      </section>

      <section className="form-section" data-company-section="inscricoes" hidden={section !== "inscricoes"} aria-labelledby="substitutos-title">
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
                  value={registration.state}
                  onChange={(event) => setStateRegistrations((current) => current.map((item) => item.id === registration.id ? { ...item, state: event.target.value } : item))}
                >
                  <option value="">Selecione</option>
                  {brazilianStates.map((state) => <option key={state}>{state}</option>)}
                </select>
              </label>
              <label className="field">
                <span>Inscrição estadual</span>
                <input aria-label={`Inscrição estadual ${index + 1}`} value={registration.value} onChange={(event) => setStateRegistrations((current) => current.map((item) => item.id === registration.id ? { ...item, value: event.target.value } : item))} />
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

      <div className="form-actions flex-wrap" aria-label="Ações do formulário">
        <span className="mr-auto basis-full text-sm text-muted-foreground sm:basis-auto" role="status" aria-live="polite">
          {saved ? "Alterações salvas no servidor" : dirty ? "Alterações não salvas" : "Nenhuma alteração pendente"}
        </span>
        <Button variant="outline" type="reset" onClick={resetLocalState}>Cancelar</Button>
        <Button type="submit" disabled={!dirty || conflict}>{saving ? "Salvando…" : "Salvar alterações"}</Button>
      </div>

      <aside className="flex gap-3 rounded-2xl border border-primary/20 bg-primary/10 p-4 text-sm text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0 text-primary" />
        <p>
          Os dados são gravados na empresa da sua sessão. Alterações exigem
          permissão e são registradas na auditoria. Uma revisão concorrente
          precisa ser conferida antes de substituir sua edição.
        </p>
      </aside>
      </fieldset>
      </div>
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
      <h2 className="mt-1 scroll-mt-24 text-lg font-semibold focus:outline-2 focus:outline-primary" id={id} tabIndex={-1}>
        {title}
      </h2>
    </div>
  );
}
