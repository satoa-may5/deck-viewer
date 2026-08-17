# カード情報の自動取得(アーカイブ)

カード画像から タイプ / 色 / 必要エナジー / トリガー を自動判定していた機能一式。
**現在アプリからは完全に切り離されていて、どこからも読み込まれていない。**
将来また使うかもしれないので、部品としてここに残してあるだけ。

## 経緯

- 元々は`pool-detail.html`の「カードの情報を自動取得する」ボタンから起動していた
- そのボタンを外した結果、呼び出し元が一つも無い到達不能なコードになった
- それでも`server.js`が起動時に無条件で`jimp`を読み込んでいて、
  - 起動が約85ms遅くなる
  - exeが約12MB太る
  - jimpがプラグインを動的requireする都合でpkgビルドが壊れやすい
    (実際にv1.0.0のexeが起動即クラッシュする不具合を起こしている)

という負担だけが残っていたため、2026-08-18に本体から削除してここへ移した。
同時に`jimp`依存も`package.json`から外している。

## 中身

| ファイル | 説明 |
|---|---|
| `classify-cards.js` | 判定エンジン本体。テンプレートマッチングで分類する。`loadTemplates()` / `classifyImage()` をエクスポート |
| `cost-templates/` | 必要エナジーの数字テンプレート画像(約3.2MB) |
| `trigger-templates/` | トリガーバッジのテンプレート画像(約400KB) |
| `card-info-jobs.js` | フロント側の常駐パネル(進捗表示・ETA・完了通知)。全ページで読み込まれていた |

## 復活させる場合に必要なこと

1. `npm i jimp` で依存を戻し、`package.json`の`pkg.assets`に
   `node_modules/@jimp/**/*`・`node_modules/jimp/**/*` を再度追加する
   (pkgが動的requireを追跡できないため、これが無いとexeが起動しない)
2. `classify-cards.js`を`tools/`に戻し、`server.js`にジョブ実行部分
   (`POST /api/pools/:id/auto-fill-info` と `GET /api/card-info-jobs`)を復元する。
   削除時点の実装は git 履歴を参照(`git log --diff-filter=D --follow`)
3. `card-info-jobs.js`を`public/js/`に戻して各HTMLで読み込み、
   `sw.js`の`SHELL_FILES`にも追加する
4. カードレコードの`infoUncertain`フラグと、それに紐づく⚠バッジ・
   レビューフロー(`pool-detail.js`)も合わせて復元する

なお`classify-cards.js`のテンプレート座標・閾値のキャリブレーション経緯
(特にトリガー判定の赤ピクセルゲート)は`CLAUDE.md`に詳しく残してある。
