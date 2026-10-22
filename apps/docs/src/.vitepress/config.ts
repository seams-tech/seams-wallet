import { defineConfig, type DefaultTheme, type MarkdownRenderer } from 'vitepress';
import { docPagePath, japaneseSidebarItem, localizedDocLink } from './i18n';

const docsOrigin = (process.env.VITE_DOCS_ORIGIN || 'https://wallet.seams.sh/docs').replace(
  /\/$/,
  '',
);
const docsBase = process.env.VITE_DOCS_BASE_PATH || '/docs/';
const walletSiteOrigin = (process.env.VITE_WALLET_SITE_ORIGIN || 'https://wallet.seams.sh').replace(
  /\/$/,
  '',
);

function pageUrl(page: string): string {
  return `${docsOrigin}${docPagePath(page)}`;
}

function sitemapPages<T extends { url: string }>(items: T[]): T[] {
  const pages: T[] = [];
  for (const item of items) {
    if (/(?:^|\/)404(?:\.html)?$/.test(item.url)) continue;
    pages.push({ ...item, url: `${docsOrigin}/${item.url}` });
  }
  return pages;
}

type FenceRenderer = NonNullable<MarkdownRenderer['renderer']['rules']['fence']>;

function renderLocalizedFence(
  renderFence: FenceRenderer,
  ...args: Parameters<FenceRenderer>
): string {
  const [tokens, index, options, env, renderer] = args;
  const html = renderFence(tokens, index, options, env, renderer);
  return env.relativePath.startsWith('ja/')
    ? html.replace('title="Copy Code"', 'title="コードをコピー"')
    : html;
}

function configureMarkdown(markdown: MarkdownRenderer): void {
  const renderFence = markdown.renderer.rules.fence;
  if (!renderFence) throw new Error('The documentation code-fence renderer is missing.');
  markdown.renderer.rules.fence = renderLocalizedFence.bind(null, renderFence);
}

const getStartedSection: DefaultTheme.SidebarItem = {
  text: 'Get started',
  items: [
    { text: 'Installation', link: '/' },
    { text: 'Release 0.19.0', link: '/releases' },
    { text: 'Create a wallet', link: '/getting-started/create-wallet' },
    { text: 'Sign with policy', link: '/getting-started/sign-with-policy' },
    {
      text: 'Devices, export, and recovery',
      link: '/getting-started/delegate-or-rotate',
    },
    { text: 'Theme wallet surfaces', link: '/getting-started/theming' },
  ],
};

const guidesSection: DefaultTheme.SidebarItem = {
  text: 'Guides',
  items: [
    { text: 'Overview', link: '/guides/' },
    { text: 'Authentication', link: '/guides/authentication' },
    { text: 'Embedded wallets', link: '/guides/embedded-wallets' },
    { text: 'Policies and mandates', link: '/guides/policies-and-mandates' },
    {
      text: 'Wallet sessions and signing lanes',
      link: '/guides/wallet-sessions-and-signing-lanes',
    },
    { text: 'Delegated agents', link: '/guides/delegated-agents' },
    { text: 'Linked devices', link: '/guides/linked-devices' },
    {
      text: 'Recovery, export, and rotation',
      link: '/guides/recovery-export-and-rotation',
    },
    { text: 'Custom transaction review', link: '/guides/transaction-review' },
    { text: 'Theming', link: '/guides/theming' },
    {
      text: 'Examples',
      collapsed: true,
      items: [
        { text: 'Overview', link: '/examples/' },
        {
          text: 'Wallet setup and authentication',
          link: '/examples/wallet-setup-and-authentication',
        },
        { text: 'Signing', link: '/examples/signing' },
        {
          text: 'Advanced wallet operations',
          link: '/examples/advanced-wallet-operations',
        },
        { text: 'UI customization', link: '/examples/ui-customization' },
      ],
    },
  ],
};

const referenceSection: DefaultTheme.SidebarItem = {
  text: 'SDK reference',
  items: [
    { text: 'Overview', link: '/reference/' },
    { text: '@seams/wallet', link: '/reference/core' },
    { text: '@seams/wallet/react', link: '/reference/react' },
    { text: '@seams/wallet/advanced', link: '/reference/advanced' },
    { text: '@seams/wallet/threshold', link: '/reference/threshold' },
    { text: '@seams/wallet/runtime', link: '/reference/runtime' },
    { text: 'Server SDK and CLI', link: '/reference/server' },
    { text: 'Configuration', link: '/reference/configuration' },
    { text: 'Results and errors', link: '/reference/results-and-errors' },
    { text: 'Events and progress', link: '/reference/events-and-progress' },
  ],
};

const conceptsSection: DefaultTheme.SidebarItem = {
  text: 'Concepts',
  items: [
    { text: 'Overview', link: '/concepts/' },
    { text: 'Architecture', link: '/concepts/architecture' },
    {
      text: 'Wallet infrastructure comparison',
      link: '/concepts/wallet-infrastructure-comparison',
    },
    { text: 'Glossary', link: '/concepts/glossary' },
    {
      text: 'Auth methods',
      link: '/concepts/auth-methods/',
      collapsed: true,
      items: [
        { text: 'Auth planes', link: '/concepts/auth-planes' },
        { text: 'Passkeys', link: '/concepts/auth-methods/passkeys' },
        { text: 'Email OTP', link: '/concepts/auth-methods/email-otp' },
        { text: 'VoiceID', link: '/concepts/auth-methods/voiceid' },
      ],
    },
    {
      text: 'Policy',
      link: '/concepts/policy/',
      collapsed: true,
      items: [
        { text: 'Mandates', link: '/concepts/policy/mandates' },
        { text: 'Credentials and proofs', link: '/concepts/policy/credentials-and-proofs' },
      ],
    },
    {
      text: 'Custody model',
      link: '/concepts/custody/',
      collapsed: true,
      items: [
        { text: 'Wallet iframe', link: '/concepts/custody/wallet-iframe' },
        { text: 'Recovery and export', link: '/concepts/custody/recovery-and-export' },
      ],
    },
    {
      text: 'Sessions',
      link: '/concepts/sessions/',
      collapsed: true,
      items: [
        { text: 'Signing lanes', link: '/concepts/sessions/signing-lanes' },
        { text: 'Wallet sessions', link: '/concepts/sessions/wallet-sessions' },
        { text: 'Sealed refresh', link: '/concepts/sessions/sealed-refresh' },
        { text: 'Nonce lanes', link: '/concepts/sessions/nonce-lanes' },
      ],
    },
    {
      text: 'Threshold signing',
      link: '/concepts/threshold-signing/',
      collapsed: true,
      items: [
        { text: 'Router A/B', link: '/concepts/threshold-signing/router-ab' },
        { text: 'Router A/B protocol', link: '/concepts/advanced/router-ab-protocol' },
        { text: 'Streaming Yao A/B', link: '/concepts/threshold-signing/streaming-yao-ab' },
        {
          text: 'Blind deterministic derivation',
          link: '/concepts/threshold-signing/blind-deterministic-derivation',
        },
        {
          text: 'Serverless threshold signing',
          link: '/concepts/threshold-signing/serverless-threshold-signing',
        },
        { text: 'Ed25519', link: '/concepts/threshold-signing/ed25519' },
        { text: 'EVM ECDSA', link: '/concepts/threshold-signing/evm-ecdsa' },
      ],
    },
    {
      text: 'Delegation',
      link: '/concepts/delegation/',
      collapsed: true,
      items: [
        { text: 'Key rotation', link: '/concepts/delegation/key-rotation' },
        { text: 'Rotation ceremonies', link: '/concepts/advanced/rotation-ceremonies' },
        { text: 'Linked devices', link: '/concepts/delegation/linked-devices' },
        { text: 'Delegated agents', link: '/concepts/delegation/delegated-agents' },
      ],
    },
    { text: 'Diagram sources', link: '/concepts/advanced/diagram-sources' },
  ],
};

const deployAndOperateSection: DefaultTheme.SidebarItem = {
  text: 'Deploy and operate',
  items: [
    { text: 'Overview', link: '/deploy-and-operate/' },
    { text: 'Hosting targets', link: '/deploy-and-operate/hosting-targets' },
    { text: 'Hosted integration', link: '/deploy-and-operate/hosted-integration' },
    { text: 'Security boundaries', link: '/deploy-and-operate/security-boundaries' },
    { text: 'Tenant-root backups', link: '/deploy-and-operate/tenant-root-backups' },
    { text: 'Recovery CLI', link: '/deploy-and-operate/recovery-cli' },
    { text: 'Recovery and portability', link: '/deploy-and-operate/recovery-and-portability' },
    { text: 'Environment', link: '/deploy-and-operate/environment' },
    { text: 'Production checklist', link: '/deploy-and-operate/production-checklist' },
    { text: 'Observability and audit', link: '/deploy-and-operate/observability-and-audit' },
    { text: 'Route auth and deployment', link: '/concepts/advanced/route-auth-and-deployment' },
    { text: 'Troubleshooting', link: '/deploy-and-operate/troubleshooting' },
  ],
};

const useCasesSection: DefaultTheme.SidebarItem = {
  text: 'Use cases',
  items: [
    { text: 'Overview', link: '/use-cases/' },
    { text: 'Platform wallets', link: '/use-cases/platform-wallets' },
    { text: 'Shopping wallet apps', link: '/use-cases/shopping-wallet-apps' },
    { text: 'Shopping agents', link: '/use-cases/ecommerce-agents' },
  ],
};

// One sidebar for every route. Top-level areas stay open — they carry no
// `collapsed`, so VitePress renders them expanded and without a toggle — while
// the deeper groups inside Guides and Concepts stay collapsible.
const documentationSidebar: DefaultTheme.SidebarItem[] = [
  getStartedSection,
  guidesSection,
  useCasesSection,
  conceptsSection,
  deployAndOperateSection,
  referenceSection,
];

export default defineConfig({
  base: docsBase,
  outDir: '../dist',
  cleanUrls: true,
  appearance: true,
  lastUpdated: true,
  title: 'Seams',
  description: 'Key and credential infrastructure for policy-bound digital authority',
  locales: {
    root: { label: 'English', lang: 'en' },
    ja: {
      label: '日本語',
      lang: 'ja',
      description: 'Seamsの導入、ウォレットの作成、署名を学ぶ開発者向けドキュメント。',
      themeConfig: {
        logoLink: `${walletSiteOrigin}/ja/`,
        nav: [
          { text: 'ドキュメント', link: '/ja/', activeMatch: '^/ja/(?!reference)' },
          { text: 'SDKリファレンス', link: '/ja/reference/', activeMatch: '^/ja/reference/' },
        ],
        sidebar: documentationSidebar.map(japaneseSidebarItem),
        outline: { level: [2, 3], label: 'このページの内容' },
        lastUpdated: { text: '最終更新' },
        docFooter: { prev: '前のページ', next: '次のページ' },
        sidebarMenuLabel: 'メニュー',
        returnToTopLabel: 'ページの先頭へ',
        langMenuLabel: '言語を選択',
        skipToContentLabel: '本文へ移動',
        darkModeSwitchLabel: '表示テーマ',
        lightModeSwitchTitle: 'ライトモードに切り替え',
        darkModeSwitchTitle: 'ダークモードに切り替え',
        notFound: {
          title: 'ページが見つかりません',
          quote: 'URLを確認するか、ドキュメントの先頭へ戻ってください。',
          linkLabel: 'はじめに戻る',
          linkText: 'はじめに戻る',
        },
      },
    },
  },
  sitemap: {
    hostname: docsOrigin,
    transformItems: sitemapPages,
  },
  head: [
    ['link', { rel: 'icon', href: `${docsBase}favicon.svg`, type: 'image/svg+xml' }],
    ['meta', { property: 'og:site_name', content: 'Seams docs' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { name: 'twitter:card', content: 'summary' }],
  ],
  transformHead({ page, title, description }) {
    const canonicalUrl = pageUrl(page);
    const path = docPagePath(page);
    const alternates: [string, Record<string, string>][] = [];
    if (!/(?:^|\/)404$/.test(path)) {
      alternates.push(
        [
          'link',
          {
            rel: 'alternate',
            hreflang: 'en',
            href: `${docsOrigin}${localizedDocLink(path, 'en')}`,
          },
        ],
        [
          'link',
          {
            rel: 'alternate',
            hreflang: 'ja',
            href: `${docsOrigin}${localizedDocLink(path, 'ja')}`,
          },
        ],
        [
          'link',
          {
            rel: 'alternate',
            hreflang: 'x-default',
            href: `${docsOrigin}${localizedDocLink(path, 'en')}`,
          },
        ],
      );
    }
    return [
      ['link', { rel: 'canonical', href: canonicalUrl }],
      ...alternates,
      ['meta', { property: 'og:title', content: title }],
      ['meta', { property: 'og:description', content: description }],
      ['meta', { property: 'og:url', content: canonicalUrl }],
      ['meta', { property: 'og:locale', content: path.startsWith('/ja/') ? 'ja_JP' : 'en_US' }],
      ['meta', { name: 'twitter:title', content: title }],
      ['meta', { name: 'twitter:description', content: description }],
    ];
  },
  markdown: {
    config: configureMarkdown,
    theme: {
      light: 'github-light',
      dark: 'github-dark',
    },
    languageAlias: {
      caddy: 'nginx',
    },
  },
  themeConfig: {
    siteTitle: 'docs',
    logo: {
      light: '/seams-v9/svg/seams-wordmark-hanken-dark.svg',
      dark: '/seams-v9/svg/seams-wordmark-hanken-white.svg',
      alt: 'Seams',
    },
    logoLink: walletSiteOrigin,
    lastUpdated: { text: 'Last updated' },
    outline: [2, 3],
    search: {
      provider: 'local',
      options: {
        locales: {
          ja: {
            translations: {
              button: { buttonText: '検索', buttonAriaLabel: 'ドキュメントを検索' },
              modal: {
                displayDetails: '詳細を表示',
                resetButtonTitle: '検索をクリア',
                backButtonTitle: '検索を閉じる',
                noResultsText: '一致する結果が見つかりません',
                footer: {
                  selectText: '選択',
                  selectKeyAriaLabel: 'Enterキー',
                  navigateText: '移動',
                  navigateUpKeyAriaLabel: '上矢印キー',
                  navigateDownKeyAriaLabel: '下矢印キー',
                  closeText: '閉じる',
                  closeKeyAriaLabel: 'Escapeキー',
                },
              },
            },
          },
        },
      },
    },
    nav: [
      { text: 'Documentation', link: '/', activeMatch: '^/(?!reference)' },
      { text: 'SDK reference', link: '/reference/', activeMatch: '^/reference/' },
    ],
    sidebar: documentationSidebar,
  },
  vite: {
    clearScreen: false,
    logLevel: 'info',
    server: {
      host: 'localhost',
      port: 4006,
      allowedHosts: ['docs.localhost', 'localhost', 'pta-m4.local'],
    },
  },
});
