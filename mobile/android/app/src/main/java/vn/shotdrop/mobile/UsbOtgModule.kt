package vn.shotdrop.mobile

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbDeviceConnection
import android.hardware.usb.UsbManager
import android.mtp.MtpConstants
import android.mtp.MtpDevice
import android.os.Build
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.locks.ReentrantLock

class UsbOtgModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext), LifecycleEventListener {

  private val executor = Executors.newSingleThreadExecutor()
  private val usbBusLock = ReentrantLock()
  private var activeDeviceId: Int = -1
  private var activePtpClient: CanonPtpClient? = null
  private val knownObjectHandles = ConcurrentHashMap.newKeySet<Int>()
  private val ignoredNonJpegHandles = ConcurrentHashMap.newKeySet<Int>()
  @Volatile private var isBaselineInitialized = false
  @Volatile private var lastKnownCardPhotoCount: Int = 0
  @Volatile private var lastFullScanAtMs: Long = 0L

  // Permission state tracking to avoid spamming Android's USB permission dialog every poll tick
  private val permissionRequestedAtMs = ConcurrentHashMap<Int, Long>()
  private val permissionDeniedDeviceIds = ConcurrentHashMap.newKeySet<Int>()
  @Volatile private var isReceiverRegistered = false

  companion object {
    const val NAME = "ShotDropUsbOtg"
    const val ACTION_USB_PERMISSION = "vn.shotdrop.mobile.USB_PERMISSION"
    const val EVENT_USB_CHANGED = "ShotDropUsbOtgChanged"
    private const val PERMISSION_COOLDOWN_MS = 20_000L
    private const val USB_CLASS_BILLBOARD = 0x11

    // Known camera vendor IDs when camera exposes vendor/composite PTP interfaces
    private val CAMERA_VENDOR_IDS = setOf(
      0x04A9, // Canon
      0x04B0, // Nikon
      0x054C, // Sony
      0x04CB, // Fujifilm
      0x07B4, // Olympus / OM System
      0x04DA, // Panasonic
      0x05CA, // Ricoh / Pentax
      0x1A4A, // Leica
      0x2672, // GoPro
      0x2B00  // DJI
    )
  }

  private val usbBroadcastReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
      if (intent == null) return
      val device: UsbDevice? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        intent.getParcelableExtra(UsbManager.EXTRA_DEVICE, UsbDevice::class.java)
      } else {
        @Suppress("DEPRECATION")
        intent.getParcelableExtra(UsbManager.EXTRA_DEVICE)
      }

      when (intent.action) {
        ACTION_USB_PERMISSION -> {
          val granted = intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)
          if (device != null) {
            permissionRequestedAtMs.remove(device.deviceId)
            if (granted) {
              permissionDeniedDeviceIds.remove(device.deviceId)
            } else {
              permissionDeniedDeviceIds.add(device.deviceId)
            }
          }
          emitUsbChangedEvent()
        }

        UsbManager.ACTION_USB_DEVICE_ATTACHED -> {
          if (device != null) {
            permissionRequestedAtMs.remove(device.deviceId)
            permissionDeniedDeviceIds.remove(device.deviceId)
          }
          emitUsbChangedEvent()
        }

        UsbManager.ACTION_USB_DEVICE_DETACHED -> {
          if (device != null) {
            permissionRequestedAtMs.remove(device.deviceId)
            permissionDeniedDeviceIds.remove(device.deviceId)
            if (device.deviceId == activeDeviceId) {
              resetSessionState()
            }
          } else {
            resetSessionState()
          }
          emitUsbChangedEvent()
        }
      }
    }
  }

  override fun getName(): String = NAME

  override fun initialize() {
    super.initialize()
    reactContext.addLifecycleEventListener(this)
    registerUsbReceiver()
  }

  override fun invalidate() {
    super.invalidate()
    unregisterUsbReceiver()
    closeActivePtpClient()
    try {
      reactContext.removeLifecycleEventListener(this)
    } catch (_: Exception) {
    }
    executor.shutdownNow()
  }

  override fun onHostResume() {
    // Re-check USB devices whenever user returns from USB Permission prompt or System Settings
    emitUsbChangedEvent()
  }

  override fun onHostPause() {
  }

  override fun onHostDestroy() {
    unregisterUsbReceiver()
    closeActivePtpClient()
  }

  private fun registerUsbReceiver() {
    if (isReceiverRegistered) return
    try {
      val filter = IntentFilter().apply {
        addAction(ACTION_USB_PERMISSION)
        addAction(UsbManager.ACTION_USB_DEVICE_ATTACHED)
        addAction(UsbManager.ACTION_USB_DEVICE_DETACHED)
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        reactContext.registerReceiver(usbBroadcastReceiver, filter, Context.RECEIVER_EXPORTED)
      } else {
        reactContext.registerReceiver(usbBroadcastReceiver, filter)
      }
      isReceiverRegistered = true
    } catch (_: Exception) {
    }
  }

  private fun unregisterUsbReceiver() {
    if (!isReceiverRegistered) return
    try {
      reactContext.unregisterReceiver(usbBroadcastReceiver)
    } catch (_: Exception) {
    } finally {
      isReceiverRegistered = false
    }
  }

  private fun emitUsbChangedEvent() {
    try {
      reactContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit(EVENT_USB_CHANGED, null)
    } catch (_: Exception) {
    }
  }

  private fun closeActivePtpClient() {
    val acquired = try {
      usbBusLock.tryLock(400L, TimeUnit.MILLISECONDS)
    } catch (_: Exception) {
      false
    }
    try {
      val existing = activePtpClient
      activePtpClient = null
      if (existing != null) {
        try {
          existing.close()
        } catch (_: Exception) {
        }
      }
    } finally {
      if (acquired) {
        usbBusLock.unlock()
      }
    }
  }

  private fun resetSessionState() {
    closeActivePtpClient()
    activeDeviceId = -1
    isBaselineInitialized = false
    lastKnownCardPhotoCount = 0
    lastFullScanAtMs = 0L
    knownObjectHandles.clear()
    ignoredNonJpegHandles.clear()
  }

  private data class UsbDiscoveryResult(
    val cameraCandidates: List<UsbDevice>,
    val massStorageDevices: List<UsbDevice>,
    val hubOrOtherDevices: List<UsbDevice>,
    val diagnosticInfo: String
  )

  private fun hasBulkInOutEndpoints(device: UsbDevice): Boolean {
    for (i in 0 until device.interfaceCount) {
      val intf = device.getInterface(i)
      var hasBulkIn = false
      var hasBulkOut = false
      for (e in 0 until intf.endpointCount) {
        val ep = intf.getEndpoint(e)
        if (ep.type == UsbConstants.USB_ENDPOINT_XFER_BULK) {
          if (ep.direction == UsbConstants.USB_DIR_IN) hasBulkIn = true
          if (ep.direction == UsbConstants.USB_DIR_OUT) hasBulkOut = true
        }
      }
      if (hasBulkIn && hasBulkOut) return true
    }
    return false
  }

  private fun isHubOrAccessoryClass(cls: Int): Boolean {
    return cls == UsbConstants.USB_CLASS_HUB ||
      cls == UsbConstants.USB_CLASS_HID ||
      cls == UsbConstants.USB_CLASS_AUDIO ||
      cls == UsbConstants.USB_CLASS_PRINTER ||
      cls == UsbConstants.USB_CLASS_COMM ||
      cls == UsbConstants.USB_CLASS_CDC_DATA ||
      cls == UsbConstants.USB_CLASS_VIDEO ||
      cls == USB_CLASS_BILLBOARD
  }

  private fun classifyUsbDevices(usbManager: UsbManager): UsbDiscoveryResult {
    val devices = usbManager.deviceList.values.toList()
    if (devices.isEmpty()) {
      return UsbDiscoveryResult(emptyList(), emptyList(), emptyList(), "")
    }

    val ptpCameras = mutableListOf<UsbDevice>()
    val vendorCameras = mutableListOf<UsbDevice>()
    val massStorage = mutableListOf<UsbDevice>()
    val hubsOrOthers = mutableListOf<UsbDevice>()
    val summaries = mutableListOf<String>()

    for (device in devices) {
      val interfaceClasses = (0 until device.interfaceCount).map {
        device.getInterface(it).interfaceClass
      }

      val name = friendlyDeviceName(device)
      val vidPid = String.format(Locale.US, "%04x:%04x", device.vendorId, device.productId)
      val clsDesc = "cls=${device.deviceClass}[${interfaceClasses.joinToString(",")}]"
      summaries.add("$name ($vidPid, $clsDesc)")

      val hasStillImage = device.deviceClass == UsbConstants.USB_CLASS_STILL_IMAGE ||
        interfaceClasses.any { it == UsbConstants.USB_CLASS_STILL_IMAGE }
      val hasMassStorage = device.deviceClass == UsbConstants.USB_CLASS_MASS_STORAGE ||
        interfaceClasses.any { it == UsbConstants.USB_CLASS_MASS_STORAGE }
      val isPureHubOrPeripheral = isHubOrAccessoryClass(device.deviceClass) ||
        (interfaceClasses.isNotEmpty() && interfaceClasses.all { isHubOrAccessoryClass(it) })
      val isKnownCameraVendor = CAMERA_VENDOR_IDS.contains(device.vendorId)
      val lowerName = name.lowercase(Locale.US)
      val looksLikeCameraName =
        lowerName.contains("canon") ||
          lowerName.contains("nikon") ||
          lowerName.contains("sony") ||
          lowerName.contains("eos") ||
          lowerName.contains("fuji") ||
          lowerName.contains("lumix") ||
          lowerName.contains("camera") ||
          lowerName.contains("ptp") ||
          lowerName.contains("mtp")

      when {
        hasStillImage -> ptpCameras.add(device)
        (isKnownCameraVendor || looksLikeCameraName) &&
          !hasMassStorage &&
          !isPureHubOrPeripheral &&
          hasBulkInOutEndpoints(device) -> {
          vendorCameras.add(device)
        }
        hasMassStorage -> massStorage.add(device)
        isPureHubOrPeripheral -> hubsOrOthers.add(device)
        else -> hubsOrOthers.add(device)
      }
    }

    return UsbDiscoveryResult(
      cameraCandidates = ptpCameras + vendorCameras,
      massStorageDevices = massStorage,
      hubOrOtherDevices = hubsOrOthers,
      diagnosticInfo = summaries.joinToString(" | ")
    )
  }

  private fun friendlyDeviceName(device: UsbDevice): String {
    return device.productName?.takeIf { it.isNotBlank() }
      ?: device.manufacturerName?.takeIf { it.isNotBlank() }
      ?: String.format(Locale.US, "USB %04X:%04X", device.vendorId, device.productId)
  }

  private fun requestUsbPermission(usbManager: UsbManager, device: UsbDevice) {
    val intent = Intent(ACTION_USB_PERMISSION).apply {
      setPackage(reactContext.packageName)
    }
    val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    } else {
      PendingIntent.FLAG_UPDATE_CURRENT
    }
    val pendingIntent = PendingIntent.getBroadcast(reactContext, device.deviceId, intent, flags)
    usbManager.requestPermission(device, pendingIntent)
  }

  private fun createStatusMap(
    connected: Boolean,
    usbAttached: Boolean,
    status: String,
    deviceName: String?,
    totalPhotosOnCard: Int,
    diagnosticInfo: String = "",
    error: String? = null,
    isCanonEos: Boolean = false
  ): WritableMap {
    return Arguments.createMap().apply {
      putBoolean("connected", connected)
      putBoolean("usbAttached", usbAttached)
      putString("status", status)
      if (deviceName != null) putString("deviceName", deviceName) else putNull("deviceName")
      putInt("totalPhotosOnCard", totalPhotosOnCard)
      putBoolean("isCanonEos", isCanonEos)
      if (diagnosticInfo.isNotBlank()) putString("diagnosticInfo", diagnosticInfo)
      if (!error.isNullOrBlank()) putString("error", error)
    }
  }

  private fun openMtpWithRetry(
    usbManager: UsbManager,
    device: UsbDevice
  ): Pair<UsbDeviceConnection, MtpDevice>? {
    var conn = usbManager.openDevice(device)
    if (conn == null) {
      Thread.sleep(220)
      conn = usbManager.openDevice(device)
    }
    if (conn == null) return null

    val mtp = MtpDevice(device)
    if (mtp.open(conn)) {
      return Pair(conn, mtp)
    }

    // Some Canon / Sony / Nikon bodies via Type-C Hubs need brief settle time after attach/permission
    try {
      conn.close()
    } catch (_: Exception) {
    }
    Thread.sleep(320)

    val retryConn = usbManager.openDevice(device) ?: return null
    val retryMtp = MtpDevice(device)
    return if (retryMtp.open(retryConn)) {
      Pair(retryConn, retryMtp)
    } else {
      try {
        retryConn.close()
      } catch (_: Exception) {
      }
      null
    }
  }

  private fun collectJpegHandles(mtpDevice: MtpDevice): List<Int> {
    var storageIds = mtpDevice.storageIds ?: IntArray(0)
    if (storageIds.isEmpty()) {
      Thread.sleep(250)
      storageIds = mtpDevice.storageIds ?: IntArray(0)
    }

    val allJpegHandles = mutableListOf<Int>()
    for (storageId in storageIds) {
      val exifJpegs =
        mtpDevice.getObjectHandles(storageId, MtpConstants.FORMAT_EXIF_JPEG, 0)
      if (exifJpegs != null && exifJpegs.isNotEmpty()) {
        for (h in exifJpegs) {
          allJpegHandles.add(h)
        }
        continue
      }

      // Fallback when camera firmware rejects format-filtered GetObjectHandles or tags JFIF
      val allHandles = mtpDevice.getObjectHandles(storageId, 0, 0) ?: IntArray(0)
      for (h in allHandles) {
        if (knownObjectHandles.contains(h)) {
          allJpegHandles.add(h)
          continue
        }
        if (ignoredNonJpegHandles.contains(h)) {
          continue
        }
        val info = mtpDevice.getObjectInfo(h)
        val fmt = info?.format ?: 0
        val name = info?.name ?: ""
        val isJpeg = fmt == MtpConstants.FORMAT_EXIF_JPEG ||
          fmt == MtpConstants.FORMAT_JFIF ||
          name.endsWith(".jpg", ignoreCase = true) ||
          name.endsWith(".jpeg", ignoreCase = true)
        if (isJpeg) {
          allJpegHandles.add(h)
        } else {
          ignoredNonJpegHandles.add(h)
        }
      }
    }
    return allJpegHandles
  }

  private inline fun <T> withUsbBus(block: () -> T): T {
    usbBusLock.lock()
    try {
      return block()
    } finally {
      usbBusLock.unlock()
    }
  }

  private fun performSync(manualRequest: Boolean, fetchRecentCount: Int): WritableMap {
    usbBusLock.lock()
    try {
      return performSyncLocked(manualRequest, fetchRecentCount)
    } finally {
      usbBusLock.unlock()
    }
  }

  private fun performSyncLocked(manualRequest: Boolean, fetchRecentCount: Int): WritableMap {
    val resultMap = Arguments.createMap()
    val importedItems = Arguments.createArray()

    val usbManager = reactContext.getSystemService(Context.USB_SERVICE) as? UsbManager
    if (usbManager == null) {
      resultMap.putMap(
        "status",
        createStatusMap(false, false, "NO_USB_SERVICE", null, 0)
      )
      resultMap.putArray("newPhotos", importedItems)
      return resultMap
    }

    val discovery = classifyUsbDevices(usbManager)
    if (
      discovery.cameraCandidates.isEmpty() &&
      discovery.massStorageDevices.isEmpty() &&
      discovery.hubOrOtherDevices.isEmpty()
    ) {
      resetSessionState()
      resultMap.putMap(
        "status",
        createStatusMap(false, false, "NO_USB_DEVICE", null, 0)
      )
      resultMap.putArray("newPhotos", importedItems)
      return resultMap
    }

    // No PTP/MTP camera seen yet, check if Mass Storage (camera MSC or Hub SD card reader) or Hub itself is attached
    if (discovery.cameraCandidates.isEmpty()) {
      resetSessionState()
      if (discovery.massStorageDevices.isNotEmpty()) {
        val msDev = discovery.massStorageDevices.first()
        resultMap.putMap(
          "status",
          createStatusMap(
            false,
            true,
            "MASS_STORAGE",
            friendlyDeviceName(msDev),
            0,
            discovery.diagnosticInfo
          )
        )
      } else {
        val hubDev = discovery.hubOrOtherDevices.first()
        resultMap.putMap(
          "status",
          createStatusMap(
            false,
            true,
            "HUB_ONLY",
            friendlyDeviceName(hubDev),
            0,
            discovery.diagnosticInfo
          )
        )
      }
      resultMap.putArray("newPhotos", importedItems)
      return resultMap
    }

    var lastStatusMap: WritableMap? = null

    for (device in discovery.cameraCandidates) {
      val friendlyName = friendlyDeviceName(device)

      if (!usbManager.hasPermission(device)) {
        if (!manualRequest && permissionDeniedDeviceIds.contains(device.deviceId)) {
          lastStatusMap = createStatusMap(
            false,
            true,
            "PERMISSION_DENIED",
            friendlyName,
            0,
            discovery.diagnosticInfo
          )
          continue
        }

        val now = System.currentTimeMillis()
        val lastReq = permissionRequestedAtMs[device.deviceId] ?: 0L
        if (manualRequest || (now - lastReq > PERMISSION_COOLDOWN_MS)) {
          permissionDeniedDeviceIds.remove(device.deviceId)
          permissionRequestedAtMs[device.deviceId] = now
          requestUsbPermission(usbManager, device)
        }

        lastStatusMap = createStatusMap(
          false,
          true,
          "REQUESTING_PERMISSION",
          friendlyName,
          0,
          discovery.diagnosticInfo
        )
        continue
      }

      // Permission granted — prefer persistent raw PTP session (keeps Canon Live View uninterrupted)
      var ptpClient = activePtpClient
      if (ptpClient != null && (ptpClient.device.deviceId != device.deviceId || !ptpClient.isHealthy())) {
        closeActivePtpClient()
        ptpClient = null
      }

      if (ptpClient == null) {
        val candidate = CanonPtpClient(device, usbManager)
        if (candidate.open()) {
          activePtpClient = candidate
          ptpClient = candidate
        } else {
          Thread.sleep(180)
          if (candidate.open()) {
            activePtpClient = candidate
            ptpClient = candidate
          }
        }
      }

      if (ptpClient != null) {
        var totalJpegs = lastKnownCardPhotoCount
        try {
          val isNewDeviceSession = activeDeviceId != device.deviceId || !isBaselineInitialized
          if (isNewDeviceSession) {
            val allHandles = ptpClient.getAllJpegHandles(knownObjectHandles, ignoredNonJpegHandles)
            activeDeviceId = device.deviceId
            knownObjectHandles.clear()
            ignoredNonJpegHandles.clear()
            knownObjectHandles.addAll(allHandles)
            lastKnownCardPhotoCount = allHandles.size
            lastFullScanAtMs = System.currentTimeMillis()
            totalJpegs = allHandles.size
            isBaselineInitialized = true
            // Flush any queued pre-connect events on first attach
            if (ptpClient.isCanonEos) {
              ptpClient.drainCanonEvents()
            }
          } else if (ptpClient.isCanonEos && fetchRecentCount == 0) {
            val drained = ptpClient.drainCanonEvents()
            for (obj in drained.addedObjects) {
              if (!ptpClient.isJpegObject(obj)) {
                if (!obj.needsTransferComplete) {
                  ignoredNonJpegHandles.add(obj.handle)
                }
                continue
              }
              if (!obj.needsTransferComplete && obj.size <= 0L) {
                // Camera is still flushing file size to card; pick it up on next poll tick
                continue
              }
              val wasNew = knownObjectHandles.add(obj.handle)
              if (wasNew || obj.needsTransferComplete) {
                val imported = importPtpRecord(ptpClient, device.deviceId, obj)
                if (imported != null) {
                  importedItems.pushMap(imported)
                } else {
                  knownObjectHandles.remove(obj.handle)
                }
              }
            }
          }

          val now = System.currentTimeMillis()
          val shouldRefreshCardHandles =
            fetchRecentCount > 0 ||
              (fetchRecentCount == 0 && (!ptpClient.isCanonEos || manualRequest || (now - lastFullScanAtMs > 3000L)))

          if (shouldRefreshCardHandles) {
            val allHandles = ptpClient.getAllJpegHandles(knownObjectHandles, ignoredNonJpegHandles)
            lastKnownCardPhotoCount = allHandles.size
            lastFullScanAtMs = now
            totalJpegs = allHandles.size

            val handlesToImport: List<Int> = if (fetchRecentCount > 0) {
              allHandles.sorted().takeLast(fetchRecentCount)
            } else {
              allHandles.filter { !knownObjectHandles.contains(it) }
            }

            for (handle in handlesToImport) {
              val imported = importPtpHandle(ptpClient, device.deviceId, handle)
              if (imported != null) {
                knownObjectHandles.add(handle)
                importedItems.pushMap(imported)
              }
            }
          } else {
            totalJpegs = maxOf(lastKnownCardPhotoCount, knownObjectHandles.size)
          }

          val resolvedName = ptpClient.modelName?.takeIf { it.isNotBlank() } ?: friendlyName
          val diag = buildString {
            append(discovery.diagnosticInfo)
            if (!ptpClient.modelName.isNullOrBlank()) {
              if (isNotEmpty()) append(" • ")
              append("Model=").append(ptpClient.modelName)
            }
            if (ptpClient.isCanonEos) {
              if (isNotEmpty()) append(" • ")
              append("CanonPTP")
            }
          }

          resultMap.putMap(
            "status",
            createStatusMap(
              connected = true,
              usbAttached = true,
              status = "CONNECTED",
              deviceName = resolvedName,
              totalPhotosOnCard = totalJpegs,
              diagnosticInfo = diag,
              isCanonEos = ptpClient.isCanonEos
            )
          )
          resultMap.putArray("newPhotos", importedItems)
          return resultMap
        } catch (e: Exception) {
          if (!ptpClient.isHealthy()) {
            closeActivePtpClient()
          }
          lastStatusMap = createStatusMap(
            false,
            true,
            "PTP_SYNC_ERROR",
            ptpClient.modelName ?: friendlyName,
            totalJpegs,
            discovery.diagnosticInfo,
            e.message ?: "Lỗi đồng bộ qua USB PTP"
          )
          continue
        }
      }

      // Fallback to Android MtpDevice for non-Canon devices if raw PTP open failed
      val opened = openMtpWithRetry(usbManager, device)
      if (opened == null) {
        val testConn = usbManager.openDevice(device)
        if (testConn == null) {
          lastStatusMap = createStatusMap(
            false,
            true,
            "OPEN_FAILED",
            friendlyName,
            0,
            discovery.diagnosticInfo,
            "Không thể mở kết nối USB tới $friendlyName"
          )
        } else {
          try {
            testConn.close()
          } catch (_: Exception) {
          }
          lastStatusMap = createStatusMap(
            false,
            true,
            "MTP_OPEN_FAILED",
            friendlyName,
            0,
            discovery.diagnosticInfo,
            "Không mở được phiên PTP/MTP trên $friendlyName (hãy tắt Wi-Fi máy ảnh hoặc rút cắm lại cáp)"
          )
        }
        continue
      }

      val connection = opened.first
      val mtpDevice = opened.second
      var totalJpegs = 0

      try {
        val allHandles = collectJpegHandles(mtpDevice)
        totalJpegs = allHandles.size
        lastKnownCardPhotoCount = totalJpegs

        if (activeDeviceId != device.deviceId || !isBaselineInitialized) {
          activeDeviceId = device.deviceId
          knownObjectHandles.clear()
          ignoredNonJpegHandles.clear()
          knownObjectHandles.addAll(allHandles)
          isBaselineInitialized = true
        }

        val handlesToImport: List<Int> = when {
          fetchRecentCount < 0 -> emptyList()
          fetchRecentCount > 0 -> allHandles.sorted().takeLast(fetchRecentCount)
          else -> allHandles.filter { !knownObjectHandles.contains(it) }
        }

        if (handlesToImport.isNotEmpty()) {
          val cacheDir = ensureOtgCacheDir()
          for (handle in handlesToImport) {
            val info = mtpDevice.getObjectInfo(handle)
            val safeName = sanitizeJpegName(info?.name, handle)
            val reportedSize = (info?.compressedSize ?: 0).toLong() and 0xFFFFFFFFL
            if (fetchRecentCount == 0 && reportedSize <= 0L) {
              continue
            }
            val destFile = File(cacheDir, "${device.deviceId}_${handle}_$safeName")

            val importedOk = if (destFile.exists() && destFile.length() > 0 &&
              (reportedSize <= 0L || destFile.length() == reportedSize)
            ) {
              true
            } else {
              mtpDevice.importFile(handle, destFile.absolutePath)
            }

            if (importedOk && destFile.exists() && destFile.length() > 0) {
              knownObjectHandles.add(handle)
              val fileSize = if (reportedSize > 0L) reportedSize else destFile.length()
              importedItems.pushMap(buildImportedPhotoMap(device.deviceId, handle, destFile, safeName, fileSize))
            }
          }
        }
      } finally {
        try {
          mtpDevice.close()
        } catch (_: Exception) {
        }
        try {
          connection.close()
        } catch (_: Exception) {
        }
      }

      resultMap.putMap(
        "status",
        createStatusMap(
          true,
          true,
          "CONNECTED",
          friendlyName,
          totalJpegs,
          discovery.diagnosticInfo
        )
      )
      resultMap.putArray("newPhotos", importedItems)
      return resultMap
    }

    resultMap.putMap(
      "status",
      lastStatusMap ?: createStatusMap(false, false, "NO_USB_DEVICE", null, 0)
    )
    resultMap.putArray("newPhotos", importedItems)
    return resultMap
  }

  private fun ensureOtgThumbDir(): File {
    val dir = File(reactContext.cacheDir, "otg_thumbs")
    if (!dir.exists()) {
      dir.mkdirs()
    }
    return dir
  }

  private fun ensureOtgCacheDir(): File {
    val cacheDir = File(reactContext.cacheDir, "otg_imports")
    if (!cacheDir.exists()) {
      cacheDir.mkdirs()
    }
    return cacheDir
  }

  private fun buildCameraKey(filename: String, size: Long, handle: Int): String {
    val normalizedName = filename.trim().lowercase(Locale.US)
    return if (size > 0L) "$normalizedName#$size" else "$normalizedName#h$handle"
  }

  private fun buildImportedPhotoMap(
    deviceId: Int,
    handle: Int,
    destFile: File,
    safeName: String,
    sizeHint: Long = 0L
  ): WritableMap {
    val now = System.currentTimeMillis()
    val resolvedSize = if (sizeHint > 0L) sizeHint else destFile.length()
    return Arguments.createMap().apply {
      putString("id", "otg-$deviceId-$handle-$now")
      putString("uri", "file://${destFile.absolutePath}")
      putString("filename", safeName)
      putInt("handle", handle)
      putDouble("size", resolvedSize.toDouble())
      putString("cameraKey", buildCameraKey(safeName, resolvedSize, handle))
      putDouble("creationTime", now.toDouble())
    }
  }

  private fun sanitizeJpegName(rawName: String?, handle: Int): String {
    val base = rawName?.takeIf { it.isNotBlank() } ?: "OTG_$handle.JPG"
    val safe = base.replace(Regex("[^a-zA-Z0-9._-]"), "_")
    return if (safe.endsWith(".jpg", ignoreCase = true) || safe.endsWith(".jpeg", ignoreCase = true)) {
      safe
    } else {
      "$safe.jpg"
    }
  }

  private fun importPtpRecord(
    client: CanonPtpClient,
    deviceId: Int,
    obj: CanonPtpClient.ObjectRecord
  ): WritableMap? {
    val cacheDir = ensureOtgCacheDir()
    val safeName = sanitizeJpegName(obj.filename, obj.handle)
    val destFile = if (obj.needsTransferComplete) {
      File(cacheDir, "${deviceId}_${obj.handle}_${System.currentTimeMillis()}_$safeName")
    } else {
      File(cacheDir, "${deviceId}_${obj.handle}_$safeName")
    }

    val alreadyCached = !obj.needsTransferComplete &&
      destFile.exists() &&
      destFile.length() > 0 &&
      (obj.size <= 0L || destFile.length() == obj.size)

    val importedOk = if (alreadyCached) {
      true
    } else {
      client.downloadObjectToFile(obj.handle, destFile, obj.size, obj.needsTransferComplete)
    }

    if (importedOk && destFile.exists() && destFile.length() > 0) {
      val resolvedSize = if (obj.size > 0L) obj.size else destFile.length()
      return buildImportedPhotoMap(deviceId, obj.handle, destFile, safeName, resolvedSize)
    }
    return null
  }

  private fun importPtpHandle(
    client: CanonPtpClient,
    deviceId: Int,
    handle: Int
  ): WritableMap? {
    val info = client.getObjectInfo(handle)
    val format = info?.first ?: 0
    val size = info?.second ?: 0L
    val filename = info?.third ?: "OTG_$handle.JPG"
    val record = CanonPtpClient.ObjectRecord(
      handle = handle,
      format = format,
      size = size,
      filename = filename,
      needsTransferComplete = false
    )
    return importPtpRecord(client, deviceId, record)
  }

  private fun ensureConnectedPtpClientLocked(): CanonPtpClient? {
    val current = activePtpClient
    if (current != null && current.isHealthy()) {
      return current
    }
    performSyncLocked(manualRequest = false, fetchRecentCount = -1)
    return activePtpClient?.takeIf { it.isHealthy() }
  }

  private fun findFirstPermittedCameraDevice(): Pair<UsbManager, UsbDevice>? {
    val usbManager = reactContext.getSystemService(Context.USB_SERVICE) as? UsbManager ?: return null
    val discovery = classifyUsbDevices(usbManager)
    val dev = discovery.cameraCandidates.firstOrNull { usbManager.hasPermission(it) } ?: return null
    return Pair(usbManager, dev)
  }

  private data class CardSummaryItem(
    val handle: Int,
    val filename: String,
    val size: Long,
    val cameraKey: String,
    val cachedThumbUri: String?
  )

  private data class CardSummarySnapshot(
    val totalCount: Int,
    val itemsNewestFirst: List<CardSummaryItem>
  )

  private fun collectCardSnapshotLocked(maxItems: Int): CardSummarySnapshot? {
    val thumbDir = ensureOtgThumbDir()
    val ptp = ensureConnectedPtpClientLocked()
    if (ptp != null) {
      val deviceId = ptp.device.deviceId
      val allHandles = ptp.getAllJpegHandles(knownObjectHandles, ignoredNonJpegHandles)
      knownObjectHandles.addAll(allHandles)
      lastKnownCardPhotoCount = allHandles.size
      val orderedHandles = allHandles.asReversed()
      val itemsToDescribe = if (maxItems > 0) orderedHandles.take(maxItems) else orderedHandles
      val items = itemsToDescribe.map { handle ->
        val info = if (ptp.isHealthy()) ptp.getObjectInfo(handle) else null
        val filename = sanitizeJpegName(info?.third, handle)
        val size = info?.second ?: 0L
        val thumbFile = File(thumbDir, "${deviceId}_${handle}.jpg")
        val cachedThumbUri = if (thumbFile.exists() && thumbFile.length() > 0L) {
          "file://${thumbFile.absolutePath}"
        } else {
          null
        }
        CardSummaryItem(
          handle = handle,
          filename = filename,
          size = size,
          cameraKey = buildCameraKey(filename, size, handle),
          cachedThumbUri = cachedThumbUri
        )
      }
      return CardSummarySnapshot(orderedHandles.size, items)
    }

    val (usbManager, dev) = findFirstPermittedCameraDevice() ?: return null
    val opened = openMtpWithRetry(usbManager, dev) ?: return null
    val (conn, mtp) = opened
    return try {
      val allHandles = collectJpegHandles(mtp)
      knownObjectHandles.addAll(allHandles)
      lastKnownCardPhotoCount = allHandles.size
      val orderedHandles = allHandles.asReversed()
      val itemsToDescribe = if (maxItems > 0) orderedHandles.take(maxItems) else orderedHandles
      val items = itemsToDescribe.map { handle ->
        val info = mtp.getObjectInfo(handle)
        val filename = sanitizeJpegName(info?.name, handle)
        val size = (info?.compressedSize ?: 0).toLong() and 0xFFFFFFFFL
        val thumbFile = File(thumbDir, "${dev.deviceId}_${handle}.jpg")
        val cachedThumbUri = if (thumbFile.exists() && thumbFile.length() > 0L) {
          "file://${thumbFile.absolutePath}"
        } else {
          null
        }
        CardSummaryItem(
          handle = handle,
          filename = filename,
          size = size,
          cameraKey = buildCameraKey(filename, size, handle),
          cachedThumbUri = cachedThumbUri
        )
      }
      CardSummarySnapshot(orderedHandles.size, items)
    } finally {
      try {
        mtp.close()
      } catch (_: Exception) {
      }
      try {
        conn.close()
      } catch (_: Exception) {
      }
    }
  }

  private fun importHandlesBatchLocked(handlesNewestFirst: List<Int>): com.facebook.react.bridge.WritableArray {
    val importedArray = Arguments.createArray()
    if (handlesNewestFirst.isEmpty()) return importedArray

    // Import oldest-first within the batch so the newest uploaded photo lands cleanly on top
    val chronological = handlesNewestFirst.asReversed()
    val ptp = ensureConnectedPtpClientLocked()
    if (ptp != null) {
      val deviceId = ptp.device.deviceId
      for (handle in chronological) {
        val imported = importPtpHandle(ptp, deviceId, handle)
        if (imported != null) {
          knownObjectHandles.add(handle)
          importedArray.pushMap(imported)
        }
      }
      return importedArray
    }

    val (usbManager, dev) = findFirstPermittedCameraDevice() ?: return importedArray
    val opened = openMtpWithRetry(usbManager, dev) ?: return importedArray
    val (conn, mtp) = opened
    try {
      val cacheDir = ensureOtgCacheDir()
      for (handle in chronological) {
        val info = mtp.getObjectInfo(handle)
        val safeName = sanitizeJpegName(info?.name, handle)
        val reportedSize = (info?.compressedSize ?: 0).toLong() and 0xFFFFFFFFL
        val destFile = File(cacheDir, "${dev.deviceId}_${handle}_$safeName")
        val ok = (destFile.exists() && destFile.length() > 0 &&
          (reportedSize <= 0L || destFile.length() == reportedSize)) ||
          mtp.importFile(handle, destFile.absolutePath)
        if (ok && destFile.exists() && destFile.length() > 0) {
          knownObjectHandles.add(handle)
          val fileSize = if (reportedSize > 0L) reportedSize else destFile.length()
          importedArray.pushMap(buildImportedPhotoMap(dev.deviceId, handle, destFile, safeName, fileSize))
        }
      }
    } finally {
      try {
        mtp.close()
      } catch (_: Exception) {
      }
      try {
        conn.close()
      } catch (_: Exception) {
      }
    }
    return importedArray
  }

  @ReactMethod
  fun syncUsbCamera(manualRequest: Boolean, fetchRecentCount: Int, promise: Promise) {
    executor.execute {
      try {
        val synced = performSync(manualRequest, fetchRecentCount)
        promise.resolve(synced)
      } catch (e: Exception) {
        val res = Arguments.createMap().apply {
          putMap(
            "status",
            createStatusMap(false, false, "ERROR", null, 0, "", e.message ?: "USB OTG error")
          )
          putArray("newPhotos", Arguments.createArray())
        }
        promise.resolve(res)
      }
    }
  }

  @ReactMethod
  fun scanAndConnectCamera(promise: Promise) {
    executor.execute {
      try {
        val synced = performSync(manualRequest = true, fetchRecentCount = 0)
        val status = synced.getMap("status")
        promise.resolve(status ?: createStatusMap(false, false, "NO_USB_DEVICE", null, 0))
      } catch (e: Exception) {
        promise.resolve(createStatusMap(false, false, "ERROR", null, 0, "", e.message))
      }
    }
  }

  @ReactMethod
  fun pollNewPhotosFromCamera(fetchRecentCount: Int, promise: Promise) {
    executor.execute {
      try {
        val synced = performSync(manualRequest = false, fetchRecentCount = fetchRecentCount)
        val photos = synced.getArray("newPhotos") ?: Arguments.createArray()
        promise.resolve(photos)
      } catch (_: Exception) {
        promise.resolve(Arguments.createArray())
      }
    }
  }

  @ReactMethod
  fun getCameraPhotosSummary(maxItems: Int, promise: Promise) {
    executor.execute {
      withUsbBus {
        try {
          val snapshot = collectCardSnapshotLocked(maxItems)
          if (snapshot == null) {
            promise.resolve(Arguments.createMap().apply {
              putInt("totalCount", 0)
              putArray("photos", Arguments.createArray())
              putString("error", "Chưa kết nối được máy ảnh qua USB OTG")
            })
            return@withUsbBus
          }
          val itemsArray = Arguments.createArray()
          for (item in snapshot.itemsNewestFirst) {
            itemsArray.pushMap(Arguments.createMap().apply {
              putInt("handle", item.handle)
              putString("filename", item.filename)
              putDouble("size", item.size.toDouble())
              putString("cameraKey", item.cameraKey)
              if (item.cachedThumbUri != null) putString("thumbUri", item.cachedThumbUri) else putNull("thumbUri")
            })
          }

          promise.resolve(Arguments.createMap().apply {
            putInt("totalCount", snapshot.totalCount)
            putArray("photos", itemsArray)
          })
        } catch (e: Exception) {
          promise.resolve(Arguments.createMap().apply {
            putInt("totalCount", 0)
            putArray("photos", Arguments.createArray())
            putString("error", e.message ?: "Không đọc được danh sách ảnh từ máy ảnh")
          })
        }
      }
    }
  }

  @ReactMethod
  fun getCameraPhotoThumbnail(handle: Int, promise: Promise) {
    executor.execute {
      withUsbBus {
        try {
          val thumbDir = ensureOtgThumbDir()
          val currentDeviceId = activePtpClient?.device?.deviceId ?: activeDeviceId
          if (currentDeviceId > 0) {
            val cached = File(thumbDir, "${currentDeviceId}_${handle}.jpg")
            if (cached.exists() && cached.length() > 0L) {
              promise.resolve(Arguments.createMap().apply {
                putString("uri", "file://${cached.absolutePath}")
              })
              return@withUsbBus
            }
          }

          val ptp = ensureConnectedPtpClientLocked()
          if (ptp != null) {
            val deviceId = ptp.device.deviceId
            val dest = File(thumbDir, "${deviceId}_${handle}.jpg")
            val thumbBytes = ptp.getObjectThumb(handle)
            if (thumbBytes != null && thumbBytes.isNotEmpty()) {
              dest.writeBytes(thumbBytes)
              promise.resolve(Arguments.createMap().apply {
                putString("uri", "file://${dest.absolutePath}")
              })
              return@withUsbBus
            }
            promise.resolve(Arguments.createMap().apply { putNull("uri") })
            return@withUsbBus
          }

          val (usbManager, dev) = findFirstPermittedCameraDevice() ?: run {
            promise.resolve(Arguments.createMap().apply { putNull("uri") })
            return@withUsbBus
          }
          val opened = openMtpWithRetry(usbManager, dev) ?: run {
            promise.resolve(Arguments.createMap().apply { putNull("uri") })
            return@withUsbBus
          }
          val (conn, mtp) = opened
          try {
            val thumbBytes = mtp.getThumbnail(handle)
            if (thumbBytes != null && thumbBytes.isNotEmpty()) {
              val dest = File(thumbDir, "${dev.deviceId}_${handle}.jpg")
              dest.writeBytes(thumbBytes)
              promise.resolve(Arguments.createMap().apply {
                putString("uri", "file://${dest.absolutePath}")
              })
            } else {
              promise.resolve(Arguments.createMap().apply { putNull("uri") })
            }
          } finally {
            try {
              mtp.close()
            } catch (_: Exception) {
            }
            try {
              conn.close()
            } catch (_: Exception) {
            }
          }
        } catch (_: Exception) {
          promise.resolve(Arguments.createMap().apply { putNull("uri") })
        }
      }
    }
  }

  @ReactMethod
  fun importCameraHandles(handlesArray: ReadableArray, promise: Promise) {
    val handleList = ArrayList<Int>(handlesArray.size())
    for (i in 0 until handlesArray.size()) {
      handleList.add(handlesArray.getInt(i))
    }
    executor.execute {
      withUsbBus {
        try {
          val photos = importHandlesBatchLocked(handleList)
          promise.resolve(Arguments.createMap().apply {
            putArray("photos", photos)
          })
        } catch (e: Exception) {
          promise.resolve(Arguments.createMap().apply {
            putArray("photos", Arguments.createArray())
            putString("error", e.message ?: "Lỗi tải ảnh từ máy ảnh")
          })
        }
      }
    }
  }

  @ReactMethod
  fun getSystemInsets(promise: Promise) {
    val activity = reactContext.currentActivity
    if (activity == null) {
      val resId = reactContext.resources.getIdentifier("navigation_bar_height", "dimen", "android")
      val px = if (resId > 0) reactContext.resources.getDimensionPixelSize(resId) else 0
      val density = reactContext.resources.displayMetrics.density.coerceAtLeast(1f)
      promise.resolve(Arguments.createMap().apply {
        putDouble("bottom", (px / density).toDouble())
      })
      return
    }
    activity.runOnUiThread {
      try {
        val density = activity.resources.displayMetrics.density.coerceAtLeast(1f)
        val rootInsets = ViewCompat.getRootWindowInsets(activity.window.decorView)
        val navBottomPx = rootInsets
          ?.getInsets(WindowInsetsCompat.Type.navigationBars() or WindowInsetsCompat.Type.displayCutout())
          ?.bottom ?: 0
        val resolvedPx = if (navBottomPx > 0) {
          navBottomPx
        } else {
          val resId = activity.resources.getIdentifier("navigation_bar_height", "dimen", "android")
          if (resId > 0) activity.resources.getDimensionPixelSize(resId) else 0
        }
        promise.resolve(Arguments.createMap().apply {
          putDouble("bottom", (resolvedPx / density).toDouble())
        })
      } catch (_: Exception) {
        promise.resolve(Arguments.createMap().apply {
          putDouble("bottom", 48.0)
        })
      }
    }
  }
}
