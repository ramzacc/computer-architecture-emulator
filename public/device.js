const deviceUA = navigator.userAgent ?? "";
const mobileUA = navigator.userAgentData?.mobile === true || /Android|iPhone|iPad|iPod|Mobile|Tablet|Kindle|Silk/i.test(deviceUA);
const ipadDesktopUA = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
const touchOnlyDevice = window.matchMedia("(pointer: coarse) and (hover: none)").matches && screen.width <= 1600;

if (mobileUA || ipadDesktopUA || touchOnlyDevice) {
  document.documentElement.classList.add("unsupported-device");
}
