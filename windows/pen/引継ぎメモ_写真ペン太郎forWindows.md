# 引継ぎメモ：写真ペン太郎 forWindows

作成 2026-11-21（しおりちゃんの依頼で作成。ゆきちゃんとの共同作業。Windows 版はしおりちゃん側で作ったもの）

## ゆきちゃん・しおりちゃんの共同作業の決まり

- このメモは2人で使う正本。共有ドライブ `Claude(一撃墨太郎)\写真ペン太郎\` に置き、GitHub `windows/pen/` の同じメモと同じ内容にそろえる。
- 作業を始める前に、このメモの「作業記録」と「確認したこと・まだのこと」を読む。Claude に頼むときは「引継ぎメモを読んでから」と言えば、続きから作業できる。
- 写真ペン太郎の中身（画面・機能・Excel 出力）は `pen.html` 1つだけを直す。スマホ版も Windows 版も同じ `pen.html` から作るので、直すのは1か所でよい。
- Windows 版だけの直し（窓・保存の窓・メニュー・見出しの forWindows・インストーラーなど）は `windows/pen/` の中だけで行い、`pen.html` には入れない。
- `pen.html` の版を上げたら、どちらが上げても「版を上げるとき（組み直し）」の手順で Windows 版も組み直し、共有ドライブ `Claude(一撃墨太郎)\写真ペン太郎\` のインストーラーを入れ替える。
- 置き場所は2人とも見える所にそろえる：ソースは GitHub `ippatsu-burn`、配る物とこのメモは共有ドライブ `Claude(一撃墨太郎)\写真ペン太郎\`。
- 作業したら、下の「作業記録」に1行足す（日付・誰・何を）。新しいものを下に足す。

## 作業記録

| 日付 | 誰 | したこと |
|---|---|---|
| 2026-11-21 | しおりちゃん（Claude） | Windows 版 v0.2.0 を作成（ソースは GitHub `windows/pen/`、PR #2） |
| 2026-11-21 | しおりちゃん（Claude） | PC（kkw01x）に winget で Node.js LTS v26.13.1 を入れた |
| 2026-11-21 | しおりちゃん（Claude） | ブランチ `claude/project-thread-yof8ir` の zip から v0.2.0 を組み立て、フォルダと zip を共有ドライブ `写真ペン太郎\` に置いた（既存の 写真ペン太郎.html などはそのまま） |
| 2026-11-21 | しおりちゃん（Claude） | exe の起動を確認。窓の題名は「写真ペン太郎」、「v0.2.0 forWindows」は画面内の見出しに出る作り |
| 2026-11-21 | しおりちゃん（Claude） | このメモを共有ドライブに置き、ゆきちゃんとの共同作業の決まりと作業記録を足して、GitHub 側と1つにまとめた |
| 2026-11-21 | しおりちゃん（Claude） | しおりちゃんの依頼で「インストールパッケージ版」に変更。`写真ペン太郎forWindows_Setup_v0.2.0.exe`（インストーラー）を作る形にした。インストーラーは Windows で組み立てる（Linux では wine が要るため） |

## これは何か

一発バーンの「写真ペン太郎」（リポジトリ直下の `pen.html`）を、Windows の窓で動くアプリにしたもの。
中身・使い方はスマホ版と同じで、写真に黒板や書き込みを入れ、ひな形Excelに貼って書き出す。

- 版：v0.2.0（pen.html の版にそろえる）
- 配り方：インストーラー `写真ペン太郎forWindows_Setup_v<版>.exe`
  - ダブルクリック → 入れる場所を選んで「インストール」。管理者権限は要らない（使う人ごとに入る。入れる場所は変えられる）
  - デスクトップとスタートメニューに「写真ペン太郎」ができる。消すときは Windows の「設定 → アプリ」から「写真ペン太郎」をアンインストール
  - 新しい版は、新しいインストーラーをそのまま実行すれば上書きされる
- 初回に「WindowsによってPCが保護されました」と出たら「詳細情報 → 実行」（署名していないため）
- インストールしない「フォルダ版」（zip を展開して `ShashinPenTaro.exe`）も組み立てのたびにできる。予備として使える

## 置き場所

| 何 | 場所 |
|---|---|
| インストーラー（配る物） | 共有ドライブ `D:\GoogleDrive\共有ドライブ\積算部\1.ATLUS\Claude(一撃墨太郎)\写真ペン太郎\写真ペン太郎forWindows_Setup_v0.2.0.exe` |
| インストール先（既定） | 使う人のPCの `%LOCALAPPDATA%\Programs\写真ペン太郎\` |
| 組み立て一式（ソース） | GitHub `nsncoltd0717-droid/ippatsu-burn` の `windows/pen/`（PR #2、ブランチ `claude/project-thread-yof8ir`） |
| 写真・設定のデータ | 使う人のPCの `%APPDATA%\写真ペン太郎`（アプリのメニュー「ヘルプ → データの保存場所を開く」）。アンインストールしても消えない |

## 作り方（仕組み）

- Electron 39.8.9 を使ったアプリ。@electron/packager 20.3.0 で Windows 64bit 用のフォルダを組み立て、electron-builder 26.18.1（NSIS）でそのフォルダをインストーラーに包む。
- exe のアイコンと版情報は resedit 3.1.1 で書き換え。アイコンは `icon.ico`（icon-512.png から 16〜256 の大きさを入れて作ったもの）。
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
| `build.js` | pen.html を写して手当て → フォルダ版を組み立て → exe のアイコン → zip → インストーラー |
| `icon.ico` | exe とインストーラーのアイコン |
| `README.md` | 組み立ての手短な説明 |

## 版を上げるとき（組み直し）

1. リポジトリ直下の `pen.html` を新しい版にする（一発バーンのアプリ版と同じもの）。
2. `windows/pen/package.json` の `version` を pen.html の版に合わせる。
3. Windows の PC で組み立て（インストーラーは Windows でしか作れない）：
   ```
   cd windows/pen
   npm install
   npm run build
   ```
   `dist\` に `写真ペン太郎forWindows_Setup_v<版>.exe`（インストーラー）と、フォルダ版 `写真ペン太郎forWindows_v<版>\` ができる（フォルダ版の zip は python3 があるときだけ）。
4. インストーラーを共有ドライブ `Claude(一撃墨太郎)\写真ペン太郎\` に置き、古い版のインストーラーは消す。
5. このメモの「作業記録」に1行足す。

手元で試すだけなら `npm start`。

### PC（kkw01x）で組み立てる場合

- 2026-11-21 に winget で Node.js LTS（v26.13.1、`C:\Program Files\nodejs`）を入れたので、そのまま組み立てられる。
- git は入っていない。ソースは GitHub のブランチの zip（`https://github.com/nsncoltd0717-droid/ippatsu-burn/archive/refs/heads/<ブランチ>.zip`）を取って展開すればよい。
- Claude に頼むときは、Remote Control で kkw01x の GoogleDrive フォルダを使う（プロジェクトの決まり）。

## 確認したこと・まだのこと

- 確認済み：写真の取り込み、編集画面、Excel 書き出し（ファイル名つき）、再起動後に写真が残ること（Linux 版 Electron で）。PC（kkw01x）でフォルダ版の exe が起動して窓が開き、閉じられること。
- まだ：Windows 実機で写真を入れて Excel を書き出すところまでの通し確認。

## 関連

- 元の写真ペン太郎（スマホ版）：プロジェクトのスレッド「写真編集アプリを作る」（v0.2.0 で完成、Excel 出力は確認済み）
- 同じ作りの Windows 版：脳みそバーン無敵CAD（`windows/nomiso/`、PR #3、exe は NomisoBurnCAD.exe、PC は `Claude(一撃墨太郎)\脳みそバーン\`）
