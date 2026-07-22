/* global vkBridge, FAPI */
(function () {
  var GAME_CFG = { vkAppId: "54678871", okAppId: "512004492157" };
  var FAPI_URL = "https://api.ok.ru/js/fapi5.js";
  var MAX_LOG = 80;

  var AD_CODE = { 12: "Uninitialized", 13: "Custom handler", 20: "No ads", 1051: "getAppAdvertisementConfig" };

  var TYPE_LABEL = {
    interstitial: "Межстраничная",
    reward: "Видео",
    banner: "Баннер",
    entry: "При входе",
    ok_prep: "OK local",
    fapi: "FAPI",
  };

  var logEntries = [];

  function escHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function stringifyVal(v) {
    if (v == null || v === "") return "";
    if (typeof v === "string") return v;
    try {
      return JSON.stringify(v);
    } catch (e) {
      return String(v);
    }
  }

  function fmtTime(ts) {
    var d = new Date(ts);
    return [d.getHours(), d.getMinutes(), d.getSeconds()].map(function (n) {
      return String(n).padStart(2, "0");
    }).join(":");
  }

  function parseVkError(err) {
    if (!err) return { text: "unknown", code: null };
    var data = err.error_data || err.data || err;
    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch (e) {
        data = {};
      }
    }
    var code = data.error_code != null ? data.error_code : err.error_code;
    var blob = stringifyVal(err).toLowerCase();
    if (blob.indexOf("1051") !== -1 || blob.indexOf("getappadvertisementconfig") !== -1) code = 1051;
    var t = [];
    if (err.error_type) t.push("type: " + err.error_type);
    if (code != null) t.push("code " + code + (AD_CODE[code] ? " (" + AD_CODE[code] + ")" : ""));
    var r = stringifyVal(data.error_reason || data.error_description || err.message || err.error);
    if (r && r.length < 90) t.push(r);
    if (!t.length) t.push(stringifyVal(err).slice(0, 90));
    return { text: t.join(" · "), code: code };
  }

  function logClass(st) {
    if (st === "ok") return "adLog__line--ok";
    if (st === "start") return "adLog__line--start";
    return "adLog__line--fail";
  }

  function adLog(type, method, status, detail) {
    var entry = {
      ts: Date.now(),
      type: type,
      label: TYPE_LABEL[type] || type,
      method: method,
      status: status,
      detail: detail || "",
    };
    logEntries.unshift(entry);
    if (logEntries.length > MAX_LOG) logEntries.length = MAX_LOG;
    window.__vkAdLog = logEntries;
    window.dispatchEvent(new CustomEvent("vk-ads-log", { detail: entry }));
    renderLog();
    return entry;
  }

  function renderLog() {
    var el = document.getElementById("adLog");
    if (!el) return;
    if (!logEntries.length) {
      el.innerHTML = '<div class="adLog__line adLog__line--muted">Лог пуст.</div>';
      return;
    }
    el.innerHTML = logEntries
      .map(function (e) {
        var line = fmtTime(e.ts) + " · " + e.label + " · " + e.method + " · " + e.status.toUpperCase();
        if (e.detail) line += " · " + e.detail;
        return '<div class="adLog__line ' + logClass(e.status) + '">' + escHtml(line) + "</div>";
      })
      .join("");
  }

  function setAdStatus(text, kind) {
    var el = document.getElementById("adStatus");
    if (!el) return;
    el.textContent = text;
    el.className = "adStatus adStatus--" + (kind || "wait");
  }

  function readQuery() {
    try {
      return new URLSearchParams(location.search || location.hash.replace(/^#/, "") || "");
    } catch (e) {
      return new URLSearchParams();
    }
  }

  /** app_id из launch params, URL или hostname prod-app123… */
  function resolveAppId(env) {
    var p = (env && env.raw) || {};
    var q = readQuery();
    var list = [p.vk_app_id, p.app_id, q.get("vk_app_id"), q.get("app_id")];
    for (var i = 0; i < list.length; i++) {
      var v = list[i];
      if (v != null && String(v) !== "" && String(v) !== "0") return String(v);
    }
    var host = (location.hostname || "").toLowerCase();
    var m = host.match(/^(?:prod|stage)-app(\d+)-/);
    if (m) return m[1];
    return GAME_CFG.vkAppId || null;
  }

  function resolveOkAppId(env) {
    if (GAME_CFG.okAppId) return String(GAME_CFG.okAppId);
    return resolveAppId(env);
  }

  function detectHostApp() {
    var host = (location.hostname || "").toLowerCase();
    if (host.indexOf("ok.ru") !== -1) return "ok";
    if (host.indexOf("vk.") !== -1) return "vk";
    if (readQuery().get("vk_client") === "ok") return "ok";
    return "unknown";
  }

  function isOkEnv(env) {
    if (!env) return detectHostApp() === "ok";
    if (env.app === "ok") return true;
    return (env.platform || "").indexOf("ok") !== -1;
  }

  function isOkWithoutVk(env) {
    if (!isOkEnv(env)) return false;
    var p = env.raw || {};
    var uid = p.vk_user_id || readQuery().get("vk_user_id");
    return !uid || String(uid) === "0";
  }

  function envLabel(env) {
    if (!env) return "Bridge";
    var a = env.app === "ok" ? "OK" : env.app === "vk" ? "VK" : "?";
    var tag = isOkWithoutVk(env) ? " · без VK ID" : "";
    return a + " · " + (env.platform || "?") + tag;
  }

  function delay(ms) {
    return new Promise(function (r) {
      setTimeout(r, ms);
    });
  }

  function isFail1051OrNoAds(err) {
    var c = parseVkError(err).code;
    return c === 20 || c === 1051;
  }

  function errDetail(e) {
    if (!e) return "unknown";
    if (typeof e === "string") return e;
    if (e.error && typeof e.error === "string") return e.error;
    if (e.error && typeof e.error === "object") return stringifyVal(e.error);
    if (e.message) return String(e.message);
    return parseVkError(e).text || stringifyVal(e).slice(0, 120);
  }

  function isRecoverableAdFail(err) {
    if (isFail1051OrNoAds(err)) return true;
    if (err && err.recoverable) return true;
    if (err && err.error) return true;
    var blob = stringifyVal(err).toLowerCase();
    if (blob.indexOf("ui methods") !== -1) return true;
    if (blob.indexOf("fapi") !== -1) return true;
    if (blob.indexOf("no_fapi") !== -1) return true;
    if (blob.indexOf("error_code\":-1") !== -1) return true;
    return true;
  }

  function canUseFapi() {
    var host = (location.hostname || "").toLowerCase();
    if (host.indexOf("ok.ru") !== -1) return true;
    var r = fapiParams();
    return !!(r.api_server && r.apiconnection);
  }

  function waitUpdateConfig(ms) {
    return new Promise(function (resolve) {
      var done = false;
      var t = setTimeout(function () {
        if (!done) {
          done = true;
          resolve(null);
        }
      }, ms);
      function onEv(e) {
        if (!e || !e.detail || e.detail.type !== "VKWebAppUpdateConfig" || done) return;
        done = true;
        clearTimeout(t);
        try {
          vkBridge.unsubscribe(onEv);
        } catch (x) {}
        resolve(e.detail.data);
      }
      if (typeof vkBridge !== "undefined" && vkBridge.subscribe) vkBridge.subscribe(onEv);
    });
  }

  function getClientEnv() {
    if (typeof vkBridge === "undefined") {
      return Promise.resolve({ app: detectHostApp(), platform: "unknown", raw: null });
    }
    return vkBridge
      .send("VKWebAppGetLaunchParams")
      .then(function (p) {
        var pl = ((p && p.vk_platform) || "unknown").toLowerCase();
        return { app: pl.indexOf("ok") !== -1 ? "ok" : detectHostApp(), platform: pl, raw: p };
      })
      .catch(function () {
        return vkBridge
          .send("VKWebAppGetClientVersion")
          .then(function (v) {
            var app = (v && v.app) || (v && v.environment === "ok" ? "ok" : detectHostApp());
            return { app: app, platform: (v && v.platform) || "unknown", raw: v };
          })
          .catch(function () {
            return { app: detectHostApp(), platform: "unknown", raw: null };
          });
      });
  }

  function bridgeCall(type, method, params, failEvt) {
    adLog(type, method, "start", params ? stringifyVal(params) : "");
    if (typeof vkBridge === "undefined") {
      adLog(type, method, "fail", "no bridge");
      return Promise.reject({ error_data: { error_code: 12 } });
    }
    return new Promise(function (resolve, reject) {
      var settled = false;
      var onFail = null;
      function done(ok, payload) {
        if (settled) return;
        settled = true;
        if (onFail) {
          try {
            vkBridge.unsubscribe(onFail);
          } catch (x) {}
        }
        if (ok) {
          var bad = payload && payload.result === false;
          adLog(type, method, bad ? "fail" : "ok", bad ? "result=false" : "OK");
          bad ? reject(payload) : resolve(payload);
        } else {
          adLog(type, method, "fail", parseVkError(payload).text);
          reject(payload);
        }
      }
      if (failEvt) {
        onFail = function (e) {
          if (e && e.detail && e.detail.type === failEvt) done(false, e.detail.data || e.detail);
        };
        vkBridge.subscribe(onFail);
      }
      vkBridge.send(method, params).then(function (d) {
        done(true, d);
      }).catch(function (e) {
        done(false, e);
      });
    });
  }

  function bridgeSilent(type, method, params, failEvt) {
    return bridgeCall(type, method, params, failEvt).catch(function () {
      return null;
    });
  }

  /* ─── FAPI (OK SDK) ─── */
  var fapiReady = null;

  function loadFapiScript() {
    if (typeof FAPI !== "undefined") return Promise.resolve();
    if (document.querySelector('script[src*="fapi5.js"]')) {
      return delay(100).then(loadFapiScript);
    }
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = FAPI_URL;
      s.async = true;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  function fapiParams() {
    if (typeof FAPI !== "undefined" && FAPI.Util && FAPI.Util.getRequestParameters) {
      try {
        return FAPI.Util.getRequestParameters() || {};
      } catch (e) {}
    }
    var q = readQuery();
    var keys = ["api_server", "apiconnection", "application_key", "session_key", "logged_user_id"];
    var o = {};
    keys.forEach(function (k) {
      var v = q.get(k);
      if (v) o[k] = v;
    });
    return o;
  }

  function ensureFapi() {
    if (fapiReady) return fapiReady;
    fapiReady = loadFapiScript()
      .then(function () {
        return new Promise(function (resolve) {
          var n = 0;
          (function tick() {
            if (typeof FAPI !== "undefined" && FAPI.UI) return resolve();
            if (++n > 80) return resolve();
            setTimeout(tick, 100);
          })();
        });
      })
      .then(function () {
        if (window.__fapiInited || typeof FAPI === "undefined") return;
        var r = fapiParams();
        if (!r.api_server || !r.apiconnection) {
          window.__fapiInited = true;
          return;
        }
        return new Promise(function (resolve) {
          try {
            FAPI.init(r.api_server, r.apiconnection, function () {
              window.__fapiInited = true;
              adLog("fapi", "FAPI.init", "ok", "OK SDK");
              resolve();
            }, function () {
              window.__fapiInited = true;
              adLog("fapi", "FAPI.init", "fail", "init error");
              resolve();
            });
          } catch (e) {
            window.__fapiInited = true;
            resolve();
          }
        });
      });
    return fapiReady;
  }

  function fapiWaitCallback(method, timeoutMs) {
    return new Promise(function (resolve, reject) {
      if (typeof FAPI === "undefined" || !FAPI.UI) {
        reject(new Error("no_fapi"));
        return;
      }
      var queueSize = 1;
      var shown = 0;
      var prev = window.API_callback;
      var timer = setTimeout(function () {
        window.API_callback = prev;
        reject({ error: "fapi_timeout" });
      }, timeoutMs || 90000);

      window.API_callback = function (m, result, data) {
        if (m !== method) {
          if (typeof prev === "function") {
            try {
              prev(m, result, data);
            } catch (e) {}
          }
          return;
        }
        if (result === "event" && data && String(data).indexOf("ads_queue_size=") === 0) {
          var n = parseInt(String(data).split("=")[1], 10);
          if (n > 0) queueSize = n;
          return;
        }
        if (result === "ok" && data === "ad_shown") {
          shown++;
          if (shown >= queueSize) {
            clearTimeout(timer);
            window.API_callback = prev;
            resolve({ result: true, data: data });
          }
          return;
        }
        if (result === "error") {
          clearTimeout(timer);
          window.API_callback = prev;
          reject({ error: data || "no_ads" });
        }
      };
    });
  }

  function fapiShowInterstitial() {
    if (!canUseFapi()) {
      adLog("fapi", "FAPI.UI.showAd", "fail", "skip: не OK iframe");
      return Promise.reject({ error: "fapi_skip", recoverable: true });
    }
    adLog("fapi", "FAPI.UI.showAd", "start", "");
    return ensureFapi().then(function () {
      if (!FAPI || !FAPI.UI || !FAPI.UI.showAd) throw { error: "no_fapi_ui", recoverable: true };
      var cb = fapiWaitCallback("showAd");
      try {
        FAPI.UI.showAd();
      } catch (e) {
        throw { error: errDetail(e), recoverable: true };
      }
      return cb;
    }).then(function (d) {
      adLog("fapi", "FAPI.UI.showAd", "ok", "ad_shown");
      return { result: true, method: "FAPI.showAd", data: d };
    }).catch(function (e) {
      adLog("fapi", "FAPI.UI.showAd", "fail", errDetail(e));
      e = e || {};
      e.recoverable = true;
      throw e;
    });
  }

  function fapiShowReward() {
    if (!canUseFapi()) {
      adLog("fapi", "FAPI load+show", "fail", "skip: не OK iframe");
      return Promise.reject({ error: "fapi_skip", recoverable: true });
    }
    return ensureFapi().then(function () {
      if (!FAPI || !FAPI.UI) throw { error: "no_fapi" };
      return new Promise(function (resolve, reject) {
        var prev = window.API_callback;
        var phase = "load";
        var timer = setTimeout(function () {
          window.API_callback = prev;
          reject({ error: "fapi_timeout" });
        }, 90000);

        window.API_callback = function (m, result, data) {
          if (m === "loadAd") {
            if (result === "ok" && data === "ready") {
              phase = "show";
              adLog("fapi", "FAPI.UI.loadAd", "ok", "ready");
              try {
                FAPI.UI.showLoadedAd();
              } catch (e) {
                clearTimeout(timer);
                window.API_callback = prev;
                reject(e);
              }
            } else if (result === "error") {
              clearTimeout(timer);
              window.API_callback = prev;
              adLog("fapi", "FAPI.UI.loadAd", "fail", data || "?");
              reject({ error: data });
            }
            return;
          }
          if (m === "showLoadedAd") {
            if (result === "ok" && data === "ad_shown") {
              clearTimeout(timer);
              window.API_callback = prev;
              adLog("fapi", "FAPI.UI.showLoadedAd", "ok", "ad_shown");
              resolve({ result: true, method: "FAPI.reward", data: data });
            } else if (result === "error") {
              clearTimeout(timer);
              window.API_callback = prev;
              adLog("fapi", "FAPI.UI.showLoadedAd", "fail", data || "?");
              reject({ error: data });
            }
          }
        };
        try {
          FAPI.UI.loadAd();
        } catch (e) {
          clearTimeout(timer);
          window.API_callback = prev;
          reject(e);
        }
      });
    });
  }

  /* ─── OK local API prep (dev.vk.com/ru/ok/development/bridge) ─── */
  function prepareOkLocal(env) {
    if (!isOkWithoutVk(env)) return Promise.resolve();
    var vkAppId = resolveAppId(env);
    var okAppId = resolveOkAppId(env);
    if (!vkAppId && !okAppId) return Promise.resolve();
    var appKey = (env.raw && env.raw.application_key) || readQuery().get("application_key") || "";

    return bridgeSilent("ok_prep", "VKWebAppGetUserInfo", { use_local: true })
      .then(function () {
        return bridgeSilent("ok_prep", "VKWebAppGetUserInfo", {});
      })
      .then(function () {
        if (!vkAppId) return null;
        return bridgeSilent("ok_prep", "VKWebAppGetAuthToken", { app_id: Number(vkAppId), scope: "", append_local: true });
      })
      .then(function (auth) {
        var token = auth && (auth.local_access_token || auth.access_token);
        if (!token || !okAppId) return null;
        return bridgeSilent("ok_prep", "OKWebAppCallAPIMethod", {
          method: "apps.getAppAdvertisementConfig",
          params: { application_key: appKey, access_token: token, app_id: String(okAppId), format: "json" },
        });
      })
      .then(function () {
        if (!vkAppId) return null;
        return bridgeSilent("ok_prep", "VKWebAppCallAPIMethod", {
          method: "apps.getAppAdvertisementConfig",
          params: { app_id: vkAppId, v: "5.205" },
          use_local: true,
        });
      })
      .then(function () {
        return ensureFapi();
      })
      .catch(function () {});
  }

  function ensureBridgeInit() {
    if (window.__vkBridgeReady) return window.__vkBridgeReady;
    window.__vkBridgeReady = Promise.race([
      new Promise(function (resolve, reject) {
        if (typeof vkBridge === "undefined") {
          reject(new Error("no_bridge"));
          return;
        }
        window.__vkBridgeInitSent = true;
        vkBridge
          .send("VKWebAppInit")
          .then(function (d) {
            if (!d || !d.result) throw { error_data: { error_code: 12 } };
            return getClientEnv();
          })
          .then(function (env) {
            window.__vkAdEnv = env;
            return prepareOkLocal(env).then(function () {
              resolve(env);
            });
          })
          .catch(reject);
      }),
      delay(12000).then(function () {
        throw { error_data: { error_code: 12 }, message: "bridge init timeout" };
      }),
    ]);
    return window.__vkBridgeReady;
  }

  function tryStep(fn) {
    return fn().then(function (r) {
      if (r && r.result) return r;
      throw { error_data: { error_code: 20 } };
    });
  }

  function runWaterfallSteps(steps) {
    var chain = Promise.reject({ error_data: { error_code: 20 }, recoverable: true });
    steps.forEach(function (step) {
      chain = chain.catch(function (err) {
        if (!isRecoverableAdFail(err)) throw err;
        return step();
      });
    });
    return chain;
  }

  function tryBannerBestEffort() {
    return bridgeCall(
      "banner",
      "VKWebAppShowBannerAd",
      { banner_location: "bottom", layout_type: "resize", can_close: true },
      "VKWebAppShowBannerAdFailed"
    )
      .then(function (d) {
        var sp = document.getElementById("bannerSpacer");
        if (sp) sp.style.height = "52px";
        return { result: true, method: "ShowBannerAd", data: d };
      })
      .catch(function (err) {
        adLog("banner", "VKWebAppShowBannerAd", "fail", errDetail(err));
        return null;
      });
  }

  function attachBannerResult(mainRes, bannerRes) {
    if (!bannerRes || !bannerRes.result) return mainRes;
    var method = (mainRes && mainRes.method ? mainRes.method + "+" : "") + "ShowBannerAd";
    return { result: true, method: method, data: mainRes && mainRes.data, banner: bannerRes.data };
  }

  /** Вход: видео → баннер → межстраничная */
  function waterfallEntry(env) {
    var mainRes = null;

    function showVideo() {
      return tryStep(function () {
        return bridgeCall(
          "reward",
          "VKWebAppShowNativeAds",
          { ad_format: "reward", use_waterfall: true },
          "VKWebAppShowNativeAdsFailed"
        );
      }).catch(function (err) {
        if (isOkWithoutVk(env) && canUseFapi() && isRecoverableAdFail(err)) {
          return tryStep(fapiShowReward);
        }
        throw err;
      });
    }

    function showInterstitialAfter() {
      return delay(800).then(function () {
        return tryStep(function () {
          return bridgeCall(
            "interstitial",
            "VKWebAppShowNativeAds",
            { ad_format: "interstitial" },
            "VKWebAppShowNativeAdsFailed"
          );
        }).catch(function (err) {
          if (isOkWithoutVk(env) && canUseFapi() && isRecoverableAdFail(err)) {
            return tryStep(fapiShowInterstitial);
          }
          throw err;
        });
      });
    }

    return showVideo()
      .catch(function () {
        return null;
      })
      .then(function (res) {
        mainRes = res;
        return tryBannerBestEffort();
      })
      .then(function (bannerRes) {
        if (bannerRes && bannerRes.result) {
          mainRes = attachBannerResult(mainRes || { result: true, method: "" }, bannerRes);
        }
        return showInterstitialAfter().catch(function () {
          return null;
        });
      })
      .then(function (interRes) {
        if (interRes && interRes.result) {
          return {
            result: true,
            method: (mainRes && mainRes.method ? mainRes.method + "+" : "") + (interRes.method || "interstitial"),
            data: interRes.data,
            banner: mainRes && mainRes.banner,
          };
        }
        if (mainRes && mainRes.result) return mainRes;
        throw { error_data: { error_code: 20 }, recoverable: true };
      });
  }

  /** Bridge first для VK ID; FAPI только OK без VK ID и только в ok.ru iframe */
  function waterfallInterstitial(env) {
    var steps = [];

    if (!isOkWithoutVk(env)) {
      steps.push(function () {
        return tryStep(function () {
          return bridgeCall("interstitial", "VKWebAppShowNativeAds", { ad_format: "interstitial" }, "VKWebAppShowNativeAdsFailed");
        });
      });
      steps.push(function () {
        return delay(1500).then(function () {
          return tryStep(function () {
            return bridgeCall("interstitial", "VKWebAppShowNativeAds", { ad_format: "interstitial" }, "VKWebAppShowNativeAdsFailed");
          });
        });
      });
      steps.push(function () {
        return tryStep(function () {
          return bridgeCall("reward", "VKWebAppShowNativeAds", { ad_format: "reward", use_waterfall: true }, "VKWebAppShowNativeAdsFailed");
        });
      });
    } else {
      steps.push(function () {
        return tryStep(function () {
          return bridgeCall("interstitial", "VKWebAppShowNativeAds", { ad_format: "interstitial" }, "VKWebAppShowNativeAdsFailed");
        });
      });
      steps.push(function () {
        return delay(1500).then(function () {
          return tryStep(function () {
            return bridgeCall("interstitial", "VKWebAppShowNativeAds", { ad_format: "interstitial" }, "VKWebAppShowNativeAdsFailed");
          });
        });
      });
      if (canUseFapi()) {
        steps.push(function () {
          return tryStep(fapiShowInterstitial);
        });
        steps.push(function () {
          return tryStep(fapiShowReward);
        });
      }
      steps.push(function () {
        return tryStep(function () {
          return bridgeCall("reward", "VKWebAppShowNativeAds", { ad_format: "reward", use_waterfall: true }, "VKWebAppShowNativeAdsFailed");
        });
      });
    }

    return runWaterfallSteps(steps).then(function (r) {
      return r;
    });
  }

  function waterfallReward(env) {
    var steps = [];

    steps.push(function () {
      return tryStep(function () {
        return bridgeCall("reward", "VKWebAppShowNativeAds", { ad_format: "reward", use_waterfall: true }, "VKWebAppShowNativeAdsFailed");
      });
    });
    steps.push(function () {
      return tryStep(function () {
        return bridgeCall("interstitial", "VKWebAppShowNativeAds", { ad_format: "interstitial" }, "VKWebAppShowNativeAdsFailed");
      });
    });
    if (isOkWithoutVk(env) && canUseFapi()) {
      steps.push(function () {
        return tryStep(fapiShowReward);
      });
      steps.push(function () {
        return tryStep(fapiShowInterstitial);
      });
    }

    return runWaterfallSteps(steps).then(function (r) {
      return r;
    });
  }

  function waterfallBanner(env) {
    return bridgeCall(
      "banner",
      "VKWebAppShowBannerAd",
      { banner_location: "bottom", layout_type: "resize", can_close: true },
      "VKWebAppShowBannerAdFailed"
    )
      .then(function (d) {
        var sp = document.getElementById("bannerSpacer");
        if (sp) sp.style.height = "52px";
        return { result: true, method: "ShowBannerAd", data: d };
      })
      .catch(function (err) {
        if (isOkWithoutVk(env) && canUseFapi() && isRecoverableAdFail(err)) {
          return fapiShowInterstitial();
        }
        throw err;
      });
  }

  var api = {
    showInterstitial: function () {
      return ensureBridgeInit().then(function (env) {
        return prepareOkLocal(env).then(function () {
          return waterfallInterstitial(env);
        });
      });
    },
    showReward: function () {
      return ensureBridgeInit().then(function (env) {
        return prepareOkLocal(env).then(function () {
          return waterfallReward(env);
        });
      });
    },
    showBanner: function () {
      return ensureBridgeInit().then(function (env) {
        return prepareOkLocal(env).then(function () {
          return waterfallBanner(env);
        });
      });
    },
  };

  function runEntryChain(env) {
    adLog("entry", "Init", "ok", envLabel(env));
    return bridgeSilent("entry", "VKWebAppCheckNativeAds", { ad_format: "reward", use_waterfall: true })
      .then(function () {
        return bridgeSilent("entry", "VKWebAppCheckNativeAds", { ad_format: "interstitial" });
      })
      .then(function () {
        setAdStatus(envLabel(env) + " · видео → баннер → межстраничная…", "wait");
        return waterfallEntry(env);
      });
  }

  function finish(payload) {
    if (window.__vkAdsDone) return;
    window.__vkEntryAd = payload;
    window.__vkAdsDone = true;
    document.body.classList.remove("vk-ads-pending");
    var label = envLabel(payload.env || window.__vkAdEnv);
    if (payload.status === "done") {
      setAdStatus(label + " · " + (payload.method || "OK"), "ok");
    } else if (payload.status === "skip") {
      setAdStatus(label + " · " + payload.reasonText, "cooldown");
    } else {
      setAdStatus(label + " · " + errDetail(payload.error || payload.parsed), "fail");
    }
    window.dispatchEvent(new Event("vk-ads-done"));
  }

  function runEntryAd() {
    window.__vkAdsDone = false;
    renderLog();
    if (typeof vkBridge === "undefined") {
      finish({ status: "skip", reasonText: "нет bridge", env: { app: detectHostApp() } });
      return;
    }
    ensureBridgeInit()
      .then(function () {
        adLog("entry", "UpdateConfig", "start", "");
        return waitUpdateConfig(3000).then(function () {
          adLog("entry", "UpdateConfig", "ok", "");
        });
      })
      .then(getClientEnv)
      .then(function (env) {
        window.__vkAdEnv = env;
        return Promise.race([
          runEntryChain(env),
          delay(25000).then(function () {
            throw { message: "entry ads timeout", recoverable: true };
          }),
        ]);
      })
      .then(function (res) {
        finish({ status: "done", result: true, env: window.__vkAdEnv, method: res.method });
      })
      .catch(function (err) {
        finish({ status: "error", error: err, parsed: parseVkError(err), env: window.__vkAdEnv });
      });
  }

  window.__vkAds = api;
  window.__vkRunEntryAd = runEntryAd;
  runEntryAd();
})();
