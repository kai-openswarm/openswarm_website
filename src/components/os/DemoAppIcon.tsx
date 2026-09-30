import { APP_ASSETS, type AppAssetId } from '@/lib/app-assets'
import { media } from '@/lib/utils'

/** Preserve original artwork; compensate only for Apple's built-in transparent margin. */
export function DemoAppIcon({ asset, size = 38 }: { asset: AppAssetId; size?: number }) {
  const app = APP_ASSETS[asset]
  const native = app.kind === 'native'
  const extent = native ? size * 1.2 : size
  return (
    <span title={app.title} className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <img
        src={media(app.src)}
        alt=""
        aria-hidden="true"
        draggable={false}
        width={app.width}
        height={app.height}
        className="pointer-events-none block max-w-none select-none object-contain"
        style={{ width: extent, height: extent, borderRadius: native ? undefined : size * 0.24, filter: 'drop-shadow(0 2px 2px rgb(0 0 0 / 12%))' }}
      />
    </span>
  )
}
