// Classic (non-module) script: runs even where ES modules cannot load, e.g. when
// index.html is opened straight from disk. Shows how to start the program.
(function () {
  function show() {
    var el = document.getElementById("boot-fallback");
    if (el && !window.__ipadFinderStarted) el.hidden = false;
  }
  if (location.protocol === "file:") show();
  else setTimeout(show, 15000);
})();
