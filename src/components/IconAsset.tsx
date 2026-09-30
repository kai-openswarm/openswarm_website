import { cn, media } from '@/lib/utils'

const iconFiles = {
  globe: 'globe.png',
  'app-builder': 'app-builder.png',
  connectors: 'connectors.png',
  workflows: 'workflows.png',
  marketplace: 'marketplace.png',
  benchmarks: 'benchmarks.png',
  conversation: 'conversation.png',
  people: 'people.png',
  research: 'research.png',
  resources: 'resources.png',
  gmail: 'gmail.svg',
  chrome: 'chrome.svg',
  notion: 'notion.svg',
  x: 'x.svg',
} as const

export type IconAssetName = keyof typeof iconFiles

/** Published icon artwork; provenance is in docs/icon-sources.md. */
export function IconAsset({ name, className, alt = '' }: { name: IconAssetName; className?: string; alt?: string }) {
  return (
    <img
      src={media(`icons/${iconFiles[name]}`)}
      alt={alt}
      aria-hidden={alt ? undefined : true}
      width={24}
      height={24}
      draggable={false}
      className={cn('h-6 w-6 shrink-0 object-contain', className)}
    />
  )
}
