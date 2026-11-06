/*
 * Planet Zoo 2 Tools - data loader
 *
 * Reads a spreadsheet that has been published to the web as an Excel file and
 * turns the tabs the tool needs into the same format the Apps Script version
 * uses. If that doesn't work, it asks the Apps Script web app instead.
 *
 * You normally never need to edit this file.
 */
window.PZ_LOAD = function (which, tabNames) {
  var cfg = (window.PZ_CONFIG || {})[which] || {};

  function norm(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase(); }

  // Same clean-up as Code.gs: keep columns with a heading, drop empty rows.
  function fromWorkbook(wb) {
    var byName = {};
    wb.SheetNames.forEach(function (n) { byName[norm(n)] = n; });
    var out = { tabs: {}, missingTabs: [], source: 'published' };
    tabNames.forEach(function (tab) {
      var real = byName[norm(tab)];
      if (!real) { out.missingTabs.push(tab); out.tabs[tab] = { header: [], rows: [] }; return; }
      var values = XLSX.utils.sheet_to_json(wb.Sheets[real], { header: 1, raw: true, defval: '', blankrows: false });
      if (!values.length) { out.tabs[tab] = { header: [], rows: [] }; return; }
      var header = values[0].map(function (h) { return String(h).trim(); });
      var keep = [];
      header.forEach(function (h, i) { if (h !== '') keep.push(i); });
      var rows = [];
      for (var r = 1; r < values.length; r++) {
        var row = values[r];
        var hasText = keep.some(function (i) {
          var v = row[i];
          return (typeof v === 'string' && v.trim() !== '') || typeof v === 'number';
        });
        if (!hasText) continue;
        rows.push(keep.map(function (i) { return row[i] === undefined ? '' : row[i]; }));
      }
      out.tabs[tab] = { header: keep.map(function (i) { return header[i]; }), rows: rows };
    });
    return out;
  }

  function fromPublished() {
    if (!cfg.published) return Promise.reject(new Error('No published link set'));
    if (!window.XLSX) return Promise.reject(new Error('Spreadsheet reader did not load'));
    var url = cfg.published + (cfg.published.indexOf('?') >= 0 ? '&' : '?') + 't=' + Math.floor(Date.now() / 60000);
    return fetch(url, { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error('Published sheet returned ' + res.status);
      return res.arrayBuffer();
    }).then(function (buf) {
      var wb = XLSX.read(buf, { type: 'array' });
      return fromWorkbook(wb);
    });
  }

  function fromAppsScript() {
    if (!cfg.appsScript) return Promise.reject(new Error('No Apps Script link set'));
    var url = cfg.appsScript + (cfg.appsScript.indexOf('?') >= 0 ? '&' : '?') + 'format=json';
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error('Apps Script returned ' + res.status);
      return res.text();
    }).then(function (txt) {
      var data = JSON.parse(txt);
      data.source = 'appsScript';
      return data;
    });
  }

  return fromPublished().catch(function (err) {
    if (window.console) console.warn('Published sheet not available, trying Apps Script:', err && err.message);
    return fromAppsScript();
  });
};
