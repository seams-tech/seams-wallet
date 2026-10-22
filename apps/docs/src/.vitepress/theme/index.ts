import DefaultTheme from 'vitepress/theme';
import type { Theme } from 'vitepress';
import type { Mermaid, MermaidConfig } from 'mermaid';
import { h } from 'vue';
import SeamsFooter from './SeamsFooter.vue';
import DocHeader from './DocHeader.vue';
import SidebarHeader from './SidebarHeader.vue';
import { docsMessages } from '../i18n';
import './custom.css';

function localizeThemeLabels(): void {
  if (document.documentElement.lang !== 'ja') return;
  const sidebarLabel = document.getElementById('sidebar-aria-label');
  if (sidebarLabel) sidebarLabel.textContent = 'サイドバーナビゲーション';
  for (const button of document.querySelectorAll('.VPSidebarItem button.caret')) {
    button.setAttribute('aria-label', 'セクションを開閉');
  }
  for (const button of document.querySelectorAll('.VPNavBarHamburger')) {
    button.setAttribute('aria-label', 'モバイルナビゲーション');
  }
}

function diagramLabel(block: Element): string {
  const messages = docsMessages[document.documentElement.lang === 'ja' ? 'ja' : 'en'];
  let sibling = block.previousElementSibling;
  while (sibling) {
    if (/^H[1-6]$/.test(sibling.tagName) && sibling.textContent?.trim()) {
      return `${sibling.textContent.trim()}${messages.diagramSuffix}`;
    }
    sibling = sibling.previousElementSibling;
  }
  const pageTitle = document.querySelector('main h1')?.textContent?.trim();
  return pageTitle ? `${pageTitle}${messages.diagramSuffix}` : messages.diagram;
}

function diagramSummary(source: string): string {
  const messages = docsMessages[document.documentElement.lang === 'ja' ? 'ja' : 'en'];
  const labels = new Set<string>();
  for (const match of source.matchAll(/(?:\[|\(|\{)["']?([^\]})"']{2,80})["']?(?:\]|\)|\})/g)) {
    const label = match[1]?.replace(/<br\s*\/?\s*>/gi, ', ').trim();
    if (label) labels.add(label);
    if (labels.size === 8) break;
  }
  if (labels.size === 0) return messages.diagramSummary;
  const separator = document.documentElement.lang === 'ja' ? '、' : ', ';
  return `${messages.diagramConnections}${[...labels].join(separator)}${messages.diagramConnectionsEnd}`;
}

function createDiagramFigure(source: string, svg: string, label: string): HTMLElement {
  const messages = docsMessages[document.documentElement.lang === 'ja' ? 'ja' : 'en'];
  const figure = document.createElement('figure');
  figure.className = 'mermaid-figure';
  figure.setAttribute('data-mermaid-source', source);

  const container = document.createElement('div');
  container.className = 'mermaid';
  container.setAttribute('role', 'img');
  container.setAttribute('aria-label', label);
  container.innerHTML = svg;

  const caption = document.createElement('figcaption');
  const captionTitle = document.createElement('strong');
  captionTitle.textContent = label;
  const captionSummary = document.createElement('span');
  captionSummary.textContent = ` ${diagramSummary(source)}`;
  caption.append(captionTitle, captionSummary);

  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = messages.diagramSource;
  const sourceBlock = document.createElement('div');
  sourceBlock.className = 'language-mermaid';
  const pre = document.createElement('pre');
  const code = document.createElement('code');
  code.textContent = source;
  pre.appendChild(code);
  sourceBlock.appendChild(pre);
  details.append(summary, sourceBlock);
  figure.append(container, caption, details);
  return figure;
}

function createMermaidRenderer() {
  let mermaidRef: Mermaid | null = null;

  const isDark = () => document.documentElement.classList.contains('dark');

  const lightVariables = (): MermaidConfig['themeVariables'] => ({
    primaryColor: '#e1f0f6',
    primaryTextColor: '#0a0a0a',
    primaryBorderColor: '#0082af',
    secondaryColor: '#f5f3f1',
    secondaryTextColor: '#44403b',
    secondaryBorderColor: '#a59f97',
    tertiaryColor: '#f8eef0',
    tertiaryTextColor: '#0a0a0a',
    tertiaryBorderColor: '#b88a96',
    lineColor: '#777169',
    textColor: '#0a0a0a',
    actorTextColor: '#0a0a0a',
    labelTextColor: '#0a0a0a',
    noteTextColor: '#44403b',
    actorBkg: '#e1f0f6',
    actorBorder: '#0082af',
    noteBkgColor: '#fbefea',
    noteBorderColor: '#c4877a',
    clusterBkg: '#f8f8f7',
    clusterBorder: '#d6d1cb',
    edgeLabelBackground: '#ffffff',
    fontFamily: "'Inter', ui-sans-serif, system-ui, sans-serif",
  });

  const darkVariables = (): MermaidConfig['themeVariables'] => ({
    background: '#121110',
    primaryColor: '#0f2a33',
    primaryTextColor: '#f1ede8',
    primaryBorderColor: '#38a3c3',
    secondaryColor: '#221f1c',
    secondaryTextColor: '#b5aea5',
    secondaryBorderColor: '#4a453f',
    tertiaryColor: '#2a2024',
    tertiaryTextColor: '#f1ede8',
    tertiaryBorderColor: '#d8a5b1',
    lineColor: '#857e76',
    textColor: '#f1ede8',
    actorTextColor: '#f1ede8',
    labelTextColor: '#f1ede8',
    noteTextColor: '#f1ede8',
    actorBkg: '#0f2a33',
    actorBorder: '#38a3c3',
    noteBkgColor: '#2d2123',
    noteBorderColor: '#e7b3a9',
    clusterBkg: '#1a1917',
    clusterBorder: '#2d2a27',
    edgeLabelBackground: '#1a1917',
    fontFamily: "'Inter', ui-sans-serif, system-ui, sans-serif",
  });

  const themeVariables = (): MermaidConfig['themeVariables'] =>
    isDark() ? darkVariables() : lightVariables();

  const configure = async () => {
    if (!mermaidRef) {
      const mod = await import('mermaid').catch(() => null);
      mermaidRef = mod?.default ?? null;
    }
    if (!mermaidRef) return false;

    const config: MermaidConfig = {
      startOnLoad: false,
      theme: 'base',
      themeVariables: themeVariables(),
    };
    mermaidRef.initialize(config);
    return true;
  };

  const restoreCodeBlocks = () => {
    document.querySelectorAll('.mermaid-figure[data-mermaid-source]').forEach((figure) => {
      const source = figure.getAttribute('data-mermaid-source');
      if (!source) return;
      const wrapper = document.createElement('div');
      wrapper.className = 'language-mermaid';
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = source;
      pre.appendChild(code);
      wrapper.appendChild(pre);
      figure.replaceWith(wrapper);
    });
  };

  const render = async () => {
    const configured = await configure();
    if (!configured || !mermaidRef) return;

    const blocks = Array.from(document.querySelectorAll('.language-mermaid'));
    for (const block of blocks) {
      const code = block.querySelector('pre code');
      if (!code) continue;
      const source = code.textContent || '';
      if (!source.trim()) continue;
      const id = `mermaid-${Math.random().toString(36).slice(2)}`;
      const label = diagramLabel(block);

      try {
        const { svg } = await mermaidRef.render(id, source);
        block.replaceWith(createDiagramFigure(source, svg, label));
      } catch (error) {
        console.error('[docs] Mermaid render failed:', error);
      }
    }
  };

  const rerender = async () => {
    restoreCodeBlocks();
    await render();
  };

  return { rerender };
}

const theme: Theme = {
  ...DefaultTheme,
  Layout: () =>
    h(
      DefaultTheme.Layout,
      { onVnodeMounted: localizeThemeLabels, onVnodeUpdated: localizeThemeLabels },
      {
        'sidebar-nav-before': () => h(SidebarHeader),
        'doc-before': () => h(DocHeader),
        'layout-bottom': () => h(SeamsFooter),
      },
    ),
  enhanceApp: async (ctx) => {
    await DefaultTheme.enhanceApp?.(ctx);
    if (import.meta.env.SSR || typeof window === 'undefined') return;

    const { rerender } = createMermaidRenderer();
    await rerender();

    ctx.router.onAfterRouteChanged = () => {
      setTimeout(() => {
        void rerender();
      }, 0);
    };

    // Diagram colors are baked into the rendered SVG, so redraw them whenever
    // the appearance toggle flips the root class.
    let wasDark = document.documentElement.classList.contains('dark');
    new MutationObserver(() => {
      const isDark = document.documentElement.classList.contains('dark');
      if (isDark === wasDark) return;
      wasDark = isDark;
      void rerender();
    }).observe(document.documentElement, { attributeFilter: ['class'] });
  },
};

export default theme;
