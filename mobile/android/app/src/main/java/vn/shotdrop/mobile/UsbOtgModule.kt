package vn.shotdrop.mobile

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.mtp.MtpConstants
import android.mtp.MtpDevice
import android.os.Build
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.util.concurrent.Executors

class UsbOtgModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private val executor = Executors.newSingleThreadExecutor()
  private var activeDeviceId: Int = -1
  private val knownObjectHandles = mutableSetOf<Int>()
  private val importedObjectHandles = mutableSetOf<Int>()
  private var isBaselineInitialized = false

  companion object {
    const val NAME = "ShotDropUsbOtg"
    const val ACTION_USB_PERMISSION = "vn.shotdrop.mobile.USB_PERMISSION"
  }

  override fun getName(): String = NAME

  private fun findCandidateUsbDevice(usbManager: UsbManager): UsbDevice? {
    val deviceList = usbManager.deviceList.values
    if (deviceList.isEmpty()) return null

    // Prioritize USB Still Image / PTP / MTP cameras (Class 6)
    for (device in deviceList) {
      if (device.deviceClass == UsbConstants.USB_CLASS_STILL_IMAGE) {
        return device
      }
      for (i in 0 until device.interfaceCount) {
        val intf = device.getInterface(i)
        if (intf.interfaceClass == UsbConstants.USB_CLASS_STILL_IMAGE) {
          return device
        }
      }
    }

    // Fallback to first attached external USB device
    return deviceList.firstOrNull()
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
    val pendingIntent = PendingIntent.getBroadcast(reactContext, 0, intent, flags)
    usbManager.requestPermission(device, pendingIntent)
  }

  @ReactMethod
  fun scanAndConnectCamera(promise: Promise) {
    executor.execute {
      try {
        val usbManager =
          reactContext.getSystemService(Context.USB_SERVICE) as? UsbManager
        if (usbManager == null) {
          val res = Arguments.createMap().apply {
            putBoolean("connected", false)
            putString("status", "NO_USB_SERVICE")
            putNull("deviceName")
            putInt("totalPhotosOnCard", 0)
          }
          promise.resolve(res)
          return@execute
        }

        val device = findCandidateUsbDevice(usbManager)
        if (device == null) {
          activeDeviceId = -1
          isBaselineInitialized = false
          knownObjectHandles.clear()
          val res = Arguments.createMap().apply {
            putBoolean("connected", false)
            putString("status", "NO_USB_DEVICE")
            putNull("deviceName")
            putInt("totalPhotosOnCard", 0)
          }
          promise.resolve(res)
          return@execute
        }

        val friendlyName =
          device.productName?.takeIf { it.isNotBlank() }
            ?: device.manufacturerName?.takeIf { it.isNotBlank() }
            ?: device.deviceName

        if (!usbManager.hasPermission(device)) {
          requestUsbPermission(usbManager, device)
          val res = Arguments.createMap().apply {
            putBoolean("connected", false)
            putString("status", "REQUESTING_PERMISSION")
            putString("deviceName", friendlyName)
            putInt("totalPhotosOnCard", 0)
          }
          promise.resolve(res)
          return@execute
        }

        val connection = usbManager.openDevice(device)
        if (connection == null) {
          val res = Arguments.createMap().apply {
            putBoolean("connected", false)
            putString("status", "OPEN_FAILED")
            putString("deviceName", friendlyName)
            putInt("totalPhotosOnCard", 0)
          }
          promise.resolve(res)
          return@execute
        }

        val mtpDevice = MtpDevice(device)
        val opened = mtpDevice.open(connection)
        if (!opened) {
          connection.close()
          val res = Arguments.createMap().apply {
            putBoolean("connected", false)
            putString("status", "MTP_OPEN_FAILED")
            putString("deviceName", friendlyName)
            putInt("totalPhotosOnCard", 0)
          }
          promise.resolve(res)
          return@execute
        }

        var totalJpegs = 0
        try {
          val storageIds = mtpDevice.storageIds ?: IntArray(0)
          val currentHandles = mutableListOf<Int>()
          for (storageId in storageIds) {
            val jpegHandles =
              mtpDevice.getObjectHandles(storageId, MtpConstants.FORMAT_EXIF_JPEG, 0)
                ?: IntArray(0)
            for (h in jpegHandles) {
              currentHandles.add(h)
            }
          }
          totalJpegs = currentHandles.size

          if (activeDeviceId != device.deviceId || !isBaselineInitialized) {
            activeDeviceId = device.deviceId
            knownObjectHandles.clear()
            knownObjectHandles.addAll(currentHandles)
            isBaselineInitialized = true
          }
        } finally {
          mtpDevice.close()
          connection.close()
        }

        val res = Arguments.createMap().apply {
          putBoolean("connected", true)
          putString("status", "CONNECTED")
          putString("deviceName", friendlyName)
          putInt("totalPhotosOnCard", totalJpegs)
        }
        promise.resolve(res)
      } catch (e: Exception) {
        val res = Arguments.createMap().apply {
          putBoolean("connected", false)
          putString("status", "ERROR")
          putString("error", e.message ?: "USB OTG error")
          putInt("totalPhotosOnCard", 0)
        }
        promise.resolve(res)
      }
    }
  }

  @ReactMethod
  fun pollNewPhotosFromCamera(fetchRecentCount: Int, promise: Promise) {
    executor.execute {
      try {
        val usbManager =
          reactContext.getSystemService(Context.USB_SERVICE) as? UsbManager
        if (usbManager == null) {
          promise.resolve(Arguments.createArray())
          return@execute
        }

        val device = findCandidateUsbDevice(usbManager)
        if (device == null || !usbManager.hasPermission(device)) {
          promise.resolve(Arguments.createArray())
          return@execute
        }

        val connection = usbManager.openDevice(device)
        if (connection == null) {
          promise.resolve(Arguments.createArray())
          return@execute
        }

        val mtpDevice = MtpDevice(device)
        if (!mtpDevice.open(connection)) {
          connection.close()
          promise.resolve(Arguments.createArray())
          return@execute
        }

        val importedItems = Arguments.createArray()

        try {
          val storageIds = mtpDevice.storageIds ?: IntArray(0)
          val allHandles = mutableListOf<Int>()
          for (storageId in storageIds) {
            val jpegHandles =
              mtpDevice.getObjectHandles(storageId, MtpConstants.FORMAT_EXIF_JPEG, 0)
                ?: IntArray(0)
            for (h in jpegHandles) {
              allHandles.add(h)
            }
          }

          if (activeDeviceId != device.deviceId || !isBaselineInitialized) {
            activeDeviceId = device.deviceId
            knownObjectHandles.clear()
            knownObjectHandles.addAll(allHandles)
            isBaselineInitialized = true
          }

          val handlesToImport: List<Int> = if (fetchRecentCount > 0) {
            allHandles
              .sorted()
              .takeLast(fetchRecentCount)
          } else {
            allHandles.filter { !knownObjectHandles.contains(it) }
          }

          if (handlesToImport.isNotEmpty()) {
            val cacheDir = File(reactContext.cacheDir, "otg_imports")
            if (!cacheDir.exists()) {
              cacheDir.mkdirs()
            }

            for (handle in handlesToImport) {
              knownObjectHandles.add(handle)
              val info = mtpDevice.getObjectInfo(handle)
              val rawName = info?.name?.takeIf { it.isNotBlank() } ?: "CANON_OTG_$handle.JPG"
              val safeName = rawName.replace(Regex("[^a-zA-Z0-9._-]"), "_")
              val destFile = File(cacheDir, "${device.deviceId}_${handle}_$safeName")

              val importedOk = if (destFile.exists() && destFile.length() > 0) {
                true
              } else {
                mtpDevice.importFile(handle, destFile.absolutePath)
              }

              if (importedOk && destFile.exists() && destFile.length() > 0) {
                importedObjectHandles.add(handle)
                val map = Arguments.createMap().apply {
                  putString("id", "otg-${device.deviceId}-$handle-${System.currentTimeMillis()}")
                  putString("uri", "file://${destFile.absolutePath}")
                  putString("filename", safeName)
                  putDouble("creationTime", System.currentTimeMillis().toDouble())
                }
                importedItems.pushMap(map)
              }
            }
          }
        } finally {
          mtpDevice.close()
          connection.close()
        }

        promise.resolve(importedItems)
      } catch (e: Exception) {
        promise.resolve(Arguments.createArray())
      }
    }
  }
}
