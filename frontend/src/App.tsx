import { useState, useRef, useEffect } from 'react'
import { Stage, Layer, Image as KonvaImage, Rect, Transformer, Group } from 'react-konva'
import Konva from 'konva'
import './App.css'

const API_URL = 'http://localhost:8000'

interface ImageResult {
  url: string
  thumbnail: string
  title: string
  width: number
  height: number
}

interface CanvasItem {
  id: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  scaleX: number
  scaleY: number
}

type Tab = 'search' | 'canvas'

const STORAGE_KEY = 'collage_canvas_items'
const ARTBOARD_SETTINGS_KEY = 'collage_artboard_settings'

// アスペクト比プリセット（比率のみ、サイズは画面に合わせて計算）
const ASPECT_RATIOS = [
  { name: '1:1', ratio: 1 },
  { name: '9:16', ratio: 9 / 16 },
  { name: '16:9', ratio: 16 / 9 },
  { name: '3:4', ratio: 3 / 4 },
  { name: '4:3', ratio: 4 / 3 },
  { name: '2:3', ratio: 2 / 3 },
  { name: '3:2', ratio: 3 / 2 },
] as const

// ツールバー幅（固定）
const TOOLBAR_WIDTH = 100

// カラーホイールから色を取得するユーティリティ
const hslToHex = (h: number, s: number, l: number): string => {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs((h / 60) % 2 - 1))
  const m = l - c / 2
  let r = 0, g = 0, b = 0
  if (h < 60) { r = c; g = x; b = 0 }
  else if (h < 120) { r = x; g = c; b = 0 }
  else if (h < 180) { r = 0; g = c; b = x }
  else if (h < 240) { r = 0; g = x; b = c }
  else if (h < 300) { r = x; g = 0; b = c }
  else { r = c; g = 0; b = x }
  const toHex = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('search')

  // Search state
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ImageResult[]>([])
  const [selectedImage, setSelectedImage] = useState<ImageResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [segmenting, setSegmenting] = useState(false)

  // Canvas state
  const [canvasItems, setCanvasItems] = useState<CanvasItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loadedImages, setLoadedImages] = useState<Map<string, HTMLImageElement>>(new Map())
  const [isInitialized, setIsInitialized] = useState(false)
  const transformerRef = useRef<Konva.Transformer>(null)
  const stageRef = useRef<Konva.Stage>(null)

  // アートボード設定
  const [aspectRatioIndex, setAspectRatioIndex] = useState(0)
  const [artboardColor, setArtboardColor] = useState('#ffffff')
  const [showColorPalette, setShowColorPalette] = useState(false)
  const [windowWidth, setWindowWidth] = useState(window.innerWidth)
  const colorButtonRef = useRef<HTMLButtonElement>(null)

  // ウィンドウサイズ監視
  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // パレット外クリックで閉じる
  useEffect(() => {
    if (!showColorPalette) return
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('.color-picker-container')) {
        setShowColorPalette(false)
      }
    }
    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [showColorPalette])

  // アートボードサイズを画面幅から計算（Stageサイズは固定）
  const currentRatio = ASPECT_RATIOS[aspectRatioIndex]
  const availableWidth = windowWidth - TOOLBAR_WIDTH - 150 // ツールバー + マージン
  const maxArtboardWidth = Math.min(availableWidth, 800)
  const maxArtboardHeight = 700
  let artboardWidth: number
  let artboardHeight: number
  if (currentRatio.ratio >= 1) {
    // 横長または正方形
    artboardWidth = Math.min(maxArtboardWidth, maxArtboardHeight * currentRatio.ratio)
    artboardHeight = artboardWidth / currentRatio.ratio
  } else {
    // 縦長
    artboardHeight = Math.min(maxArtboardHeight, maxArtboardWidth / currentRatio.ratio)
    artboardWidth = artboardHeight * currentRatio.ratio
  }
  const artboard = { x: 50, y: 50, width: Math.round(artboardWidth), height: Math.round(artboardHeight) }
  // Stageサイズは固定（大きめに）
  const stageSize = { width: Math.max(900, windowWidth - TOOLBAR_WIDTH - 50), height: 1500 }

  // localStorageから復元
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const items: CanvasItem[] = JSON.parse(saved)
        if (items.length > 0) {
          // サーバーから画像をプリロード
          items.forEach(item => {
            const img = new window.Image()
            img.crossOrigin = 'anonymous'
            img.src = `${API_URL}/assets/${item.id}`
            img.onload = () => {
              setLoadedImages(prev => new Map(prev).set(item.id, img))
            }
          })
          setCanvasItems(items)
        }
      }
      // アートボード設定を復元
      const artboardSettings = localStorage.getItem(ARTBOARD_SETTINGS_KEY)
      if (artboardSettings) {
        const { aspectRatioIndex: savedIndex, color } = JSON.parse(artboardSettings)
        if (typeof savedIndex === 'number' && savedIndex >= 0 && savedIndex < ASPECT_RATIOS.length) {
          setAspectRatioIndex(savedIndex)
        }
        if (typeof color === 'string') {
          setArtboardColor(color)
        }
      }
    } catch (e) {
      console.error('Failed to load from localStorage:', e)
    }
    setIsInitialized(true)
  }, [])

  // localStorageに保存
  useEffect(() => {
    if (!isInitialized) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(canvasItems))
    } catch (e) {
      console.error('Failed to save to localStorage:', e)
    }
  }, [canvasItems, isInitialized])

  // アートボード設定を保存
  useEffect(() => {
    if (!isInitialized) return
    try {
      localStorage.setItem(ARTBOARD_SETTINGS_KEY, JSON.stringify({
        aspectRatioIndex,
        color: artboardColor
      }))
    } catch (e) {
      console.error('Failed to save artboard settings:', e)
    }
  }, [aspectRatioIndex, artboardColor, isInitialized])

  // アスペクト比を切り替え
  const cycleAspectRatio = () => {
    setAspectRatioIndex(prev => (prev + 1) % ASPECT_RATIOS.length)
  }

  const searchImages = async () => {
    if (!query.trim()) return
    setLoading(true)
    setResults([])
    setSelectedImage(null)

    try {
      const res = await fetch(`${API_URL}/search?q=${encodeURIComponent(query)}`)
      const data = await res.json()
      setResults(data.results || [])
    } catch (e) {
      console.error('Search failed:', e)
      alert('検索に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  const selectImage = (img: ImageResult) => {
    setSelectedImage(img)
  }

  const cutoutAndUseImage = async () => {
    if (!selectedImage) return
    setSegmenting(true)

    try {
      const imgRes = await fetch(`${API_URL}/proxy-image?url=${encodeURIComponent(selectedImage.url)}`)

      if (!imgRes.ok) {
        throw new Error(`Proxy failed: ${imgRes.status}`)
      }

      const blob = await imgRes.blob()
      console.log('Blob size:', blob.size, 'type:', blob.type)

      if (blob.size === 0) {
        throw new Error('Empty image data from proxy')
      }

      // Content-Typeに基づいて適切な拡張子を設定
      const ext = blob.type.includes('png') ? 'png' : blob.type.includes('gif') ? 'gif' : 'jpg'
      const formData = new FormData()
      formData.append('image', blob, `image.${ext}`)

      const segRes = await fetch(`${API_URL}/segment`, {
        method: 'POST',
        body: formData
      })
      const data = await segRes.json()

      if (!segRes.ok) {
        throw new Error(data.detail || `Server error: ${segRes.status}`)
      }

      const cutoutData = data.cutout as string
      const id = `item_${Date.now()}`

      // サーバーに画像を保存
      await fetch(`${API_URL}/assets/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_id: id, data: cutoutData })
      })

      const newItem: CanvasItem = {
        id,
        x: artboard.x + artboard.width / 2 - 100,
        y: artboard.y + artboard.height / 2 - 100,
        width: 200,
        height: 200,
        rotation: 0,
        scaleX: 1,
        scaleY: 1
      }

      // 画像をプリロード
      const img = new window.Image()
      img.src = cutoutData
      img.onload = () => {
        // アスペクト比を維持してサイズ調整
        const maxSize = 200
        const scale = Math.min(maxSize / img.width, maxSize / img.height)
        newItem.width = img.width * scale
        newItem.height = img.height * scale

        setLoadedImages(prev => new Map(prev).set(id, img))
        setCanvasItems(prev => [...prev, newItem])

        // Canvasタブに切り替え
        setActiveTab('canvas')
        setSelectedId(id)

        // 検索状態をリセット
        setSelectedImage(null)

        // トップにスクロール
        window.scrollTo({ top: 0, behavior: 'smooth' })
      }
    } catch (e) {
      console.error('Segmentation failed:', e)
      const message = e instanceof Error ? e.message : '切り抜きに失敗しました'
      alert(message)
    } finally {
      setSegmenting(false)
    }
  }

  // Transformer更新
  useEffect(() => {
    if (selectedId && transformerRef.current && stageRef.current) {
      // DOMの更新を待ってからノードを探す
      const updateTransformer = () => {
        if (!transformerRef.current || !stageRef.current) return
        const node = stageRef.current.findOne(`#${selectedId}`)
        if (node) {
          transformerRef.current.nodes([node])
          transformerRef.current.forceUpdate()
          transformerRef.current.getLayer()?.batchDraw()
        }
      }
      // 即座に試行 + 少し遅延して再試行
      updateTransformer()
      const timeoutId = setTimeout(updateTransformer, 50)
      return () => clearTimeout(timeoutId)
    } else if (transformerRef.current) {
      // 選択解除時はノードをクリア
      transformerRef.current.nodes([])
      transformerRef.current.getLayer()?.batchDraw()
    }
  }, [selectedId, canvasItems, loadedImages])

  const handleStageMouseDown = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    const stage = e.target.getStage()
    if (!stage) return

    // Transformerのハンドルやアンカーをクリックした場合は何もしない
    const target = e.target
    let currentNode: Konva.Node | null = target
    // 親を辿ってTransformerがあるかチェック
    while (currentNode) {
      if (currentNode.getClassName() === 'Transformer') {
        return
      }
      const name = currentNode.name() || ''
      if (name.includes('_anchor') || name.includes('rotater') || name.includes('back')) {
        return
      }
      currentNode = currentNode.getParent()
    }

    const pos = stage.getPointerPosition()
    if (!pos) return

    // 透明度を考慮してクリックされた画像を探す
    const clickedId = findClickedItem(pos.x, pos.y)

    if (clickedId) {
      setSelectedId(clickedId)

      // Transformerを即座に更新
      if (transformerRef.current) {
        const node = stage.findOne(`#${clickedId}`)
        if (node) {
          transformerRef.current.nodes([node])
          transformerRef.current.forceUpdate()
          transformerRef.current.getLayer()?.batchDraw()
        }
      }
      // ドラッグはKonvaの標準動作に任せる（startDrag不要）
    } else {
      setSelectedId(null)
      // Transformerをクリア
      if (transformerRef.current) {
        transformerRef.current.nodes([])
        transformerRef.current.getLayer()?.batchDraw()
      }
    }
  }

  const handleItemChange = (id: string, newAttrs: Partial<CanvasItem>) => {
    setCanvasItems(prev =>
      prev.map(item => (item.id === id ? { ...item, ...newAttrs } : item))
    )
  }

  // 重なり順変更
  const moveToFront = () => {
    if (!selectedId) return
    setCanvasItems(prev => {
      const idx = prev.findIndex(item => item.id === selectedId)
      if (idx === -1 || idx === prev.length - 1) return prev
      const item = prev[idx]
      return [...prev.slice(0, idx), ...prev.slice(idx + 1), item]
    })
  }

  const moveToBack = () => {
    if (!selectedId) return
    setCanvasItems(prev => {
      const idx = prev.findIndex(item => item.id === selectedId)
      if (idx === -1 || idx === 0) return prev
      const item = prev[idx]
      return [item, ...prev.slice(0, idx), ...prev.slice(idx + 1)]
    })
  }

  const moveUp = () => {
    if (!selectedId) return
    setCanvasItems(prev => {
      const idx = prev.findIndex(item => item.id === selectedId)
      if (idx === -1 || idx === prev.length - 1) return prev
      const newItems = [...prev]
      ;[newItems[idx], newItems[idx + 1]] = [newItems[idx + 1], newItems[idx]]
      return newItems
    })
  }

  const moveDown = () => {
    if (!selectedId) return
    setCanvasItems(prev => {
      const idx = prev.findIndex(item => item.id === selectedId)
      if (idx === -1 || idx === 0) return prev
      const newItems = [...prev]
      ;[newItems[idx], newItems[idx - 1]] = [newItems[idx - 1], newItems[idx]]
      return newItems
    })
  }

  const deleteSelected = async () => {
    if (!selectedId) return
    // サーバーから画像を削除
    try {
      await fetch(`${API_URL}/assets/${selectedId}`, { method: 'DELETE' })
    } catch (e) {
      console.error('Failed to delete asset:', e)
    }
    setCanvasItems(prev => prev.filter(item => item.id !== selectedId))
    setSelectedId(null)
  }

  // アートボードをPNGとしてエクスポート
  const exportArtboard = () => {
    if (!stageRef.current) return

    // 選択を解除してTransformerを非表示にする
    setSelectedId(null)
    if (transformerRef.current) {
      transformerRef.current.nodes([])
    }

    // 少し遅延してからエクスポート（Transformerの非表示を待つ）
    setTimeout(() => {
      if (!stageRef.current) return

      // アートボード領域のみをクリップしてエクスポート
      const dataURL = stageRef.current.toDataURL({
        x: artboard.x,
        y: artboard.y,
        width: artboard.width,
        height: artboard.height,
        pixelRatio: 2, // 高解像度でエクスポート
      })

      // ダウンロードリンクを作成
      const link = document.createElement('a')
      link.download = `collage_${Date.now()}.png`
      link.href = dataURL
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    }, 50)
  }

  // 透明度チェック用のキャンバスキャッシュ
  const alphaCanvasCache = useRef<Map<string, { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }>>(new Map())

  // 画像の透明度データをキャッシュ
  const getAlphaCanvas = (id: string, img: HTMLImageElement) => {
    if (alphaCanvasCache.current.has(id)) {
      return alphaCanvasCache.current.get(id)!
    }
    const canvas = document.createElement('canvas')
    canvas.width = img.width
    canvas.height = img.height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(img, 0, 0)
    const cached = { canvas, ctx }
    alphaCanvasCache.current.set(id, cached)
    return cached
  }

  // 指定座標のアルファ値を取得
  const getPixelAlpha = (id: string, img: HTMLImageElement, localX: number, localY: number): number => {
    const cached = getAlphaCanvas(id, img)
    if (!cached) return 255
    try {
      const pixel = cached.ctx.getImageData(Math.floor(localX), Math.floor(localY), 1, 1)
      return pixel.data[3]
    } catch {
      return 255
    }
  }

  // ステージ座標から画像のローカル座標に変換
  const getLocalCoords = (item: CanvasItem, stageX: number, stageY: number) => {
    // 回転を考慮した変換
    const dx = stageX - item.x
    const dy = stageY - item.y
    const rad = -item.rotation * Math.PI / 180
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    const localX = (dx * cos - dy * sin) / item.scaleX
    const localY = (dx * sin + dy * cos) / item.scaleY
    return { localX, localY }
  }

  // クリック位置で透明度をチェックし、適切な画像を選択
  const findClickedItem = (stageX: number, stageY: number): string | null => {
    // 上から（後に追加された順）チェック
    for (let i = canvasItems.length - 1; i >= 0; i--) {
      const item = canvasItems[i]
      const img = loadedImages.get(item.id)
      if (!img) continue

      const { localX, localY } = getLocalCoords(item, stageX, stageY)

      // 画像の範囲内かチェック
      if (localX < 0 || localX >= item.width || localY < 0 || localY >= item.height) {
        continue
      }

      // 元画像のピクセル座標に変換
      const imgX = (localX / item.width) * img.width
      const imgY = (localY / item.height) * img.height

      const alpha = getPixelAlpha(item.id, img, imgX, imgY)
      if (alpha > 10) { // 透明度の閾値（10以上で不透明とみなす）
        return item.id
      }
    }
    return null
  }

  return (
    <div className="app">
      <header className="header">
        <h1>10sec collage</h1>
        <div className="tabs">
          <button
            className={`tab ${activeTab === 'search' ? 'active' : ''}`}
            onClick={() => setActiveTab('search')}
          >
            Internet
          </button>
          <button
            className={`tab ${activeTab === 'canvas' ? 'active' : ''}`}
            onClick={() => setActiveTab('canvas')}
          >
            Canvas
          </button>
        </div>
      </header>

      {/* Search Tab */}
      {activeTab === 'search' && (
        <main className="main">
          <div className="search-bar">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && searchImages()}
              placeholder="画像を検索..."
            />
            <button onClick={searchImages} disabled={loading}>
              {loading ? '検索中...' : '検索'}
            </button>
          </div>

          {results.length > 0 && (
            <section className="results-section">
              <h2>検索結果（クリックで選択）</h2>
              <div className="results-grid">
                {results.map((img, i) => (
                  <div
                    key={i}
                    className={`result-item ${selectedImage === img ? 'selected' : ''}`}
                    onClick={() => selectImage(img)}
                  >
                    <img src={`${API_URL}/proxy-image?url=${encodeURIComponent(img.thumbnail)}`} alt={img.title} />
                  </div>
                ))}
              </div>
            </section>
          )}

          {selectedImage && (
            <section className="preview-section">
              <h2>選択した画像</h2>
              <div className="preview-container">
                <img
                  src={`${API_URL}/proxy-image?url=${encodeURIComponent(selectedImage.url)}`}
                  alt="Selected"
                  className="preview-image"
                />
                <button
                  onClick={cutoutAndUseImage}
                  disabled={segmenting}
                  className="cutout-button"
                >
                  {segmenting ? '処理中...' : '使用'}
                </button>
              </div>
            </section>
          )}
        </main>
      )}

      {/* Canvas Tab */}
      {activeTab === 'canvas' && (
        <main className="canvas-main">
          <div className="canvas-workspace">
            <Stage
              ref={stageRef}
              width={stageSize.width}
              height={stageSize.height}
              onMouseDown={handleStageMouseDown}
              onTouchStart={handleStageMouseDown}
              style={{ background: '#2a2a2a' }}
            >
              <Layer>
                {/* 1. アートボード背景 */}
                <Rect
                  name="artboard"
                  x={artboard.x}
                  y={artboard.y}
                  width={artboard.width}
                  height={artboard.height}
                  fill={artboardColor}
                  shadowColor="black"
                  shadowBlur={10}
                  shadowOpacity={0.3}
                />

                {/* 2. 完全にアートボード外の画像のみ100%で表示 */}
                {canvasItems.map(item => {
                  const img = loadedImages.get(item.id)
                  if (!img) return null

                  // 回転を考慮したバウンディングボックスを計算
                  const w = item.width * item.scaleX
                  const h = item.height * item.scaleY
                  const rad = item.rotation * Math.PI / 180
                  const cos = Math.abs(Math.cos(rad))
                  const sin = Math.abs(Math.sin(rad))
                  // 回転後のバウンディングボックスサイズ
                  const rotatedWidth = w * cos + h * sin
                  const rotatedHeight = w * sin + h * cos
                  // 中心点からバウンディングボックスを計算
                  const centerX = item.x + w / 2
                  const centerY = item.y + h / 2
                  const bboxLeft = centerX - rotatedWidth / 2
                  const bboxRight = centerX + rotatedWidth / 2
                  const bboxTop = centerY - rotatedHeight / 2
                  const bboxBottom = centerY + rotatedHeight / 2

                  const artboardRight = artboard.x + artboard.width
                  const artboardBottom = artboard.y + artboard.height
                  const intersects = !(
                    bboxRight < artboard.x ||
                    bboxLeft > artboardRight ||
                    bboxBottom < artboard.y ||
                    bboxTop > artboardBottom
                  )

                  // 完全にアートボード外なら100%不透明で表示
                  if (!intersects) {
                    return (
                      <KonvaImage
                        key={`outside-${item.id}`}
                        image={img}
                        x={item.x}
                        y={item.y}
                        width={item.width}
                        height={item.height}
                        rotation={item.rotation}
                        scaleX={item.scaleX}
                        scaleY={item.scaleY}
                        opacity={1}
                        listening={false}
                      />
                    )
                  }

                  // 交差している場合：はみ出し部分は表示しない（アートボード内のみクリップ表示）
                  return null
                })}

                {/* 3. アートボード内にクリップされた画像（不透明） */}
                <Group
                  clipX={artboard.x}
                  clipY={artboard.y}
                  clipWidth={artboard.width}
                  clipHeight={artboard.height}
                  listening={false}
                >
                  {canvasItems.map(item => {
                    const img = loadedImages.get(item.id)
                    if (!img) return null
                    return (
                      <KonvaImage
                        key={`clipped-${item.id}`}
                        image={img}
                        x={item.x}
                        y={item.y}
                        width={item.width}
                        height={item.height}
                        rotation={item.rotation}
                        scaleX={item.scaleX}
                        scaleY={item.scaleY}
                        listening={false}
                      />
                    )
                  })}
                </Group>

                {/* 4. 操作用の透明画像（全体、操作のみ） */}
                {canvasItems.map(item => {
                  const img = loadedImages.get(item.id)
                  if (!img) return null
                  return (
                    <KonvaImage
                      key={item.id}
                      id={item.id}
                      image={img}
                      x={item.x}
                      y={item.y}
                      width={item.width}
                      height={item.height}
                      rotation={item.rotation}
                      scaleX={item.scaleX}
                      scaleY={item.scaleY}
                      opacity={0}
                      draggable
                      onDragEnd={(e) => {
                        handleItemChange(item.id, {
                          x: e.target.x(),
                          y: e.target.y()
                        })
                      }}
                      onTransformEnd={(e) => {
                        const node = e.target
                        handleItemChange(item.id, {
                          x: node.x(),
                          y: node.y(),
                          rotation: node.rotation(),
                          scaleX: node.scaleX(),
                          scaleY: node.scaleY()
                        })
                      }}
                    />
                  )
                })}

                {/* Transformer（同じLayer内で最後に描画 = 最前面） */}
                <Transformer
                  ref={transformerRef}
                  rotateEnabled={true}
                  enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']}
                  boundBoxFunc={(oldBox, newBox) => {
                    if (newBox.width < 10 || newBox.height < 10) {
                      return oldBox
                    }
                    return newBox
                  }}
                />
              </Layer>
            </Stage>

            <div className="canvas-toolbar">
              <button onClick={cycleAspectRatio} className="size-button" title="アスペクト比を変更">
                {currentRatio.name}
              </button>

              <div className="color-picker-container">
                <button
                  ref={colorButtonRef}
                  className="color-button"
                  style={{ backgroundColor: artboardColor }}
                  onClick={() => setShowColorPalette(!showColorPalette)}
                  title="背景色を変更"
                />
                {showColorPalette && (
                  <div className="color-wheel-popup">
                    <canvas
                      width={120}
                      height={120}
                      ref={(canvas) => {
                        if (!canvas) return
                        const ctx = canvas.getContext('2d')
                        if (!ctx) return
                        const size = 120
                        const center = size / 2
                        const radius = size / 2 - 4
                        // カラーホイール描画
                        for (let angle = 0; angle < 360; angle++) {
                          const startAngle = (angle - 1) * Math.PI / 180
                          const endAngle = (angle + 1) * Math.PI / 180
                          ctx.beginPath()
                          ctx.moveTo(center, center)
                          ctx.arc(center, center, radius, startAngle, endAngle)
                          ctx.closePath()
                          // グラデーション（外側は彩度100%、内側は白）
                          const gradient = ctx.createRadialGradient(center, center, 0, center, center, radius)
                          gradient.addColorStop(0, '#ffffff')
                          gradient.addColorStop(1, `hsl(${angle}, 100%, 50%)`)
                          ctx.fillStyle = gradient
                          ctx.fill()
                        }
                      }}
                      onClick={(e) => {
                        const canvas = e.currentTarget
                        const rect = canvas.getBoundingClientRect()
                        const x = e.clientX - rect.left - 60
                        const y = e.clientY - rect.top - 60
                        const angle = Math.atan2(y, x) * 180 / Math.PI
                        const hue = (angle + 360) % 360
                        const distance = Math.sqrt(x * x + y * y)
                        const saturation = Math.min(distance / 56, 1)
                        const color = hslToHex(hue, saturation, 0.5 + (1 - saturation) * 0.5)
                        setArtboardColor(color)
                        setShowColorPalette(false)
                      }}
                      style={{ cursor: 'crosshair', borderRadius: '50%' }}
                    />
                    <div className="color-wheel-presets">
                      {['#ffffff', '#000000', '#f5f5f5', '#e0e0e0'].map(color => (
                        <button
                          key={color}
                          className="preset-swatch"
                          style={{ backgroundColor: color }}
                          onClick={() => {
                            setArtboardColor(color)
                            setShowColorPalette(false)
                          }}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="toolbar-divider" />

              <button onClick={moveToFront} title="最前面へ" disabled={!selectedId}>
                ⬆
              </button>
              <button onClick={moveUp} title="1つ上へ" disabled={!selectedId}>
                ↑
              </button>
              <button onClick={moveDown} title="1つ下へ" disabled={!selectedId}>
                ↓
              </button>
              <button onClick={moveToBack} title="最背面へ" disabled={!selectedId}>
                ⬇
              </button>

              <div className="toolbar-divider" />

              <button onClick={deleteSelected} className="delete-button" title="削除" disabled={!selectedId}>
                ✕
              </button>

              <div className="toolbar-divider" />

              <button onClick={exportArtboard} className="export-button" title="画像を書き出し">
                ↓
              </button>
            </div>
          </div>

          <div className="canvas-info">
            {canvasItems.length === 0 ? (
              <p>Image Searchタブで画像を切り抜いて「使用」してください</p>
            ) : (
              <p>画像をドラッグで移動、角をドラッグで拡大縮小・回転</p>
            )}
          </div>
        </main>
      )}
    </div>
  )
}

export default App
