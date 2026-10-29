"use client"

import { useRouter } from "next/navigation"
import { useConfirmNavigation } from "@/components/navigation-guard"
import { navigationDestinations } from "@/components/navigation-catalog"
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"

const categories = [...new Set(navigationDestinations.map(item => item.category))]

export function PreferencesCommandPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter()
  const confirmNavigation = useConfirmNavigation()
  return <CommandDialog open={open} onOpenChange={onOpenChange} title="Buscar no ERP" description="Encontre módulos, operações e configurações.">
    <Command><CommandInput autoFocus placeholder="Buscar título, descrição ou categoria" /><CommandList>
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
