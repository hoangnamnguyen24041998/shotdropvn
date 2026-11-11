package vn.shotdrop.mobile

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.RectF
import android.view.View
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

/**
 * Shared native hub that decodes Canon EOS EVF JPEG bytes off the UI/JS threads
 * and paints them straight onto attached [CanonLiveViewView] surfaces with zero
 * React Native bridge serialization or JS re-render overhead.
 */
object CanonLiveViewHub {
  private val views = CopyOnWriteArraySet<CanonLiveViewView>()
  private val decodeExecutor = Executors.newSingleThreadExecutor { r ->
    Thread(r, "ShotDropLvDecode").apply { isDaemon = true }
  }
  private val pendingJpeg = AtomicReference<ByteArray?>(null)
  private val isDecodeScheduled = AtomicBoolean(false)

  @Volatile
  var latestBitmap: Bitmap? = null
    private set

  fun registerView(view: CanonLiveViewView) {
    views.add(view)
    latestBitmap?.let { bmp ->
      if (!bmp.isRecycled) {
        view.postInvalidateOnAnimation()
      }
    }
  }

  fun unregisterView(view: CanonLiveViewView) {
    views.remove(view)
  }

  fun hasAttachedView(): Boolean = views.isNotEmpty()

  fun clearFrames() {
    pendingJpeg.set(null)
    latestBitmap = null
    for (v in views) {
      v.postInvalidateOnAnimation()
    }
  }

  fun pushJpegFrame(jpegBytes: ByteArray) {
    if (jpegBytes.isEmpty() || views.isEmpty()) return
    pendingJpeg.set(jpegBytes)
    scheduleDecodePass()
  }

  private fun scheduleDecodePass() {
    if (!isDecodeScheduled.compareAndSet(false, true)) return
    decodeExecutor.execute {
      try {
        while (true) {
          val bytes = pendingJpeg.getAndSet(null) ?: break
          val opts = BitmapFactory.Options().apply {
            inPreferredConfig = Bitmap.Config.RGB_565
          }
          val decoded = try {
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, opts)
          } catch (_: Throwable) {
            null
          }
          if (decoded != null) {
            latestBitmap = decoded
            for (v in views) {
              v.postInvalidateOnAnimation()
            }
          }
        }
      } finally {
        isDecodeScheduled.set(false)
        if (pendingJpeg.get() != null) {
          scheduleDecodePass()
        }
      }
    }
  }
}

class CanonLiveViewView(context: Context) : View(context) {
  private val bitmapPaint = Paint(Paint.FILTER_BITMAP_FLAG or Paint.DITHER_FLAG)
  private val srcRect = Rect()
  private val dstRect = RectF()

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    CanonLiveViewHub.registerView(this)
  }

  override fun onDetachedFromWindow() {
    CanonLiveViewHub.unregisterView(this)
    super.onDetachedFromWindow()
  }

  override fun onDraw(canvas: Canvas) {
    canvas.drawColor(Color.rgb(11, 18, 32))
    val bmp = CanonLiveViewHub.latestBitmap ?: return
    if (bmp.isRecycled) return

    val vw = width.toFloat()
    val vh = height.toFloat()
    val bw = bmp.width.toFloat()
    val bh = bmp.height.toFloat()
    if (vw <= 0f || vh <= 0f || bw <= 0f || bh <= 0f) return

    // Center-crop fill inside viewfinder box cleanly
    val viewAspect = vw / vh
    val bmpAspect = bw / bh
    if (bmpAspect > viewAspect) {
      val cropW = (bh * viewAspect).toInt().coerceIn(1, bmp.width)
      val left = (bmp.width - cropW) / 2
      srcRect.set(left, 0, left + cropW, bmp.height)
    } else {
      val cropH = (bw / viewAspect).toInt().coerceIn(1, bmp.height)
      val top = (bmp.height - cropH) / 2
      srcRect.set(0, top, bmp.width, top + cropH)
    }
    dstRect.set(0f, 0f, vw, vh)
    canvas.drawBitmap(bmp, srcRect, dstRect, bitmapPaint)
  }
}
