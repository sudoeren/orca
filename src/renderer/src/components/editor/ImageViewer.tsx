import { Image as ImageIcon, RotateCcw, X, ZoomIn, ZoomOut } from 'lucide-react'
import {
  type CSSProperties,
  type JSX,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import PdfViewer from './PdfViewer'
import {
  IMAGE_VIEWER_ZOOM_STEP,
  MAX_IMAGE_VIEWER_ZOOM,
  MIN_IMAGE_VIEWER_ZOOM,
  type ImageViewerImageDimensions,
  type ImageViewerSurfaceSize,
  clampImageViewerZoom,
  getNextWheelImageViewerZoom,
  getZoomedImageLayoutSize,
  shouldHandleImageZoomWheel
} from './image-viewer-zoom'

const FALLBACK_IMAGE_MIME_TYPE = 'image/png'

type ImageViewerProps = {
  content: string
  filePath: string
  mimeType?: string
  layout?: 'fill' | 'intrinsic'
}

function getElementSurfaceSize(element: HTMLElement): ImageViewerSurfaceSize {
  return {
    width: element.clientWidth,
    height: element.clientHeight
  }
}

function getImageLayoutStyle(size: ImageViewerImageDimensions | null): CSSProperties | undefined {
  if (!size) {
    return undefined
  }

  return {
    width: `${size.width}px`,
    height: `${size.height}px`
  }
}

export default function ImageViewer({
  content,
  filePath,
  mimeType = FALLBACK_IMAGE_MIME_TYPE,
  layout = 'fill'
}: ImageViewerProps): JSX.Element {
  const [imageError, setImageError] = useState(false)
  const [isPopupOpen, setIsPopupOpen] = useState(false)
  const [zoom, setZoom] = useState(1)
  const inlineSurfaceRef = useRef<HTMLDivElement | null>(null)
  const popupSurfaceRef = useRef<HTMLDivElement | null>(null)
  const [inlineSurfaceSize, setInlineSurfaceSize] = useState<ImageViewerSurfaceSize | null>(null)
  const [popupSurfaceSize, setPopupSurfaceSize] = useState<ImageViewerSurfaceSize | null>(null)
  const [imageDimensions, setImageDimensions] = useState<ImageViewerImageDimensions | null>(null)

  const filename = useMemo(() => filePath.split(/[/\\]/).pop() || filePath, [filePath])
  const cleanedContent = useMemo(() => content.replace(/\s/g, ''), [content])
  const isPdf = mimeType === 'application/pdf'
  const isIntrinsicLayout = layout === 'intrinsic'
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const estimatedSize = useMemo(() => {
    const bytes = Math.floor((cleanedContent.length * 3) / 4)
    if (bytes < 1024) {
      return `${bytes} B`
    }
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }, [cleanedContent])
  const zoomPercent = Math.round(zoom * 100)
  const inlineImageLayoutSize = useMemo(
    () =>
      isIntrinsicLayout
        ? null
        : getZoomedImageLayoutSize({
            imageDimensions,
            surfaceSize: inlineSurfaceSize,
            zoom
          }),
    [imageDimensions, inlineSurfaceSize, isIntrinsicLayout, zoom]
  )
  const popupImageLayoutSize = useMemo(
    () =>
      getZoomedImageLayoutSize({
        imageDimensions,
        surfaceSize: popupSurfaceSize,
        zoom
      }),
    [imageDimensions, popupSurfaceSize, zoom]
  )
  const inlineImageLayoutStyle = useMemo(
    () => getImageLayoutStyle(inlineImageLayoutSize),
    [inlineImageLayoutSize]
  )
  const popupImageLayoutStyle = useMemo(
    () => getImageLayoutStyle(popupImageLayoutSize),
    [popupImageLayoutSize]
  )
  const applyZoomChange = useCallback((getNextZoom: (currentZoom: number) => number) => {
    setZoom((currentZoom) => clampImageViewerZoom(getNextZoom(currentZoom)))
  }, [])
  const handleImageSurfaceWheel = useCallback(
    (event: WheelEvent) => {
      if (!shouldHandleImageZoomWheel(event)) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      applyZoomChange((currentZoom) =>
        getNextWheelImageViewerZoom(currentZoom, event.deltaY, event.deltaMode)
      )
    },
    [applyZoomChange]
  )
  const setInlineSurfaceRef = useCallback(
    (surface: HTMLDivElement | null) => {
      if (inlineSurfaceRef.current) {
        inlineSurfaceRef.current.removeEventListener('wheel', handleImageSurfaceWheel)
      }
      inlineSurfaceRef.current = surface
      if (surface) {
        setInlineSurfaceSize(getElementSurfaceSize(surface))
        // Why: Chromium exposes trackpad pinch as ctrl-wheel and requires a
        // native non-passive listener to stop browser/app zoom.
        surface.addEventListener('wheel', handleImageSurfaceWheel, { passive: false })
      } else {
        setInlineSurfaceSize(null)
      }
    },
    [handleImageSurfaceWheel]
  )
  const setPopupSurfaceRef = useCallback(
    (surface: HTMLDivElement | null) => {
      if (popupSurfaceRef.current) {
        popupSurfaceRef.current.removeEventListener('wheel', handleImageSurfaceWheel)
      }
      popupSurfaceRef.current = surface
      if (surface) {
        setPopupSurfaceSize(getElementSurfaceSize(surface))
        surface.addEventListener('wheel', handleImageSurfaceWheel, { passive: false })
      } else {
        setPopupSurfaceSize(null)
      }
    },
    [handleImageSurfaceWheel]
  )

  useEffect(() => {
    const surface = inlineSurfaceRef.current
    if (!surface) {
      setInlineSurfaceSize(null)
      return
    }

    const updateSize = () => setInlineSurfaceSize(getElementSurfaceSize(surface))
    updateSize()
    if (typeof ResizeObserver === 'undefined') {
      return
    }

    const observer = new ResizeObserver(updateSize)
    observer.observe(surface)
    return () => observer.disconnect()
  }, [previewUrl])

  useEffect(() => {
    if (!isPopupOpen) {
      setPopupSurfaceSize(null)
      return
    }

    const surface = popupSurfaceRef.current
    if (!surface) {
      return
    }

    const updateSize = () => setPopupSurfaceSize(getElementSurfaceSize(surface))
    updateSize()
    if (typeof ResizeObserver === 'undefined') {
      return
    }

    const observer = new ResizeObserver(updateSize)
    observer.observe(surface)
    return () => observer.disconnect()
  }, [isPopupOpen])

  useEffect(() => {
    setZoom(1)
  }, [filePath, mimeType, cleanedContent])

  useEffect(() => {
    setImageError(false)
    setImageDimensions(null)
    if (!cleanedContent || isPdf) {
      setPreviewUrl(null)
      return
    }
    let binary: string
    try {
      binary = window.atob(cleanedContent)
    } catch {
      setImageError(true)
      return
    }
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i)
    }
    const objectUrl = URL.createObjectURL(new Blob([bytes], { type: mimeType }))
    setPreviewUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [cleanedContent, mimeType, isPdf])

  if (isPdf) {
    return <PdfViewer content={cleanedContent} filePath={filePath} />
  }

  if (imageError) {
    return (
      <div
        className={cn(
          'flex flex-col items-center justify-center gap-3 bg-muted/20 p-8 text-sm text-muted-foreground',
          isIntrinsicLayout ? 'min-h-64' : 'h-full'
        )}
      >
        <ImageIcon size={40} />
        <div>Failed to load file preview</div>
        <div className="max-w-md break-all text-center text-xs">{filename}</div>
      </div>
    )
  }

  if (!previewUrl) {
    return (
      <div
        className={cn(
          'flex items-center justify-center text-muted-foreground text-sm',
          isIntrinsicLayout ? 'min-h-64' : 'h-full'
        )}
      >
        Loading preview...
      </div>
    )
  }

  return (
    <>
      <div className={cn('flex min-h-0 flex-col', isIntrinsicLayout ? 'h-auto' : 'h-full')}>
        <div
          ref={setInlineSurfaceRef}
          className={cn(
            'cursor-pointer bg-muted/20',
            isIntrinsicLayout
              ? 'flex justify-center overflow-visible p-4'
              : 'flex-1 overflow-auto scrollbar-editor'
          )}
          onClick={() => setIsPopupOpen(true)}
          title="Open image in popup"
        >
          <div
            className={cn(
              'flex justify-center',
              isIntrinsicLayout
                ? 'max-w-full items-start'
                : 'h-max min-h-full w-max min-w-full items-center p-4'
            )}
          >
            <div
              className="flex items-center justify-center"
              style={
                isIntrinsicLayout
                  ? { transform: `scale(${zoom})`, transformOrigin: 'center center' }
                  : inlineImageLayoutStyle
              }
            >
              <img
                src={previewUrl}
                alt={filename}
                className={cn(
                  'object-contain',
                  isIntrinsicLayout
                    ? 'block h-auto max-h-none max-w-full'
                    : inlineImageLayoutSize
                      ? 'block h-full w-full'
                      : 'block max-h-full max-w-full'
                )}
                onLoad={(event) => {
                  const img = event.currentTarget
                  setImageDimensions({ width: img.naturalWidth, height: img.naturalHeight })
                }}
                onError={() => setImageError(true)}
              />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4 border-t px-4 py-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="rounded p-1 hover:bg-accent hover:text-foreground disabled:opacity-50"
              onClick={() => applyZoomChange((currentZoom) => currentZoom / IMAGE_VIEWER_ZOOM_STEP)}
              disabled={zoom <= MIN_IMAGE_VIEWER_ZOOM}
              title="Zoom out"
            >
              <ZoomOut size={14} />
            </button>
            <button
              type="button"
              className="rounded p-1 hover:bg-accent hover:text-foreground disabled:opacity-50"
              onClick={() => applyZoomChange(() => 1)}
              disabled={zoom === 1}
              title="Reset zoom"
            >
              <RotateCcw size={14} />
            </button>
            <button
              type="button"
              className="rounded p-1 hover:bg-accent hover:text-foreground disabled:opacity-50"
              onClick={() => applyZoomChange((currentZoom) => currentZoom * IMAGE_VIEWER_ZOOM_STEP)}
              disabled={zoom >= MAX_IMAGE_VIEWER_ZOOM}
              title="Zoom in"
            >
              <ZoomIn size={14} />
            </button>
            <span className="ml-1 tabular-nums">{zoomPercent}%</span>
          </div>
          <span className="min-w-0 truncate" title={filename}>
            {filename}
          </span>
          {imageDimensions && (
            <span>
              {imageDimensions.width} x {imageDimensions.height}
            </span>
          )}
          <span>{estimatedSize}</span>
        </div>
      </div>
      <Dialog open={isPopupOpen} onOpenChange={setIsPopupOpen}>
        <DialogContent
          showCloseButton={false}
          className="top-1/2 left-1/2 flex h-[80vh] w-[70vw] max-w-[70vw] -translate-x-1/2 -translate-y-1/2 flex-col gap-0 overflow-hidden border border-border/60 bg-background p-0 shadow-2xl sm:max-w-[70vw]"
        >
          <DialogTitle className="sr-only">{filename}</DialogTitle>
          <DialogDescription className="sr-only">Full-size image preview</DialogDescription>
          <div className="flex shrink-0 items-center justify-between border-b border-border/60 bg-background/95 px-3 py-2">
            <div className="min-w-0 truncate text-sm font-medium text-foreground">{filename}</div>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={() => setIsPopupOpen(false)}
            >
              <X size={14} />
              <span>Close</span>
            </button>
          </div>
          <div
            ref={setPopupSurfaceRef}
            className="min-h-0 flex-1 overflow-auto bg-muted/20 scrollbar-editor"
          >
            <div className="flex h-max min-h-full w-max min-w-full items-center justify-center p-4">
              <div className="flex items-center justify-center" style={popupImageLayoutStyle}>
                <img
                  src={previewUrl}
                  alt={filename}
                  className={cn(
                    'object-contain',
                    popupImageLayoutSize ? 'block h-full w-full' : 'block max-h-full max-w-full'
                  )}
                />
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center justify-between border-t border-border/60 bg-background/95 px-3 py-2 text-xs text-muted-foreground">
            <div>Press Esc to close</div>
            <div className="tabular-nums">{zoomPercent}%</div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
