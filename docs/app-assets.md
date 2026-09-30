# Demo application artwork

The application icons in `public/media/apps/` use original installed application resources, with a separate original illustration for the demo-created Daily Brief app. The registry is `src/lib/app-assets.ts`.

## Apple application icons

Messages, FaceTime and Calendar were exported from each installed macOS application's `Contents/Resources/AppIcon.icns`. Safari uses its application bundle's `Contents/Resources/AppIcon.icns`; Finder uses `Finder.app/Contents/Resources/Finder.icns`.

The exports are 256 × 256 PNGs, retain transparency and the original artwork, and are intended only to identify the corresponding application in the product demo. Apple application names and artwork remain the property of Apple. No endorsement is implied.

The native icon canvases include the original optical padding. The UI may scale these canvases slightly to align their visible bounds with the full-bleed custom app tiles.

## AI application icons

The ChatGPT and Claude sidebar icons were exported from original installed application resources on September 30, 2026. The 256 × 256 PNGs preserve the source artwork and transparent optical padding. ChatGPT uses `ChatGPT.app/Contents/Resources/icon-chatgpt.icns`; Claude uses `Claude.app/Contents/Resources/electron.icns`, the icon selected by its application manifest. The corresponding artwork remains the property of OpenAI and Anthropic.

These two apps replace the Books shortcut in the demo's existing rail. The rail remains centered, and the pointer's app-launcher target follows its new position.

## Open Swarm application icons

These files were copied without alteration from the installed Open Swarm application workspaces, using the icon filename selected in each application's `meta.json`. Their artwork matches the app launcher supplied as the design reference.

| App | Original resource | Dimensions |
| --- | --- | --- |
| CRM Core | `icon.webp` | 512 × 512 |
| Lead Finder | `icon.png` | 124 × 124 |
| Problem Validator | `icon.webp` | 464 × 459 |
| Post Harvester | `icon.webp` | 512 × 512 |
| Social Footprint Finder | `icon.webp` | 512 × 512 |
| Skill Editor | `icon.webp` | 128 × 128 |
| Style Guide Extractor | `icon.webp` | 104 × 104 |
| Git Graph | `icon.webp` | 105 × 105 |
| Analytics Refresh | `icon.webp` | 128 × 128 |
| Akira | `icon.svg` | 64 × 64 viewBox |

## Daily Brief demo app

Daily Brief is the app created within the demonstration. Its custom icon (`daily-brief.webp`) was generated with Higgsfield's `gpt_image_2_5` model on September 30, 2026. It is original synthetic artwork for this fictional demo app, not an Apple icon or an installed application asset. The 1024 × 1024 source was resized to a 256 × 256 WebP for delivery.
