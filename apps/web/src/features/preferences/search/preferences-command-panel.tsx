"use client"

import { useRouter } from "next/navigation"
import { useConfirmNavigation } from "@/components/shell/navigation-guard"
import { navigationDestinations } from "@/components/shell/navigation-catalog"
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"

const categories = [...new Set(navigationDestinations.map(item => item.category))]
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR")

export function PreferencesCommandPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter()
  const confirmNavigation = useConfirmNavigation()
  return <CommandDialog open={open} onOpenChange={onOpenChange} title="Buscar no ERP" description="Encontre módulos, operações e configurações.">
    <Command filter={(value, search, keywords) => {
      const text = normalize([value, ...(keywords ?? [])].join(" "))
      return normalize(search).trim().split(/\s+/).every(word => text.includes(word)) ? 1 : 0
    }}><CommandInput autoFocus placeholder="Buscar título, descrição ou categoria" /><CommandList>
      <CommandEmpty>Nenhum destino encontrado.</CommandEmpty>
      {categories.map(category => <CommandGroup heading={category} key={category}>
        {navigationDestinations.filter(item => item.category === category).map(item => <CommandItem key={item.href} value={item.href} keywords={[item.label, item.keywords]} onSelect={() => {
          if (!confirmNavigation()) return
          onOpenChange(false); router.push(item.href)
        }}><span className="min-w-0"><strong className="block font-medium">{item.label}</strong><small className="block truncate text-xs text-muted-foreground">{item.category}</small></span></CommandItem>)}
      </CommandGroup>)}
    </CommandList></Command>
  </CommandDialog>
}
