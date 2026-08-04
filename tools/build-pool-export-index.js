// pool-exports/*.dvpool から pool-exports/index.json を再生成する。
//
// これまで「カードプールをインポート」画面はサーバー起動のたびに GitHub の
// Contents API で一覧を取り(1回)、さらに新規/更新された .dvpool ごとに
// raw.githubusercontent から本体(数十MBのzip)を丸ごとダウンロードして
// manifest.json だけを読む、という重い処理をしていた。この index.json は
// その結果(poolName/release/size)を事前に1つのJSONへまとめておくためのもの。
// サーバー側はこのファイル1つを取得するだけで一覧を組み立てられるようになる。
//
// 使い方: pool-exports/*.dvpool を追加/更新するたびに実行し、
// index.json も一緒にコミット・プッシュすること。
//   node tools/build-pool-export-index.js

const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");

const EXPORTS_DIR = path.join(__dirname, "..", "pool-exports");

function main() {
  const files = fs
    .readdirSync(EXPORTS_DIR)
    .filter((f) => /^[A-Za-z0-9._-]+\.dvpool$/.test(f))
    .sort();

  const index = files.map((fileName) => {
    const filePath = path.join(EXPORTS_DIR, fileName);
    const stat = fs.statSync(filePath);
    const zip = new AdmZip(filePath);
    const entry = zip.getEntry("manifest.json");
    let poolName = null;
    let release = null;
    if (entry) {
      try {
        const manifest = JSON.parse(entry.getData().toString("utf8"));
        poolName = manifest.poolName || null;
        release = manifest.release || null;
      } catch (err) {
        // 壊れたmanifest.jsonはpoolName/releaseなしのまま扱う(呼び出し側が
        // ファイル名からフォールバックする)。
      }
    }
    return {
      name: fileName,
      poolName: poolName || path.basename(fileName, ".dvpool"),
      release,
      size: stat.size,
    };
  });

  fs.writeFileSync(path.join(EXPORTS_DIR, "index.json"), JSON.stringify(index, null, 2) + "\n");
  console.log(`pool-exports/index.json を書き出しました(${index.length}件)`);
}

main();
