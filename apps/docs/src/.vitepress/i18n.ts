import type { DefaultTheme } from 'vitepress';

export type DocsLocale = 'en' | 'ja';

export function docPagePath(relativePath: string): string {
  return `/${relativePath.replace(/(^|\/)index\.md$/, '$1').replace(/\.md$/, '')}`;
}

function englishDocPath(path: string): string {
  return path.replace(/^\/ja(?=\/)/, '');
}

export function localizedDocLink(path: string, locale: DocsLocale): string {
  const englishPath = englishDocPath(path);
  if (locale === 'en') return englishPath;
  return `/ja${englishPath}`;
}

export const docsMessages = {
  en: {
    language: 'Language',
    breadcrumb: 'Breadcrumb',
    copyPage: 'Copy page',
    copied: 'Copied',
    footer: 'Seams footer',
    footerNavigation: 'Footer navigation',
    build: 'Build',
    start: 'Start here',
    createWallet: 'Create a wallet',
    signWithPolicy: 'Sign with policy',
    learn: 'Learn',
    architecture: 'Architecture',
    authentication: 'Authentication',
    policies: 'Policies',
    release: 'Release 0.22.0',
    pricing: 'Pricing',
    support: 'Support',
    diagram: 'Architecture diagram',
    diagramSuffix: ' diagram',
    diagramSource: 'View diagram source',
    diagramConnections: 'The diagram connects ',
    diagramConnectionsEnd: '.',
    diagramSummary: 'The diagram presents the flow described in the surrounding section.',
  },
  ja: {
    language: '言語',
    breadcrumb: 'パンくずリスト',
    copyPage: 'ページをコピー',
    copied: 'コピーしました',
    footer: 'Seamsのフッター',
    footerNavigation: 'フッターナビゲーション',
    build: '開発する',
    start: 'はじめに',
    createWallet: 'ウォレットを作成',
    signWithPolicy: 'ポリシーに従って署名',
    learn: '学ぶ',
    architecture: 'アーキテクチャ',
    authentication: '認証',
    policies: 'ポリシー',
    release: 'リリース 0.22.0',
    pricing: '料金',
    support: 'サポート',
    diagram: '構成図',
    diagramSuffix: 'の図',
    diagramSource: '図のソースを表示',
    diagramConnections: 'この図は、',
    diagramConnectionsEnd: 'の関係を示します。',
    diagramSummary: 'この図は、この節で説明する流れを示します。',
  },
};

const japaneseSidebarLabels: Record<string, string> = {
  'Get started': 'はじめに',
  Installation: 'インストール',
  'Release 0.22.0': 'リリース 0.22.0',
  'Create a wallet': 'ウォレットを作成',
  'Sign with policy': 'ポリシーに従って署名',
  'Devices, export, and recovery': 'デバイス連携・鍵のエクスポート・復元',
  'Theme wallet surfaces': 'ウォレットUIのテーマ',
  Guides: 'ガイド',
  Overview: '概要',
  Authentication: '認証',
  'Embedded wallets': '組み込みウォレット',
  'Policies and mandates': 'ポリシーと委任条件',
  'Wallet sessions and signing lanes': 'ウォレットセッションと署名レーン',
  'Delegated agents': '権限を委任したエージェント',
  'Linked devices': 'リンク済みデバイス',
  'Recovery, export, and rotation': '復元・エクスポート・鍵のローテーション',
  'Custom transaction review': '取引確認UIのカスタマイズ',
  Theming: 'テーマの設定',
  Examples: '実装例',
  'Wallet setup and authentication': 'ウォレットの設定と認証',
  Signing: '署名',
  'Advanced wallet operations': 'ウォレットの高度な操作',
  'UI customization': 'UIのカスタマイズ',
  'SDK reference': 'SDKリファレンス',
  '@seams/wallet': '@seams/wallet',
  '@seams/wallet/react': '@seams/wallet/react',
  '@seams/wallet/advanced': '@seams/wallet/advanced',
  '@seams/wallet/threshold': '@seams/wallet/threshold',
  '@seams/wallet/runtime': '@seams/wallet/runtime',
  'Server SDK and CLI': 'サーバーSDKとCLI',
  Configuration: '設定',
  'Results and errors': '結果とエラー',
  'Events and progress': 'イベントと進行状況',
  Concepts: '基本概念',
  Architecture: 'アーキテクチャ',
  'Wallet infrastructure comparison': 'ウォレット基盤の比較',
  Glossary: '用語集',
  'Auth methods': '認証方法',
  'Auth planes': '認証の境界',
  Passkeys: 'パスキー',
  'Email OTP': 'メールのワンタイムコード',
  VoiceID: 'VoiceID',
  Policy: 'ポリシー',
  Mandates: '委任条件',
  'Credentials and proofs': '認証情報と証明',
  'Custody model': '資産管理モデル',
  'Wallet iframe': 'ウォレットiframe',
  'Recovery and export': '復元とエクスポート',
  Sessions: 'セッション',
  'Signing lanes': '署名レーン',
  'Wallet sessions': 'ウォレットセッション',
  'Sealed refresh': 'シール済み情報による更新',
  'Nonce lanes': 'ノンスレーン',
  'Threshold signing': 'しきい値署名',
  'Router A/B': 'Router A/B',
  'Router A/B protocol': 'Router A/Bプロトコル',
  'Streaming Yao A/B': 'Streaming Yao A/B',
  'Blind deterministic derivation': 'ブラインド決定的導出',
  'Serverless threshold signing': 'サーバーレスのしきい値署名',
  Ed25519: 'Ed25519',
  'EVM ECDSA': 'EVM ECDSA',
  Delegation: '権限の委任',
  'Key rotation': '鍵のローテーション',
  'Rotation ceremonies': '鍵のローテーション手順',
  'Diagram sources': '図のソース',
  'Deploy and operate': 'デプロイと運用',
  'Hosting targets': 'ホスティング先',
  'Hosted integration': 'ホスト環境への導入',
  'Security boundaries': 'セキュリティの境界',
  'Tenant-root backups': 'テナントルートのバックアップ',
  'Recovery CLI': '復元CLI',
  'Recovery and portability': '復元と移行',
  Environment: '環境変数',
  'Production checklist': '本番環境の確認事項',
  'Observability and audit': '監視と監査',
  'Route auth and deployment': 'ルートの認証とデプロイ',
  Troubleshooting: 'トラブルシューティング',
  'Use cases': '活用事例',
  'Platform wallets': 'プラットフォームのウォレット',
  'Shopping wallet apps': 'ショッピング用ウォレットアプリ',
  'Shopping agents': 'ショッピングエージェント',
};

export function japaneseSidebarItem(item: DefaultTheme.SidebarItem): DefaultTheme.SidebarItem {
  const text = item.text === undefined ? undefined : japaneseSidebarLabels[item.text];
  if (item.text !== undefined && text === undefined) {
    throw new Error(`Missing Japanese sidebar label: ${item.text}`);
  }
  return {
    ...item,
    text,
    link: item.link === undefined ? undefined : localizedDocLink(item.link, 'ja'),
    items: item.items?.map(japaneseSidebarItem),
  };
}
