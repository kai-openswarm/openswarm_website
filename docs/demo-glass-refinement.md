# Demo glass and application artwork

September 30, 2026 — updated after the email and material refinement pass.

The supplied Open Swarm screenshots remain the primary reference. Keep the existing desktop, agent layout, real application artwork and animation story. Refine the material and feedback without adding new sections, shaders or decorative interactions to the illustrated scenes.

| Detail | Current implementation |
| --- | --- |
| Sidebar | 48px translucent blue-gray glass, down from 56px, with a 4px inset that preserves its center. Original app artwork is 32px inside the existing 38px animation slots. Thin lit edges and a soft lower shadow replace the pale block-like face. |
| Wallpaper | The same twilight artwork, with a brighter, less saturated treatment and a light blue veil. The dot overlay has been removed. |
| Agent panels and launcher | A coordinated blue-gray glass palette, thin highlights, restrained backdrop blur and recessed translucent composers. Labels stay on a sharp foreground. |
| Real controls | Navigation and team tabs use a damped moving highlight and a small press response. Tab changes have short contained transitions and explicit reduced-motion behavior. |
| Loading and signup | Email replaces the country/phone control. Joining keeps the button's width stable, locks repeated submissions, announces progress and shows success only after the API confirms the save. The existing referral confirmation stays intact. |
| Application identity | Original Apple and Open Swarm artwork remains consistent across the dock, launcher and small demos. See [asset sources](app-assets.md). |

## Reference decisions

The six supplied component snippets reduce to four distinct concepts: layered glass, a spring card, a moving glass segment and repeated shader-wave examples. Adapt the layered material, fine rim and restrained press response. Do not introduce the snippets' large distortion, hover padding changes, continuous WebGL rendering or additional dependencies. Thinking dots reuse the existing scene clock, so they still pause offscreen and freeze for reduced motion.

All four Loom recordings were reviewed using sampled actual video frames, with denser samples around interactions:

- [Mistral](https://www.loom.com/share/c23f081e84cb406e91aa65ac6d13d2d7): localized edge and card feedback inside a stable grid.
- [heyclicky](https://www.loom.com/share/9e5172cecbf44720b5623e786158d366): fine luminous rims, small native-window components and contained progress indicators.
- [Nous / Hermes](https://www.loom.com/share/e4191f24a6154c50bf0d036cf3b89ed1): anchored navigation flyouts and compact trigger feedback.
- [Aside](https://www.loom.com/share/0952fc82bbc8482b9971130588200ecc): a light canvas, legible authentic app marks and compact task status rows.

These are material and interaction references, not copied layouts. Samples establish state changes but not exact easing curves. The supplied [Gabriel profile](https://x.com/gabriell_lab) reinforces purposeful feedback and physical continuity; the existing curved app handoff and scene timing remain unchanged.

Refero's live library returned `NO_SUBSCRIPTION`. Its installed design guidance, the user screenshots and supplied references informed the pass. [Apple's material guidance](https://developer.apple.com/documentation/TechnologyOverviews/liquid-glass) informed the earlier glass layering. No new media generation was needed for this pass.

The hero retains its twelve-slot launcher and first-slot Daily Brief target. The smaller app-building scene retains its five existing apps and sixth-slot landing target. The dock's center and vertical slot geometry preserve the cursor choreography.

## Verification

- TypeScript/Vite production build passes; the existing bundle-size advisory remains. Removing phone parsing from the browser reduces the main JS bundle from approximately 785 KB to 665 KB before gzip.
- Lint passes with the existing animation/shared-export warnings.
- Safari checks cover the email field, inline invalid-input state, desktop/mobile success dialog, another-email recovery, and the compact mobile menu. Chrome verifies all four team tabs and keyboard navigation. Safari background rendering paused Motion transitions during the iframe check; Chrome completed them correctly.
- README desktop/mobile demo screenshots are refreshed from the rendered components. Both are frozen at 11.8 seconds for a like-for-like comparison.
- Standard and WebKit-prefixed backdrop filters are included; opaque fallbacks preserve legibility without blur or when reduced transparency is requested.
- Email persistence, duplicates, mixed legacy referrals and SQL migration checks are documented in [production waitlist](production-waitlist.md). Browser signup checks used an isolated temporary store, never the workspace's real signup data.

```text
http://localhost:4310/?scene=hero&t=11.8&w=1280
http://localhost:4310/?scene=hero&t=11.8&w=390
http://localhost:4310/?scene=apps&t=9.6&w=520
```
