// 写真ペン太郎 forWindows の組み立て
//   node build.js --prepare  … app/ に pen.html と部品を写すだけ(npm start 用)
//   node build.js            … Windows 用(64bit)に組み立てて dist/ にフォルダ・zip・インストーラー(setup.exe)を作る
//                              ※インストーラーは Windows で組み立てること(Linux では wine が要る)
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
  // pen.html はそのまま写す。Windows 版の手当て(題名・sw.js・書き出し名・2列の画面)は main.js が開くときに入れる
  const html = fs.readFileSync(path.join(REPO, 'pen.html'), 'utf8');
  if (!/<h1 class="hm">写真ペン太郎<small>v/.test(html)) throw new Error('pen.html の題名が見つかりません');
  fs.writeFileSync(path.join(APP, 'pen.html'), html);
  for (const f of ['desktop.js', 'desktop.css']) fs.copyFileSync(path.join(HERE, f), path.join(APP, f));
  fs.cpSync(path.join(REPO, 'vendor', 'libredwg'), path.join(APP, 'vendor', 'libredwg'), { recursive: true });
  // v2.13.0 から pen.html は共通部品(vendor/ipx/)を別ファイルで読む
  for (const d of ['ipx', 'opening']) if (fs.existsSync(path.join(REPO, 'vendor', d))) fs.cpSync(path.join(REPO, 'vendor', d), path.join(APP, 'vendor', d), { recursive: true });
  fs.copyFileSync(path.join(REPO, 'icon-512.png'), path.join(HERE, 'icon.png'));
  console.log('app/ を用意しました');
}

async function build() {
  prepare();
  const { packager } = require('@electron/packager');
  const ResEdit = require('resedit');

  fs.rmSync(DIST, { recursive: true, force: true });
  const NAME = '写真ペン太郎';
  const outs = await packager({
    dir: HERE, out: DIST, name: NAME, executableName: 'ShashinPenTaro',
    platform: 'win32', arch: 'x64', overwrite: true, asar: true, prune: true,
    appVersion: pkg.version, appCopyright: '一発バーン',
    ignore: [/^\/node_modules($|\/)/, /^\/desktop\.(js|css)$/, /^\/引継ぎ/, /^\/icon\.ico$/, /^\/dist($|\/)/, /^\/build\.js$/, /^\/README\.md$/, /^\/\.gitignore$/],
    win32metadata: { CompanyName: '一発バーン', FileDescription: NAME, ProductName: NAME, InternalName: NAME },
  });
  const outDir = outs[0];
  // 日本語と英語以外の言語ファイルは使わないので消す(少しでも軽く)
  const loc = path.join(outDir, 'locales');
  for (const f of fs.readdirSync(loc)) if (!/^(ja|en-US)\.pak$/.test(f)) fs.rmSync(path.join(loc, f));

  // exe のアイコンと説明を入れる(Linux でも動くように resedit で書き換える)
  const exe = path.join(outDir, 'ShashinPenTaro.exe');
  const ico = fs.readFileSync(path.join(HERE, 'icon.ico'));   // 16〜256 の大きさ入り(icon-512.png から作ったもの)
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
  インストーラー版：デスクトップかスタートメニューの「写真ペン太郎」から。
  フォルダ版(zip)：このフォルダの「ShashinPenTaro.exe」をダブルクリックします。

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

  // インストーラー(setup.exe)。上で作ったフォルダをそのまま NSIS で包む
  const builder = require('electron-builder');
  await builder.build({
    targets: builder.Platform.WINDOWS.createTarget('nsis', builder.Arch.x64),
    projectDir: HERE,
    prepackaged: path.join(DIST, folder),
    config: {
      appId: 'net.ippatsu.shashinpen',
      productName: NAME,
      copyright: '一発バーン',
      directories: { output: path.join(DIST, 'installer') },
      win: { icon: 'icon.ico', executableName: 'ShashinPenTaro', signAndEditExecutable: false },
      nsis: {
        oneClick: false, perMachine: false, allowElevation: true, allowToChangeInstallationDirectory: true,
        createDesktopShortcut: true, createStartMenuShortcut: true, shortcutName: NAME, uninstallDisplayName: NAME,
        installerIcon: 'icon.ico', uninstallerIcon: 'icon.ico', installerLanguages: ['ja_JP'], language: '1041',
        deleteAppDataOnUninstall: false, runAfterFinish: true,
        artifactName: `写真ペン太郎forWindows_Setup_v${pkg.version}.exe`,
      },
    },
  });
  const setup = `写真ペン太郎forWindows_Setup_v${pkg.version}.exe`;
  fs.renameSync(path.join(DIST, 'installer', setup), path.join(DIST, setup));
  fs.rmSync(path.join(DIST, 'installer'), { recursive: true, force: true });
  console.log('できました:', path.join(DIST, setup));
}

if (process.argv.includes('--prepare')) prepare();
else build().catch((e) => { console.error(e); process.exit(1); });
