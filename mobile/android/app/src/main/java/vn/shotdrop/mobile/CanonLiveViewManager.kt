package vn.shotdrop.mobile

import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext

class CanonLiveViewManager : SimpleViewManager<CanonLiveViewView>() {
  override fun getName(): String = "ShotDropCanonLiveView"

  override fun createViewInstance(reactContext: ThemedReactContext): CanonLiveViewView {
    return CanonLiveViewView(reactContext)
  }
}
