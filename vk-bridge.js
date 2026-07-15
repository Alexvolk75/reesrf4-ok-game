/* global vkBridge */
(() => {
  const state = {
    available: false,
    inited: false,
    platform: null,
  };

  function bridgeReady() {
    return typeof vkBridge !== "undefined" && typeof vkBridge.send === "function";
  }

  async function init() {
    if (state.inited) return state;

    if (!bridgeReady()) {
      state.inited = true;
      return state;
    }

    try {
      if (!window.__vkBridgeInitSent) {
        const initData = await vkBridge.send("VKWebAppInit");
        window.__vkBridgeInitSent = true;
        if (!initData?.result) {
          state.inited = true;
          state.available = false;
          return state;
        }
      }

      state.available = true;
      state.inited = true;

      try {
        const info = await vkBridge.send("VKWebAppGetClientVersion");
        state.platform = info?.platform ?? null;
      } catch {
        state.platform = null;
      }

      return state;
    } catch {
      state.available = false;
      state.inited = true;
      return state;
    }
  }

  async function share(text) {
    await init();
    if (!state.available) {
      try {
        await navigator.clipboard.writeText(text);
        return { ok: true, method: "clipboard" };
      } catch {
        return { ok: false, method: "none" };
      }
    }

    try {
      await vkBridge.send("VKWebAppShare", { link: window.location.href });
      return { ok: true, method: "vk_share_link" };
    } catch {
      try {
        await navigator.clipboard.writeText(text);
        return { ok: true, method: "clipboard" };
      } catch {
        return { ok: false, method: "none" };
      }
    }
  }

  async function showAd({ format = "interstitial", waterfall = true } = {}) {
    await init();
    const ads = window.__vkAds;
    if (ads) {
      try {
        const data =
          format === "reward"
            ? await ads.showReward(waterfall)
            : format === "banner"
              ? await ads.showBanner()
              : await ads.showInterstitial();
        return { ok: !!data?.result, data };
      } catch (e) {
        const errData = e?.error_data || e?.data?.error_data || {};
        return {
          ok: false,
          reason: e?.error_type || errData.error_reason || e?.message || "ads_error",
          error_code: errData.error_code,
          error: e,
        };
      }
    }
    if (!state.available) return { ok: false, reason: "no_bridge" };

    try {
      const data = await vkBridge.send("VKWebAppShowNativeAds", {
        ad_format: format === "reward" ? "reward" : "interstitial",
        ...(format === "reward" && waterfall ? { use_waterfall: true } : {}),
      });
      return { ok: !!data?.result, data };
    } catch (e) {
      const errData = e?.error_data || e?.data?.error_data || {};
      return {
        ok: false,
        reason: e?.error_type || errData.error_reason || e?.message || "ads_error",
        error_code: errData.error_code,
        error: e,
      };
    }
  }

  window.VKMini = { init, share, showAd };
})();
