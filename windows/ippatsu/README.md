# 一発バーン forWindows

一発バーンのアプリ（ホーム・脳みそバーン無敵CAD・ECP一撃逃墨太郎・一発かまし太郎・くるくる回し太郎・こっそり写し太郎・写真ペン太郎）を、
1つの Windows アプリにまとめたもの（Electron）。中身はリポジトリ直下の各 HTML（携帯・Web 版と同じもの）。

## 組み立て

```
cd windows/ippatsu
npm install
npm start                  # 手元で試す
npm run build              # dist/ にフォルダ・zip・インストーラー（Windows で組み立てる）
node build.js --no-setup   # インストーラーなし（Linux で試すとき）
```

- 元の HTML はさわらない。Windows 版の手当ては `main.js` が開くときに入れる（sw.js を外す、書き出しの名前、`common.css/js`、写真ペン太郎には `windows/pen/desktop.*`）。
- 左の帯（`rail.html`）は別の画面（WebContentsView）なので、アプリの作りに手を入れない。
- 全アプリを `app://pen/` で配る。住所が同じなので、現場（IndexedDB `ippatsu-genba`）・写真・設定を全アプリで共通に使える。住所を `pen` にしているのは、写真ペン太郎 forWindows のデータを引き継ぐため。
- データは `%APPDATA%\一発バーン`。初めて開いたとき `%APPDATA%\写真ペン太郎` があれば写す（`migrated.json` に記録）。
- 「⟳ 更新」（左の帯）は公開ページ（GitHub Pages）から全アプリの HTML・`common.*`・`rail.html`・`desktop.*` を取って `%APPDATA%\一発バーン\web` に置く。本体（main.js・preload.js）の更新はインストーラーで。
- 画面の手当てを直したら `common.js` の `SCREEN_VER` を上げる（左の帯の下に出る）。
- Linux で試すときは `LANG=C.UTF-8` にする（日本語のフォルダ名だと IndexedDB が開けないため。Windows では問題なし）。
