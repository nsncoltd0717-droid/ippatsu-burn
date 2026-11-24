# 引継ぎメモ：一発バーン forWindows

> 携帯の一発バーンと共通の更新メモ：リポジトリ直下 `更新メモ_一発バーン×写真ペン太郎.md`（共有ドライブ `Claude(一撃墨太郎)\` 直下にも写し）。更新したら、そちらにも1行足すこと。

作成 2026-11-25（しおりちゃんの依頼。写真ペン太郎 forWindows と 脳みそバーン無敵CAD forWindows を1つにまとめたもの）

## これは何か

一発バーンの全アプリを、1つの Windows アプリにまとめたもの。窓の左の帯でアプリを切り替える（Ctrl+0〜6 でも切り替わる）。

| 帯 | アプリ | 元の HTML | パソコン向けの手当て |
|---|---|---|---|
| ⌂ ホーム | 一発バーン（現場の一覧） | `index.html` | クラウド共有の欄は隠している（下の「まだのこと」） |
| ① 脳みそ | 脳みそバーン無敵CAD | `nomiso.html` | 図面を左・操作を右の2列 |
| ② 逃墨 | ECP一撃逃墨太郎 | `sumi.html` | 同上 |
| ③ かまし | 一発かまし太郎 | `kamashi.html` | 同上 |
| ④ くるくる | くるくる回し太郎 | `kurukuru.html` | 同上。USB/シリアルは「つなぐ口を選ぶ」窓を出す |
| ⑤ 写し | こっそり写し太郎 | `utsushi.html` | そのまま（たたき台） |
| ⑥ ペン | 写真ペン太郎 | `pen.html` | 写真ペン太郎 forWindows の2列の画面（`windows/pen/desktop.*`）をそのまま使う |

- 版：本体 0.5.0（`package.json`）。左の帯の下に「本体 0.5.0 / 中身 v2.9.1（一発バーンの版）/ 画面 11-25a（`common.js` の SCREEN_VER）」が出る。帯の版にマウスを載せると、最後に更新した日時も出る
- 現場・写真・設定は全アプリで共通（同じ住所 `app://pen/` で動かしているため）。携帯とは別に持つ
- データ：`%APPDATA%\一発バーン`。初めて開いたとき、写真ペン太郎 forWindows のデータ（`%APPDATA%\写真ペン太郎`）を写して引き継ぐ（写した物は `migrated.json` に記録）。写真ペン太郎 forWindows は、引き継ぎを確かめたらアンインストールしてよい（元のデータは残る）
- 書き出しは「名前を付けて保存」の窓。前に選んだフォルダを覚える
- 「⟳ 更新」（左の帯）：公開ページから全アプリの新しい版を取ってくる。本体（main.js・preload.js）が変わったときはインストーラーで入れ直す

## 配り方

- インストーラー `一発バーンforWindows_Setup_v<版>.exe`（共有ドライブ `Claude(一撃墨太郎)\一発バーン\`）。管理者権限は要らない。デスクトップとスタートメニューに「一発バーン」ができる
- **署名がまだない**ので、ノートPC（Acer、スマート アプリ コントロールが有効）では止められる。コード署名証明書（OV）を買う方針。届いたら build.js の electron-builder 設定に署名を足して組み直す。kkw01x では入る

## 作り（windows/ippatsu/）

- `main.js`：窓（BaseWindow）の左に帯（`rail.html`、WebContentsView）、右にアプリ（WebContentsView）。`app://pen/` で `app/` を配り、開くときに手当てする
  - 全ページ：sw.js の登録を外す、`<head>` に書き出し名の受け渡し（`ippatsuApp.noteDownload`）と `win/common.css`、`</body>` の前に `win/common.js`
  - pen.html：さらに見出しに「forWindows 版」、`desktop.css`・`desktop.js`（写真ペン太郎 forWindows と同じ）
  - 写真ペン太郎の編集は別の窓（`pen.html?edit=`）。写真フォルダを見る `pen:*` の橋渡しは写真ペン太郎 forWindows と同じ
  - くるくるの Web Serial：`select-serial-port` で口を選ぶ窓。権限はすべて許可
- `preload.js`：`ippatsuApp`（全アプリ共通）と `penApp`（desktop.js 用。写真ペン太郎 forWindows と同じ形）
- `common.css / common.js`：パソコン向けの手当て（たたき台）。図面系4本（`body > main` に `#cv`、`body > .sheet`）を2列にし、境目をドラッグで右の欄の幅を変えられる（アプリごとに localStorage `ipw.side.<アプリ>`）
- `build.js`：リポジトリ直下の HTML・`vendor/libredwg`・`vendor/pdfjs`・`windows/pen/desktop.*` を `app/` に写し、packager → resedit（アイコン・版）→ zip → electron-builder（NSIS）。exe は `IppatsuBurn.exe`、appId `net.ippatsu.burn`
- 脳みそバーン無敵CAD forWindows（ブランチ `claude/project-thread-1qehy3`、PR #3）から取り込んだ物：保存名の受け渡し、sw.js を外す、Ctrl+数字の切替。⌂ を2本の切替ボタンにする手当てと「くるくるを開きますか?」を案内だけにする手当ては、左の帯とくるくる入りになったので要らなくなった

## 版を上げるとき

- 画面だけ（`common.*`・`rail.html`・各 HTML・`windows/pen/desktop.*`）：main に入れて公開ページに出れば、各PCの「⟳ 更新」で届く。`common.js` の SCREEN_VER を上げる
- 本体（`main.js`・`preload.js`・`package.json`）：`package.json` の version を上げ、Windows（kkw01x）で `npm install` → `npm run build`、共有ドライブ `一発バーン\` のインストーラーを入れ替え（古い物は `旧ファイル\` へ）
- どちらも、このメモの作業記録と共通の更新メモに1行足す

## 確認したこと・まだのこと

- 確認（Linux の Electron）：全7画面が開く、図面系の2列と境目のドラッグ、DXF の表示、保存名、写真ペン太郎のデータの引き継ぎ（IndexedDB・localStorage）、「⟳ 更新」（公開ページの代わりに手元のサーバーで）
- まだ：Windows 実機での起動、くるくるのシリアル接続、写し太郎のカメラ、ホームの「クラウド共有」（Electron で共有フォルダを選ぶと本体が落ちる件が写真ペン太郎のスレッドで見つかっている。原因を確かめてから出す）

## 作業記録

| 日付 | 誰 | したこと |
|---|---|---|
| 2026-11-25 | しおりちゃん（Claude） | 一発バーン forWindows 0.5.0 を作成。写真ペン太郎 forWindows（0.4.1）と脳みそバーン無敵CAD forWindows（PR #3）を1つにまとめ、ほかのアプリも入れた。図面系4本は2列の画面に |
