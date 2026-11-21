// 脳みそバーン無敵CAD forWindows を組み立てる:  cd windows/nomiso && npm install && node build.js
// 1. リポジトリ直下の nomiso.html・kamashi.html・vendor/libredwg を app/ に写す(元の HTML はさわらない)
// 2. Windows 用に小さく手当て(sw.js を使わない・⌂ を2本の切り替えに・くるくるへ飛ばない・保存の名前)
// 3. Electron で win32 x64 に固めて、exe のアイコンと版情報を書き換え、zip にする
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const HERE = __dirname;
const REPO = path.resolve(HERE, "..", "..");
const APPDIR = path.join(HERE, "app");
const DIST = path.join(HERE, "dist");
const pkg = require("./package.json");
const EXE = "NomisoBurnCAD";
const OUTNAME = `脳みそバーン無敵CADforWindows_v${pkg.version}`;

function rm(p) { fs.rmSync(p, { recursive: true, force: true }); }
function copyDir(src, dst) { fs.cpSync(src, dst, { recursive: true }); }
function must(s, from, to, label) {
  if (!s.includes(from)) throw new Error(`手当ての場所が見つかりません: ${label}`);
  return s.split(from).join(to);
}

// ---- ページの手当て
const HEAD = `<script>
// forWindows: app:// では a.download の名前が落ちるので、保存の前に名前を本体へ知らせる
(function () {
  var c = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    try { if (this.download && window.nomisoApp) window.nomisoApp.noteDownload(this.href, this.download); } catch (e) { /* */ }
    return c.apply(this, arguments);
  };
  window.IPPATSU_WINDOWS = true;
})();
</script>
<style>.menuback.winsw { min-width: 0 !important; width: auto !important; padding: 0 10px !important; font-size: 12px !important; white-space: nowrap; text-decoration: none; }</style>
`;
const KURU_ASK = '"\\n\\nくるくる回し太郎を開きますか?")';
const KURU_SAY = '"\\n\\n(くるくる回し太郎はタブレットのアプリで開いてください)"), false)';

function patch(src, me) {
  let s = src;
  const other = me === "nomiso" ? { href: "kamashi.html", label: "③ かまし太郎へ", title: "一発かまし太郎に切り替える(Ctrl+2)" }
                                : { href: "nomiso.html", label: "① 脳みそバーンへ", title: "脳みそバーン無敵CADに切り替える(Ctrl+1)" };
  if (!/^\s*<!DOCTYPE html>\s*<html[^>]*>\s*<head>/i.test(s)) throw new Error("手当ての場所が見つかりません: head");
  s = s.replace("<head>", "<head>\n" + HEAD);   // 最初の1つ(本物の head)だけ
  s = s.replace(/<title>([^<]*)<\/title>/, "<title>$1 forWindows</title>");
  s = must(s, 'navigator.serviceWorker.register("sw.js").catch(() => {});', "/* forWindows: sw.js は使わない */",
    "serviceWorker");
  s = must(s, '<a class="menuback" href="./" aria-label="アプリを選ぶ画面へ" title="アプリを選ぶ画面へ">⌂</a>',
    `<a class="menuback winsw" href="${other.href}" aria-label="${other.title}" title="${other.title}">${other.label}</a>`, "menuback");
  // くるくる回し太郎は Windows 版に入っていないので、「開きますか?」は案内だけにする
  s = s.replace(/confirm\((m|msg) \+ "\\n\\nくるくる回し太郎を開きますか\?"\)/g, (_all, v) => `(alert(${v} + ${KURU_SAY}`);
  if (s.includes(KURU_ASK)) throw new Error("くるくるの手当てが残っています");
  return s;
}

console.log("1/4 app/ を作る");
rm(APPDIR);
fs.mkdirSync(APPDIR, { recursive: true });
for (const me of ["nomiso", "kamashi"]) {
  const src = fs.readFileSync(path.join(REPO, `${me}.html`), "utf8");
  fs.writeFileSync(path.join(APPDIR, `${me}.html`), patch(src, me));
}
copyDir(path.join(REPO, "vendor", "libredwg"), path.join(APPDIR, "vendor", "libredwg"));
fs.copyFileSync(path.join(REPO, "icon-512.png"), path.join(HERE, "icon.png"));

// ---- Electron で固める
(async () => {
  console.log("2/4 Electron で固める");
  rm(DIST);
  const { packager } = require("@electron/packager");
  const [out] = await packager({
    dir: HERE, out: DIST, name: EXE, executableName: EXE, platform: "win32", arch: "x64",
    electronVersion: require("electron/package.json").version, asar: true, overwrite: true, prune: true,
    ignore: [/^\/dist($|\/)/, /^\/build\.js$/, /^\/\.gitignore$/, /^\/README\.md$/],
    appCopyright: "一発バーン", win32metadata: { CompanyName: "一発バーン", ProductName: pkg.productName, FileDescription: pkg.productName },
  });
  // 日本語と英語だけ残す
  const loc = path.join(out, "locales");
  for (const f of fs.readdirSync(loc)) if (!/^(ja|en-US)\.pak$/.test(f)) fs.rmSync(path.join(loc, f));

  console.log("3/4 exe のアイコンと版情報");
  const ResEdit = require("resedit");
  const pngToIco = (require("png-to-ico").default || require("png-to-ico"));
  const ico = await pngToIco(path.join(HERE, "icon.png"));
  const exePath = path.join(out, `${EXE}.exe`);
  const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(exe);
  const iconFile = ResEdit.Data.IconFile.from(ico);
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  const gid = groups.length ? groups[0].id : 1, glang = groups.length ? groups[0].lang : 1033;
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, gid, glang, iconFile.icons.map((i) => i.data));
  const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0];
  const [a, b, c] = pkg.version.split(".").map(Number);
  vi.setFileVersion(a, b, c, 0, 1041); vi.setProductVersion(a, b, c, 0, 1041);
  for (const lang of vi.getAllLanguagesForStringValues()) {
    vi.setStringValues(lang, { FileDescription: pkg.productName, ProductName: pkg.productName, CompanyName: "一発バーン",
      OriginalFilename: `${EXE}.exe`, InternalName: EXE, FileVersion: pkg.version, ProductVersion: pkg.version });
  }
  vi.outputToResourceEntries(res.entries);
  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));

  fs.writeFileSync(path.join(out, "はじめにお読みください.txt"), [
    `脳みそバーン無敵CAD forWindows  v${pkg.version}(一発かまし太郎入り)`,
    "",
    "■ 使い方",
    `  このフォルダの中の ${EXE}.exe をダブルクリックすると開きます。`,
    "  よく使うなら、exe を右クリック →「ショートカットの作成」→ できたショートカットをデスクトップへ。",
    "  インストールは要りません。フォルダごと好きな場所に置いて使えます(フォルダの中身はばらさないでください)。",
    "",
    "■ 2本の切り替え",
    "  上の「③ かまし太郎へ」「① 脳みそバーンへ」のボタン、またはメニューの「アプリ」(Ctrl+1 / Ctrl+2)で切り替えます。",
    "  現場の図面・座標は2本で共通です。",
    "",
    "■ 保存",
    "  DXF・CSV・SIMA などの書き出しは「名前を付けて保存」の窓が出るので、保存先を選んでください。",
    "",
    "■ 注意",
    "  初めて開くとき、Windows が「PC を保護しました」と出すことがあります。",
    "  その場合は「詳細情報」→「実行」を押してください(署名をしていないためで、中身は同じです)。",
    "  図面はこのパソコンの中で開くだけで、どこにも送られません。",
    "  データ(現場・設定)は %APPDATA%\\脳みそバーン無敵CAD に入ります。",
    "  くるくる回し太郎(杭ナビ)はこの Windows 版には入っていません。タブレットのアプリを使ってください。",
    "",
  ].join("\r\n"), "utf8");

  console.log("4/4 zip にする");
  const top = path.join(DIST, OUTNAME);
  fs.renameSync(out, top);
  const zip = path.join(DIST, `${OUTNAME}.zip`);
  execFileSync("python3", ["-I", "-c", `
import os, sys, zipfile
src, dst = sys.argv[1], sys.argv[2]
base = os.path.dirname(src)
with zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for root, dirs, files in os.walk(src):
        dirs.sort()
        for f in sorted(files):
            p = os.path.join(root, f)
            z.write(p, os.path.relpath(p, base))
`, top, zip], { stdio: "inherit" });
  console.log("できあがり:", zip, (fs.statSync(zip).size / 1048576).toFixed(1) + " MB");
})().catch((e) => { console.error(e); process.exit(1); });
