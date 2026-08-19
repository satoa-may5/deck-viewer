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

// ---- ビルド中は開発者自身のカードプールデータを退避しておく ----
//
// data/ と images/ は開発者がこのプロジェクトを普通に使って溜めた実データで、
// 配布物には一切入ってはいけない。ビルド中だけ .build-stash/ へ移動し、
// 成否にかかわらず必ず元の場所へ戻す(finallyで復元)。
// renameSyncを使うので同一ボリューム内の移動として一瞬で終わり、画像が
// 何百MBあってもコピー時間はかからない。
const STASH_DIR = path.join(ROOT, ".build-stash");
const STASH_TARGETS = ["data", "images"];

function moveDir(src, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.renameSync(src, dest);
}

// 前回のビルドが異常終了して退避したままになっていたら、まずそれを戻す。
// (戻さずに新しく退避すると、本物のデータを空データで上書きしてしまう)
function recoverAbandonedStash() {
  if (!fs.existsSync(STASH_DIR)) return;
  for (const name of STASH_TARGETS) {
    const stashed = path.join(STASH_DIR, name);
    if (!fs.existsSync(stashed)) continue;
    console.log(`前回のビルドで退避したままの ${name}/ を復元します`);
    moveDir(stashed, path.join(ROOT, name));
  }
  fs.rmSync(STASH_DIR, { recursive: true, force: true });
}

function stashUserData() {
  const stashed = [];
  fs.mkdirSync(STASH_DIR, { recursive: true });
  for (const name of STASH_TARGETS) {
    const src = path.join(ROOT, name);
    if (!fs.existsSync(src)) continue;
    moveDir(src, path.join(STASH_DIR, name));
    stashed.push(name);
  }
  if (stashed.length) console.log(`退避: ${stashed.join(", ")}`);
  return stashed;
}

function restoreUserData(stashed) {
  for (const name of stashed) {
    const src = path.join(STASH_DIR, name);
    if (!fs.existsSync(src)) continue;
    moveDir(src, path.join(ROOT, name));
  }
  fs.rmSync(STASH_DIR, { recursive: true, force: true });
  if (stashed.length) console.log(`復元: ${stashed.join(", ")}`);
}

recoverAbandonedStash();

const stashed = stashUserData();
try {
  // releaseDirはフォルダごと消さないこと。ここのexeをそのまま普段使いしている場合、
  // 隣に data/ images/ が生成されていて、消すとそのカードデータごと失われる
  // (実際に一度やってしまった)。差し替えるのはexe本体だけにする。
  fs.mkdirSync(releaseDir, { recursive: true });
  fs.rmSync(exePath, { force: true });

  console.log(`pkgでビルド中: ${exePath}`);
  execFileSync(
    "npx",
    ["pkg", ".", "--targets", "node22-win-x64", "--output", exePath],
    { cwd: ROOT, stdio: "inherit", shell: true }
  );

  // 配布zipにはexeだけを入れる。releaseDirをまるごと固めると、上記の
  // data/ images/(普段使いで溜めた自分のカードデータ)が配布物に混入してしまう。
  console.log(`zip化中: ${zipPath}`);
  fs.rmSync(zipPath, { force: true });
  const zip = new AdmZip();
  zip.addLocalFile(exePath, releaseName);
  zip.writeZip(zipPath);

  console.log(`完了: ${zipPath}`);
} finally {
  restoreUserData(stashed);
}
