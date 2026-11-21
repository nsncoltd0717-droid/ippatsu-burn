# 脳みそバーン無敵CAD forWindows（一発かまし太郎入り）

リポジトリ直下の `nomiso.html`・`kamashi.html`・`vendor/libredwg` を Electron で包んだ Windows 版。写真ペン太郎 forWindows(`windows/pen/`)と同じ作り。

- 組み立て: `cd windows/nomiso && npm install && npm run build` → `dist/脳みそバーン無敵CADforWindows_Setup_v<版>.exe`(インストーラー。Windows で組む)とフォルダ版
- Linux で試すだけなら `node build.js --no-setup`(フォルダ版と zip だけ)
- 版を上げるときは `package.json` の version を脳みそバーンの版に合わせて組み直す
- 元の HTML はさわらず、build.js が app/ に写すときに次だけ手当てする
  - sw.js を登録しない(独自スキーム app://nomiso/ で配信するため不要)
  - ⌂(アプリを選ぶ画面へ)を「③ かまし太郎へ」「① 脳みそバーンへ」の切り替えボタンにする(メニューの Ctrl+1 / Ctrl+2 でも切り替え)
  - 「くるくる回し太郎を開きますか?」は案内だけにする(Windows 版には入っていない)
  - 保存(a.download)の名前を本体に知らせ、「名前を付けて保存」の窓を出す
- データ(現場・設定)は `%APPDATA%\脳みそバーン無敵CAD`
- 引継ぎメモ: `引継ぎメモ_脳みそバーン無敵CADforWindows.md`(共有ドライブ `Claude(一撃墨太郎)\脳みそバーン\` と同じ内容)
