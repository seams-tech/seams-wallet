<script setup lang="ts">
import { computed } from 'vue';
import { useData, withBase } from 'vitepress';
import { docsMessages, localizedDocLink } from '../i18n';
import LanguageSelector from './LanguageSelector.vue';

const { lang } = useData();
const locale = computed(() => (lang.value === 'ja' ? 'ja' : 'en'));
const messages = computed(() => docsMessages[locale.value]);
const pricingLink = computed(() =>
  locale.value === 'ja' ? 'https://seams.sh/ja/pricing/' : 'https://seams.sh/pricing/',
);
const year = new Date().getFullYear();

function docLink(path: string): string {
  return withBase(localizedDocLink(path, locale.value));
}
</script>

<template>
  <footer class="seams-docs-footer" :aria-label="messages.footer">
    <div class="seams-docs-footer__inner">
      <div class="seams-docs-footer__brand">
        <a class="seams-docs-footer__brand-link" href="https://seams.sh" rel="noreferrer">
          <img
            class="seams-docs-footer__wordmark seams-docs-footer__wordmark--light"
            :src="withBase('/seams-v9/svg/seams-wordmark-hanken-dark.svg')"
            alt="Seams"
          />
          <img
            class="seams-docs-footer__wordmark seams-docs-footer__wordmark--dark"
            :src="withBase('/seams-v9/svg/seams-wordmark-hanken-white.svg')"
            alt=""
            aria-hidden="true"
          />
        </a>
        <LanguageSelector />
        <p class="seams-docs-footer__legal">© {{ year }} Seams, Inc.</p>
      </div>

      <nav class="seams-docs-footer__links" :aria-label="messages.footerNavigation">
        <div class="seams-docs-footer__group">
          <h2>{{ messages.build }}</h2>
          <a :href="docLink('/')">{{ messages.start }}</a>
          <a :href="docLink('/getting-started/create-wallet')">{{ messages.createWallet }}</a>
          <a :href="docLink('/getting-started/sign-with-policy')">{{ messages.signWithPolicy }}</a>
        </div>
        <div class="seams-docs-footer__group">
          <h2>{{ messages.learn }}</h2>
          <a :href="docLink('/concepts/architecture')">{{ messages.architecture }}</a>
          <a :href="docLink('/concepts/auth-methods/')">{{ messages.authentication }}</a>
          <a :href="docLink('/concepts/policy/')">{{ messages.policies }}</a>
          <a :href="docLink('/releases')">{{ messages.release }}</a>
        </div>
        <div class="seams-docs-footer__group">
          <h2>Seams</h2>
          <a :href="pricingLink" rel="noreferrer">{{ messages.pricing }}</a>
          <a href="https://seams.sh/contact/" rel="noreferrer">{{ messages.support }}</a>
          <a href="https://github.com/seams-tech/seams-wallet" rel="noreferrer">GitHub</a>
        </div>
      </nav>
    </div>
  </footer>
</template>
