/** 認証画面・課金画面などアプリ外枠用の法的リンク */

export function AuthLegalFooter(): JSX.Element {
  return (
    <nav className="auth-legal-footer" aria-label="法的情報">
      <a href="/legal/tokushoho" target="_blank" rel="noopener noreferrer">
        特定商取引法に基づく表記
      </a>
      <span className="auth-legal-sep" aria-hidden="true">
        ·
      </span>
      <a href="/legal/privacy" target="_blank" rel="noopener noreferrer">
        プライバシーポリシー
      </a>
      <span className="auth-legal-sep" aria-hidden="true">
        ·
      </span>
      <a href="/legal/terms" target="_blank" rel="noopener noreferrer">
        利用規約
      </a>
    </nav>
  );
}
