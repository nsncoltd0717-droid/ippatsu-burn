# 写真ペン太郎 forWindows

一発バーンの写真ペン太郎(リポジトリ直下の `pen.html`)を、Windows の窓で動くアプリにしたもの(Electron)。
中身はスマホ版と同じ。Excel・画像の書き出しは「名前を付けて保存」の窓で保存先を選ぶ。

## 組み立て

```
cd windows/pen
npm install
npm run build      # dist/写真ペン太郎forWindows_v<版>/ と同じ名前の zip ができる
npm start          # 手元で試す
```

- pen.html の版を上げたら `package.json` の `version` を合わせて組み立て直す。
- `pen.html` 自体はさわらない。Windows 版だけの手当て(題名の forWindows、sw.js を外す、書き出し名の受け渡し、写し太郎ボタンを隠す)は `build.js` が写すときに入れる。
- 写真や設定は `%APPDATA%\写真ペン太郎` に残る。フォルダを新しい版に置き換えても引き継がれる。
