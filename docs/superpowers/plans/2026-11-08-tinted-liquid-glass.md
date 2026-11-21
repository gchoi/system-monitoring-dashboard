# Tinted Liquid Glass Implementation Plan

> Execute inline using superpowers:executing-plans. User delegated remaining decisions and execution.

**Goal:** Tinted Liquid Glass dashboard with System / Light / Dark appearance.
**Architecture:** Shared CSS tokens and existing CSS Modules; early inline theme initialization and a small client theme control.
**Tech Stack:** Next.js 14, React, TypeScript, CSS Modules, Recharts.
**Spec:** docs/superpowers/specs/2026-11-08-tinted-liquid-glass-design.md

## Global constraints
Preserve monitoring behavior, real telemetry, and existing dependencies. Local deployment only.

## Review focus
Storage denied must not disable theme switching. Invalid stored settings fall back to System. System changes apply only in System mode. Light charts and dialogs need readable colors. Narrow viewports must not overflow.

### Task 1: Theme lifecycle
- [x] Implement `frontend/src/components/ThemeControl.tsx`, its CSS Module, and `frontend/src/theme.ts`; initialize before paint in layout and add control to Dashboard.
- [x] Verify resolution, storage failure, and system changes using a Node VM test of the real bootstrap script, before and after implementation.

### Task 2: Visual system
- [x] Replace globals with Light/Dark tinted tokens, glass material, typography, focus and reduced-motion rules.
- [x] Update every component CSS Module and Recharts hardcoded colors. Preserve table scrolling, dialogs, actions, and data structure.

### Task 3: Verification and local release
- [x] Run theme lifecycle tests, TypeScript and production build.
- [x] Rebuild and recreate only the frontend Docker service.
- [x] Review diff and verify deployed assets/API. Browser visual checks blocked: browser access host unavailable and no enabled surfaces. Do not claim screenshots, contrast measurements, or mobile interaction tests.

## Execution notes
Work in the current checkout to update the user's existing local deployment; leave the pre-existing staged CLAUDE.md alone. Do not commit or publish. Styling is verified visually rather than with implementation-mirroring tests.

Validation: theme bootstrap tests 3/3 passed; TypeScript passed; production build passed. Independent code reviewer found no actionable bugs. Browser runtime interaction and visual QA remain unverified.
