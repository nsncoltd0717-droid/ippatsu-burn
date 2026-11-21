# 引継ぎメモ：脳みそバーン無敵CAD forWindows（一発かまし太郎入り）

作成 2026-11-21（しおりちゃんの依頼で作成。ゆきちゃんとの共同作業。Windows 版はしおりちゃん側で作ったもの）

## ゆきちゃん・しおりちゃんの共同作業の決まり

- このメモは2人で使う正本。共有ドライブ `Claude(一撃墨太郎)\脳みそバーン\` に置き、GitHub `windows/nomiso/` の同じメモと同じ内容にそろえる。
- 作業を始める前に、このメモの「作業記録」と「確認したこと・まだのこと」を読む。Claude に頼むときは「引継ぎメモを読んでから」と言えば、続きから作業できる。
- 脳みそバーン・かまし太郎の中身（画面・機能）は、リポジトリ直下の `nomiso.html`・`kamashi.html` だけを直す（ふだんどおり make_apps.py で書き出したもの）。iPhone・Android 版も Windows 版も同じ HTML から作るので、直すのは1か所でよい。脳みそバーンの直しはふだんゆきちゃん側の担当。
- Windows 版だけの直し（窓・保存の窓・メニュー・切り替えボタン・インストーラーなど）は `windows/nomiso/` の中だけで行い、HTML には入れない。
- `nomiso.html` か `kamashi.html` の版を上げたら、どちらが上げても「版を上げるとき（組み直し）」の手順で Windows 版も組み直し、共有ドライブのインストーラーを入れ替える。
- 置き場所は2人とも見える所にそろえる：ソースは GitHub `ippatsu-burn`、配る物とこのメモは共有ドライブ `Claude(一撃墨太郎)\脳みそバーン\`。
- 作業したら、下の「作業記録」に1行足す（日付・誰・何を）。新しいものを下に足す。
- 写真ペン太郎 forWindows（`windows/pen/`、`Claude(一撃墨太郎)\写真ペン太郎\`）と同じ作り・同じ決まり。片方の作りを変えたら、もう片方もそろえる。

## 作業記録

| 日付 | 誰 | したこと |
|---|---|---|
| 2026-11-21 | しおりちゃん（Claude） | Windows 版 v0.13.0 を作成。しおりちゃんの依頼で一発かまし太郎 v1.3.1 も入れ、2本を切り替えて使う形にした（ソースは GitHub `windows/nomiso/`、PR #3） |
| 2026-11-21 | しおりちゃん（Claude） | 写真ペン太郎にそろえて「インストールパッケージ版」（`脳みそバーン無敵CADforWindows_Setup_v0.13.0.exe`）を作る形にした。インストーラーは Windows で組み立てる |

## これは何か

一発バーンの「脳みそバーン無敵CAD」（`nomiso.html`）と「一発かまし太郎」（`kamashi.html`）を、1つの Windows アプリにしたもの。中身・使い方はスマホ版と同じ。

- 版：v0.13.0（脳みそバーンの版にそろえる。中のかまし太郎は v1.3.1）
- 配り方：インストーラー `脳みそバーン無敵CADforWindows_Setup_v<版>.exe`
  - ダブルクリック → 入れる場所を選んで「インストール」。管理者権限は要らない（使う人ごとに入る）
  - デスクトップとスタートメニューに「脳みそバーン無敵CAD」ができる。消すときは「設定 → アプリ」から
  - 新しい版は、新しいインストーラーをそのまま実行すれば上書きされる
- 初回に「WindowsによってPCが保護されました」と出たら「詳細情報 → 実行」（署名していないため）
- インストールしない「フォルダ版」（zip を展開して `NomisoBurnCAD.exe`）も組み立てのたびにできる。予備として使える
- 2本の切り替え：画面左上のボタン（「③ かまし太郎へ」「① 脳みそバーンへ」）、またはメニュー「アプリ」の Ctrl+1 / Ctrl+2
- 現場の図面・座標は2本で共通（同じアプリの中の IndexedDB・localStorage）
- 書き出し（DXF・CSV・SIMA など）は「名前を付けて保存」の窓（初めは「ドキュメント」）
- くるくる回し太郎は入っていない。くるくるへ渡す場面では「タブレットのアプリで開いてください」と案内だけ出す

## 置き場所

| 何 | 場所 |
|---|---|
| インストーラー（配る物） | 共有ドライブ `D:\GoogleDrive\共有ドライブ\積算部\1.ATLUS\Claude(一撃墨太郎)\脳みそバーン\脳みそバーン無敵CADforWindows_Setup_v0.13.0.exe` |
| インストール先（既定） | 使う人のPCの `%LOCALAPPDATA%\Programs\` の下（PC で確認して書き足す） |
| 組み立て一式（ソース） | GitHub `nsncoltd0717-droid/ippatsu-burn` の `windows/nomiso/`（PR #3、ブランチ `claude/project-thread-1qehy3`） |
| 現場・設定のデータ | 使う人のPCの `%APPDATA%\脳みそバーン無敵CAD`（メニュー「ヘルプ → 版の情報」に出る）。アンインストールしても消えない |

## 作り方（仕組み）

- Electron 39.8.9。@electron/packager 20.3.0 で Windows 64bit 用のフォルダを組み立て、electron-builder 26.18.1（NSIS）でそのフォルダをインストーラーに包む。
- exe のアイコンと版情報は resedit 3.1.1 で書き換え。アイコンは `icon.ico`（写真ペン太郎と同じ、icon-512.png から作ったもの）。
- `app://nomiso/` という自前の住所で HTML を開く（file:// だと DWG 読み込み部品 vendor/libredwg（wasm）が動かないため）。
- HTML 自体はさわらない。Windows 版だけの手当ては `build.js` が `app/` に写すときに入れる：
  - 書き出しファイル名を本体に知らせる小さな script（app:// の blob 保存だと名前が「download」になるため。preload.js の `nomisoApp.noteDownload` と対）
  - 題名に「forWindows」を付ける
  - ホーム画面アプリ用の sw.js の登録を外す
  - ⌂（アプリを選ぶ画面へ）を、もう片方への切り替えボタンにする
  - 「くるくる回し太郎を開きますか?」を案内だけにする
  - 手当ての場所が見つからないと build.js がエラーで止まる。HTML の書き方が変わったら build.js の該当の文字列を直す

| ファイル | 役目 |
|---|---|
| `package.json` | 版・使う部品の版 |
| `main.js` | 窓・app:// の配信・保存の窓・メニュー（アプリ切り替え・拡大縮小・全画面） |
| `preload.js` | 書き出し名の受け渡し |
| `build.js` | HTML を写して手当て → フォルダ版を組み立て → exe のアイコン → zip → インストーラー |
| `icon.ico` | exe とインストーラーのアイコン |
| `README.md` | 組み立ての手短な説明 |

## 版を上げるとき（組み直し）

1. リポジトリ直下の `nomiso.html`・`kamashi.html` を新しい版にする（一発バーンのアプリ版と同じもの）。
2. `windows/nomiso/package.json` の `version` を脳みそバーンの版に合わせる。
3. Windows の PC で組み立て：
   ```
   cd windows/nomiso
   npm install
   npm run build
   ```
   `dist\` に `脳みそバーン無敵CADforWindows_Setup_v<版>.exe`（インストーラー）と、フォルダ版 `脳みそバーン無敵CADforWindows_v<版>\` ができる（zip は python があるときだけ）。Linux で試すだけなら `node build.js --no-setup`。
4. インストーラーを共有ドライブ `Claude(一撃墨太郎)\脳みそバーン\` に置き、古い版のインストーラーは消す。
5. このメモの「作業記録」に1行足す。

### PC（kkw01x）で組み立てる場合

- Node.js（`C:\Program Files\nodejs`）は写真ペン太郎のときに入れてあるので、そのまま組み立てられる。
- git は入っていない。ソースは GitHub のブランチの zip（`https://github.com/nsncoltd0717-droid/ippatsu-burn/archive/refs/heads/<ブランチ>.zip`）を取って展開すればよい。
- Claude に頼むときは、Remote Control で kkw01x の GoogleDrive フォルダを使う（プロジェクトの決まり）。

## 確認したこと・まだのこと

- 確認済み（クラウドの Linux 版 Electron で同じ main.js）：DXF を開いて表示、DWG 用 libredwg（wasm）の読み込み、IndexedDB・localStorage、2本の切り替え、保存の名前と「名前を付けて保存」の窓、画面のエラーなし。
- まだ：Windows 実機でのインストールと起動、実際の DWG 図面での確認。
- 自動更新はない。版を上げたらインストーラーを配り直す。

## 関連

- 同じ作りの Windows 版：写真ペン太郎（`windows/pen/`、PR #2、PC は `Claude(一撃墨太郎)\写真ペン太郎\`）
