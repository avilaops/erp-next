"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export type PartyAddress = { label: string; postalCode: string; state: string; city: string; street: string; number: string; district: string; complement: string | null; primary: boolean }
export type PartyContact = { name: string; role: string | null; email: string | null; phone: string | null; primary: boolean }
const blankAddress: PartyAddress = { label: "", postalCode: "", state: "", city: "", street: "", number: "", district: "", complement: null, primary: false }
const blankContact: PartyContact = { name: "", role: null, email: null, phone: null, primary: false }

export function PartyComplements({ addresses, contacts, onAddresses, onContacts }: { addresses: PartyAddress[]; contacts: PartyContact[]; onAddresses?: (value: PartyAddress[]) => void; onContacts?: (value: PartyContact[]) => void }) {
  if (!onAddresses || !onContacts) return <div className="space-y-5">
    <section><h2 className="font-semibold">Endereços</h2>{!addresses.length && <p>Nenhum endereço informado.</p>}{addresses.map((item, index) => <div className="mt-3 rounded-lg border p-3" key={index}><h3>{item.label}{item.primary ? " · Principal" : ""}</h3><p>{item.street}, {item.number} · {item.district}</p><p>{item.city}/{item.state} · CEP {item.postalCode}</p>{item.complement && <p>{item.complement}</p>}</div>)}</section>
    <section><h2 className="font-semibold">Contatos adicionais</h2>{!contacts.length && <p>Nenhum contato adicional informado.</p>}{contacts.map((item, index) => <div className="mt-3 rounded-lg border p-3" key={index}><h3>{item.name}{item.primary ? " · Principal" : ""}</h3>{item.role && <p>{item.role}</p>}{item.email && <p className="break-all">{item.email}</p>}{item.phone && <p>{item.phone}</p>}</div>)}</section>
  </div>
  return <div className="col-span-full space-y-5">
    <section className="space-y-3"><h2 className="font-semibold">Endereços</h2><p className="text-sm text-muted-foreground">Até dez endereços declarados, com um principal. Nenhuma consulta automática de CEP.</p>
      {addresses.map((item, index) => <fieldset className="grid gap-3 rounded-xl border p-4 sm:grid-cols-2" key={index}><legend className="px-2">Endereço {index + 1}</legend>
        {([ ["label", "Identificação", 80], ["postalCode", "CEP", 12], ["state", "UF", 2], ["city", "Cidade", 200], ["street", "Rua", 200], ["number", "Número", 40], ["district", "Bairro", 200], ["complement", "Complemento", 200] ] as const).map(([field, label, max]) => <label className="space-y-2" key={field}>{label}<Input aria-label={`Endereço ${index + 1}: ${label}`} maxLength={max} required={field !== "complement"} value={item[field] || ""} onChange={event => onAddresses(addresses.map((value, position) => position === index ? { ...value, [field]: event.target.value } : value))} /></label>)}
        <label className="flex items-center gap-2"><input type="checkbox" aria-label={`Endereço ${index + 1}: Principal`} checked={item.primary} onChange={event => onAddresses(addresses.map((value, position) => ({ ...value, primary: position === index ? event.target.checked : event.target.checked ? false : value.primary })))} />Principal</label>
        <Button type="button" variant="outline" onClick={() => onAddresses(addresses.filter((_, position) => position !== index))}>Remover endereço {index + 1}</Button>
      </fieldset>)}
      <Button type="button" variant="outline" disabled={addresses.length >= 10} onClick={() => onAddresses([...addresses, { ...blankAddress }])}>Adicionar endereço</Button>
    </section>
    <section className="space-y-3"><h2 className="font-semibold">Contatos adicionais</h2><p className="text-sm text-muted-foreground">Até dez contatos, com um principal. Informe e-mail ou telefone; salvar não envia mensagens.</p>
      {contacts.map((item, index) => <fieldset className="grid gap-3 rounded-xl border p-4 sm:grid-cols-2" key={index}><legend className="px-2">Contato {index + 1}</legend>
        {([ ["name", "Nome", 200], ["role", "Área ou cargo", 80], ["email", "E-mail", 254], ["phone", "Telefone", 40] ] as const).map(([field, label, max]) => <label className="space-y-2" key={field}>{label}<Input aria-label={`Contato ${index + 1}: ${label}`} maxLength={max} type={field === "email" ? "email" : "text"} required={field === "name"} value={item[field] || ""} onChange={event => onContacts(contacts.map((value, position) => position === index ? { ...value, [field]: event.target.value } : value))} /></label>)}
        <label className="flex items-center gap-2"><input type="checkbox" aria-label={`Contato ${index + 1}: Principal`} checked={item.primary} onChange={event => onContacts(contacts.map((value, position) => ({ ...value, primary: position === index ? event.target.checked : event.target.checked ? false : value.primary })))} />Principal</label>
        <Button type="button" variant="outline" onClick={() => onContacts(contacts.filter((_, position) => position !== index))}>Remover contato {index + 1}</Button>
      </fieldset>)}
      <Button type="button" variant="outline" disabled={contacts.length >= 10} onClick={() => onContacts([...contacts, { ...blankContact }])}>Adicionar contato</Button>
    </section>
  </div>
}
