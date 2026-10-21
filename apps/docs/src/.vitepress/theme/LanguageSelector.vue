<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useData, withBase } from 'vitepress';
import { docPagePath, docsMessages, hasJapaneseTranslation, localizedDocLink } from '../i18n';
import type { DocsLocale } from '../i18n';

const { lang, page } = useData();
defineProps<{ align?: 'start' | 'end' }>();

const menu = ref<HTMLDetailsElement | null>(null);
const trigger = ref<HTMLElement | null>(null);
const locale = computed(currentLocale);
const messages = computed(() => docsMessages[locale.value]);
const languageName = computed(() => (locale.value === 'ja' ? '日本語' : 'English'));

type LanguageOption = { locale: DocsLocale; label: string; description: string | null };
const languages: readonly LanguageOption[] = [
  { locale: 'en', label: 'English', description: null },
  { locale: 'ja', label: '日本語', description: 'Japanese' },
];

function currentLocale(): DocsLocale {
  return lang.value === 'ja' ? 'ja' : 'en';
}

function languagePath(nextLocale: DocsLocale): string {
  const path = docPagePath(page.value.relativePath);
  const translated = hasJapaneseTranslation(path);
  const nextPath = nextLocale === 'ja' && !translated ? '/ja/' : localizedDocLink(path, nextLocale);
  return withBase(nextPath);
}

function changeLanguage(event: MouseEvent, nextLocale: DocsLocale): void {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
    return;
  event.preventDefault();
  if (nextLocale === locale.value) {
    closeAndFocus();
    return;
  }
  const path = docPagePath(page.value.relativePath);
  const destination = new URL(languagePath(nextLocale), window.location.origin);
  destination.search = window.location.search;
  if (hasJapaneseTranslation(path) || nextLocale === 'en') destination.hash = window.location.hash;
  window.location.assign(destination.href);
}

function closeMenu(): void {
  if (menu.value) menu.value.open = false;
}

function closeAndFocus(): void {
  closeMenu();
  trigger.value?.focus();
}

function closeOutside(event: PointerEvent): void {
  if (event.target instanceof Node && !menu.value?.contains(event.target)) closeMenu();
}

function closeOnBlur(event: FocusEvent): void {
  if (event.relatedTarget instanceof Node && menu.value?.contains(event.relatedTarget)) return;
  closeMenu();
}

function installDismissal(): void {
  document.addEventListener('pointerdown', closeOutside);
}

function removeDismissal(): void {
  document.removeEventListener('pointerdown', closeOutside);
}

onMounted(installDismissal);
onUnmounted(removeDismissal);
</script>

<template>
  <details
    ref="menu"
    class="seams-docs-language"
    :class="{ 'seams-docs-language--end': align === 'end' }"
    @mouseleave="closeMenu"
    @focusout="closeOnBlur"
    @keydown.esc.prevent="closeAndFocus"
  >
    <summary ref="trigger" :aria-label="`${messages.language}: ${languageName}`">
      <span class="vpi-languages" aria-hidden="true" />
      <span class="seams-docs-language__name" :lang="locale">{{ languageName }}</span>
      <span class="vpi-chevron-down" aria-hidden="true" />
    </summary>
    <div class="seams-docs-language__panel">
      <nav class="seams-docs-language__menu" :aria-label="messages.language">
        <!-- Reload the localized document instead of using VitePress link routing. -->
        <a
          v-for="option in languages"
          :key="option.locale"
          class="seams-docs-language__option"
          :href="languagePath(option.locale)"
          target="_self"
          :aria-current="locale === option.locale ? 'true' : undefined"
          :lang="option.locale"
          @click="changeLanguage($event, option.locale)"
        >
          <svg class="seams-docs-language__flag" viewBox="0 0 26 26" aria-hidden="true">
            <template v-if="option.locale === 'en'">
              <path fill="#fff" d="M0 0h26v26H0z" />
              <path
                stroke="#b31942"
                stroke-width="2"
                d="M0 1h26M0 5h26M0 9h26M0 13h26M0 17h26M0 21h26M0 25h26"
              />
              <path fill="#0a3161" d="M0 0h13v14H0z" />
              <path
                stroke="#fff"
                stroke-width="1"
                stroke-linecap="round"
                d="M2 3h0M6 3h0M10 3h0M4 6h0M8 6h0M2 9h0M6 9h0M10 9h0M4 12h0M8 12h0"
              />
            </template>
            <template v-else>
              <circle cx="13" cy="13" r="13" fill="#f0efed" />
              <circle cx="13" cy="13" r="5.5" fill="#bc002d" />
            </template>
          </svg>
          <span>{{ option.label }}</span>
          <span v-if="option.description" class="seams-docs-language__description" lang="en">{{
            option.description
          }}</span>
          <svg
            v-if="locale === option.locale"
            class="seams-docs-language__check"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="m20 6-11 11-5-5" />
          </svg>
        </a>
      </nav>
    </div>
  </details>
</template>

<style scoped>
.seams-docs-language {
  position: relative;
  width: fit-content;
  font-size: 13px;
  line-height: 20px;
  color: var(--vp-c-text-1);
}

summary {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 32px;
  padding: 6px 8px;
  border-radius: 9999px;
  list-style: none;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color 150ms ease;
}

summary::-webkit-details-marker {
  display: none;
}

summary:focus-visible {
  outline: none;
}

summary:focus-visible .seams-docs-language__name {
  text-decoration: underline;
  text-underline-offset: 4px;
}

.seams-docs-language[open] > summary {
  background: var(--vp-c-default-soft);
}

.vpi-languages {
  width: 16px;
  height: 16px;
}

.vpi-chevron-down {
  width: 12px;
  height: 12px;
  color: var(--vp-c-text-3);
}

.seams-docs-language__panel {
  position: absolute;
  z-index: 30;
  top: 100%;
  left: 0;
  padding-top: 4px;
}

.seams-docs-language--end .seams-docs-language__panel {
  right: 0;
  left: auto;
}

.seams-docs-language__menu {
  min-width: 180px;
  max-width: calc(100vw - 32px);
  padding: 3px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background: var(--vp-c-bg-elv);
  box-shadow: var(--vp-shadow-3);
  overscroll-behavior: contain;
}

.seams-docs-language__option {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 3px 8px;
  border-radius: 8px;
  color: inherit;
  text-decoration: none;
}

.seams-docs-language__option[aria-current],
.seams-docs-language__option:focus-visible {
  background: var(--vp-c-default-soft);
}

.seams-docs-language__option:focus-visible {
  outline: 1px solid var(--vp-c-text-3);
  outline-offset: -1px;
}

.seams-docs-language__flag {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  overflow: hidden;
  border-radius: 50%;
}

.seams-docs-language__description {
  color: var(--vp-c-text-2);
}

.seams-docs-language__check {
  width: 16px;
  height: 16px;
  margin-left: auto;
}

@media (hover: hover) {
  summary:hover,
  .seams-docs-language__option:hover {
    background: var(--vp-c-default-soft);
  }
}

@media (pointer: coarse) {
  summary,
  .seams-docs-language__option {
    min-height: 44px;
  }
}
</style>
