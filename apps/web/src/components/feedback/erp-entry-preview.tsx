import Image from "next/image"

export function ErpEntryPreview() {
  return (
    <div className="mt-5 aspect-square overflow-hidden rounded-xl border border-white/20 shadow-xl shadow-black/15">
      <Image
        src="/erp-preview-editorial.png"
        alt="Empreendedora organizando pedidos em seu estoque, com indicadores ilustrativos de produtos e vendas"
        width={1536}
        height={1024}
        sizes="(min-width: 1280px) 510px, (min-width: 1024px) 45vw, (min-width: 640px) 80vw, 90vw"
        className="h-full w-full object-cover"
        loading="eager"
      />
    </div>
  )
}
