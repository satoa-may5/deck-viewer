// 配布用パッケージ(dist/deck-viewer-<version>.zip)を作る。
//
// exeをダブルクリックすると同じ場所にdata/・images/フォルダが勝手に生成される
// ため、バラの.exeファイル1つだけを配ると、受け取った側のダウンロードフォルダ等
// 直下にそれらが散らかってしまう。専用フォルダ(deck-viewer-<version>/)の中に
// バージョン入りのexe名(deck-viewer-<version>.exe)を入れ、そのフォルダごとzip化
// することで、展開したフォルダの中で完結するようにしている。
//
// 使い方: node tools/package-release.js
//   (npm run build:exe のエイリアスとして package.json に登録済み)

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");

const ROOT = path.join(__dirname, "..");
const version = require(path.join(ROOT, "package.json")).version;
const releaseName = `deck-viewer-${version}`;
const releaseDir = path.join(ROOT, "dist", releaseName);
const exePath = path.join(releaseDir, `${releaseName}.exe`);
const zipPath = path.join(ROOT, "dist", `${releaseName}.zip`);

fs.rmSync(releaseDir, { recursive: true, force: true });
fs.mkdirSync(releaseDir, { recursive: true });

console.log(`pkgでビルド中: ${exePath}`);
execFileSync(
  "npx",
  ["pkg", ".", "--targets", "node22-win-x64", "--output", exePath],
  { cwd: ROOT, stdio: "inherit", shell: true }
);

console.log(`zip化中: ${zipPath}`);
fs.rmSync(zipPath, { force: true });
const zip = new AdmZip();
zip.addLocalFolder(releaseDir, releaseName);
zip.writeZip(zipPath);

console.log(`完了: ${zipPath}`);
