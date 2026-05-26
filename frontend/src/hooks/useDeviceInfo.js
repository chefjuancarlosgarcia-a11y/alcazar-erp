import { useEffect, useState } from "react"

const MOBILE_MAX_WIDTH = 767
const TABLET_MAX_WIDTH = 1199

function matchesMedia(query) {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches
}

function readDeviceInfo() {
  if (typeof window === "undefined") {
    return {
      isMobile: false,
      isTablet: false,
      isDesktop: true,
      isIOS: false,
      isAndroid: false,
      isTouchDevice: false,
      screenWidth: 0,
      screenHeight: 0,
      orientation: "landscape"
    }
  }

  const screenWidth = window.innerWidth
  const screenHeight = window.innerHeight
  const userAgent = navigator.userAgent || ""
  const isAndroid = /Android/i.test(userAgent)
  const isIOS = /iPad|iPhone|iPod/i.test(userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  const isTouchDevice = navigator.maxTouchPoints > 0 || "ontouchstart" in window || matchesMedia("(pointer: coarse)")
  const isMobile = screenWidth <= MOBILE_MAX_WIDTH
  const isTablet = screenWidth > MOBILE_MAX_WIDTH && screenWidth <= TABLET_MAX_WIDTH

  return {
    isMobile,
    isTablet,
    isDesktop: !isMobile && !isTablet,
    isIOS,
    isAndroid,
    isTouchDevice,
    screenWidth,
    screenHeight,
    orientation: matchesMedia("(orientation: portrait)") || screenHeight >= screenWidth ? "portrait" : "landscape"
  }
}

function useDeviceInfo() {
  const [deviceInfo, setDeviceInfo] = useState(readDeviceInfo)

  useEffect(() => {
    const orientationQuery = window.matchMedia("(orientation: portrait)")
    const pointerQuery = window.matchMedia("(pointer: coarse)")
    const updateDeviceInfo = () => setDeviceInfo(readDeviceInfo())
    const addMediaListener = (query) => {
      if (query.addEventListener) query.addEventListener("change", updateDeviceInfo)
      else query.addListener(updateDeviceInfo)
    }
    const removeMediaListener = (query) => {
      if (query.removeEventListener) query.removeEventListener("change", updateDeviceInfo)
      else query.removeListener(updateDeviceInfo)
    }

    window.addEventListener("resize", updateDeviceInfo)
    addMediaListener(orientationQuery)
    addMediaListener(pointerQuery)

    return () => {
      window.removeEventListener("resize", updateDeviceInfo)
      removeMediaListener(orientationQuery)
      removeMediaListener(pointerQuery)
    }
  }, [])

  return deviceInfo
}

export default useDeviceInfo
