# Published icon assets

These are downloaded upstream icon files, not locally drawn approximations or generated icons. Retrieved 2026-09-29.

## Microsoft Fluent Emoji

The menu artwork and phone icon come from [Microsoft Fluent Emoji](https://github.com/microsoft/fluentui-emoji), in its published 3D PNG style. The files are used without edits. The complete MIT license and Microsoft copyright notice are included in [`public/media/icons/LICENSE-fluent-emoji.txt`](../public/media/icons/LICENSE-fluent-emoji.txt).

| Local file | Published source |
| --- | --- |
| `globe.png` | [Upstream PNG](https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Globe%20showing%20americas/3D/globe_showing_americas_3d.png) |
| `app-builder.png` | [Upstream PNG](https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Toolbox/3D/toolbox_3d.png) |
| `connectors.png` | [Upstream PNG](https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Electric%20plug/3D/electric_plug_3d.png) |
| `workflows.png` | [Upstream PNG](https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Gear/3D/gear_3d.png) |
| `marketplace.png` | [Upstream PNG](https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Shopping%20bags/3D/shopping_bags_3d.png) |
| `benchmarks.png` | [Upstream PNG](https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Bar%20chart/3D/bar_chart_3d.png) |
| `conversation.png` | [Upstream PNG](https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Speech%20balloon/3D/speech_balloon_3d.png) |
| `people.png` | [Upstream PNG](https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Busts%20in%20silhouette/3D/busts_in_silhouette_3d.png) |
| `research.png` | [Upstream PNG](https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Magnifying%20glass%20tilted%20left/3D/magnifying_glass_tilted_left_3d.png) |
| `resources.png` | [Upstream PNG](https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Open%20book/3D/open_book_3d.png) |
| `mobile-phone-3d.png` | [Upstream PNG](https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Mobile%20phone/3D/mobile_phone_3d.png) |

## Microsoft Fluent UI System Icons

The browser-use benchmark uses the published **Content View** color SVG from [Microsoft Fluent UI System Icons](https://github.com/microsoft/fluentui-system-icons). This depicts a generic webpage, so it does not attribute the “Previous best” benchmark to a browser vendor. The original blue gradient artwork is used without edits and scales cleanly for both the section emblem and small row icon. This is the official Color icon family, distinct from Fluent Emoji's 3D PNG family.

| Local file | Published source |
| --- | --- |
| `browser.svg` | [Content View, 32 px Color SVG](https://raw.githubusercontent.com/microsoft/fluentui-system-icons/main/assets/Content%20View/SVG/ic_fluent_content_view_32_color.svg) |

The complete MIT license and Microsoft copyright notice are included in [`public/media/icons/LICENSE-fluent-system-icons.txt`](../public/media/icons/LICENSE-fluent-system-icons.txt). Retrieved 2026-09-29.

## Brand logos

Gmail, Google Chrome and Notion use published multicolor SVG artwork from [SVGL](https://github.com/pheralb/svgl). Files are used without path or color edits. SVGL's MIT repository license is included in [`public/media/icons/LICENSE-svgl.txt`](../public/media/icons/LICENSE-svgl.txt). Brand names and marks remain the property of their respective owners; they identify apps in the product integration illustration and do not imply endorsement.

The 21st.dev SVGL search connector returned no results for the three requested names; the exact published files were then retrieved directly from the SVGL repository.

| Local file | Published source |
| --- | --- |
| `gmail.svg` | [Upstream SVG](https://raw.githubusercontent.com/pheralb/svgl/main/static/library/gmail.svg) |
| `chrome.svg` | [Upstream SVG](https://raw.githubusercontent.com/pheralb/svgl/main/static/library/chrome.svg) |
| `notion.svg` | [Upstream SVG](https://raw.githubusercontent.com/pheralb/svgl/main/static/library/notion.svg) |

The Resources menu's Updates link uses the X brand mark from the installed `simple-icons` package (`siX`, source: [X](https://x.com)), saved as `public/media/icons/x.svg` without path edits on September 30, 2026. Simple Icons is distributed under CC0; the X name and mark remain the property of their owner. This mark identifies the actual destination of the link.

## Interface utility icons

Chevron, arrow, menu and close controls continue to use the installed Lucide React library. These standard functional symbols are kept separate from the illustrative menu artwork.

## Design reference lock

The user-supplied Grain navigation video determines the existing menu geometry, frosted panel and interaction. The user's correction determines the use of real icon artwork and an intentional octopus/app composition. Refero's live tool reported an inactive subscription, so its bundled icon craft guidance was used alongside the locked user reference.

| Decision | Source and role |
| --- | --- |
| Preserve the outer navbar and dropdown grid | User's existing navigation reference and explicit scope |
| Use one published 3D artwork family for topics | User's request for real icon assets; Refero icon consistency guidance |
| Use the real octopus plus Gmail, Chrome and Notion logos | Existing Open Swarm branding and requested miniature agent workspace |
| Share the original painted twilight artwork | Current product canvas direction; background media only |
| Keep image treatment inside the feature tile | Preserve the current navigation structure and legibility |

The feature tile links to the existing product tour section. It does not represent a launch video; no launch-video link is included.

## Referral gift artwork

The gift artwork below is retained as an unused asset with its provenance. The latest user correction removed it from both the Share trigger and referral dialog; those controls now use neutral Lucide utility icons.

The earlier Share treatment used Microsoft's published [Wrapped Gift 3D PNG](https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Wrapped%20gift/3D/wrapped_gift_3d.png), saved without editing at `public/media/icons/wrapped-gift-3d.png`. The official source is the [Microsoft Fluent Emoji repository](https://github.com/microsoft/fluentui-emoji). It is a 256×256 transparent PNG, retrieved 2026-09-29, under the existing bundled `LICENSE-fluent-emoji.txt` MIT notice.

SHA-256: `fc9c446401c9fb347f4e9f47e6023247208126047d9ec32059d5e14e127fb562`.

The small octopus is the existing Open Swarm brand asset. Utility copy/check/close/share symbols remain Lucide.
