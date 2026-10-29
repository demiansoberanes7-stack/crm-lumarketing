/**
 * Lanzador del chat del sitio (Lumarketing CRM).
 *
 * Uso en la web del negocio:
 *   <script src="https://crm.lumarketing.digital/widget/webchat.js"
 *           data-key="wc_..." async></script>
 *
 * El script se pinta como una burbuja flotante. Al pulsarla carga
 * /embed/webchat dentro de un iframe: el panel y su API viven en el mismo
 * origen (el CRM), así que no hay que resolver CORS ni cookies de terceros, y
 * el snippet no crece con la lógica del chat.
 *
 * Si la llave está apagada o no existe, el script se retira solo: la web del
 * negocio no debe quedarse con una burbuja que no lleva a ninguna parte.
 */
(function () {
  "use strict";

  if (window.__lumarkWebchatLoaded) return;
  window.__lumarkWebchatLoaded = true;

  var script =
    document.currentScript ||
    document.querySelector("script[data-key][src*='webchat.js']");
  if (!script) return;

  var key = script.getAttribute("data-key") || "";
  if (!/^wc_[a-f0-9]{24}$/.test(key)) return;

  var origin;
  try {
    origin = new URL(script.src, window.location.href).origin;
  } catch {
    return;
  }

  var STYLE_ID = "lumark-webchat-style";
  var CSS =
    ".lumark-wc-btn{position:fixed;right:20px;bottom:20px;z-index:2147483000;display:flex;align-items:center;justify-content:center;width:56px;height:56px;border:0;border-radius:50%;background:#0d5bff;color:#fff;box-shadow:0 10px 25px rgba(13,91,255,.35);cursor:pointer;transition:transform .15s ease,box-shadow .15s ease}" +
    ".lumark-wc-btn:hover{transform:translateY(-2px);box-shadow:0 14px 30px rgba(13,91,255,.42)}" +
    ".lumark-wc-btn svg{width:26px;height:26px;display:block}" +
    // `display:flex` de la clase gana al `[hidden]{display:none}` del navegador:
    // sin esta regla la burbuja se quedaba encima del panel abierto y, en móvil
    // (panel a pantalla completa), tapaba el botón de enviar.
    ".lumark-wc-btn[hidden]{display:none}" +
    ".lumark-wc-frame{position:fixed;right:20px;bottom:88px;z-index:2147483000;width:360px;height:560px;max-height:calc(100vh - 120px);border:0;border-radius:16px;background:#fff;box-shadow:0 24px 60px rgba(15,23,42,.28)}" +
    "@media (max-width:520px){.lumark-wc-frame{right:0;bottom:0;width:100%;height:100%;max-height:100%;border-radius:0}.lumark-wc-btn{right:16px;bottom:16px}}";

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.appendChild(document.createTextNode(CSS));
    document.head.appendChild(style);
  }

  function mount() {
    ensureStyle();

    var frame = document.createElement("iframe");
    frame.className = "lumark-wc-frame";
    frame.title = "Chat";
    frame.hidden = true;
    frame.setAttribute("loading", "lazy");
    frame.src = origin + "/embed/webchat?key=" + encodeURIComponent(key);

    var button = document.createElement("button");
    button.className = "lumark-wc-btn";
    button.type = "button";
    button.setAttribute("aria-label", "Abrir chat");
    button.setAttribute("aria-expanded", "false");
    button.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>';

    function open() {
      frame.hidden = false;
      button.hidden = true;
      button.setAttribute("aria-expanded", "true");
      try {
        frame.contentWindow.focus();
      } catch {
        frame.focus();
      }
    }

    function close() {
      frame.hidden = true;
      button.hidden = false;
      button.setAttribute("aria-expanded", "false");
      button.focus();
    }

    button.addEventListener("click", open);

    window.addEventListener("message", function (event) {
      if (event.origin !== origin) return;
      if (event.data && event.data.type === "lumark-webchat-close") close();
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && !frame.hidden) close();
    });

    document.body.appendChild(frame);
    document.body.appendChild(button);
  }

  // Comprobación de disponibilidad: una llave apagada no deja rastro en la web
  // del negocio. Si la red falla se monta igual — es preferible un chat que
  // quizá responda «no disponible» a una web sin chat por un corte puntual.
  fetch(origin + "/api/webchat/" + encodeURIComponent(key), { cache: "no-store" })
    .then(function (res) {
      if (res.ok) {
        mount();
      } else {
        window.__lumarkWebchatLoaded = false;
      }
    })
    .catch(function () {
      mount();
    });
})();
