import { Capacitor, registerPlugin } from '@capacitor/core'

export interface NativePdfPluginInterface {
  renderThumbnail(options: {
    path: string
    pageIndex: number
    width?: number
  }): Promise<{ path: string; width: number; height: number }>

  renderPageForCompression(options: {
    path: string
    pageIndex: number
    scale?: number
    quality?: number
  }): Promise<{
    path: string
    width: number
    height: number
    originalWidth: number
    originalHeight: number
    size: number
  }>

  getPageCount(options: {
    path: string
  }): Promise<{ pageCount: number }>

  compressImage(options: {
    path: string
    quality?: number
    maxWidth?: number
    maxHeight?: number
  }): Promise<{
    path: string
    size: number
    width: number
    height: number
  }>

  clearCache(): Promise<void>
}

export const NativePdf = registerPlugin<NativePdfPluginInterface>('NativePdf')

/**
 * Returns true if the app is running on Android native platform where
 * NativePdf plugin is available.
 */
export function isNativePdfSupported(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
}

/**
 * Renders a PDF page thumbnail using the native Android PdfRenderer (C++ PDFium).
 * Returns the converted WebView asset URL (e.g. http://localhost/_capacitor_file_/...)
 * or null if unavailable / error, allowing transparent fallback to PDF.js.
 */
export async function renderNativeThumbnail(
  filePath: string,
  pageIndex: number,
  width = 320
): Promise<string | null> {
  if (!isNativePdfSupported() || !filePath) {
    return null
  }

  try {
    const result = await NativePdf.renderThumbnail({
      path: filePath,
      pageIndex,
      width
    })
    if (result && result.path) {
      return Capacitor.convertFileSrc(result.path)
    }
  } catch (err) {
    console.debug(`Native thumbnail rendering not available for page ${pageIndex}:`, err)
  }

  return null
}

/**
 * Renders a PDF page directly via native Android PdfRenderer and compresses it
 * with Android's native libjpeg in C++, returning binary Uint8Array bytes and dimensions.
 */
export async function renderNativePageForCompression(
  filePath: string,
  pageIndex: number,
  scale = 1.5,
  quality = 80
): Promise<{
  bytes: Uint8Array
  width: number
  height: number
  originalWidth: number
  originalHeight: number
} | null> {
  if (!isNativePdfSupported() || !filePath) {
    return null
  }

  try {
    const result = await NativePdf.renderPageForCompression({
      path: filePath,
      pageIndex,
      scale,
      quality
    })

    if (result && result.path) {
      const convertedUrl = Capacitor.convertFileSrc(result.path)
      const resp = await fetch(convertedUrl)
      if (!resp.ok) {
        throw new Error(`Failed to read native rendered image: ${resp.status}`)
      }
      const buffer = await resp.arrayBuffer()
      return {
        bytes: new Uint8Array(buffer),
        width: result.width,
        height: result.height,
        originalWidth: result.originalWidth,
        originalHeight: result.originalHeight
      }
    }
  } catch (err) {
    console.debug(`Native compression render failed for page ${pageIndex}:`, err)
  }

  return null
}

/**
 * Natively compresses an image using Android C++ libjpeg without HTML5 Canvas.
 */
export async function compressNativeImage(
  filePath: string,
  quality = 80,
  maxWidth = 1800,
  maxHeight = 1800
): Promise<{
  path: string
  convertedUrl: string
  bytes: Uint8Array
  size: number
  width: number
  height: number
} | null> {
  if (!isNativePdfSupported() || !filePath) {
    return null
  }

  try {
    const result = await NativePdf.compressImage({
      path: filePath,
      quality,
      maxWidth,
      maxHeight
    })

    if (result && result.path) {
      const convertedUrl = Capacitor.convertFileSrc(result.path)
      const resp = await fetch(convertedUrl)
      const buffer = await resp.arrayBuffer()
      return {
        path: result.path,
        convertedUrl,
        bytes: new Uint8Array(buffer),
        size: result.size,
        width: result.width,
        height: result.height
      }
    }
  } catch (err) {
    console.debug('Native image compression failed:', err)
  }

  return null
}

/**
 * Clears temporary native thumbnail and compression cache files.
 */
export async function clearNativePdfCache(): Promise<void> {
  if (!isNativePdfSupported()) return
  try {
    await NativePdf.clearCache()
  } catch (err) {
    console.debug('Failed to clear native PDF cache:', err)
  }
}

