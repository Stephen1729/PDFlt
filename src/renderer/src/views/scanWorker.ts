export interface WorkerPoint {
  x: number
  y: number
}

export interface ScanWorkerRequest {
  id: number
  srcBuffer: ArrayBuffer
  srcW: number
  srcH: number
  quad: [WorkerPoint, WorkerPoint, WorkerPoint, WorkerPoint]
  targetW: number
  targetH: number
  isDefaultCrop: boolean
  filter: 'raw' | 'bw' | 'color'
}

export interface ScanWorkerResponse {
  id: number
  dstBuffer: ArrayBuffer
  width: number
  height: number
  error?: string
}

self.onmessage = (e: MessageEvent<ScanWorkerRequest>) => {
  const { id, srcBuffer, srcW, srcH, quad, targetW, targetH, isDefaultCrop, filter } = e.data

  try {
    const srcData = new Uint8ClampedArray(srcBuffer)
    let dstBuffer: ArrayBuffer
    let dstData: Uint8ClampedArray
    let finalW: number
    let finalH: number

    if (isDefaultCrop) {
      // Direct pass-through: srcBuffer already holds the rotated pixel buffer
      dstBuffer = srcBuffer
      dstData = srcData
      finalW = srcW
      finalH = srcH
    } else {
      // Allocate destination buffer for perspective dewarping
      finalW = targetW
      finalH = targetH
      dstBuffer = new ArrayBuffer(targetW * targetH * 4)
      dstData = new Uint8ClampedArray(dstBuffer)

      const [p0, p1, p2, p3] = quad
      const eps = 0.5
      const isRect =
        Math.abs(p0.y - p1.y) < eps &&
        Math.abs(p3.y - p2.y) < eps &&
        Math.abs(p0.x - p3.x) < eps &&
        Math.abs(p1.x - p2.x) < eps

      if (isRect) {
        // Axis-aligned rectangular crop
        const sx0 = Math.max(0, Math.min(srcW - 1, Math.round(p0.x)))
        const sy0 = Math.max(0, Math.min(srcH - 1, Math.round(p0.y)))
        const sx1 = Math.max(0, Math.min(srcW - 1, Math.round(p1.x)))
        const sy1 = Math.max(0, Math.min(srcH - 1, Math.round(p3.y)))
        const sw = Math.max(1, sx1 - sx0)
        const sh = Math.max(1, sy1 - sy0)

        let dstIdx = 0
        for (let y = 0; y < targetH; y++) {
          const sy = sy0 + Math.min(sh - 1, Math.floor((y / targetH) * sh))
          const rowOffset = sy * srcW * 4
          for (let x = 0; x < targetW; x++) {
            const sx = sx0 + Math.min(sw - 1, Math.floor((x / targetW) * sw))
            const srcIdx = rowOffset + sx * 4
            dstData[dstIdx] = srcData[srcIdx]
            dstData[dstIdx + 1] = srcData[srcIdx + 1]
            dstData[dstIdx + 2] = srcData[srcIdx + 2]
            dstData[dstIdx + 3] = 255
            dstIdx += 4
          }
        }
      } else {
        // Perspective dewarp using homography or bilinear interpolation
        const dx1 = p1.x - p2.x
        const dx2 = p3.x - p2.x
        const dx3 = p0.x - p1.x + p2.x - p3.x
        const dy1 = p1.y - p2.y
        const dy2 = p3.y - p2.y
        const dy3 = p0.y - p1.y + p2.y - p3.y

        const det = dx1 * dy2 - dy1 * dx2
        const useHomography = Math.abs(det) > 1e-7

        let a = 0, b = 0, c = 0, d = 0, e = 0, f = 0, g = 0, h = 0
        if (useHomography) {
          g = (dx3 * dy2 - dy3 * dx2) / det
          h = (dx1 * dy3 - dy1 * dx3) / det
          a = p1.x - p0.x + g * p1.x
          b = p3.x - p0.x + h * p3.x
          c = p0.x
          d = p1.y - p0.y + g * p1.y
          e = p3.y - p0.y + h * p3.y
          f = p0.y
        }

        let dstIdx = 0
        const srcW_minus_1 = srcW - 1
        const srcH_minus_1 = srcH - 1

        for (let y = 0; y < targetH; y++) {
          const v = y / targetH
          if (useHomography) {
            const bv_c = b * v + c
            const ev_f = e * v + f
            const hv_1 = h * v + 1

            for (let x = 0; x < targetW; x++) {
              const u = x / targetW
              const denom = g * u + hv_1
              const sx = (a * u + bv_c) / denom
              const sy = (d * u + ev_f) / denom

              const x0 = Math.floor(sx)
              const y0 = Math.floor(sy)

              if (x0 >= 0 && x0 < srcW_minus_1 && y0 >= 0 && y0 < srcH_minus_1) {
                const fx = sx - x0
                const fy = sy - y0
                const fx1 = 1 - fx
                const fy1 = 1 - fy

                const idx00 = (y0 * srcW + x0) * 4
                const idx10 = idx00 + 4
                const idx01 = idx00 + srcW * 4
                const idx11 = idx01 + 4

                const w00 = fx1 * fy1
                const w10 = fx * fy1
                const w01 = fx1 * fy
                const w11 = fx * fy

                dstData[dstIdx] = (srcData[idx00] * w00 + srcData[idx10] * w10 + srcData[idx01] * w01 + srcData[idx11] * w11) | 0
                dstData[dstIdx + 1] = (srcData[idx00 + 1] * w00 + srcData[idx10 + 1] * w10 + srcData[idx01 + 1] * w01 + srcData[idx11 + 1] * w11) | 0
                dstData[dstIdx + 2] = (srcData[idx00 + 2] * w00 + srcData[idx10 + 2] * w10 + srcData[idx01 + 2] * w01 + srcData[idx11 + 2] * w11) | 0
                dstData[dstIdx + 3] = 255
              } else if (x0 >= 0 && x0 <= srcW_minus_1 && y0 >= 0 && y0 <= srcH_minus_1) {
                const idx = (y0 * srcW + x0) * 4
                dstData[dstIdx] = srcData[idx]
                dstData[dstIdx + 1] = srcData[idx + 1]
                dstData[dstIdx + 2] = srcData[idx + 2]
                dstData[dstIdx + 3] = 255
              }
              dstIdx += 4
            }
          } else {
            const v1 = 1 - v
            for (let x = 0; x < targetW; x++) {
              const u = x / targetW
              const u1 = 1 - u
              const w0 = u1 * v1
              const w1 = u * v1
              const w2 = u * v
              const w3 = u1 * v

              const sx = w0 * p0.x + w1 * p1.x + w2 * p2.x + w3 * p3.x
              const sy = w0 * p0.y + w1 * p1.y + w2 * p2.y + w3 * p3.y

              const x0 = Math.floor(sx)
              const y0 = Math.floor(sy)

              if (x0 >= 0 && x0 < srcW_minus_1 && y0 >= 0 && y0 < srcH_minus_1) {
                const fx = sx - x0
                const fy = sy - y0
                const fx1 = 1 - fx
                const fy1 = 1 - fy

                const idx00 = (y0 * srcW + x0) * 4
                const idx10 = idx00 + 4
                const idx01 = idx00 + srcW * 4
                const idx11 = idx01 + 4

                dstData[dstIdx] = (srcData[idx00] * fx1 * fy1 + srcData[idx10] * fx * fy1 + srcData[idx01] * fx1 * fy + srcData[idx11] * fx * fy) | 0
                dstData[dstIdx + 1] = (srcData[idx00 + 1] * fx1 * fy1 + srcData[idx10 + 1] * fx * fy1 + srcData[idx01 + 1] * fx1 * fy + srcData[idx11 + 1] * fx * fy) | 0
                dstData[dstIdx + 2] = (srcData[idx00 + 2] * fx1 * fy1 + srcData[idx10 + 2] * fx * fy1 + srcData[idx01 + 2] * fx1 * fy + srcData[idx11 + 2] * fx * fy) | 0
                dstData[dstIdx + 3] = 255
              }
              dstIdx += 4
            }
          }
        }
      }
    }

    // Apply Filter in place
    if (filter !== 'raw') {
      const len = dstData.length
      if (filter === 'bw') {
        for (let i = 0; i < len; i += 4) {
          const gray = 0.299 * dstData[i] + 0.587 * dstData[i + 1] + 0.114 * dstData[i + 2]
          const val = gray > 140 ? 255 : Math.max(0, (gray * 0.7) | 0)
          dstData[i] = val
          dstData[i + 1] = val
          dstData[i + 2] = val
        }
      } else if (filter === 'color') {
        const factor = 1.22
        for (let i = 0; i < len; i += 4) {
          const r = dstData[i]
          const g = dstData[i + 1]
          const b = dstData[i + 2]
          dstData[i] = Math.min(255, Math.max(0, ((r - 128) * factor + 146) | 0))
          dstData[i + 1] = Math.min(255, Math.max(0, ((g - 128) * factor + 146) | 0))
          dstData[i + 2] = Math.min(255, Math.max(0, ((b - 128) * factor + 146) | 0))
        }
      }
    }

    // Post back transferring ownership of dstBuffer
    const response: ScanWorkerResponse = {
      id,
      dstBuffer,
      width: finalW,
      height: finalH
    }
    self.postMessage(response, [dstBuffer] as any)
  } catch (err: any) {
    const errorResponse: ScanWorkerResponse = {
      id,
      dstBuffer: new ArrayBuffer(0),
      width: 0,
      height: 0,
      error: err?.message || String(err)
    }
    self.postMessage(errorResponse)
  }
}

