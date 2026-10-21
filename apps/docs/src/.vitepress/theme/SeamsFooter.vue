<script setup lang="ts">
import { withBase } from 'vitepress';

const year = new Date().getFullYear();
</script>

<template>
  <footer class="seams-docs-footer" aria-label="Seams footer">
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
        <p class="seams-docs-footer__legal">© {{ year }} Seams, Inc.</p>
      </div>

      <nav class="seams-docs-footer__links" aria-label="Footer navigation">
        <div class="seams-docs-footer__group">
          <h2>Build</h2>
          <a :href="withBase('/')">Start here</a>
          <a :href="withBase('/getting-started/create-wallet')">Create a wallet</a>
          <a :href="withBase('/getting-started/sign-with-policy')">Sign with policy</a>
        </div>
        <div class="seams-docs-footer__group">
          <h2>Learn</h2>
          <a :href="withBase('/concepts/architecture')">Architecture</a>
          <a :href="withBase('/concepts/auth-methods/')">Authentication</a>
          <a :href="withBase('/concepts/policy/')">Policies</a>
          <a :href="withBase('/releases')">Release 0.17.0</a>
        </div>
        <div class="seams-docs-footer__group">
          <h2>Seams</h2>
          <a href="https://seams.sh/pricing/" rel="noreferrer">Pricing</a>
          <a href="https://seams.sh/contact/" rel="noreferrer">Support</a>
          <a href="https://github.com/seams-tech/seams-wallet" rel="noreferrer">GitHub</a>
        </div>
      </nav>
    </div>
  </footer>
</template>
