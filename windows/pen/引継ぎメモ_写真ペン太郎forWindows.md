# 引継ぎメモ：写真ペン太郎 forWindows

作成 2026-11-21（しおりちゃんの依頼で作成。ゆきちゃん側ではなく、しおりちゃん側で作ったもの）

## これは何か

一発バーンの「写真ペン太郎」（リポジトリ直下の `pen.html`）を、Windows の窓で動くアプリにしたもの。
中身・使い方はスマホ版と同じで、写真に黒板や書き込みを入れ、ひな形Excelに貼って書き出す。

- 版：v0.2.0（pen.html の版にそろえる）
- 起動：フォルダの中の `ShashinPenTaro.exe` をダブルクリック（インストール不要のポータブル版）
- 初回に「WindowsによってPCが保護されました」と出たら「詳細情報 → 実行」（署名していないため）

## 置き場所

| 何 | 場所 |
|---|---|
| アプリ本体（PC） | `D:\GoogleDrive\共有ドライブ\積算部\1.ATLUS\Claude(一撃墨太郎)\写真ペン太郎\写真ペン太郎forWindows_v0.2.0\` |
| 配布用zip（PC） | 同じ `写真ペン太郎\` に `写真ペン太郎forWindows_v0.2.0.zip`（約122MB） |
| 配布用zip（プロジェクト） | プロジェクトのフォルダ `Claude測量/写真ペン太郎/写真ペン太郎forWindows_v0.2.0.zip` |
| 組み立て一式（ソース） | GitHub `nsncoltd0717-droid/ippatsu-burn` の `windows/pen/`（PR #2、ブランチ `claude/project-thread-yof8ir`） |
| 写真・設定のデータ | 使う人のPCの `%APPDATA%\写真ペン太郎`（アプリのメニュー「ヘルプ → データの保存場所を開く」） |

他の人に渡すときは zip を渡し、好きな場所に展開して exe を起動してもらえばよい。
データは各PCの %APPDATA% に残るので、フォルダを新しい版に置き換えても写真や設定は消えない。

## 作り方（仕組み）

- Electron 39.8.9 を使ったアプリ。@electron/packager 20.3.0 で Windows 64bit 用に組み立てる。
- exe のアイコンと版情報は resedit 3.1.1 ＋ png-to-ico 3.0.2 で書き換え（Linux でも Windows でも組み立てられる）。
- `app://pen/` という自前の住所で `pen.html` を開く（file:// だと DWG 読み込み部品 vendor/libredwg が動かないため）。
- `pen.html` 自体はさわらない。Windows 版だけの手当ては `build.js` が写すときに入れる：
  - 見出しに「forWindows」を付ける
  - ホーム画面アプリ用の sw.js の登録を外す
  - 書き出しファイル名を本体に知らせる小さな script（app:// の blob 保存だと名前が「download」になってしまうため。preload.js の `penApp.noteDownload` と対）
  - 「写し太郎の写真から」ボタンを隠す（写し太郎の写真は同じ端末のブラウザ内にあり、Windows 版からは読めない）
- Excel・画像の書き出しは「名前を付けて保存」の窓で保存先を選ぶ。前に選んだフォルダを覚える。保存後に「開く／フォルダを開く」を出す。

| ファイル | 役目 |
|---|---|
| `package.json` | 版・使う部品の版 |
| `main.js` | 窓・app:// の配信・保存の窓・メニュー |
| `preload.js` | 書き出し名の受け渡し |
| `build.js` | pen.html を写して手当て → 組み立て → exe のアイコン → zip |
| `README.md` | 組み立ての手短な説明 |

## 版を上げるとき（組み直し）

1. リポジトリ直下の `pen.html` を新しい版にする（一発バーンのアプリ版と同じもの）。
2. `windows/pen/package.json` の `version` を pen.html の版に合わせる。
3. 組み立て：
   ```
   cd windows/pen
   npm install
   npm run build
   ```
   `dist\写真ペン太郎forWindows_v<版>\` と同名の zip ができる（zip は python3 があるときだけ。無くてもフォルダはそのまま使える）。
4. できたフォルダ（と zip）を PC の `Claude(一撃墨太郎)\写真ペン太郎\` に置く。古い版のフォルダは消してよい（データは %APPDATA% 側にある）。

手元で試すだけなら `npm start`。

### PC（kkw01x）で組み立てる場合

- 2026-11-21 に winget で Node.js LTS（v26.13.1、`C:\Program Files\nodejs`）を入れたので、そのまま組み立てられる。
- git は入っていない。ソースは GitHub のブランチの zip（`https://github.com/nsncoltd0717-droid/ippatsu-burn/archive/refs/heads/<ブランチ>.zip`）を取って展開すればよい。
- Claude に頼むときは、Remote Control で kkw01x の GoogleDrive フォルダを使う（プロジェクトの決まり）。

## 確認したこと・まだのこと

- 確認済み：写真の取り込み、編集画面、Excel 書き出し（ファイル名つき）、再起動後に写真が残ること（Linux 版 Electron で）。PC（kkw01x）で exe が起動して窓が開き、閉じられること。
- まだ：Windows 実機で写真を入れて Excel を書き出すところまでの通し確認。

## 関連

- 元の写真ペン太郎（スマホ版）：プロジェクトのスレッド「写真編集アプリを作る」（v0.2.0 で完成、Excel 出力は確認済み）
- 同じ作りの Windows 版：脳みそバーン無敵CAD（`windows/nomiso/`、PR #3、exe は NomisoBurnCAD.exe、PC は `Claude(一撃墨太郎)\脳みそバーン\`）
