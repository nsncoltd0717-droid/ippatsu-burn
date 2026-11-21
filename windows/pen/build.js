// 写真ペン太郎 forWindows の組み立て
//   node build.js --prepare  … app/ に pen.html と部品を写すだけ(npm start 用)
//   node build.js            … Windows 用(64bit)に組み立てて dist/ に zip を作る
// 元にするのはリポジトリ直下の pen.html(一発バーンのアプリ版と同じもの)。
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const HERE = __dirname;
const REPO = path.resolve(HERE, '..', '..');
const APP = path.join(HERE, 'app');
const DIST = path.join(HERE, 'dist');
const pkg = require('./package.json');

function prepare() {
  fs.rmSync(APP, { recursive: true, force: true });
  fs.mkdirSync(APP, { recursive: true });
  let html = fs.readFileSync(path.join(REPO, 'pen.html'), 'utf8');
  const patch = (from, to, what) => {
    if (!html.includes(from)) throw new Error('pen.html の書き換え箇所が見つかりません: ' + what);
    html = html.replace(from, to);
  };
  // 題名に forWindows を足す(版の番号は pen.html のまま)
  html = html.replace(/(<h1 class="hm">写真ペン太郎)(<small>v[^<]*<\/small>)/, (m, a, b) => `${a}${b.replace('</small>', ' forWindows</small>')}`);
  if (!html.includes(' forWindows</small>')) throw new Error('pen.html の題名が見つかりません');
  // ホーム画面アプリ用の sw.js はいらない(アプリの中に全部入っている)
  patch('navigator.serviceWorker.register("sw.js").catch(() => {});', '/* Windows版では使わない */', 'sw.js');
  // 書き出しの名前を Windows 版の本体へ知らせる(preload.js の penApp.noteDownload)
  patch('<meta charset="utf-8" />', `<meta charset="utf-8" />
<script>(function(){ if (!window.penApp) return; var c = HTMLAnchorElement.prototype.click;
HTMLAnchorElement.prototype.click = function(){ try { if (this.download && this.href) penApp.noteDownload(this.href, this.download); } catch (e) {} return c.apply(this, arguments); }; })();</script>
<style>/* 写し太郎は同じ端末のブラウザの中にあるので、Windows版からは読めない */ #bUts{display:none!important}</style>`, 'charset');
  fs.writeFileSync(path.join(APP, 'pen.html'), html);
  fs.cpSync(path.join(REPO, 'vendor', 'libredwg'), path.join(APP, 'vendor', 'libredwg'), { recursive: true });
  fs.copyFileSync(path.join(REPO, 'icon-512.png'), path.join(HERE, 'icon.png'));
  const v = (html.match(/<h1 class="hm">写真ペン太郎<small>v([0-9.]+)/) || [])[1];
  if (v && v !== pkg.version) console.warn(`※ pen.html は v${v}、package.json は ${pkg.version}。合わせてください`);
  console.log('app/ を用意しました');
}

async function build() {
  prepare();
  const { packager } = require('@electron/packager');
  const pngToIco = require('png-to-ico').default || require('png-to-ico');
  const ResEdit = require('resedit');

  fs.rmSync(DIST, { recursive: true, force: true });
  const NAME = '写真ペン太郎';
  const outs = await packager({
    dir: HERE, out: DIST, name: NAME, executableName: 'ShashinPenTaro',
    platform: 'win32', arch: 'x64', overwrite: true, asar: true, prune: true,
    appVersion: pkg.version, appCopyright: '一発バーン',
    ignore: [/^\/node_modules($|\/)/, /^\/dist($|\/)/, /^\/build\.js$/, /^\/README\.md$/, /^\/\.gitignore$/],
    win32metadata: { CompanyName: '一発バーン', FileDescription: NAME, ProductName: NAME, InternalName: NAME },
  });
  const outDir = outs[0];
  // 日本語と英語以外の言語ファイルは使わないので消す(少しでも軽く)
  const loc = path.join(outDir, 'locales');
  for (const f of fs.readdirSync(loc)) if (!/^(ja|en-US)\.pak$/.test(f)) fs.rmSync(path.join(loc, f));

  // exe のアイコンと説明を入れる(Linux でも動くように resedit で書き換える)
  const exe = path.join(outDir, 'ShashinPenTaro.exe');
  const ico = await pngToIco([path.join(HERE, 'icon.png')]);
  const data = fs.readFileSync(exe);
  const ex = ResEdit.NtExecutable.from(data);
  const res = ResEdit.NtExecutableResource.from(ex);
  const iconFile = ResEdit.Data.IconFile.from(ico);
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, 1, 1041,
    iconFile.icons.map((i) => i.data));
  const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0];
  if (vi) {
    const [a, b, c] = pkg.version.split('.').map(Number);
    vi.setFileVersion(a, b, c, 0, 1041); vi.setProductVersion(a, b, c, 0, 1041);
    vi.setStringValues({ lang: 1033, codepage: 1200 }, { FileDescription: NAME, ProductName: NAME, CompanyName: '一発バーン' });
    vi.outputToResourceEntries(res.entries);
  }
  res.outputResource(ex);
  fs.writeFileSync(exe, Buffer.from(ex.generate()));

  fs.writeFileSync(path.join(outDir, 'はじめにお読みください.txt'),
`写真ペン太郎 forWindows v${pkg.version}

■ 起動
  このフォルダの「ShashinPenTaro.exe」をダブルクリックします。
  よく使うなら、右クリック →「スタートにピン留めする」か「送る → デスクトップ (ショートカットを作成)」。

■ 使い方
  スマホ版と同じです。写真はボタンから選ぶか、窓へドラッグして入れます。
  Excel・画像の書き出しは「名前を付けて保存」の窓が出るので、保存先を選びます。

■ データ
  写真や設定はこのパソコンの %APPDATA%\\${NAME} に残ります(メニュー「ヘルプ → データの保存場所を開く」)。
  新しい版に入れ替えるときは、このフォルダごと置き換えれば、写真や設定はそのまま引き継がれます。

■ 初回に「WindowsによってPCが保護されました」と出たとき
  「詳細情報」→「実行」を押します(社内で作ったアプリで、署名をしていないため出ます)。
`, 'utf8');

  const zipName = `写真ペン太郎forWindows_v${pkg.version}.zip`;
  const folder = `写真ペン太郎forWindows_v${pkg.version}`;
  fs.renameSync(outDir, path.join(DIST, folder));
  // 日本語のファイル名が Windows のエクスプローラーで化けないように、Python の zipfile(UTF-8 の印付き)で固める
  try {
    execFileSync('python3', ['-c', 'import sys,os,zipfile\nz=zipfile.ZipFile(sys.argv[1],"w",zipfile.ZIP_DEFLATED,compresslevel=9)\nfor r,d,f in os.walk(sys.argv[2]):\n  for n in f: z.write(os.path.join(r,n))\nz.close()', zipName, folder], { cwd: DIST });
    console.log('できました:', path.join(DIST, zipName));
  } catch (e) {
    console.warn('zip は作れませんでした(python3 がない等)。フォルダはそのまま使えます:', path.join(DIST, folder));
  }
}

if (process.argv.includes('--prepare')) prepare();
else build().catch((e) => { console.error(e); process.exit(1); });
