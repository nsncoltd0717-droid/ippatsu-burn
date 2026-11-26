// 一発バーン forWindows の組み立て
//   node build.js --prepare   … app/ に全アプリと部品を写すだけ(npm start 用)
//   node build.js             … Windows 用(64bit)に組み立てて dist/ にフォルダ・zip・インストーラー(setup.exe)を作る
//   node build.js --no-setup  … インストーラーは作らない(Linux で試すとき。インストーラーは Windows で組み立てる)
//   node build.js --sign      … Windows で署名もする(Azure Artifact Signing。AZURE_CLIENT_SECRET が要る)
// 元にするのはリポジトリ直下の各アプリの HTML(一発バーンのアプリ版と同じもの)。HTML はそのまま写し、
// Windows 版の手当て(sw.js・書き出し名・パソコン向けの画面・写真ペン太郎の2列)は main.js が開くときに入れる。
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const HERE = __dirname;
const REPO = path.resolve(HERE, '..', '..');
const APP = path.join(HERE, 'app');
const DIST = path.join(HERE, 'dist');
const pkg = require('./package.json');
// コード署名(Azure Artifact Signing)。名前は秘密ではない。合い言葉は Windows の環境変数
// AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET にだけ置く(kkw01x)。無いときは署名せずに組む。
const SIGN = {
  endpoint: 'https://jpe.codesigning.azure.net/',
  codeSigningAccountName: 'ippatsu-signing',
  certificateProfileName: 'ippatsu-public',
  publisherName: process.env.IPPATSU_SIGN_PUBLISHER || '株式会社グランテス',
};
// 署名するのは、Windows で --sign を付けたときだけ(証明書プロファイルができるまでは付けない)
const CAN_SIGN = process.platform === 'win32' && process.argv.includes('--sign') && !!process.env.AZURE_CLIENT_SECRET;

// フォルダの中の exe・dll をまとめて署名する(スマート アプリ コントロールは dll も見る)
function signFolder(dir) {
  const ps = [
    '$ErrorActionPreference = "Stop"',
    'if (-not (Get-Module -ListAvailable -Name TrustedSigning)) { Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Force -Scope CurrentUser | Out-Null; Install-Module -Name TrustedSigning -Force -Scope CurrentUser -AllowClobber }',
    `Invoke-TrustedSigning -Endpoint '${SIGN.endpoint}' -CodeSigningAccountName '${SIGN.codeSigningAccountName}' -CertificateProfileName '${SIGN.certificateProfileName}' ` +
      `-FilesFolder '${dir.replace(/'/g, "''")}' -FilesFolderFilter 'exe,dll' -FilesFolderRecurse -FileDigest SHA256 -TimestampRfc3161 'http://timestamp.acs.microsoft.com' -TimestampDigest SHA256`,
  ].join('; ');
  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], { stdio: 'inherit' });
  console.log('署名しました:', dir);
}

const PAGES = ['index.html', 'nomiso.html', 'sumi.html', 'kamashi.html', 'kurukuru.html', 'utsushi.html', 'pen.html', 'hisoka.html'];

function prepare() {
  fs.rmSync(APP, { recursive: true, force: true });
  fs.mkdirSync(path.join(APP, 'win'), { recursive: true });
  for (const p of PAGES) {
    const html = fs.readFileSync(path.join(REPO, p), 'utf8');
    if (!/<\/html>/i.test(html)) throw new Error(p + ' が正しくありません');
    fs.writeFileSync(path.join(APP, p), html);
  }
  if (!/<h1 class="hm">写真ペン太郎<small>v/.test(fs.readFileSync(path.join(APP, 'pen.html'), 'utf8'))) throw new Error('pen.html の題名が見つかりません');
  for (const f of ['desktop.js', 'desktop.css']) fs.copyFileSync(path.join(REPO, 'windows', 'pen', f), path.join(APP, f));
  for (const f of ['common.js', 'common.css', 'rail.html']) fs.copyFileSync(path.join(HERE, f), path.join(APP, 'win', f));
  for (const f of ['icon-180.png', 'icon-192.png', 'icon-512.png', 'manifest.webmanifest']) fs.copyFileSync(path.join(REPO, f), path.join(APP, f));
  for (const d of ['libredwg', 'pdfjs', 'ipx', 'opening']) fs.cpSync(path.join(REPO, 'vendor', d), path.join(APP, 'vendor', d), { recursive: true });
  fs.copyFileSync(path.join(REPO, 'icon-512.png'), path.join(HERE, 'icon.png'));
  console.log('app/ を用意しました');
}

async function build() {
  prepare();
  const { packager } = require('@electron/packager');
  const ResEdit = require('resedit');

  fs.rmSync(DIST, { recursive: true, force: true });
  const NAME = '一発バーン';
  const EXE = 'IppatsuBurn';
  const outs = await packager({
    dir: HERE, out: DIST, name: EXE, executableName: EXE,
    platform: 'win32', arch: 'x64', overwrite: true, asar: true, prune: true,
    appVersion: pkg.version, appCopyright: '一発バーン',
    ignore: [/^\/node_modules($|\/)/, /^\/(common\.(js|css)|rail\.html)$/, /^\/引継ぎ/, /^\/icon\.ico$/, /^\/dist($|\/)/, /^\/build\.js$/, /^\/README\.md$/, /^\/\.gitignore$/],
    win32metadata: { CompanyName: '一発バーン', FileDescription: NAME, ProductName: NAME, InternalName: NAME },
  });
  const outDir = outs[0];
  // 日本語と英語以外の言語ファイルは使わないので消す(少しでも軽く)
  const loc = path.join(outDir, 'locales');
  for (const f of fs.readdirSync(loc)) if (!/^(ja|en-US)\.pak$/.test(f)) fs.rmSync(path.join(loc, f));

  // exe のアイコンと説明を入れる(Linux でも動くように resedit で書き換える)
  const exe = path.join(outDir, EXE + '.exe');
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
  // 署名は exe を書き換え終わってから(後で書き換えると署名が壊れる)
  if (CAN_SIGN) signFolder(outDir);
  else console.warn('署名なしで組みます(署名するときは Windows で node build.js --sign)');

  fs.writeFileSync(path.join(outDir, 'はじめにお読みください.txt'),
`一発バーン forWindows v${pkg.version}

■ 起動
  インストーラー版：デスクトップかスタートメニューの「一発バーン」から。
  フォルダ版(zip)：このフォルダの「IppatsuBurn.exe」をダブルクリックします。

■ 使い方
  左の帯でアプリを切り替えます(Ctrl+0〜7 でも切り替わります)。
  脳みそバーン・逃墨太郎・かまし太郎・くるくる・写し太郎・写真ペン太郎・ひそかに調べ太郎が入っていて、現場と写真は全アプリで共通です。
  書き出しは「名前を付けて保存」の窓が出るので、保存先を選びます。
  左の帯の「⟳ 更新」で、公開ページから全アプリの新しい版を取ってきます。帯の下に版が出ます。
  左の帯の「🖥 PC / ✋ タブレット」で、マウス・キーボード用と指で使う用(全体が少し大きい)を切り替えます。

■ データ
  写真・現場・設定はこのパソコンの %APPDATA%\\${NAME} に残ります(Alt でメニュー →「ヘルプ → データの保存場所を開く」)。
  初めて開いたとき、写真ペン太郎 forWindows の写真と設定(%APPDATA%\\写真ペン太郎)を写して引き継ぎます。
  新しい版に入れ替えるときは、このフォルダごと置き換えれば、写真や設定はそのまま引き継がれます。

${CAN_SIGN ? '' : `■ 初回に「WindowsによってPCが保護されました」と出たとき
  「詳細情報」→「実行」を押します(この組み立てには署名が付いていないため出ます)。
`}`, 'utf8');

  const zipName = `一発バーンforWindows_v${pkg.version}.zip`;
  const folder = `一発バーンforWindows_v${pkg.version}`;
  fs.renameSync(outDir, path.join(DIST, folder));
  // 日本語のファイル名が Windows のエクスプローラーで化けないように、Python の zipfile(UTF-8 の印付き)で固める
  try {
    execFileSync('python3', ['-c', 'import sys,os,zipfile\nz=zipfile.ZipFile(sys.argv[1],"w",zipfile.ZIP_DEFLATED,compresslevel=9)\nfor r,d,f in os.walk(sys.argv[2]):\n  for n in f: z.write(os.path.join(r,n))\nz.close()', zipName, folder], { cwd: DIST });
    console.log('できました:', path.join(DIST, zipName));
  } catch (e) {
    console.warn('zip は作れませんでした(python3 がない等)。フォルダはそのまま使えます:', path.join(DIST, folder));
  }

  if (process.argv.includes('--no-setup')) return;
  // インストーラー(setup.exe)。上で作ったフォルダをそのまま NSIS で包む
  const builder = require('electron-builder');
  await builder.build({
    targets: builder.Platform.WINDOWS.createTarget('nsis', builder.Arch.x64),
    projectDir: HERE,
    prepackaged: path.join(DIST, folder),
    config: {
      appId: 'net.ippatsu.burn',
      productName: NAME,
      copyright: '一発バーン',
      directories: { output: path.join(DIST, 'installer') },
      // 中の exe・dll は上で署名済み。ここではインストーラーとアンインストーラーに署名する
      win: { icon: 'icon.ico', executableName: EXE, signAndEditExecutable: CAN_SIGN, ...(CAN_SIGN ? { azureSignOptions: SIGN } : {}) },
      nsis: {
        oneClick: false, perMachine: false, allowElevation: true, allowToChangeInstallationDirectory: true,
        createDesktopShortcut: true, createStartMenuShortcut: true, shortcutName: NAME, uninstallDisplayName: NAME,
        installerIcon: 'icon.ico', uninstallerIcon: 'icon.ico', installerLanguages: ['ja_JP'], language: '1041',
        deleteAppDataOnUninstall: false, runAfterFinish: true,
        artifactName: `一発バーンforWindows_Setup_v${pkg.version}.exe`,
      },
    },
  });
  const setup = `一発バーンforWindows_Setup_v${pkg.version}.exe`;
  fs.renameSync(path.join(DIST, 'installer', setup), path.join(DIST, setup));
  fs.rmSync(path.join(DIST, 'installer'), { recursive: true, force: true });
  console.log('できました:', path.join(DIST, setup));
}

if (process.argv.includes('--prepare')) prepare();
else build().catch((e) => { console.error(e); process.exit(1); });
