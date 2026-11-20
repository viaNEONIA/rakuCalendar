# rakuCalendar

スマートフォンで1日の予定を入力し、縦の時間軸で確認・編集する軽量PWAです。初期版は日表示に集中し、予定は端末内に保存します。

## 開発環境

- Node.js 20 以降
- npm

```sh
npm install
npm run dev
npm test
npm run build
```

## 実装状況

- Phase 0: PWA基盤、IndexedDB schema v1、テスト/ビルド基盤
- Phase 1: 日表示、予定の追加・編集・削除、現在時刻、次の予定、重複の横並び表示
- Phase 2: 長押しドラッグ移動、上下端の時間変更、10分スナップ、Undo/Redo
- Phase 3: 操作刻み/表示設定、JSONバックアップ/復元、統合/置換、復元競合の選択
- 後続: ICS出力、表示時間帯/重複集約などの仕上げ

各段階の差分・検証・未解決事項はGitHub PRに記載しています。仕様書は [docs/WORK_HANDOFF.md](docs/WORK_HANDOFF.md) です。

## 仕様上の未決定事項

行先を必須にするか、開始時刻の丸め方向、20分刻みのスナップ基準、重複多数時の集約方法、Undo/Redoの履歴範囲、ICS出力範囲とタイムゾーン詳細は未決定です。必要な段階で判断理由と暫定動作をPRに記録します。
