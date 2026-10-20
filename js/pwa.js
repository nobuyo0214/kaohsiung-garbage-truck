"use strict";
(() => {
  let promptEvent = null,
    registration = null,
    requestedReload = false;
  const $ = (id) => document.getElementById(id);
  function installed() {
    $("installButton").hidden = true;
    $("installStatus").textContent =
      "已以主畫面模式開啟。清運資料仍需網路更新。";
  }
  if (
    matchMedia("(display-mode: standalone)").matches ||
    navigator.standalone === true
  )
    installed();
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    promptEvent = event;
    $("installButton").hidden = false;
  });
  window.addEventListener("appinstalled", installed);
  $("installButton").addEventListener("click", async () => {
    if (!promptEvent) return;
    const current = promptEvent;
    promptEvent = null;
    $("installButton").hidden = true;
    try {
      await current.prompt();
      await current.userChoice;
    } catch {
      $("installStatus").textContent = "請使用瀏覽器選單加入主畫面。";
    }
  });
  if (!("serviceWorker" in navigator)) return;
  function offerUpdate() {
    if (registration?.waiting) $("appUpdate").hidden = false;
  }
  $("applyUpdate").addEventListener("click", () => {
    if (!registration?.waiting) {
      location.reload();
      return;
    }
    requestedReload = true;
    registration.waiting.postMessage({ type: "ACTIVATE_UPDATE" });
  });
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (requestedReload) location.reload();
  });
  window.addEventListener("load", async () => {
    try {
      registration = await navigator.serviceWorker.register("./sw.js", {
        scope: "./",
        updateViaCache: "none",
      });
      offerUpdate();
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        worker?.addEventListener("statechange", () => {
          if (
            worker.state === "installed" &&
            navigator.serviceWorker.controller
          )
            offerUpdate();
        });
      });
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) registration.update().catch(() => {});
      });
    } catch {
      $("installStatus").textContent =
        "目前未能啟用離線介面；線上查詢仍可使用。可使用瀏覽器選單加入主畫面。";
    }
  });
})();
