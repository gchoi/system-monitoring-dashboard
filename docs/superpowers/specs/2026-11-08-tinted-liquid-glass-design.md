# Tinted Liquid Glass theme

## Intent
Apply an Apple Liquid Glass inspired, tinted appearance to the existing real-time monitoring dashboard in both Light and Dark themes. Keep telemetry readable and preserve the current monitoring workflows.

## Approaches
- Shared CSS theme tokens and CSS Modules (recommended): consistently update every surface, chart, control, tooltip, and dialog using the existing stack, with no new styling dependency.
- Restyle only the global panel colors: smaller change, but existing hardcoded dark colors would leave tables, charts, and dialogs inconsistent in Light mode.
- Replace the UI with a component library: adds dependencies and broad structural changes without a benefit for this styling request.

The proposed implementation uses shared CSS theme tokens and the existing CSS Modules.

## Visual design
- Default tint: cool blue with soft lavender highlights; status colors retain their meaning.
- Light: pale blue-gray background, softly tinted translucent surfaces, dark ink text, subtle highlights and shadows.
- Dark: deep blue background, smoky blue translucent surfaces, bright text, restrained reflective edges.
- Glass: layered gradients, backdrop blur and saturation, fine borders, inset highlights, rounded corners, and subtle hover feedback. Use CSS to approximate the material in the browser.
- Typography: system-first sans-serif and monospaced numerical values, with quieter headings and clear information hierarchy.
- Preserve the existing dashboard sections and information density. Extend responsive wrapping to the header and theme control.

## Theme behavior
- Header control: System / Light / Dark, with accessible labels and a visible selected state.
- Default to the operating system theme; remember an explicit selection locally.
- Initialize appearance before paint to avoid a wrong-theme flash; follow operating system changes while System is selected.
- Apply the theme to charts, tooltips, tables, filters, badges, process dialogs, loading, and connection errors.
- Provide visible keyboard focus, reduced-motion support, and a legible fallback when backdrop blur is unavailable.

## Scope and validation
Change frontend presentation and theme state only; preserve real telemetry and process management behavior. No new visual library or generated assets are required.

Verify TypeScript and production compilation, then inspect both themes, persistence, system preference behavior, mobile layout, charts, and dialogs in a browser. Rebuild the running frontend container to make the change visible at localhost:3000.

## Approval
Approved by the user: “알아서 진행해”. Remaining visual and implementation decisions delegated.
