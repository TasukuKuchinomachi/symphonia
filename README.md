# symphonia

OpenAI [`symphony`](https://github.com/openai/symphony) を Claude Code 用にオマージュ実装した、
**カンバン駆動 + Claude Code エージェントオーケストレーター**です。

- カンバンボード上の **Task** が作業の単位
- AI エージェントが Task を **Grain** (作業の最小単位) に分解 (**Plan** フェーズ)
- 人間が Grain 一覧を承認すると、`git worktree` を Grain ごとに切って **並列実装** (**Implement** フェーズ)
- 各 Grain は型チェック + テストの品質ゲートを通過したら Task ブランチに `--no-ff` マージ
- 全 Grain が終わったら **Review** エージェントが diff を読んで verdict を返す
  - APPROVE → `gh pr create` で PR を作成
  - REQUEST_CHANGES → 追加 Grain を生成して再実行 (最大 5 回)

シングルユーザー / ローカル起動 / SQLite 永続化。

## アーキテクチャ

```
Next.js (App Router, single process)
├── UI                      Kanban + Task 詳細 (SSE で agent stdout をストリーム)
├── Server Actions          CRUD / Plan 起動 / Approve 起動
├── In-process worker       DAG ベースで Grain を並列スケジュール
└── Spawned `claude` CLIs   Plan / Implement / Review × N
```

エージェントは 3 種類すべて `claude -p --bare --output-format=stream-json --permission-mode acceptEdits`
で **子プロセス** として起動されます (`--bare` で auto-memory / hooks / CLAUDE.md 自動探索を切って、
専用 system prompt を `--system-prompt` で渡します)。stdout/stderr の各行は `LogEvent` テーブルに
書き込まれ、ブラウザは Task 詳細を開いている間 `/api/tasks/[id]/stream` を SSE 購読します。

## 起動

前提:

- Node 22+ (このリポジトリは 24 で開発)
- `pnpm`
- `git` / `gh` (GitHub CLI) で `gh auth status` が通っていること
- `claude` CLI が PATH 上にあり、`claude auth status` が通っていること

```bash
pnpm install
cp .env.example .env   # 必要なら ANTHROPIC_API_KEY や WORKSPACE_DIR を編集
pnpm prisma db push    # SQLite を初期化
pnpm dev               # http://localhost:3000
```

UI を開いたら:

1. **New Project** で GitHub リポジトリ (`owner/repo`) を登録
2. Project を開いて **New Task** で Task を Backlog に追加
3. カードの **Plan** を押すと Plan エージェントが Grain を生成し `Awaiting Approval` レーンへ
4. 内容を確認して **Approve** を押すと、依存関係に沿って worktree を切りつつ並列実装が走る
5. Review エージェントが APPROVE すると `gh pr create` で PR が作成され `Done` レーンへ

## Grain DAG

Plan エージェントが返す JSON で `dependsOn: [<前段の index>]` を指定します。
依存が解決済みの Grain は同時に起動され、上限は `SYMPHONIA_MAX_PARALLEL` (デフォルト 3) です。
worktree は `$SYMPHONIA_WORKSPACE_DIR/worktrees/<grainId>` に作られ、マージ後に
`git worktree remove --force` で消されます。

## 環境変数

| 変数 | デフォルト | 用途 |
|---|---|---|
| `DATABASE_URL` | `file:./prisma/dev.db` | Prisma + SQLite |
| `SYMPHONIA_WORKSPACE_DIR` | `~/workspace/.symphonia-workspaces` | clone / worktree の置き場所 |
| `CLAUDE_BIN` | `claude` | Claude Code CLI のバイナリパス |
| `ANTHROPIC_API_KEY` | (任意) | `--bare` モードで claude が読みに行く |
| `SYMPHONIA_MAX_PARALLEL` | `3` | Grain の同時実行数 |

## 設計メモ

- **`--permission-mode acceptEdits` + `--allowed-tools` 明示**
  worktree 内では編集を自動承諾し、bash は `pnpm/npm/node/git diff` 系のみ。
  worktree の外側 (project clone のメタファイル) は触れません。
- **`--bare` を使う理由**: 各 Grain はクリーンな system prompt で動かしたいので、ユーザーの auto
  memory / CLAUDE.md / hooks が走らないようにしています。リポジトリ固有の規約は対象 worktree の
  CLAUDE.md を agent が Read することで取り込みます。
- **Plan / Review は JSON 出力**: extractJson で fenced block を取り出す。失敗時は `FAILED` レーン。

## 既知の制約 (MVP)

- in-process worker のため、Next.js を再起動するとリトライ中の状態がリセットされます (DB 上は残る)。
- `git push` / PR 作成は `Done` 直前の 1 回のみ。途中 PR は出ません。
- conflict resolution は今のところ手動 (merge が失敗したら Task を FAILED にして停止)。
