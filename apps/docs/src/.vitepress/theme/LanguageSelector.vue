<script setup lang="ts">
import { computed } from 'vue';
import { useData, withBase } from 'vitepress';
import { docPagePath, docsMessages, hasJapaneseTranslation, localizedDocLink } from '../i18n';
import type { DocsLocale } from '../i18n';

const { lang, page } = useData();
const locale = computed({ get: currentLocale, set: changeLanguage });
const messages = computed(() => docsMessages[locale.value]);

function currentLocale(): DocsLocale {
  return lang.value === 'ja' ? 'ja' : 'en';
}

function changeLanguage(nextLocale: string): void {
  if (nextLocale !== 'en' && nextLocale !== 'ja') return;
  const path = docPagePath(page.value.relativePath);
  const translated = hasJapaneseTranslation(path);
  const nextPath = nextLocale === 'ja' && !translated ? '/ja/' : localizedDocLink(path, nextLocale);
  const destination = new URL(withBase(nextPath), window.location.origin);
  destination.search = window.location.search;
  if (translated || nextLocale === 'en') destination.hash = window.location.hash;
  window.location.assign(destination.href);
}
</script>

<template>
  <label class="seams-docs-language">
    <span class="vpi-languages" aria-hidden="true" />
    <select v-model="locale" :aria-label="messages.language">
      <option value="en" lang="en">English</option>
      <option value="ja" lang="ja">日本語</option>
    </select>
  </label>
</template>

<style scoped>
.seams-docs-language {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  width: fit-content;
  color: var(--vp-c-text-2);
}

.vpi-languages {
  width: 16px;
  height: 16px;
}

select {
  appearance: auto;
  min-height: 32px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  padding: 4px 8px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

select:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 2px;
}

@media (pointer: coarse) {
  select {
    min-height: 44px;
  }
}
</style>
