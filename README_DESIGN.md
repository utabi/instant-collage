
# デジタルコラージュアプリ設計書

## 1. 目的
インターネット上の画像（人物に限らず多種多様）を取り込み、AIで「いい感じに切り抜き」→ ブラウザ上の作業空間に配置してコラージュ制作できるアプリを、Macローカルで動かす。

## 2. 要件整理

### 2.1 コア要件（必須）
- 画像取り込み
  - キーワード検索：入力したキーワードでWeb画像検索 → 候補から1つ選択
  - ローカルファイル読み込み / ドラッグ&ドロップ
  - 画像はプロジェクト内に保存（データURL or バイナリ保存）して再現可能にする
- AI切り抜き（セグメンテーション）
  - 人物以外も対象（汎用セグメンテーション）
  - 画像→「透過PNG（アルファ付き）」または「マスク + 元画像」で返す
- 配置・変形（Konva）
  - 移動 / 拡大縮小 / 回転
- 重なり順（Zオーダー）
  - 前面へ / 背面へ / 1つ上 / 1つ下（ショートカットで操作）
- キャンバス（アートボード）挙動
  - 作業空間：無限（スクロール/パン/ズーム）を想定
  - アートボード：書き出し対象の矩形
  - **アートボード内に入った部分だけ表示（クリップ）**
  - **完全にアートボード外にある部分は、作業空間側では"消さない"（削除しない）**
    - ＝外側にもオブジェクトは存在し、編集のために見える状態にできる（表示ON/OFFはUIで選べる）
- 履歴（Undo/Redo）
  - ⌘Z / ⌘⇧Z（macOS） / Ctrl+Z / Ctrl+Shift+Z（Windows/Linux）
  - 操作ごとにスナップショットを保持（移動、回転、削除、追加など）
  - 履歴スタックの上限設定（メモリ対策、例：50件）
- 自動保存（二重保存）
  - localStorage：変更があったら即座に書き込み（リアルタイム）
  - project.json：変更があったら30秒おきに書き込み（ファイル保存）
  - 両者は同じデータ構造
  - ブラウザ再読み込み時はlocalStorageから復元
- 削除操作
  - Delete / Backspaceキーで選択中のオブジェクトを削除
- 書き出し（Export）
  - アートボード範囲をPNG/WebP/JPEGで保存
  - 解像度（ピクセル比）指定可能
  - 背景透過オプション

### 2.2 任意（後回しOK）
- 切り抜き後の手動修正（マスクブラシ）
- 影/縁取り/色調補正
- PSD風のJSON + アセット書き出し

## 3. 全体アーキテクチャ（ローカル前提）

### 3.1 構成
- フロント：Vite + React（任意） + Konva.js（必須）
- ローカルサーバ：Python + FastAPI（推奨）
  - セグメンテーション実行（GPUなしでも動くモデル選定）
  - 画像のキャッシュ、プロジェクト保存補助（任意）
- データ保存：ローカルファイル
  - `project.json`（シーン定義）
  - `assets/`（元画像・切り抜き結果・マスク等）

### 3.2 データフロー
1) キーワード入力 → サーバでWeb画像検索 → 候補を返却
2) フロントで候補表示 → ユーザーが1つ選択
3) 選択した画像をプレビュー → 「切り抜き」ボタン押下
4) 画像をローカルサーバへ送信（セグメンテーション実行）
5) サーバから透過PNG（or mask）返却
6) フロントでKonva上にノード作成・配置
7) 状態保存（localStorage即時 + project.json 30秒おき）

### 3.3 保存戦略
- **localStorage**（即時保存）
  - 変更のたびに即座に書き込み
  - ブラウザクラッシュ・リロード時の復元用
  - 容量制限あり（約5MB）→ 画像はDataURLで持つと圧迫するため注意
- **project.json**（定期保存）
  - 変更検知後、30秒おきにサーバへPOST
  - 永続保存、バックアップ用
  - 画像アセットは別ファイル（`assets/`）参照

## 4. Konva設計（ステージ/レイヤ）

### 4.1 レイヤ構成（例）
- `Layer: background`（作業空間の背景、グリッド）
- `Layer: outsidePreview`（アートボード外も“見える”モード用：薄く表示）
- `Layer: artboardContent`（アートボード内の最終見た目：クリップされる）
- `Layer: uiOverlay`（選択枠、ハンドル、ガイド、HUD）

### 4.2 「アートボード内だけ表示（クリップ）」の実装方針
- `Konva.Group` を1つ作り、そこにコラージュ要素を入れる
- そのGroupに `clipX/clipY/clipWidth/clipHeight` もしくは `clipFunc` を設定
- 作業用に「外側も見える」モードが欲しければ：
  - 同じ要素を `outsidePreview` に “参照表示”（または一時的にクリップ無効化）
  - もしくは「編集時はクリップ無し、書き出し時だけクリップ」を採用

### 4.3 重なり順（Zオーダー）
Konvaは「同一親の子要素の順＝描画順」。
- 前面/背面：`node.moveToTop()`, `node.moveToBottom()`
- 1つ上/下：`node.moveUp()`, `node.moveDown()`
- ショートカット（⌘] / ⌘[）で操作

## 5. データモデル（project.json案）

```json
{
  "version": 1,
  "artboard": { "x": 200, "y": 120, "width": 1024, "height": 1024 },
  "viewport": { "panX": 0, "panY": 0, "zoom": 1.0 },
  "items": [
    {
      "id": "item_001",
      "type": "image",
      "asset": {
        "source": "assets/src/abc.jpg",
        "cutout": "assets/cut/abc_cut.png",
        "mask": "assets/mask/abc_mask.png"
      },
      "transform": { "x": 340, "y": 260, "scaleX": 0.8, "scaleY": 0.8, "rotation": 12 },
      "opacity": 1.0,
      "visible": true,
      "locked": false
    }
  ],
  "selection": { "activeId": "item_001" }
}
````

ポイント：

* `items` の配列順＝描画順（下→上）
* AI結果は `cutout`（透過PNG）を基本にする（取り回しが楽）

## 6. セグメンテーションAI（ローカルサーバ）

### 6.1 モデル候補（汎用向け）

* **Segment Anything（SAM / SAM2系）**

  * “自動マスク生成”または“ポイント指定”で強い
  * 自動で「いい感じ」には調整が要る場合あり（候補複数→選択UIが相性良い）
* **U^2-Net系（背景除去）**

  * ざっくり自動切り抜きに向く
  * 被写体が単純だと速い、複雑だと弱いことも

最短実装は：

* サーバ側で「自動で最大領域マスク」などのヒューリスティックを入れてワンボタン化
* 後で「候補選択」「手動修正」を追加

### 6.2 API設計（FastAPI例）

* `GET /search?q={keyword}`
  * input: 検索キーワード
  * output: 画像候補リスト（URL, サムネイル, タイトル等）
* `POST /segment`
  * input: multipart（image）, options（mode, threshold, prompt点など）
  * output: `cutout.png`（透過PNG） + `mask.png`（任意） + メタ情報（推論時間など）
* `GET /health`
* `POST /project/save`
* `GET /project/load`

### 6.3 返却形式

* 透過PNG（RGBA）を基本
* 追加でmaskも返す（後で手動編集や再合成に使える）

## 7. UI設計（最小）

### 7.1 画面

* 上部：検索バー（キーワード入力 → Web画像検索）
* 左：ツール（Cutout / Export）
* 中央：作業空間（パン/ズーム）＋アートボード枠

### 7.2 操作

* クリック：選択
* Shift+クリック：複数選択（後回しOK）
* ドラッグ：移動
* ショートカット

  * ⌘Z/⌘⇧Z（Undo/Redo）【必須】
  * Delete / Backspace（選択オブジェクト削除）【必須】
  * ⌘] / ⌘[（前面/背面、または1つ上/下）
  * Space+ドラッグ（パン）
  * ⌘S（手動保存）
  * ⌘E（書き出し）

## 8. 書き出し（Export）

### 8.1 対応形式
* PNG（透過対応）
* WebP（軽量、透過対応）
* JPEG（背景色指定が必要）

### 8.2 実装方法
* 方法A：artboardGroup（clip付き）を `toDataURL({pixelRatio, mimeType})`
* 方法B：Stage全体を描画し、オフスクリーンでアートボード矩形をトリミング（高解像度対応しやすい）

### 8.3 オプション
* 解像度（pixelRatio: 1x, 2x, 3x, カスタム）
* 背景透過 / 背景色指定
* ファイル名（デフォルト：`collage_YYYYMMDD_HHMMSS.png`）

### 8.4 ダウンロード実装
```javascript
// Konvaからダウンロード
const dataURL = stage.toDataURL({ pixelRatio: 2, mimeType: 'image/png' });
const link = document.createElement('a');
link.download = 'collage.png';
link.href = dataURL;
link.click();
```

## 9. 実装ステップ（現実的な順）

1. Konvaで

   * アートボード枠
   * 画像ノード追加、変形、Zオーダー
2. ローカルサーバ（FastAPI）で

   * `/segment` が透過PNGを返す
3. フロント統合

   * 画像→切り抜き→配置
4. project.json保存/読み込み
5. Export（アートボード範囲）

## 10. 技術メモ（ハマりどころ）

* CORS：ローカルURL画像取得は制約が出るので、

  * フロントがURLを直接fetch→blob化→サーバへ送る
  * うまく取れないサイトは「サーバ側がURLを取得する」モードも用意（User-Agent等）
* 画像の巨大サイズ：先に縮小プレビュー、書き出し時だけ高解像で再合成（将来）
* “いい感じ”切り抜き：最初から完璧は難しいので

  * ①候補マスク提示 → ②選択 → ③微調整 の導線が強い

