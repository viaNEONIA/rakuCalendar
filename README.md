# rakuCalendar

スマートフォンで1日の予定を入力し、縦の時間軸で確認・編集する軽量PWAです。初期版は日表示に集中し、予定は端末内に保存します。

## 開発環境

- Node.js 22.12 以降（または24以降）
- npm

```sh
npm install
npm run dev
npm test
npm run build
```

## 実装状況

- Phase 0: PWA基盤、IndexedDB schema v1、テスト/ビルド基盤
- Phase 1: 日表示、予定CRUD、現在時刻、次の予定、重複表示
- Phase 2: 長押しドラッグ、時間変更、Undo/Redo
- Phase 3: 設定、JSONバックアップ/復元、統合/置換
- Phase 4: 表示時間帯設定、ICS出力、オフラインシェル

各段階の差分・検証・未解決事項はGitHub PRに記載しています。仕様書は [docs/WORK_HANDOFF.md](docs/WORK_HANDOFF.md) です。

## 実機確認

GitHub Pagesへ `main` の更新ごとに自動デプロイします。初回はリポジトリ Settings > Pages の Source を GitHub Actions に設定してください。Actions の「Deploy GitHub Pages」が成功したら、[実機確認URL](https://viaNEONIA.github.io/rakuCalendar/)をAndroid Chromeで開きます。スマートフォンでのドラッグ、時間変更、重複表示、バックアップ、オフライン確認は [実機確認チェックリスト](docs/DEVICE_TEST_CHECKLIST.md) に記録します。

## 仕様上の未決定事項

行先を必須にするか、開始時刻の丸め方向、20分刻みのスナップ基準、重複多数時の集約方法、Undo/Redoの履歴範囲、ICS出力範囲とタイムゾーン詳細は未決定です。必要な段階で判断理由と暫定動作をPRに記録します。
