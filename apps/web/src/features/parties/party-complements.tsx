"use client"

import { useEffect, useId, useState } from "react"
import { erpFetch } from "@/lib/api/client"
import type { Schema } from "@/lib/api/types"
import { municipalityMatchesAddress } from "@/lib/municipality-code"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { RegistryLookup } from "@/features/records/registry-lookup"

export type PartyAddress = Schema<"PartyAddress"> & { municipalityCode?: string | null }
export type PartyContact = Schema<"PartyContact">
const blankAddress: PartyAddress = {
  label: "",
  postalCode: "",
  state: "",
  city: "",
  street: "",
  number: "",
  district: "",
  complement: null,
  primary: false
}
const blankContact: PartyContact = { name: "", role: null, email: null, phone: null, primary: false }

export function PartyComplements({
  addresses,
  contacts,
  onAddresses,
  onContacts,
  tenantId
}: {
  addresses: PartyAddress[]
  contacts: PartyContact[]
  onAddresses?: (value: PartyAddress[]) => void
  onContacts?: (value: PartyContact[]) => void
  tenantId?: string
}) {
  const listId = useId()
  const editing = !!onContacts
  const [contactTypes, setContactTypes] = useState<string[]>([])
  useEffect(() => {
    const controller = new AbortController()
    if (editing)
      erpFetch("/api/erp/registration-settings/contact-types", {
        cache: "no-store",
        signal: controller.signal
      })
        .then(async (response) => {
          if (!response.ok) return
          const value = await response.json()
          if (
            !controller.signal.aborted &&
            Array.isArray(value.data?.labels) &&
            value.data.labels.every((label: unknown) => typeof label === "string")
          )
            setContactTypes(value.data.labels)
        })
        .catch(() => {})
    return () => controller.abort()
  }, [editing])
  if (!onAddresses || !onContacts)
    return (
      <div className="space-y-5">
        <section>
          <h2 className="font-semibold">Endereços</h2>
          {!addresses.length && <p>Nenhum endereço informado.</p>}
          {addresses.map((item, index) => (
            <div className="mt-3 rounded-lg border p-3" key={index}>
              <h3>
                {item.label}
                {item.primary ? " · Principal" : ""}
              </h3>
              <p>
                {item.street}, {item.number} · {item.district}
              </p>
              <p>
                {item.city}/{item.state} · CEP {item.postalCode}
              </p>
              {item.municipalityCode && <p>Código IBGE: {item.municipalityCode}</p>}
              {item.complement && <p>{item.complement}</p>}
            </div>
          ))}
        </section>
        <section>
          <h2 className="font-semibold">Contatos adicionais</h2>
          {!contacts.length && <p>Nenhum contato adicional informado.</p>}
          {contacts.map((item, index) => (
            <div className="mt-3 rounded-lg border p-3" key={index}>
              <h3>
                {item.name}
                {item.primary ? " · Principal" : ""}
              </h3>
              {item.role && <p>{item.role}</p>}
              {item.email && <p className="break-all">{item.email}</p>}
              {item.phone && <p>{item.phone}</p>}
            </div>
          ))}
        </section>
      </div>
    )
  return (
    <div className="col-span-full space-y-3">
      <section className="space-y-2 border-t pt-2">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">Endereços</h2><Button type="button" variant="outline" className="h-9 px-3" disabled={addresses.length >= 10} onClick={() => onAddresses([...addresses, { ...blankAddress }])}>Adicionar endereço</Button></div>
        <p className="text-sm text-muted-foreground">
          Opcional · até dez endereços, com um principal.
        </p>
        {addresses.map((item, index) => (
          <fieldset className="grid min-w-0 grid-cols-2 gap-2 rounded-lg border p-2" key={index}>
            <legend className="px-2">Endereço {index + 1}</legend>
            {(
              [
                ["label", "Identificação", 80],
                ["postalCode", "CEP", 12],
                ["state", "UF", 2],
                ["city", "Cidade", 200],
                ["municipalityCode", "Código IBGE", 7],
                ["street", "Rua", 200],
                ["number", "Número", 40],
                ["district", "Bairro", 200],
                ["complement", "Complemento", 200]
              ] as const
            ).map(([field, label, max]) => (
              <label className={`min-w-0 space-y-1 ${field === "street" || field === "complement" ? "col-span-2" : ""}`} key={field}>
                {label}
                <Input
                  aria-label={`Endereço ${index + 1}: ${label}`}
                  maxLength={max}
                  required={field !== "complement" && field !== "municipalityCode"}
                  value={item[field] || ""}
                  onChange={(event) =>
                    onAddresses(
                      addresses.map((value, position) =>
                        position === index ? { ...value, [field]: event.target.value, ...(["state", "city", "postalCode"].includes(field) ? { municipalityCode: null } : {}) } : value
                      )
                    )
                  }
                />
              </label>
            ))}
            {tenantId && (
              <RegistryLookup
                kind="cep"
                context="party"
                tenantId={tenantId}
                readValue={() => item.postalCode}
                onApply={(fields) => {
                  let count = 0
                  onAddresses(
                    addresses.map((value, position) => {
                      if (position !== index) return value
                      const updated = { ...value }
                      for (const field of ["state", "city", "street", "district"] as const) {
                        if (!updated[field].trim() && fields[field]) {
                          updated[field] = fields[field]
                          count++
                        }
                      }
                      if (!updated.municipalityCode?.trim() && municipalityMatchesAddress(fields, updated)) {
                        updated.municipalityCode = fields.municipalityCode
                        count++
                      }
                      return updated
                    })
                  )
                  return count
                }}
              />
            )}
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                aria-label={`Endereço ${index + 1}: Principal`}
                checked={item.primary}
                onChange={(event) =>
                  onAddresses(
                    addresses.map((value, position) => ({
                      ...value,
                      primary:
                        position === index
                          ? event.target.checked
                          : event.target.checked
                            ? false
                            : value.primary
                    }))
                  )
                }
              />
              Principal
            </label>
            <Button
              type="button"
              variant="outline"
              onClick={() => onAddresses(addresses.filter((_, position) => position !== index))}
            >
              Remover endereço {index + 1}
            </Button>
          </fieldset>
        ))}
      </section>
      <datalist id={listId}>
        {contactTypes.map((label) => (
          <option key={label} value={label} />
        ))}
      </datalist>
      <section className="space-y-2 border-t pt-2">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">Contatos adicionais</h2><Button type="button" variant="outline" className="h-9 px-3" disabled={contacts.length >= 10} onClick={() => onContacts([...contacts, { ...blankContact }])}>Adicionar contato</Button></div>
        <p className="text-sm text-muted-foreground">
          Opcional · informe e-mail ou telefone.
        </p>
        {contacts.map((item, index) => (
          <fieldset className="grid min-w-0 grid-cols-2 gap-2 rounded-lg border p-2" key={index}>
            <legend className="px-2">Contato {index + 1}</legend>
            {(
              [
                ["name", "Nome", 200],
                ["role", "Área ou cargo", 80],
                ["email", "E-mail", 254],
                ["phone", "Telefone", 40]
              ] as const
            ).map(([field, label, max]) => (
              <label className={`min-w-0 space-y-1 ${field === "name" || field === "email" ? "col-span-2" : ""}`} key={field}>
                {label}
                <Input
                  list={field === "role" ? listId : undefined}
                  aria-label={`Contato ${index + 1}: ${label}`}
                  maxLength={max}
                  type={field === "email" ? "email" : "text"}
                  required={field === "name"}
                  value={item[field] || ""}
                  onChange={(event) =>
                    onContacts(
                      contacts.map((value, position) =>
                        position === index ? { ...value, [field]: event.target.value } : value
                      )
                    )
                  }
                />
              </label>
            ))}
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                aria-label={`Contato ${index + 1}: Principal`}
                checked={item.primary}
                onChange={(event) =>
                  onContacts(
                    contacts.map((value, position) => ({
                      ...value,
                      primary:
                        position === index
                          ? event.target.checked
                          : event.target.checked
                            ? false
                            : value.primary
                    }))
                  )
                }
              />
              Principal
            </label>
            <Button
              type="button"
              variant="outline"
              onClick={() => onContacts(contacts.filter((_, position) => position !== index))}
            >
              Remover contato {index + 1}
            </Button>
          </fieldset>
        ))}
      </section>
    </div>
  )
}
