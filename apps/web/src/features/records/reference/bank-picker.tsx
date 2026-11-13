"use client"

import Image from "next/image"
import { useEffect, useId, useRef, useState } from "react"
import { Landmark } from "lucide-react"
import { Input } from "@/components/ui/input"
import { identifyBank, searchBanks, type Bank } from "./bank-catalog"

function BankLogo({ bank }: { bank?: Bank }) {
  const [failed, setFailed] = useState(false)
  const dark = bank && ["ifood-pago", "uzzipay", "zemo-bank"].includes(bank.id)
  return <span aria-hidden="true" className={`flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md border p-1 ${dark ? "border-slate-700 bg-slate-800" : "border-slate-200 bg-white"}`}>
    {bank?.logo && !failed ? <Image unoptimized src={bank.logo} alt="" width={28} height={28} className="size-7 object-contain" onError={() => setFailed(true)} /> : <Landmark className="size-5 text-slate-500" />}
  </span>
}

export function BankIdentity({ value }: { value: string }) {
  const bank = identifyBank(value)
  return <span className="flex min-w-0 items-center gap-2"><BankLogo key={bank?.id || "manual"} bank={bank} /><span className="min-w-0 break-words">{value}{bank?.code && <span className="ml-1 text-xs text-muted-foreground">· {bank.code}</span>}</span></span>
}

export function BankPicker({ value, onChange, disabled = false }: { value: string | null; onChange: (value: string | null) => void; disabled?: boolean }) {
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const text = value || ""
  const matches = searchBanks(text)
  const bank = identifyBank(text)
  const hasManual = !!text.trim()
  const count = matches.length + Number(hasManual)
  const expanded = open && !disabled
  const activeId = expanded && active >= 0 && active < count ? `${id}-option-${active}` : undefined

  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: "nearest" })
  }, [activeId])

  function close() { setOpen(false); setActive(-1) }
  function choose(index: number) {
    const option = matches[index]
    if (option) onChange(option.name)
    close()
    input.current?.focus()
  }

  return <div className="relative min-w-0 space-y-2" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) close() }}>
    <label htmlFor={id} className="block text-sm">Banco</label>
    <Input ref={input} id={id} role="combobox" aria-autocomplete="list" aria-expanded={expanded} aria-controls={expanded ? `${id}-list` : undefined} aria-activedescendant={activeId} aria-describedby={`${id}-help`} autoComplete="off" maxLength={100} disabled={disabled} value={text} placeholder="Busque por nome ou código" style={{ height: 44, minHeight: 44 }}
      onFocus={() => setOpen(true)} onClick={() => setOpen(true)}
      onChange={event => { onChange(event.target.value || null); setOpen(true); setActive(-1) }}
      onKeyDown={event => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault()
          setOpen(true)
          setActive(previous => count ? event.key === "ArrowDown" ? (previous + 1) % count : (previous <= 0 ? count : previous) - 1 : -1)
        } else if (expanded && active >= 0 && (event.key === "Home" || event.key === "End")) {
          event.preventDefault(); setActive(event.key === "Home" ? 0 : count - 1)
        } else if (expanded && event.key === "Enter") {
          event.preventDefault()
          if (active >= 0 && active < count) choose(active)
          else close()
        } else if (event.key === "Escape" && expanded) {
          event.preventDefault(); event.stopPropagation(); close()
        } else if (event.key === "Tab") close()
      }} />
    <p id={`${id}-help`} className="text-xs text-muted-foreground">Selecione um banco ou mantenha o nome digitado manualmente.</p>
    {expanded && <div className="absolute inset-x-0 top-[4.5rem] z-30 min-w-0 rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg">
      <p role="status" className="px-2 py-1 text-xs text-muted-foreground">{matches.length ? `${matches.length} banco(s) encontrado(s)` : "Nenhum banco encontrado. Você pode manter o nome digitado."}</p>
      <ul id={`${id}-list`} role="listbox" aria-label="Bancos" className="max-h-72 min-w-0 overflow-y-auto overscroll-contain">
        {matches.map((option, index) => <li id={`${id}-option-${index}`} key={option.id} role="option" aria-selected={bank?.id === option.id} className={`flex min-h-11 min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm ${active === index ? "bg-accent text-accent-foreground outline outline-1 outline-primary" : "hover:bg-accent"}`} onMouseDown={event => event.preventDefault()} onMouseMove={() => setActive(index)} onClick={() => choose(index)}>
          <BankLogo bank={option} /><span className="min-w-0 flex-1 break-words">{option.name}</span>{option.code && <span className="shrink-0 font-mono text-xs">{option.code}</span>}
        </li>)}
        {hasManual && <li id={`${id}-option-${matches.length}`} role="option" aria-selected={!bank} className={`flex min-h-11 min-w-0 cursor-pointer items-center rounded-md border-t px-2 py-2 text-sm break-words ${active === matches.length ? "bg-accent text-accent-foreground outline outline-1 outline-primary" : "hover:bg-accent"}`} onMouseDown={event => event.preventDefault()} onMouseMove={() => setActive(matches.length)} onClick={() => choose(matches.length)}><span className="min-w-0 break-words">Manter nome digitado: {text}</span></li>}
      </ul>
    </div>}
    {text && <div className="rounded-md border bg-muted/30 p-2 text-sm"><BankIdentity value={text} /></div>}
  </div>
}
