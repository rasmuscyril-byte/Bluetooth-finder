// Classic (non-module) script: runs even where ES modules cannot load, e.g. when
// index.html is opened straight from disk. Shows what to do instead.
(function () {
  var fromDisk = location.protocol === "file:";
  function show() {
    var el = document.getElementById("boot-fallback");
    if (!el || window.__ipadFinderStarted) return;
    var parts = el.querySelectorAll("[data-boot]");
    for (var i = 0; i < parts.length; i++) {
      parts[i].hidden = parts[i].getAttribute("data-boot") !== (fromDisk ? "file" : "web");
    }
    el.hidden = false;
  }
  if (fromDisk) show();
  else setTimeout(show, 15000);
})();
