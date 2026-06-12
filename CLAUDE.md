# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — Start dev server (Vite, default port 5173)
- `npm run build` — Type-check (`vue-tsc -b`) then production build
- `npm run preview` — Preview production build locally

No test framework is configured yet.

## Architecture

**Tech stack:** Vue 3 (Composition API + `<script setup>`) / TypeScript / Vite / Pinia / Vue Router 4 / Tailwind CSS 4 / unplugin-icons (Iconify)

**Path alias:** `@` → `src/` (configured in `vite.config.ts` and `tsconfig.app.json`)

### Data flow

All persistent state uses `useStorage<T>(key, default)` (`src/composables/useStorage.ts`) — a reactive `ref` backed by `localStorage` with deep watch. Pinia stores wrap these refs. Default seed data lives in `src/utils/default-bookmarks.ts` and `src/utils/default-categories.ts`.

**localStorage keys:** `hao123-bookmarks`, `hao123-categories`, `hao123-engines`, `hao123-current-engine`. When changing default data, users may need to clear these keys to see updates.

### Component hierarchy

```
App.vue (router-view)
  └─ Layout.vue (single-page layout, provides BookmarkEditor)
       ├─ search/SearchBar.vue       (engine selector dropdown + input, Ctrl+K shortcut)
       ├─ bookmark/BookmarkGrid.vue  (manages activeCategoryId via v-model, uses BookmarkEditor)
       │    ├─ bookmark/CategoryTabs.vue  (v-model for selected category)
       │    └─ bookmark/BookmarkCard.vue   (edit/delete emit → BookmarkEditor)
       ├─ bookmark/BookmarkForm.vue   (modal for add/edit, watches BookmarkEditor.editingBookmark)
       └─ clock/ClockWidget.vue
```

BookmarkGrid → BookmarkForm communication uses `provideBookmarkEditor`/`useBookmarkEditor` (`src/composables/useBookmarkEditor.ts`) — a provide/inject pattern with reactive state, avoiding prop drilling and window events.

### Stores

- `stores/bookmarks.ts` — bookmark CRUD only
- `stores/categories.ts` — category CRUD only
- `stores/search.ts` — search engine selection + `search()` method

### Icons

Use `import IconXxx from '~icons/<collection>/<name>'` (e.g., `~icons/mdi/pencil`). The `unplugin-icons` plugin auto-installs from `@iconify/json`. Type declarations are in `src/env.d.ts`.
