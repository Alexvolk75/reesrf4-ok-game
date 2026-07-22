/* global FAPI */
(function () {
  var FAPI_URL = "https://api.ok.ru/js/fapi5.js";
  var MAX_LOG = 80;
  var AD_POLICY = {
    entryInterstitialCount: 3,
    interstitialGapMs: 900,
    gameplayInterstitialGapMs: 1200,
    allowVideo: false,
    bannerPosition: "bottom",
  };

  var logEntries = [];
  var initPromise = null;
  var inited = false;
  var bannerRequested = false;
  var bannerLoaded = false;

  function escHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function fmtTime(ts) {
    var d = new Date(ts);
    return [d.getHours(), d.getMinutes(), d.getSeconds()]
      .map(function (n) {
        return String(n).padStart(2, "0");
      })
      .join(":");
  }

  function delay(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function adLog(method, status, detail) {
    var entry = { ts: Date.now(), method: method, status: status, detail: detail || "" };
    logEntries.unshift(entry);
    if (logEntries.length > MAX_LOG) logEntries.length = MAX_LOG;
    window.__okAdLog = logEntries;
    window.dispatchEvent(new CustomEvent("ok-ads-log", { detail: entry }));
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
        var cls =
          e.status === "ok" ? "adLog__line--ok" : e.status === "start" ? "adLog__line--start" : "adLog__line--fail";
        var line = fmtTime(e.ts) + " · FAPI." + e.method + " · " + e.status.toUpperCase();
        if (e.detail) line += " · " + e.detail;
        return '<div class="adLog__line ' + cls + '">' + escHtml(line) + "</div>";
      })
      .join("");
  }

  function setAdStatus(text, kind) {
    var el = document.getElementById("adStatus");
    if (!el) return;
    el.textContent = text;
    el.className = "adStatus adStatus--" + (kind || "wait");
  }

  function setBannerSpacer(heightPx) {
    var sp = document.getElementById("bannerSpacer");
    if (sp) sp.style.height = heightPx ? heightPx + "px" : "0px";
  }

  function readQuery() {
    try {
      return new URLSearchParams(location.search || "");
    } catch (e) {
      return new URLSearchParams();
    }
  }

  function getParams() {
    if (typeof FAPI !== "undefined" && FAPI.Util && FAPI.Util.getRequestParameters) {
      try {
        return FAPI.Util.getRequestParameters() || {};
      } catch (e) {}
    }
    var q = readQuery();
    var keys = ["api_server", "apiconnection", "application_key", "session_key", "logged_user_id", "application_id"];
    var o = {};
    keys.forEach(function (k) {
      var v = q.get(k);
      if (v) o[k] = v;
    });
    return o;
  }

  function isOkFrame() {
    var host = (location.hostname || "").toLowerCase();
    if (host.indexOf("ok.ru") !== -1) return true;
    var p = getParams();
    return !!(p.api_server && p.apiconnection);
  }

  function loadScript() {
    if (typeof FAPI !== "undefined") return Promise.resolve();
    if (document.querySelector('script[src*="fapi5.js"]')) {
      return new Promise(function (resolve) {
        (function wait() {
          if (typeof FAPI !== "undefined") return resolve();
          setTimeout(wait, 50);
        })();
      });
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

  function waitUi(method, timeoutMs, okDataList) {
    var okSet = {};
    (okDataList || ["ad_shown"]).forEach(function (d) {
      okSet[d] = true;
    });

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
        reject(new Error("fapi_timeout"));
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
        if (result === "ok" && okSet[data]) {
          shown++;
          if (shown >= queueSize) {
            clearTimeout(timer);
            window.API_callback = prev;
            resolve({ ok: true, data: data });
          }
          return;
        }
        if (result === "error") {
          clearTimeout(timer);
          window.API_callback = prev;
          reject(new Error(data || "no_ads"));
        }
      };
    });
  }

  function invokeUi(method, args, waitMethod, okDataList, timeoutMs) {
    if (typeof FAPI === "undefined" || !FAPI.invokeUIMethod) {
      return Promise.reject(new Error("no_invoke_ui"));
    }
    adLog(method, "start", args ? args.join(",") : "");
    var wait = waitUi(waitMethod || method, timeoutMs, okDataList);
    try {
      if (args && args.length) FAPI.invokeUIMethod.apply(FAPI, [method].concat(args));
      else FAPI.invokeUIMethod(method);
    } catch (e) {
      return Promise.reject(e);
    }
    return wait
      .then(function (d) {
        adLog(method, "ok", d.data || "ok");
        return d;
      })
      .catch(function (e) {
        adLog(method, "fail", e.message || String(e));
        throw e;
      });
  }

  function ensureFapi() {
    if (initPromise) return initPromise;
    initPromise = loadScript()
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
        if (inited || typeof FAPI === "undefined") return;
        var p = getParams();
        if (!p.api_server || !p.apiconnection) {
          adLog("init", "fail", "нет api_server/apiconnection — откройте из ok.ru/game/...");
          return;
        }
        return new Promise(function (resolve) {
          try {
            FAPI.init(
              p.api_server,
              p.apiconnection,
              function () {
                inited = true;
                adLog("init", "ok", "OK FAPI");
                resolve();
              },
              function () {
                adLog("init", "fail", "FAPI.init error");
                resolve();
              }
            );
          } catch (e) {
            adLog("init", "fail", String(e.message || e));
            resolve();
          }
        });
      });
    return initPromise;
  }

  function showInterstitialOnce() {
    if (!isOkFrame()) {
      adLog("showAd", "fail", "не iframe ОК");
      return Promise.reject(new Error("not_ok_frame"));
    }
    return ensureFapi().then(function () {
      if (!inited || !FAPI.UI.showAd) throw new Error("fapi_not_ready");
      var wait = waitUi("showAd");
      FAPI.UI.showAd();
      return wait;
    }).then(function (d) {
      adLog("showAd", "ok", "ad_shown");
      return { ok: true, method: "showAd", data: d };
    }).catch(function (e) {
      adLog("showAd", "fail", e.message || String(e));
      throw e;
    });
  }

  function showInterstitialBurst(count, gapMs) {
    var chain = Promise.resolve(null);
    for (var i = 0; i < count; i++) {
      (function (idx) {
        chain = chain
          .then(function () {
            return showInterstitialOnce().catch(function () {
              return null;
            });
          })
          .then(function (res) {
            if (idx < count - 1) {
              return delay(gapMs).then(function () {
                return res;
              });
            }
            return res;
          });
      })(i);
    }
    return chain;
  }

  function showInterstitial() {
    return showInterstitialBurst(3, AD_POLICY.gameplayInterstitialGapMs);
  }

  function requestBanner() {
    if (!isOkFrame()) {
      return Promise.reject(new Error("not_ok_frame"));
    }
    if (bannerRequested && bannerLoaded) return Promise.resolve({ ok: true, cached: true });
    return ensureFapi().then(function () {
      if (!inited) throw new Error("fapi_not_ready");
      bannerRequested = true;
      return invokeUi("requestBannerAds", [], "requestBannerAds", ["ad_loaded", "ad_shown", "banner_shown"], 60000)
        .then(function () {
          bannerLoaded = true;
          return { ok: true };
        })
        .catch(function (e) {
          bannerRequested = false;
          throw e;
        });
    });
  }

  function showBanner() {
    if (!isOkFrame()) {
      adLog("showBannerAds", "fail", "не iframe ОК");
      return Promise.reject(new Error("not_ok_frame"));
    }
    return ensureFapi()
      .then(function () {
        if (!bannerLoaded) return requestBanner();
      })
      .then(function () {
        return invokeUi(
          "showBannerAds",
          [AD_POLICY.bannerPosition],
          "showBannerAds",
          ["true"],
          30000
        );
      })
      .then(function (d) {
        setBannerSpacer(96);
        return { ok: true, method: "showBannerAds", data: d };
      })
      .catch(function (e) {
        adLog("showBannerAds", "fail", e.message || String(e));
        throw e;
      });
  }

  function runEntryAds() {
    setAdStatus("ОК · межстраничная ×" + AD_POLICY.entryInterstitialCount + " + баннер…", "wait");
    return showInterstitialBurst(AD_POLICY.entryInterstitialCount, AD_POLICY.interstitialGapMs)
      .then(function () {
        return showBanner().catch(function () {
          return null;
        });
      })
      .then(function () {
        setAdStatus("ОК · реклама загружена (FAPI)", "ok");
      })
      .catch(function (e) {
        setAdStatus("ОК · реклама недоступна: " + (e.message || e), "fail");
        return null;
      });
  }

  window.OKAds = {
    ensureFapi: ensureFapi,
    isReady: function () {
      return inited;
    },
    isOkFrame: isOkFrame,
    showInterstitial: showInterstitial,
    showBanner: showBanner,
    requestBanner: requestBanner,
  };

  renderLog();
  ensureFapi()
    .then(runEntryAds)
    .finally(function () {
      document.body.classList.remove("ok-ads-pending");
      window.dispatchEvent(new Event("ok-ads-ready"));
    });
})();
