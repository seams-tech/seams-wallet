<script setup lang="ts">
import { computed, ref } from 'vue';
import { useData, withBase } from 'vitepress';
import type { DefaultTheme } from 'vitepress/theme';
import { docPagePath, docsMessages, localizedDocLink } from '../i18n';

const { frontmatter, lang, page, theme } = useData();
const messages = computed(() => docsMessages[lang.value === 'ja' ? 'ja' : 'en']);
const englishLink = computed(() =>
  withBase(localizedDocLink(docPagePath(page.value.relativePath), 'en')),
);

function normalize(link: string): string {
  const path = link.replace(/index\.md$/, '').replace(/\.md$/, '');
  const noTrailing = path !== '/' ? path.replace(/\/$/, '') : path;
  return noTrailing.startsWith('/') ? noTrailing : `/${noTrailing}`;
}

const currentPath = computed(() => normalize(`/${page.value.relativePath}`));

function findTrail(
  items: DefaultTheme.SidebarItem[],
  trail: DefaultTheme.SidebarItem[],
): DefaultTheme.SidebarItem[] | null {
  for (const item of items) {
    const next = [...trail, item];
    if (item.link && normalize(item.link) === currentPath.value) return next;
    if (item.items) {
      const found = findTrail(item.items, next);
      if (found) return found;
    }
  }
  return null;
}

const crumbs = computed(() => {
  const sidebar = theme.value.sidebar;
  if (!Array.isArray(sidebar)) return [];
  const trail = findTrail(sidebar as DefaultTheme.SidebarItem[], []);
  // Parents only: the page's own H1 already names the leaf.
  return trail && trail.length > 1 ? trail.slice(0, -1) : [];
});

const copied = ref(false);

async function copyPage(): Promise<void> {
  const body = document.querySelector('.vp-doc')?.textContent?.trim();
  if (!body) return;
  await navigator.clipboard.writeText(`# ${page.value.title}\n\n${body}`);
  copied.value = true;
  setTimeout(() => {
    copied.value = false;
  }, 2000);
}
</script>

<template>
  <header class="seams-doc-header">
    <div class="seams-doc-header__bar">
      <nav
        v-if="crumbs.length"
        class="seams-doc-header__breadcrumb"
        :aria-label="messages.breadcrumb"
      >
        <template v-for="(crumb, index) in crumbs" :key="crumb.text">
          <a v-if="crumb.link" :href="withBase(crumb.link)">{{ crumb.text }}</a>
          <span v-else>{{ crumb.text }}</span>
          <span v-if="index < crumbs.length - 1" class="seams-doc-header__sep" aria-hidden="true">
            ›
          </span>
        </template>
      </nav>
      <span v-else />
      <button class="seams-doc-header__copy" type="button" @click="copyPage">
        <svg
          aria-hidden="true"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <rect width="14" height="14" x="8" y="8" rx="2" />
          <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
        </svg>
        {{ copied ? messages.copied : messages.copyPage }}
      </button>
    </div>
    <aside v-if="lang === 'ja'" class="seams-doc-header__translation" role="note">
      <strong>日本語版（試験公開）</strong>
      <p>
        導入ガイドを先行公開しています。翻訳は調整中です。その他のページは英語版へ移動します。
        <a :href="englishLink" lang="en">English</a>
      </p>
    </aside>
    <h1 class="seams-doc-header__title">{{ page.title }}</h1>
    <p v-if="frontmatter.description" class="seams-doc-header__subtitle">
      {{ frontmatter.description }}
    </p>
  </header>
</template>

<style scoped>
.seams-doc-header {
  margin-bottom: 32px;
}

.seams-doc-header__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 32px;
  margin-bottom: 12px;
}

.seams-doc-header__translation {
  margin-bottom: 24px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  padding: 12px 16px;
  background: var(--vp-c-bg-soft);
  font-size: 13px;
  line-height: 1.8;
  color: var(--vp-c-text-2);
}

.seams-doc-header__translation strong {
  color: var(--vp-c-text-1);
}

.seams-doc-header__translation p {
  margin: 4px 0 0;
}

.seams-doc-header__translation a {
  color: var(--vp-c-brand-1);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.seams-doc-header__title {
  margin: 0;
  font-size: 36px;
  font-weight: 700;
  line-height: 1.15;
  letter-spacing: -0.02em;
  color: var(--vp-c-text-1);
}

.seams-doc-header__subtitle {
  margin: 10px 0 0;
  font-size: 17px;
  line-height: 1.6;
  color: var(--vp-c-text-2);
}

.seams-doc-header__breadcrumb {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-size: 14px;
  color: var(--vp-c-text-2);
}

.seams-doc-header__breadcrumb a {
  color: var(--vp-c-text-2);
  text-decoration: none;
  transition: color 0.25s;
}

.seams-doc-header__breadcrumb a:hover {
  color: var(--vp-c-brand-1);
}

.seams-doc-header__sep {
  color: var(--vp-c-text-3);
}

.seams-doc-header__copy {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  border: 1px solid var(--vp-c-border);
  border-radius: 8px;
  padding: 4px 12px;
  color: var(--vp-c-text-2);
  font-size: 13px;
  font-weight: 500;
  transition:
    color 0.25s,
    border-color 0.25s;
}

.seams-doc-header__copy:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}
</style>
