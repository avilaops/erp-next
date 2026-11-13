"use client"

import { useId } from "react"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  contractChooseGroup,
  contractFieldGroup,
  contractFieldGroups,
  contractFieldIsMultiline,
  contractFieldLabels,
  contractFieldUnits,
  contractFieldValue,
  type ContractDocumentField,
  type ContractFieldUnit,
} from "./contract-fields"

export type ContractDocumentFieldsProps = {
  fields: readonly ContractDocumentField[]
  defaults: Record<string, string>
  values: Record<string, string>
  onChange: (values: Record<string, string>) => void
}

/** Compact controls for document fields; the enclosing command fieldset owns its lock. */
export function ContractDocumentFields({ fields, defaults, values, onChange }: ContractDocumentFieldsProps) {
  const id = useId()
  const large = fields.length >= 40
  const units = contractFieldUnits(fields)
  const fieldValue = (name: string) => contractFieldValue(name, defaults, values)
  const required = (unit: ContractFieldUnit) => unit.fields.some(field => field.required)
  const missing = (unit: ContractFieldUnit) => unit.fields.some(field => field.required && !fieldValue(field.name).trim())
  const locked = (unit: ContractFieldUnit) => unit.kind === "choice"
    ? unit.fields.every(field => Object.hasOwn(defaults, field.name)) || unit.fields.some(field => Object.hasOwn(defaults, field.name) && defaults[field.name] === "X")
    : Object.hasOwn(defaults, unit.fields[0].name)

  function renderUnit(unit: ContractFieldUnit, key: string) {
    const controlId = `${id}-${key}`
    const label = contractFieldLabels[unit.name] || unit.name
    const isRequired = required(unit)
    const isLocked = locked(unit)
    const helpId = isLocked ? `${controlId}-help` : undefined
    if (unit.kind === "choice") {
      const selected = unit.fields.filter(field => fieldValue(field.name) === "X")
      const invalid = selected.length > 1 || unit.fields.some(field => !["", "X"].includes(fieldValue(field.name).trim()))
      return <div key={key} className="min-w-0 space-y-1.5">
        <label className="block break-words text-sm font-medium" htmlFor={controlId}>{label}{isRequired && <span> *</span>}</label>
        <select
          id={controlId}
          className="block h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-base disabled:bg-muted/40 md:text-sm"
          value={selected[0]?.name || ""}
          required={isRequired}
          disabled={isLocked}
          aria-describedby={helpId}
          aria-invalid={invalid || undefined}
          onChange={event => onChange(contractChooseGroup(unit.fields, event.currentTarget.value, defaults, values))}
        >
          <option value="" disabled={isRequired}>{isRequired ? "Selecione uma opção" : "Não informado"}</option>
          {unit.fields.map(field => <option key={field.name} value={field.name} disabled={Object.hasOwn(defaults, field.name) && defaults[field.name] !== "X"}>{field.choiceOption}</option>)}
        </select>
        {isLocked && <p id={helpId} className="text-xs text-muted-foreground">Definido no pedido.</p>}
        {invalid && <p role="alert" className="text-sm text-destructive">Revise a seleção deste grupo.</p>}
      </div>
    }
    const field = unit.fields[0]
    const multiline = contractFieldIsMultiline(field.name)
    const value = fieldValue(field.name)
    const common = {
      id: controlId,
      name: field.name,
      value,
      required: field.required,
      readOnly: isLocked,
      maxLength: 20000,
      "aria-describedby": helpId,
      onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        if (!isLocked) onChange({ ...values, [field.name]: event.currentTarget.value })
      },
    }
    return <div key={key} className={`min-w-0 space-y-1.5 ${multiline ? "md:col-span-2" : ""}`}>
      <label className="block break-words text-sm font-medium" htmlFor={controlId}>{label}{field.required && <span> *</span>}</label>
      {multiline
        ? <Textarea {...common} rows={2} className="min-h-16 resize-y read-only:bg-muted/40" />
        : <Input {...common} type={field.type === "date" ? "date" : field.type === "phone" ? "tel" : "text"} inputMode={/preço|valor|pedido_total/iu.test(field.name) ? "decimal" : undefined} className="read-only:bg-muted/40" />}
      {isLocked && <p id={helpId} className="text-xs text-muted-foreground">{value ? "Preenchido pelo pedido ou proposta." : "Em branco no pedido."}</p>}
    </div>
  }

  function renderSection(title: string, selected: ContractFieldUnit[], key: string, collapsed: boolean) {
    if (!selected.length) return null
    const remaining = selected.filter(missing).length
    const count = `${selected.length} ${selected.length === 1 ? "campo" : "campos"}`
    const content = <div className="grid min-w-0 gap-3 md:grid-cols-2">{selected.map((unit, index) => renderUnit(unit, `${key}-${index}`))}</div>
    if (collapsed) return <details key={key} className="min-w-0 rounded-xl border px-4 py-3">
      <summary className="cursor-pointer break-words text-sm font-medium">{title}<span className="ml-2 font-normal text-muted-foreground">({count})</span></summary>
      <fieldset className="mt-3 min-w-0"><legend className="sr-only">{title}</legend>{content}</fieldset>
    </details>
    return <fieldset key={key} className="min-w-0 space-y-3 rounded-xl border p-4">
      <legend className="max-w-full break-words px-2 text-sm font-medium">{title}</legend>
      <p className="text-xs text-muted-foreground">{count}{remaining ? ` · ${remaining} ${remaining === 1 ? "obrigatório por preencher" : "obrigatórios por preencher"}` : ""}</p>
      {content}
    </fieldset>
  }

  return <div className="min-w-0 space-y-3" aria-label="Campos do contrato">
    {contractFieldGroups.map(group => {
      const selected = units.filter(unit => contractFieldGroup(unit.name) === group.key)
      if (!large) return renderSection(group.title, selected, group.key, false)
      const mandatory = selected.filter(unit => required(unit) && (!locked(unit) || missing(unit)))
      const optional = selected.filter(unit => !required(unit) && !locked(unit))
      const review = selected.filter(unit => locked(unit) && !missing(unit))
      return <div key={group.key} className="min-w-0 space-y-3">
        {renderSection(group.title, mandatory, `${group.key}-required`, false)}
        {renderSection(`${group.title} — informações opcionais`, optional, `${group.key}-optional`, true)}
        {renderSection(`${group.title} — dados do pedido`, review, `${group.key}-review`, true)}
      </div>
    })}
  </div>
}
