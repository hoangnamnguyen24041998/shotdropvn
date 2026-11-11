package vn.shotdrop.mobile

import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbDeviceConnection
import android.hardware.usb.UsbEndpoint
import android.hardware.usb.UsbInterface
import android.hardware.usb.UsbManager
import android.util.Log
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.Locale

/**
 * Low-level ISO 15740 USB Bulk PTP client with Canon EOS (0x91xx) extensions.
 *
 * Designed to keep ONE persistent PTP session open while connected over USB OTG so:
 *  - Canon cameras in Live View remain responsive without Open/CloseSession storms.
 *  - New photos trigger instant event-based downloads (ObjectAddedEx / RequestObjectTransfer)
 *    or fallback object-handle diffs.
 *  - Live View EVF JPEG frames (0x9153), Autofocus (0x9154 / 0x9128), Remote Shutter (0x9128/0x9129),
 *    and Card JPEG Exports work over the same serialized USB bulk connection.
 */
class CanonPtpClient(
  val device: UsbDevice,
  private val usbManager: UsbManager
) {
  companion object {
    private const val TAG = "ShotDropCanonPtp"
    private const val USB_CHUNK_SIZE = 16_384
    private const val DEFAULT_TIMEOUT_MS = 3_500
    private const val BULK_READ_TIMEOUT_MS = 5_000
    private const val MAX_PACKET_BYTES = 64 * 1024 * 1024L

    // Standard PTP Container Types
    private const val CONTAINER_COMMAND = 1
    private const val CONTAINER_DATA = 2
    private const val CONTAINER_RESPONSE = 3

    // Standard PTP Operation Codes
    private const val OC_GET_DEVICE_INFO = 0x1001
    private const val OC_OPEN_SESSION = 0x1002
    private const val OC_CLOSE_SESSION = 0x1003
    private const val OC_GET_STORAGE_IDS = 0x1004
    private const val OC_GET_OBJECT_HANDLES = 0x1007
    private const val OC_GET_OBJECT_INFO = 0x1008
    private const val OC_GET_OBJECT = 0x1009
    private const val OC_GET_THUMB = 0x100A
    private const val OC_INITIATE_CAPTURE = 0x100E

    // Standard PTP Response Codes
    const val RC_OK = 0x2001
    private const val RC_GENERAL_ERROR = 0x2002
    private const val RC_OPERATION_NOT_SUPPORTED = 0x2005
    private const val RC_PARAMETER_NOT_SUPPORTED = 0x2006
    private const val RC_INCOMPLETE_TRANSFER = 0x2007
    private const val RC_DEVICE_BUSY = 0x2019
    private const val RC_INVALID_PARAMETER = 0x201D
    private const val RC_SESSION_ALREADY_OPENED = 0x201E
    private const val RC_CANON_NOT_READY = 0xA102

    // Standard PTP Object Formats
    const val FORMAT_EXIF_JPEG = 0x3801
    const val FORMAT_JFIF = 0x3808
    const val FORMAT_ASSOCIATION = 0x3001

    // Canon EOS Vendor Operation Codes (0x91xx)
    private const val OC_CANON_EOS_GET_PARTIAL_OBJECT = 0x9107
    private const val OC_CANON_EOS_REMOTE_RELEASE = 0x910F
    private const val OC_CANON_EOS_SET_DEVICE_PROP_VALUE_EX = 0x9110
    private const val OC_CANON_EOS_SET_REMOTE_MODE = 0x9114
    private const val OC_CANON_EOS_SET_EVENT_MODE = 0x9115
    private const val OC_CANON_EOS_GET_EVENT = 0x9116
    private const val OC_CANON_EOS_TRANSFER_COMPLETE = 0x9117
    private const val OC_CANON_EOS_PC_HDD_CAPACITY = 0x911A
    private const val OC_CANON_EOS_REMOTE_RELEASE_ON = 0x9128
    private const val OC_CANON_EOS_REMOTE_RELEASE_OFF = 0x9129
    private const val OC_CANON_EOS_GET_VIEWFINDER_DATA = 0x9153
    private const val OC_CANON_EOS_DO_AF = 0x9154

    // Canon EOS Event Codes (0xC1xx)
    private const val EC_CANON_EOS_OBJECT_ADDED_EX = 0xC181
    private const val EC_CANON_EOS_OBJECT_INFO_CHANGED_EX = 0xC182
    private const val EC_CANON_EOS_REQUEST_OBJECT_TRANSFER = 0xC186
    private const val EC_CANON_EOS_PROP_VALUE_CHANGED = 0xC189
    private const val EC_CANON_EOS_AVAIL_LIST_CHANGED = 0xC18A
    private const val EC_CANON_EOS_OBJECT_ADDED_EX64 = 0xC1A7
    private const val EC_CANON_EOS_REQUEST_OBJECT_TRANSFER64 = 0xC1A9

    // Canon EOS Device Properties (0xD1xx)
    private const val DPC_CANON_EOS_CAPTURE_DESTINATION = 0xD11C
    private const val DPC_CANON_EOS_EVF_OUTPUT_DEVICE = 0xD1B0
    private const val DPC_CANON_EOS_EVF_MODE = 0xD1B1

    // Canon EVF Output flags
    const val EVF_OUTPUT_TFT = 0x01
    const val EVF_OUTPUT_PC = 0x02
    const val EVF_OUTPUT_TFT_AND_PC = 0x03

    // Canon CaptureDestination flags
    private const val CAPTURE_DEST_HD = 0x04

    // Canon Live View Data Blob segment IDs
    private const val LV_SEG_JPEG_1 = 1
    private const val LV_SEG_JPEG_9 = 9
    private const val LV_SEG_JPEG_11 = 11
  }

  data class ObjectRecord(
    val handle: Int,
    val format: Int,
    val size: Long,
    val filename: String,
    val needsTransferComplete: Boolean
  )

  data class EventDrainResult(
    val addedObjects: List<ObjectRecord>,
    val evfMode: Int?,
    val evfOutputDevice: Int?
  )

  private data class PtpContainer(
    val type: Int,
    val code: Int,
    val txId: Int,
    val data: ByteArray
  )

  private data class TransactionResult(
    val responseCode: Int,
    val data: ByteArray,
    val responseParams: IntArray
  )

  private var connection: UsbDeviceConnection? = null
  private var usbInterface: UsbInterface? = null
  private var bulkIn: UsbEndpoint? = null
  private var bulkOut: UsbEndpoint? = null

  private var nextTransactionId = 0
  private var isOpen = false
  private var consecutiveIoFailures = 0

  var modelName: String? = null
    private set
  var isCanonEos: Boolean = false
    private set
  var supportsLiveView: Boolean = false
    private set
  var supportsRemoteCapture: Boolean = false
    private set
  var supportsAutoFocus: Boolean = false
    private set
  @Volatile var evfMode: Int = 0
    private set
  @Volatile var evfOutputDevice: Int = 0
    private set
  @Volatile var captureDestination: Int = 0
    private set

  private val supportedOperations = HashSet<Int>()
  private var isRemoteModeInitialized = false

  fun isHealthy(): Boolean = isOpen && connection != null && consecutiveIoFailures < 4

  fun open(): Boolean {
    close()

    val interfacePair = findPtpInterfaceAndEndpoints(device) ?: return false
    val (intf, inEp, outEp) = interfacePair

    var conn = usbManager.openDevice(device)
    if (conn == null) {
      Thread.sleep(220)
      conn = usbManager.openDevice(device)
    }
    if (conn == null) return false

    if (!conn.claimInterface(intf, true)) {
      Thread.sleep(220)
      if (!conn.claimInterface(intf, true)) {
        try {
          conn.close()
        } catch (_: Exception) {
        }
        return false
      }
    }

    connection = conn
    usbInterface = intf
    bulkIn = inEp
    bulkOut = outEp
    nextTransactionId = 0
    consecutiveIoFailures = 0

    // Standard PTP OpenSession (txId = 0, sessionId = 1)
    var openResp = executeNoData(OC_OPEN_SESSION, intArrayOf(1), txIdOverride = 0)
    if (openResp == RC_SESSION_ALREADY_OPENED) {
      executeNoData(OC_CLOSE_SESSION, intArrayOf(), txIdOverride = 0)
      Thread.sleep(100)
      nextTransactionId = 0
      openResp = executeNoData(OC_OPEN_SESSION, intArrayOf(1), txIdOverride = 0)
    }

    if (openResp != RC_OK && openResp != RC_SESSION_ALREADY_OPENED) {
      Log.w(TAG, "PTP OpenSession failed: 0x${Integer.toHexString(openResp)}")
      close()
      return false
    }

    nextTransactionId = 1
    isOpen = true

    // Inspect DeviceInfo for supported operations & model name
    val devInfo = executeGetData(OC_GET_DEVICE_INFO, intArrayOf())
    if (devInfo.responseCode == RC_OK && devInfo.data.isNotEmpty()) {
      parseDeviceInfo(devInfo.data)
    }

    isCanonEos = supportedOperations.contains(OC_CANON_EOS_GET_EVENT) ||
      supportedOperations.contains(OC_CANON_EOS_SET_REMOTE_MODE) ||
      (device.vendorId == 0x04A9 && supportedOperations.contains(OC_CANON_EOS_GET_VIEWFINDER_DATA))

    supportsLiveView = supportedOperations.contains(OC_CANON_EOS_GET_VIEWFINDER_DATA)
    supportsRemoteCapture =
      supportedOperations.contains(OC_CANON_EOS_REMOTE_RELEASE_ON) ||
      supportedOperations.contains(OC_CANON_EOS_REMOTE_RELEASE) ||
      supportedOperations.contains(OC_INITIATE_CAPTURE)
    supportsAutoFocus =
      supportedOperations.contains(OC_CANON_EOS_DO_AF) ||
      supportedOperations.contains(OC_CANON_EOS_REMOTE_RELEASE_ON)

    if (isCanonEos) {
      ensureCanonRemoteInitialized()
    }

    return true
  }

  private fun ensureCanonRemoteInitialized() {
    if (isRemoteModeInitialized) return

    if (supportedOperations.contains(OC_CANON_EOS_SET_REMOTE_MODE)) {
      executeWithBusyRetry(OC_CANON_EOS_SET_REMOTE_MODE, intArrayOf(1), maxAttempts = 5)
    }
    if (supportedOperations.contains(OC_CANON_EOS_SET_EVENT_MODE)) {
      executeWithBusyRetry(OC_CANON_EOS_SET_EVENT_MODE, intArrayOf(1), maxAttempts = 5)
    }
    if (supportedOperations.contains(OC_CANON_EOS_PC_HDD_CAPACITY)) {
      executeWithBusyRetry(
        OC_CANON_EOS_PC_HDD_CAPACITY,
        intArrayOf(0x0FFFFFFF, 0x00001000, 0x00000001),
        maxAttempts = 3
      )
    }

    isRemoteModeInitialized = true
    // Drain initial event property dump (tells us whether camera already has Live View ON)
    drainCanonEvents()

    // If camera has no memory card installed, allow direct Host/SDRAM capture so shutter still works
    val storages = getStorageIds()
    if (storages.isEmpty() && supportedOperations.contains(OC_CANON_EOS_SET_DEVICE_PROP_VALUE_EX)) {
      setCanonPropertyInt32(DPC_CANON_EOS_CAPTURE_DESTINATION, CAPTURE_DEST_HD)
    }
  }

  fun close() {
    val conn = connection
    val intf = usbInterface
    if (isOpen && conn != null) {
      try {
        if (isCanonEos && isRemoteModeInitialized && evfOutputDevice != EVF_OUTPUT_TFT &&
          supportedOperations.contains(OC_CANON_EOS_SET_DEVICE_PROP_VALUE_EX) &&
          evfMode == 1 &&
          (evfOutputDevice and EVF_OUTPUT_PC) != 0
        ) {
          setCanonPropertyInt32(DPC_CANON_EOS_EVF_OUTPUT_DEVICE, EVF_OUTPUT_TFT)
        }
        if (isCanonEos && isRemoteModeInitialized &&
          supportedOperations.contains(OC_CANON_EOS_SET_REMOTE_MODE)
        ) {
          executeNoData(OC_CANON_EOS_SET_REMOTE_MODE, intArrayOf(0))
        }
        executeNoData(OC_CLOSE_SESSION, intArrayOf())
      } catch (_: Exception) {
      }
    }
    if (conn != null) {
      try {
        if (intf != null) {
          conn.releaseInterface(intf)
        }
      } catch (_: Exception) {
      }
      try {
        conn.close()
      } catch (_: Exception) {
      }
    }
    connection = null
    usbInterface = null
    bulkIn = null
    bulkOut = null
    isOpen = false
    isRemoteModeInitialized = false
  }

  fun startLiveView(): Boolean {
    if (!isHealthy() || !isCanonEos || !supportsLiveView) return false
    ensureCanonRemoteInitialized()

    // Ensure Live View mode (0xD1B1) is enabled if not already active on camera
    if (evfMode != 1) {
      val rcMode = setCanonPropertyInt32(DPC_CANON_EOS_EVF_MODE, 1)
      if (rcMode == RC_OK) {
        evfMode = 1
      }
      Thread.sleep(180)
    }

    // Prefer TFT + PC (0x03) so both the camera's rear screen AND the phone show Live View;
    // fall back to PC-only (0x02) if the camera body rejects simultaneous TFT+PC.
    if ((evfOutputDevice and EVF_OUTPUT_PC) == 0) {
      var rcOut = setCanonPropertyInt32(DPC_CANON_EOS_EVF_OUTPUT_DEVICE, EVF_OUTPUT_TFT_AND_PC)
      if (rcOut == RC_OK) {
        evfOutputDevice = EVF_OUTPUT_TFT_AND_PC
      } else {
        rcOut = setCanonPropertyInt32(DPC_CANON_EOS_EVF_OUTPUT_DEVICE, EVF_OUTPUT_PC)
        if (rcOut == RC_OK) {
          evfOutputDevice = EVF_OUTPUT_PC
        } else {
          return false
        }
      }
    }

    drainCanonEvents()
    return true
  }

  fun stopLiveView(): Boolean {
    if (!isHealthy() || !isCanonEos) return false
    if ((evfOutputDevice and EVF_OUTPUT_PC) != 0 &&
      supportedOperations.contains(OC_CANON_EOS_SET_DEVICE_PROP_VALUE_EX)
    ) {
      val rc = setCanonPropertyInt32(DPC_CANON_EOS_EVF_OUTPUT_DEVICE, EVF_OUTPUT_TFT)
      if (rc == RC_OK) {
        evfOutputDevice = EVF_OUTPUT_TFT
        return true
      }
    }
    return false
  }

  /**
   * Pulls one Live View JPEG frame via 0x9153 (GetViewFinderData).
   * Returns raw JPEG bytes or null if the camera is briefly busy/mirror transitioning.
   */
  fun getLiveViewJpegFrame(drainEvents: Boolean = false): ByteArray? {
    if (!isHealthy() || !isCanonEos || !supportsLiveView) return null

    if (drainEvents && supportedOperations.contains(OC_CANON_EOS_GET_EVENT)) {
      val evtRes = executeGetData(OC_CANON_EOS_GET_EVENT, intArrayOf(), timeoutMs = 1_200)
      if (evtRes.responseCode == RC_OK && evtRes.data.isNotEmpty()) {
        parseCanonEventsBuffer(evtRes.data)
      }
    }

    var res = executeGetData(
      OC_CANON_EOS_GET_VIEWFINDER_DATA,
      intArrayOf(0x00200000, 0, 0),
      timeoutMs = 2_500
    )
    if (res.responseCode == RC_INVALID_PARAMETER || res.responseCode == RC_PARAMETER_NOT_SUPPORTED) {
      res = executeGetData(
        OC_CANON_EOS_GET_VIEWFINDER_DATA,
        intArrayOf(0x00100000, 0, 0),
        timeoutMs = 2_500
      )
    }

    if (res.responseCode == RC_CANON_NOT_READY || res.responseCode == RC_DEVICE_BUSY) {
      return null
    }
    if (res.responseCode != RC_OK || res.data.isEmpty()) {
      return null
    }

    return extractJpegFromViewFinderPayload(res.data)
  }

  fun triggerAutoFocus(): Boolean {
    if (!isHealthy()) return false
    if (isCanonEos && supportedOperations.contains(OC_CANON_EOS_DO_AF)) {
      val rc = executeWithBusyRetry(OC_CANON_EOS_DO_AF, intArrayOf(), maxAttempts = 4)
      drainCanonEvents()
      return rc == RC_OK
    }
    if (isCanonEos && supportedOperations.contains(OC_CANON_EOS_REMOTE_RELEASE_ON)) {
      val rcOn = executeWithBusyRetry(
        OC_CANON_EOS_REMOTE_RELEASE_ON,
        intArrayOf(1, 0),
        maxAttempts = 4
      )
      Thread.sleep(220)
      drainCanonEvents()
      executeWithBusyRetry(OC_CANON_EOS_REMOTE_RELEASE_OFF, intArrayOf(1), maxAttempts = 4)
      drainCanonEvents()
      return rcOn == RC_OK
    }
    return false
  }

  /**
   * Triggers a remote shutter release and waits for Canon event delivery (or storage handle diff),
   * returning all newly captured JPEG objects ready for import.
   */
  fun triggerCaptureAndWaitObjects(withAf: Boolean): Pair<Boolean, List<ObjectRecord>> {
    if (!isHealthy()) return Pair(false, emptyList())

    val discovered = mutableListOf<ObjectRecord>()
    val seenHandles = HashSet<Int>()

    // Snapshot baseline storage handles only if Canon EOS event mode is unavailable
    val baselineHandles = if (!isCanonEos) getAllJpegHandles().toSet() else emptySet()

    // Clear stale events right before triggering shutter
    if (isCanonEos) {
      val pre = drainCanonEvents()
      for (obj in pre.addedObjects) {
        if (seenHandles.add(obj.handle)) discovered.add(obj)
      }
    }

    val triggered = executeShutterCommand(withAf)
    if (!triggered) {
      return Pair(false, emptyList())
    }

    if (isCanonEos) {
      val deadlineMs = System.currentTimeMillis() + 9_000L
      var sawRawNonJpegAtMs = 0L

      while (System.currentTimeMillis() < deadlineMs) {
        val drained = drainCanonEvents()
        for (obj in drained.addedObjects) {
          if (isJpegObject(obj)) {
            if (seenHandles.add(obj.handle)) {
              discovered.add(obj)
            }
          } else {
            // In RAW+JPEG or RAW-only mode, acknowledge SDRAM RAW transfer immediately so camera doesn't stall
            if (obj.needsTransferComplete) {
              transferComplete(obj.handle)
            }
            if (sawRawNonJpegAtMs == 0L) {
              sawRawNonJpegAtMs = System.currentTimeMillis()
            }
          }
        }

        if (discovered.isNotEmpty()) {
          // Wait briefly once more to catch any companion JPEG if burst/RAW+JPEG split events
          Thread.sleep(120)
          val extra = drainCanonEvents()
          for (obj in extra.addedObjects) {
            if (isJpegObject(obj) && seenHandles.add(obj.handle)) {
              discovered.add(obj)
            } else if (obj.needsTransferComplete) {
              transferComplete(obj.handle)
            }
          }
          break
        }

        if (sawRawNonJpegAtMs > 0L && (System.currentTimeMillis() - sawRawNonJpegAtMs > 2_500L)) {
          // Camera only emitted RAW and never sent a JPEG after 2.5s
          break
        }
        Thread.sleep(100)
      }
    } else {
      val deadlineMs = System.currentTimeMillis() + 7_000L
      while (System.currentTimeMillis() < deadlineMs) {
        val currentHandles = getAllJpegHandles()
        val added = currentHandles.filter { !baselineHandles.contains(it) }
        if (added.isNotEmpty()) {
          for (h in added) {
            val info = getObjectInfo(h)
            discovered.add(
              ObjectRecord(
                handle = h,
                format = info?.first ?: FORMAT_EXIF_JPEG,
                size = info?.second ?: 0L,
                filename = info?.third ?: "OTG_$h.JPG",
                needsTransferComplete = false
              )
            )
          }
          break
        }
        Thread.sleep(250)
      }
    }

    return Pair(true, discovered)
  }

  private fun executeShutterCommand(withAf: Boolean): Boolean {
    if (isCanonEos && supportedOperations.contains(OC_CANON_EOS_REMOTE_RELEASE_ON)) {
      val afModifier = if (withAf) 0 else 1

      // Standard Canon EOS DSLRs (6D, 5D, 70D, 80D, R, etc.): half press (1), full press (2)
      val rcHalf = executeWithBusyRetry(
        OC_CANON_EOS_REMOTE_RELEASE_ON,
        intArrayOf(1, afModifier),
        maxAttempts = 6
      )

      if (rcHalf == RC_INVALID_PARAMETER || rcHalf == RC_PARAMETER_NOT_SUPPORTED) {
        // Canon EOS M single-stage instant release (3, 0)
        val rcM = executeWithBusyRetry(
          OC_CANON_EOS_REMOTE_RELEASE_ON,
          intArrayOf(3, 0),
          maxAttempts = 6
        )
        Thread.sleep(120)
        executeWithBusyRetry(OC_CANON_EOS_REMOTE_RELEASE_OFF, intArrayOf(3), maxAttempts = 6)
        return rcM == RC_OK
      }

      if (rcHalf != RC_OK) {
        return false
      }

      if (withAf) {
        Thread.sleep(220)
        drainCanonEvents()
      }

      var rcFull = executeWithBusyRetry(
        OC_CANON_EOS_REMOTE_RELEASE_ON,
        intArrayOf(2, afModifier),
        maxAttempts = 8
      )

      // If AF half-press didn't achieve focus lock and blocked full-press, retry full-press cleanly
      if (rcFull != RC_OK && withAf) {
        executeWithBusyRetry(OC_CANON_EOS_REMOTE_RELEASE_OFF, intArrayOf(1), maxAttempts = 4)
        Thread.sleep(80)
        executeWithBusyRetry(OC_CANON_EOS_REMOTE_RELEASE_ON, intArrayOf(1, 1), maxAttempts = 5)
        rcFull = executeWithBusyRetry(
          OC_CANON_EOS_REMOTE_RELEASE_ON,
          intArrayOf(2, 1),
          maxAttempts = 6
        )
      }

      Thread.sleep(80)
      executeWithBusyRetry(OC_CANON_EOS_REMOTE_RELEASE_OFF, intArrayOf(2), maxAttempts = 6)
      executeWithBusyRetry(OC_CANON_EOS_REMOTE_RELEASE_OFF, intArrayOf(1), maxAttempts = 6)

      return rcFull == RC_OK
    }

    if (isCanonEos && supportedOperations.contains(OC_CANON_EOS_REMOTE_RELEASE)) {
      val rc = executeWithBusyRetry(OC_CANON_EOS_REMOTE_RELEASE, intArrayOf(), maxAttempts = 6)
      return rc == RC_OK
    }

    if (supportedOperations.contains(OC_INITIATE_CAPTURE)) {
      val rc = executeWithBusyRetry(OC_INITIATE_CAPTURE, intArrayOf(0, 0), maxAttempts = 5)
      return rc == RC_OK
    }

    return false
  }

  fun drainCanonEvents(): EventDrainResult {
    if (!isHealthy() || !isCanonEos || !supportedOperations.contains(OC_CANON_EOS_GET_EVENT)) {
      return EventDrainResult(emptyList(), null, null)
    }

    val collected = mutableListOf<ObjectRecord>()
    var iterations = 0
    while (iterations < 6) {
      iterations++
      val res = executeGetData(OC_CANON_EOS_GET_EVENT, intArrayOf(), timeoutMs = 2_000)
      if (res.responseCode != RC_OK || res.data.isEmpty()) {
        break
      }
      val parsedCountBefore = collected.size
      val hasAnyRecord = parseCanonEventsBuffer(res.data, collected)
      if (!hasAnyRecord && collected.size == parsedCountBefore) {
        break
      }
      if (res.data.size <= 16) {
        break
      }
    }

    return EventDrainResult(
      addedObjects = collected,
      evfMode = evfMode,
      evfOutputDevice = evfOutputDevice
    )
  }

  fun transferComplete(handle: Int) {
    if (!isHealthy() || !isCanonEos) return
    if (supportedOperations.contains(OC_CANON_EOS_TRANSFER_COMPLETE)) {
      executeWithBusyRetry(OC_CANON_EOS_TRANSFER_COMPLETE, intArrayOf(handle), maxAttempts = 4)
    }
  }

  fun getStorageIds(): IntArray {
    if (!isHealthy()) return IntArray(0)
    val res = executeGetData(OC_GET_STORAGE_IDS, intArrayOf())
    if (res.responseCode != RC_OK || res.data.size < 4) return IntArray(0)
    val buf = ByteBuffer.wrap(res.data).order(ByteOrder.LITTLE_ENDIAN)
    val count = buf.int
    if (count <= 0 || count > 64 || res.data.size < 4 + count * 4) return IntArray(0)
    val ids = IntArray(count)
    for (i in 0 until count) {
      ids[i] = buf.int
    }
    return ids
  }

  fun getAllJpegHandles(
    knownJpegs: Set<Int> = emptySet(),
    ignoredNonJpegs: MutableSet<Int>? = null
  ): List<Int> {
    var storageIds = getStorageIds()
    if (storageIds.isEmpty()) {
      Thread.sleep(200)
      storageIds = getStorageIds()
    }

    val result = mutableListOf<Int>()
    for (storageId in storageIds) {
      val jpegRes = executeGetData(
        OC_GET_OBJECT_HANDLES,
        intArrayOf(storageId, FORMAT_EXIF_JPEG, 0),
        timeoutMs = 5_000
      )
      if (jpegRes.responseCode == RC_OK && jpegRes.data.size >= 4) {
        val handles = unpackIntArray(jpegRes.data)
        if (handles.isNotEmpty()) {
          result.addAll(handles)
          continue
        }
      }

      // Fallback when camera returns empty on format-filtered query or tags JFIF
      val allRes = executeGetData(
        OC_GET_OBJECT_HANDLES,
        intArrayOf(storageId, 0, 0),
        timeoutMs = 6_000
      )
      if (allRes.responseCode == RC_OK && allRes.data.size >= 4) {
        val handles = unpackIntArray(allRes.data)
        for (h in handles) {
          if (knownJpegs.contains(h)) {
            result.add(h)
            continue
          }
          if (ignoredNonJpegs?.contains(h) == true) {
            continue
          }
          val info = getObjectInfo(h)
          val fmt = info?.first ?: 0
          val name = info?.third ?: ""
          if (fmt == FORMAT_EXIF_JPEG ||
            fmt == FORMAT_JFIF ||
            name.endsWith(".jpg", ignoreCase = true) ||
            name.endsWith(".jpeg", ignoreCase = true)
          ) {
            result.add(h)
          } else {
            ignoredNonJpegs?.add(h)
          }
        }
      }
    }
    return result
  }

  /**
   * Returns Triple(objectFormat, objectSize, filename) via PTP GetObjectInfo (0x1008).
   */
  fun getObjectInfo(handle: Int): Triple<Int, Long, String>? {
    if (!isHealthy()) return null
    val res = executeGetData(OC_GET_OBJECT_INFO, intArrayOf(handle))
    if (res.responseCode != RC_OK || res.data.size < 53) return null
    val buf = ByteBuffer.wrap(res.data).order(ByteOrder.LITTLE_ENDIAN)
    val format = buf.getShort(4).toInt() and 0xFFFF
    val size = buf.getInt(8).toLong() and 0xFFFFFFFFL
    val filename = readPtpStringAt(res.data, 52).first
    return Triple(format, size, filename)
  }

  /**
   * Fetches embedded EXIF/PTP thumbnail via GetThumb (0x100A).
   */
  fun getObjectThumb(handle: Int): ByteArray? {
    if (!isHealthy()) return null
    val res = executeGetData(OC_GET_THUMB, intArrayOf(handle), timeoutMs = 2_000)
    if (res.responseCode == RC_OK && res.data.isNotEmpty()) {
      return res.data
    }
    return null
  }

  /**
   * Downloads an object directly to `destFile` using streaming bulk reads (avoids large heap allocations)
   * and acknowledges Canon TransferComplete when required.
   */
  fun downloadObjectToFile(
    handle: Int,
    destFile: File,
    expectedSize: Long = 0L,
    needsTransferComplete: Boolean = false
  ): Boolean {
    if (!isHealthy()) return false

    val tmpFile = File(destFile.parentFile, "${destFile.name}.part")
    if (tmpFile.exists()) tmpFile.delete()

    var ok = false
    if (isCanonEos && expectedSize > 1_048_576L &&
      supportedOperations.contains(OC_CANON_EOS_GET_PARTIAL_OBJECT)
    ) {
      ok = downloadChunkedPartial(handle, expectedSize, tmpFile)
    }

    if (!ok) {
      ok = streamGetObjectToFile(handle, tmpFile)
    }

    if (needsTransferComplete) {
      transferComplete(handle)
    }

    if (ok && tmpFile.exists() && tmpFile.length() > 0L) {
      if (destFile.exists()) destFile.delete()
      return tmpFile.renameTo(destFile) || tmpFile.copyTo(destFile, overwrite = true).let {
        tmpFile.delete()
        destFile.exists() && destFile.length() > 0L
      }
    }
    tmpFile.delete()
    return false
  }

  fun isJpegObject(obj: ObjectRecord): Boolean {
    return obj.format == FORMAT_EXIF_JPEG ||
      obj.format == FORMAT_JFIF ||
      obj.filename.endsWith(".jpg", ignoreCase = true) ||
      obj.filename.endsWith(".jpeg", ignoreCase = true)
  }

  private fun downloadChunkedPartial(handle: Int, totalSize: Long, destFile: File): Boolean {
    val chunkLimit = 1_048_576 // 1MB chunks (safe across Canon EOS R / 6D / older bodies)
    var offset = 0L
    try {
      FileOutputStream(destFile).use { fos ->
        while (offset < totalSize) {
          val toRead = minOf(chunkLimit.toLong(), totalSize - offset).toInt()
          val res = executeGetData(
            OC_CANON_EOS_GET_PARTIAL_OBJECT,
            intArrayOf(handle, offset.toInt(), toRead),
            timeoutMs = 8_000
          )
          if (res.responseCode != RC_OK || res.data.isEmpty()) {
            return false
          }
          fos.write(res.data)
          offset += res.data.size
        }
      }
      return destFile.length() > 0L
    } catch (_: Exception) {
      return false
    }
  }

  private fun streamGetObjectToFile(handle: Int, destFile: File): Boolean {
    val conn = connection ?: return false
    val inEp = bulkIn ?: return false
    val outEp = bulkOut ?: return false

    val txId = nextTransactionId++
    val cmd = buildCommandPacket(OC_GET_OBJECT, txId, intArrayOf(handle))
    if (!sendBytes(conn, outEp, cmd, DEFAULT_TIMEOUT_MS)) {
      consecutiveIoFailures++
      return false
    }

    return try {
      var gotData = false
      while (true) {
        val header = readHeaderAndFirstChunk(conn, inEp, 10_000) ?: run {
          consecutiveIoFailures++
          return false
        }
        val (containerLen, type, code, _, firstChunk, firstLen) = header
        if (type == CONTAINER_DATA) {
          gotData = true
          FileOutputStream(destFile).use { fos ->
            if (firstLen > 12) {
              fos.write(firstChunk, 12, firstLen - 12)
            }
            var received = firstLen.toLong()
            val expectedTotal = if (containerLen == -1L) Long.MAX_VALUE else containerLen
            val buf = ByteArray(USB_CHUNK_SIZE)
            while (received < expectedTotal) {
              val remaining = if (expectedTotal == Long.MAX_VALUE) {
                USB_CHUNK_SIZE
              } else {
                minOf(USB_CHUNK_SIZE.toLong(), expectedTotal - received).toInt()
              }
              val n = conn.bulkTransfer(inEp, buf, 0, remaining, 10_000)
              if (n <= 0) {
                if (expectedTotal == Long.MAX_VALUE) break
                consecutiveIoFailures++
                return false
              }
              fos.write(buf, 0, n)
              received += n
              if (expectedTotal == Long.MAX_VALUE && n < remaining) {
                break
              }
            }
          }
        } else if (type == CONTAINER_RESPONSE) {
          consecutiveIoFailures = 0
          return gotData && code == RC_OK
        } else {
          return false
        }
      }
      @Suppress("UNREACHABLE_CODE")
      false
    } catch (e: Exception) {
      Log.w(TAG, "streamGetObjectToFile failed", e)
      consecutiveIoFailures++
      false
    }
  }

  private fun setCanonPropertyInt32(propCode: Int, value: Int): Int {
    val data = ByteArray(12)
    ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN).apply {
      putInt(12)
      putInt(propCode)
      putInt(value)
    }
    var attempts = 0
    while (attempts < 5) {
      attempts++
      val rc = executeSendData(OC_CANON_EOS_SET_DEVICE_PROP_VALUE_EX, intArrayOf(), data)
      if (rc != RC_DEVICE_BUSY && rc != RC_CANON_NOT_READY) {
        return rc
      }
      Thread.sleep(100)
    }
    return RC_DEVICE_BUSY
  }

  private fun executeWithBusyRetry(
    opCode: Int,
    params: IntArray,
    maxAttempts: Int = 5
  ): Int {
    var attempt = 0
    while (attempt < maxAttempts) {
      attempt++
      val rc = executeNoData(opCode, params)
      if (rc != RC_DEVICE_BUSY && rc != RC_CANON_NOT_READY) {
        return rc
      }
      Thread.sleep(110)
    }
    return RC_DEVICE_BUSY
  }

  private fun executeNoData(
    opCode: Int,
    params: IntArray,
    txIdOverride: Int? = null,
    timeoutMs: Int = DEFAULT_TIMEOUT_MS
  ): Int {
    return executeTransaction(opCode, params, null, txIdOverride, timeoutMs).responseCode
  }

  private fun executeGetData(
    opCode: Int,
    params: IntArray,
    timeoutMs: Int = BULK_READ_TIMEOUT_MS
  ): TransactionResult {
    return executeTransaction(opCode, params, null, null, timeoutMs)
  }

  private fun executeSendData(
    opCode: Int,
    params: IntArray,
    outData: ByteArray,
    timeoutMs: Int = DEFAULT_TIMEOUT_MS
  ): Int {
    return executeTransaction(opCode, params, outData, null, timeoutMs).responseCode
  }

  @Synchronized
  private fun executeTransaction(
    opCode: Int,
    params: IntArray,
    outData: ByteArray?,
    txIdOverride: Int?,
    timeoutMs: Int
  ): TransactionResult {
    val conn = connection ?: return TransactionResult(RC_GENERAL_ERROR, ByteArray(0), IntArray(0))
    val inEp = bulkIn ?: return TransactionResult(RC_GENERAL_ERROR, ByteArray(0), IntArray(0))
    val outEp = bulkOut ?: return TransactionResult(RC_GENERAL_ERROR, ByteArray(0), IntArray(0))

    val txId = txIdOverride ?: nextTransactionId++
    val cmdPacket = buildCommandPacket(opCode, txId, params)

    if (!sendBytes(conn, outEp, cmdPacket, timeoutMs)) {
      consecutiveIoFailures++
      return TransactionResult(RC_GENERAL_ERROR, ByteArray(0), IntArray(0))
    }

    if (outData != null) {
      val dataPacket = buildDataPacket(opCode, txId, outData)
      if (!sendBytes(conn, outEp, dataPacket, timeoutMs)) {
        consecutiveIoFailures++
        return TransactionResult(RC_GENERAL_ERROR, ByteArray(0), IntArray(0))
      }
    }

    var responseData = ByteArray(0)
    while (true) {
      val container = readFullContainer(conn, inEp, timeoutMs) ?: run {
        consecutiveIoFailures++
        return TransactionResult(RC_GENERAL_ERROR, ByteArray(0), IntArray(0))
      }
      when (container.type) {
        CONTAINER_DATA -> {
          responseData = container.data
        }
        CONTAINER_RESPONSE -> {
          consecutiveIoFailures = 0
          val respParams = if (container.data.size >= 4) {
            val count = container.data.size / 4
            val bb = ByteBuffer.wrap(container.data).order(ByteOrder.LITTLE_ENDIAN)
            IntArray(count) { bb.int }
          } else {
            IntArray(0)
          }
          return TransactionResult(container.code, responseData, respParams)
        }
        else -> {
          return TransactionResult(RC_GENERAL_ERROR, ByteArray(0), IntArray(0))
        }
      }
    }
  }

  private fun buildCommandPacket(opCode: Int, txId: Int, params: IntArray): ByteArray {
    val totalLen = 12 + params.size * 4
    val packet = ByteArray(totalLen)
    ByteBuffer.wrap(packet).order(ByteOrder.LITTLE_ENDIAN).apply {
      putInt(totalLen)
      putShort(CONTAINER_COMMAND.toShort())
      putShort(opCode.toShort())
      putInt(txId)
      for (p in params) {
        putInt(p)
      }
    }
    return packet
  }

  private fun buildDataPacket(opCode: Int, txId: Int, payload: ByteArray): ByteArray {
    val totalLen = 12 + payload.size
    val packet = ByteArray(totalLen)
    ByteBuffer.wrap(packet).order(ByteOrder.LITTLE_ENDIAN).apply {
      putInt(totalLen)
      putShort(CONTAINER_DATA.toShort())
      putShort(opCode.toShort())
      putInt(txId)
      put(payload)
    }
    return packet
  }

  private fun sendBytes(
    conn: UsbDeviceConnection,
    outEp: UsbEndpoint,
    bytes: ByteArray,
    timeoutMs: Int
  ): Boolean {
    var offset = 0
    while (offset < bytes.size) {
      val toSend = minOf(USB_CHUNK_SIZE, bytes.size - offset)
      val sent = conn.bulkTransfer(outEp, bytes, offset, toSend, timeoutMs)
      if (sent <= 0) return false
      offset += sent
    }
    val maxPacket = outEp.maxPacketSize.coerceAtLeast(64)
    if (bytes.isNotEmpty() && bytes.size % maxPacket == 0) {
      conn.bulkTransfer(outEp, ByteArray(0), 0, 0, timeoutMs)
    }
    return true
  }

  private data class FirstChunkHeader(
    val containerLength: Long,
    val type: Int,
    val code: Int,
    val txId: Int,
    val buffer: ByteArray,
    val bytesRead: Int
  )

  private fun readHeaderAndFirstChunk(
    conn: UsbDeviceConnection,
    inEp: UsbEndpoint,
    timeoutMs: Int
  ): FirstChunkHeader? {
    val firstBuf = ByteArray(USB_CHUNK_SIZE)
    var n = 0
    var zeroRetries = 0
    while (zeroRetries < 3) {
      n = conn.bulkTransfer(inEp, firstBuf, 0, firstBuf.size, timeoutMs)
      if (n == 0) {
        zeroRetries++
        continue
      }
      break
    }
    if (n < 12) return null

    val bb = ByteBuffer.wrap(firstBuf).order(ByteOrder.LITTLE_ENDIAN)
    val len = bb.getInt(0).toLong() and 0xFFFFFFFFL
    val type = bb.getShort(4).toInt() and 0xFFFF
    val code = bb.getShort(6).toInt() and 0xFFFF
    val txId = bb.getInt(8)

    return FirstChunkHeader(len, type, code, txId, firstBuf, n)
  }

  private fun readFullContainer(
    conn: UsbDeviceConnection,
    inEp: UsbEndpoint,
    timeoutMs: Int
  ): PtpContainer? {
    val header = readHeaderAndFirstChunk(conn, inEp, timeoutMs) ?: return null
    val (containerLen, type, code, txId, firstBuf, firstRead) = header

    if (containerLen == 0xFFFFFFFFL) {
      val out = ByteArrayOutputStream()
      if (firstRead > 12) {
        out.write(firstBuf, 12, firstRead - 12)
      }
      val buf = ByteArray(USB_CHUNK_SIZE)
      while (out.size() < MAX_PACKET_BYTES) {
        val n = conn.bulkTransfer(inEp, buf, 0, buf.size, timeoutMs)
        if (n <= 0) break
        out.write(buf, 0, n)
        if (n < buf.size) break
      }
      return PtpContainer(type, code, txId, out.toByteArray())
    }

    if (containerLen < 12L || containerLen > MAX_PACKET_BYTES) {
      return null
    }

    val payloadLen = (containerLen - 12L).toInt()
    val payload = ByteArray(payloadLen)
    val initialCopy = minOf(payloadLen, (firstRead - 12).coerceAtLeast(0))
    if (initialCopy > 0) {
      System.arraycopy(firstBuf, 12, payload, 0, initialCopy)
    }

    var offset = initialCopy
    while (offset < payloadLen) {
      val toRead = minOf(USB_CHUNK_SIZE, payloadLen - offset)
      val n = conn.bulkTransfer(inEp, payload, offset, toRead, timeoutMs)
      if (n <= 0) return null
      offset += n
    }

    return PtpContainer(type, code, txId, payload)
  }

  private fun findPtpInterfaceAndEndpoints(
    dev: UsbDevice
  ): Triple<UsbInterface, UsbEndpoint, UsbEndpoint>? {
    var fallback: Triple<UsbInterface, UsbEndpoint, UsbEndpoint>? = null

    for (i in 0 until dev.interfaceCount) {
      val intf = dev.getInterface(i)
      var inEp: UsbEndpoint? = null
      var outEp: UsbEndpoint? = null
      for (e in 0 until intf.endpointCount) {
        val ep = intf.getEndpoint(e)
        if (ep.type == UsbConstants.USB_ENDPOINT_XFER_BULK) {
          if (ep.direction == UsbConstants.USB_DIR_IN && inEp == null) inEp = ep
          if (ep.direction == UsbConstants.USB_DIR_OUT && outEp == null) outEp = ep
        }
      }
      if (inEp != null && outEp != null) {
        if (intf.interfaceClass == UsbConstants.USB_CLASS_STILL_IMAGE) {
          return Triple(intf, inEp, outEp)
        }
        if (fallback == null) {
          fallback = Triple(intf, inEp, outEp)
        }
      }
    }
    return fallback
  }

  private fun parseDeviceInfo(data: ByteArray) {
    try {
      var pos = 0
      if (data.size < 10) return
      pos += 2 // StandardVersion
      pos += 4 // VendorExtensionID
      pos += 2 // VendorExtensionVersion
      pos = readPtpStringAt(data, pos).second // VendorExtensionDesc
      pos += 2 // FunctionalMode

      if (pos + 4 > data.size) return
      val opCount = getIntLE(data, pos)
      pos += 4
      supportedOperations.clear()
      for (i in 0 until opCount.coerceAtMost(512)) {
        if (pos + 2 > data.size) return
        val op = getUInt16LE(data, pos)
        supportedOperations.add(op)
        pos += 2
      }

      // Skip EventsSupported, DevicePropertiesSupported, CaptureFormats, ImageFormats
      repeat(4) {
        if (pos + 4 > data.size) return
        val cnt = getIntLE(data, pos)
        pos += 4 + cnt.coerceAtLeast(0).coerceAtMost(512) * 2
      }

      val (_, nextAfterMfg) = readPtpStringAt(data, pos) // Manufacturer
      val (model, _) = readPtpStringAt(data, nextAfterMfg) // Model
      if (model.isNotBlank()) {
        modelName = model.trim()
      }
    } catch (_: Exception) {
    }
  }

  private fun parseCanonEventsBuffer(
    data: ByteArray,
    addedObjectsOut: MutableList<ObjectRecord>? = null
  ): Boolean {
    var offset = 0
    var sawValidRecord = false

    while (offset + 8 <= data.size) {
      val size = getIntLE(data, offset)
      val code = getIntLE(data, offset + 4)

      if (size == 8 && code == 0) break
      if (size < 8 || offset + size > data.size) break

      sawValidRecord = true
      when (code) {
        EC_CANON_EOS_OBJECT_ADDED_EX,
        EC_CANON_EOS_OBJECT_INFO_CHANGED_EX -> {
          if (size >= 0x29) {
            val handle = getIntLE(data, offset + 0x08)
            val format = getUInt16LE(data, offset + 0x10)
            val objSize = getIntLE(data, offset + 0x1C).toLong() and 0xFFFFFFFFL
            val filename = readCString(data, offset + 0x28, offset + size)
              .ifBlank { "CANON_$handle.JPG" }
            if (code == EC_CANON_EOS_OBJECT_ADDED_EX && format != FORMAT_ASSOCIATION) {
              addedObjectsOut?.add(
                ObjectRecord(
                  handle = handle,
                  format = format,
                  size = objSize,
                  filename = filename,
                  needsTransferComplete = false
                )
              )
            }
          }
        }

        EC_CANON_EOS_OBJECT_ADDED_EX64 -> {
          if (size >= 0x2D) {
            val handle = getIntLE(data, offset + 0x08)
            val format = getUInt16LE(data, offset + 0x10)
            val objSize = getIntLE(data, offset + 0x1C).toLong() and 0xFFFFFFFFL
            val filename = readCString(data, offset + 0x2C, offset + size)
              .ifBlank { "CANON_$handle.JPG" }
            if (format != FORMAT_ASSOCIATION) {
              addedObjectsOut?.add(
                ObjectRecord(
                  handle = handle,
                  format = format,
                  size = objSize,
                  filename = filename,
                  needsTransferComplete = false
                )
              )
            }
          }
        }

        EC_CANON_EOS_REQUEST_OBJECT_TRANSFER,
        EC_CANON_EOS_REQUEST_OBJECT_TRANSFER64 -> {
          if (size >= 0x1D) {
            val handle = getIntLE(data, offset + 0x08)
            val format = getUInt16LE(data, offset + 0x0C)
            val objSize = getIntLE(data, offset + 0x14).toLong() and 0xFFFFFFFFL
            val filename = readCString(data, offset + 0x1C, offset + size)
              .ifBlank { "CANON_$handle.JPG" }
            addedObjectsOut?.add(
              ObjectRecord(
                handle = handle,
                format = format,
                size = objSize,
                filename = filename,
                needsTransferComplete = true
              )
            )
          }
        }

        EC_CANON_EOS_PROP_VALUE_CHANGED -> {
          if (size >= 14) {
            val dpc = getIntLE(data, offset + 0x08)
            val value = if (size >= 16) getIntLE(data, offset + 0x0C) else getUInt16LE(data, offset + 0x0C)
            when (dpc) {
              DPC_CANON_EOS_EVF_MODE -> evfMode = value
              DPC_CANON_EOS_EVF_OUTPUT_DEVICE -> evfOutputDevice = value
              DPC_CANON_EOS_CAPTURE_DESTINATION -> captureDestination = value
            }
          }
        }

        EC_CANON_EOS_AVAIL_LIST_CHANGED -> {
          // Observed for device property capabilities
        }
      }

      offset += size
    }

    return sawValidRecord
  }

  private fun extractJpegFromViewFinderPayload(data: ByteArray): ByteArray? {
    var pos = 0
    while (pos + 8 <= data.size) {
      val segLen = getIntLE(data, pos)
      val segType = getIntLE(data, pos + 4)
      if (segLen < 8 || pos + segLen > data.size) break

      if (segType == LV_SEG_JPEG_1 || segType == LV_SEG_JPEG_9 || segType == LV_SEG_JPEG_11) {
        val segStart = pos + 8
        val segEnd = pos + segLen
        val soi = findJpegMarker(data, segStart, segEnd, 0xD8.toByte())
        if (soi >= 0) {
          val eoi = findLastJpegEoi(data, soi + 2, segEnd)
          val copyEnd = if (eoi > soi) eoi else segEnd
          return data.copyOfRange(soi, copyEnd)
        }
      }

      pos += segLen
    }

    // Fallback scan for embedded SOI..EOI anywhere in payload
    val soi = findJpegMarker(data, 0, data.size, 0xD8.toByte())
    if (soi >= 0) {
      val eoi = findLastJpegEoi(data, soi + 2, data.size)
      val copyEnd = if (eoi > soi) eoi else data.size
      return data.copyOfRange(soi, copyEnd)
    }
    return null
  }

  private fun findJpegMarker(data: ByteArray, start: Int, end: Int, markerByte: Byte): Int {
    for (i in start until (end - 1)) {
      if (data[i] == 0xFF.toByte() && data[i + 1] == markerByte) {
        return i
      }
    }
    return -1
  }

  private fun findLastJpegEoi(data: ByteArray, start: Int, end: Int): Int {
    for (i in (end - 2) downTo start) {
      if (data[i] == 0xFF.toByte() && data[i + 1] == 0xD9.toByte()) {
        return i + 2
      }
    }
    return -1
  }

  private fun unpackIntArray(data: ByteArray): List<Int> {
    if (data.size < 4) return emptyList()
    val bb = ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN)
    val count = bb.int
    if (count <= 0 || data.size < 4 + count * 4) return emptyList()
    val list = ArrayList<Int>(count)
    for (i in 0 until count) {
      list.add(bb.int)
    }
    return list
  }

  private fun getIntLE(buf: ByteArray, offset: Int): Int {
    return (buf[offset].toInt() and 0xFF) or
      ((buf[offset + 1].toInt() and 0xFF) shl 8) or
      ((buf[offset + 2].toInt() and 0xFF) shl 16) or
      ((buf[offset + 3].toInt() and 0xFF) shl 24)
  }

  private fun getUInt16LE(buf: ByteArray, offset: Int): Int {
    return (buf[offset].toInt() and 0xFF) or ((buf[offset + 1].toInt() and 0xFF) shl 8)
  }

  private fun readPtpStringAt(data: ByteArray, offset: Int): Pair<String, Int> {
    if (offset >= data.size) return Pair("", offset)
    val numChars = data[offset].toInt() and 0xFF
    var pos = offset + 1
    if (numChars == 0) return Pair("", pos)

    val byteLen = (numChars * 2).coerceAtMost((data.size - pos).coerceAtLeast(0))
    val chars = CharArray(byteLen / 2)
    var charCount = 0
    for (i in 0 until byteLen / 2) {
      val ch = getUInt16LE(data, pos + i * 2)
      if (ch == 0) break
      chars[charCount++] = ch.toChar()
    }
    return Pair(String(chars, 0, charCount), pos + numChars * 2)
  }

  private fun readCString(data: ByteArray, start: Int, limit: Int): String {
    if (start >= limit) return ""
    var end = start
    while (end < limit && data[end] != 0.toByte()) {
      end++
    }
    return String(data, start, (end - start).coerceAtLeast(0), Charsets.UTF_8)
      .trim()
      .ifBlank { String.format(Locale.US, "") }
  }
}
