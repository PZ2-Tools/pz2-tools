/*
 * Planet Zoo 2 Tools - habitat calculations
 *
 * Shared by the Habitat Planner and the Zoo Planner, so both always work out
 * habitat sizes the same way. You normally never need to edit this file.
 */
/* =========================================================================
   PART 1 — THE CALCULATIONS
   Everything here reads the spreadsheet data and works out the results.
   ========================================================================= */
var PZ = (function () {

  // ---------- small helpers ----------
  function norm(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase(); }
  function blank(v) { return v === null || v === undefined || (typeof v === 'string' && v.trim() === ''); }
  function num(v) {
    if (blank(v) || typeof v === 'boolean') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    var m = String(v).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : null;
  }
  function bool(v) { return v === true || ['true', 'yes', 'y', 'x', '✓'].indexOf(norm(v)) >= 0; }
  function list(v) { return blank(v) ? [] : String(v).split(',').map(function (s) { return s.trim(); }).filter(Boolean); }
  function uniq(arr) { var seen = {}, out = []; arr.forEach(function (x) { if (!seen[x]) { seen[x] = 1; out.push(x); } }); return out; }

  function table(data, name) {
    var t = (data.tabs && data.tabs[name]) || { header: [], rows: [] };
    var idx = {};
    t.header.forEach(function (h, i) { idx[norm(h)] = i; });
    return {
      name: name, header: t.header, idx: idx, rows: t.rows,
      has: function (key) { return idx[norm(key)] !== undefined; },
      get: function (row, key) { var i = idx[norm(key)]; return i === undefined ? null : row[i]; }
    };
  }

  function parseAmount(v, reqName) {
    if (blank(v)) return { kind: 'none', value: null };
    if (typeof v === 'number') {
      if (norm(reqName) === 'native plants') return { kind: 'pct', value: v <= 1 ? v * 100 : v };
      return { kind: 'count', value: v };
    }
    var s = String(v).toLowerCase();
    var n = num(s);
    if (/m2|m²|sq\.?\s*m|square/.test(s)) return { kind: 'area', value: n };
    if (/%/.test(s)) return { kind: 'pct', value: n };
    return { kind: 'count', value: n };
  }

  var SPACE_NAMES = {
    'land area': 'land', 'water area': 'water', 'deep water area': 'deep',
    'shelter area': 'shelter', 'climbing area': 'climb', 'flying area': 'fly'
  };

  // ---------- build the model from the spreadsheet ----------
  function buildModel(data) {
    var warnings = [];
    (data.missingTabs || []).forEach(function (t) { warnings.push('The "' + t + '" tab was not found.'); });

    var info = table(data, 'Info'), bn = table(data, 'Basic Needs'), bi = table(data, 'Basic Items'),
        ti = table(data, 'Thrive Items'), tr = table(data, 'Terrain'), sg = table(data, 'Social Groups'),
        tt = table(data, 'Tooltips');

    function expect(tab, keys) {
      if (!tab.header.length) return;
      keys.forEach(function (k) { if (!tab.has(k)) warnings.push('Heading "' + k + '" was not found on the ' + tab.name + ' tab.'); });
    }
    expect(info, ['Done', 'Animal', 'Enclosure Type', 'Climb Proof', 'Roof', 'Native Range', 'Biome', 'Collective Animal',
      'No Other Species in Habitat', 'Mixed Gender Habitat: Minimum', 'Mixed Gender Habitat: Maximum',
      'Mixed Gender Habitat: Maximum # Males', 'Mixed Gender Habitat: Maximum # Females',
      'Males Only Habitat: Minimum', 'Males Only Habitat: Maximum', 'Females Only Habitat: Minimum', 'Females Only Habitat: Maximum',
      'Barrier Strength', 'Barrier Height', 'Salinity', 'Temperature: Minimum (C)', 'Temperature: Maximum (C)',
      'Plants: Minimum %', 'Plants: Maximum %', 'Guests Can Enter', 'Accreditation Tier',
      'Food Grade 1: Cost Per Animal', 'Food Grade 2: Cost Per Animal']);
    var SPACE_COLS = {
      land: ['Land Space: Base Amount (m2)', 'Land Space: Additional Per Animal (m2)'],
      climb: ['Climbing Space: Base Amount (m2)', 'Climbing Space: Additional Per Animal (m2)'],
      water: ['Water Space: Base Amount (m2)', 'Water Space: Additional Per Animal (m2)'],
      deep: ['Deep Water Space: Base Amount (m2)', 'Deep Water Space: Additional Per Animal (m2)'],
      fly: ['Flying Space: Base Amount (m2)', 'Flying Space: Additional Per Animal (m2)']
    };
    var SHELTER_COL = 'Shelter Space Per Animal (m2)';
    expect(bn, ['Animal', SHELTER_COL].concat(SPACE_COLS.land, SPACE_COLS.climb, SPACE_COLS.water, SPACE_COLS.deep, SPACE_COLS.fly));
    expect(bi, ['Animal', 'Requirement', 'Quantity']);
    expect(ti, ['Animal', 'Requirement', 'Quantity', 'Individual']);
    expect(tr, ['Terrain', 'Belongs To', 'Overlay']);
    expect(sg, ['Group', 'Animal']);
    expect(tt, ['Item', 'Tooltip']);

    // Terrain
    var terrain = {}, terrainOrder = [];
    tr.rows.forEach(function (r) {
      var name = tr.get(r, 'Terrain');
      if (blank(name)) return;
      var k = norm(name);
      if (terrain[k]) return;
      terrain[k] = { key: k, name: String(name).trim(), parentName: tr.get(r, 'Belongs To'), overlay: bool(tr.get(r, 'Overlay')), children: [] };
      terrainOrder.push(k);
    });
    var terrainCols = [];
    bn.header.forEach(function (h, i) {
      var m = String(h).match(/^(.*?):\s*(minimum|maximum)\s*%\s*$/i);
      if (!m) return;
      var k = norm(m[1]);
      if (!terrain[k]) {
        terrain[k] = { key: k, name: m[1].trim(), parentName: null, overlay: false, children: [] };
        terrainOrder.push(k);
        warnings.push('"' + m[1].trim() + '" is a heading on Basic Needs but is not on the Terrain tab.');
      }
      terrainCols.push({ key: k, bound: norm(m[2]) === 'minimum' ? 'min' : 'max', index: i });
    });
    terrainOrder.forEach(function (k) {
      var t = terrain[k];
      t.parent = blank(t.parentName) ? null : norm(t.parentName);
      if (t.parent === k) t.parent = null;
      if (t.parent && !terrain[t.parent]) {
        warnings.push('Terrain "' + t.name + '" belongs to "' + t.parentName + '", which is not on the Terrain tab.');
        t.parent = null;
      }
    });
    // guard against loops (A belongs to B belongs to A)
    terrainOrder.forEach(function (k) {
      var seen = {}, p = terrain[k].parent;
      while (p) {
        if (seen[p] || p === k) { warnings.push('Terrain "' + terrain[k].name + '" has a loop in "Belongs To".'); terrain[k].parent = null; break; }
        seen[p] = 1; p = terrain[p].parent;
      }
    });
    terrainOrder.forEach(function (k) { var t = terrain[k]; if (t.parent) terrain[t.parent].children.push(k); });

    // Social groups
    var groups = {};
    sg.rows.forEach(function (r) {
      var g = sg.get(r, 'Group'), a = sg.get(r, 'Animal');
      if (blank(g)) return;
      var gk = norm(g);
      if (!groups[gk]) groups[gk] = { key: gk, name: String(g).trim(), members: {} };
      if (!blank(a)) groups[gk].members[norm(a)] = true;
    });

    // Tooltips
    var tooltips = {};
    tt.rows.forEach(function (r) {
      var item = tt.get(r, 'Item'), text = tt.get(r, 'Tooltip');
      if (!blank(item) && !blank(text)) tooltips[norm(item)] = String(text).trim();
    });

    // Animals
    var animals = {};
    info.rows.forEach(function (r) {
      var name = info.get(r, 'Animal');
      if (blank(name)) return;
      var k = norm(name);
      var types = list(info.get(r, 'Enclosure Type'));
      var usable = [];
      types.forEach(function (t) {
        if (norm(t) === 'habitat') usable.push('Habitat');
        if (norm(t) === 'aquarium') usable.push('Aquarium');
      });
      var gradeRaw = info.get(r, 'Barrier Strength'), heightRaw = info.get(r, 'Barrier Height');
      animals[k] = {
        key: k, name: String(name).trim(), done: bool(info.get(r, 'Done')), types: types, usable: uniq(usable),
        climbProof: bool(info.get(r, 'Climb Proof')), roof: bool(info.get(r, 'Roof')),
        ranges: list(info.get(r, 'Native Range')), biomes: list(info.get(r, 'Biome')),
        collective: bool(info.get(r, 'Collective Animal')),
        alone: bool(info.get(r, 'No Other Species in Habitat')),
        cannot: list(info.get(r, 'Cannot Live With')).map(norm),
        grp: {
          mixMin: num(info.get(r, 'Mixed Gender Habitat: Minimum')), mixMax: num(info.get(r, 'Mixed Gender Habitat: Maximum')),
          maxM: num(info.get(r, 'Mixed Gender Habitat: Maximum # Males')), maxF: num(info.get(r, 'Mixed Gender Habitat: Maximum # Females')),
          mMin: num(info.get(r, 'Males Only Habitat: Minimum')), mMax: num(info.get(r, 'Males Only Habitat: Maximum')),
          fMin: num(info.get(r, 'Females Only Habitat: Minimum')), fMax: num(info.get(r, 'Females Only Habitat: Maximum'))
        },
        barrierGrade: num(gradeRaw), barrierGradeText: blank(gradeRaw) ? null : String(gradeRaw).trim(),
        barrierHeight: num(heightRaw),
        salinity: list(info.get(r, 'Salinity')),
        tMin: num(info.get(r, 'Temperature: Minimum (C)')), tMax: num(info.get(r, 'Temperature: Maximum (C)')),
        pMin: num(info.get(r, 'Plants: Minimum %')), pMax: num(info.get(r, 'Plants: Maximum %')),
        guests: bool(info.get(r, 'Guests Can Enter')),
        tier: num(info.get(r, 'Accreditation Tier')),
        food: { 1: num(info.get(r, 'Food Grade 1: Cost Per Animal')), 2: num(info.get(r, 'Food Grade 2: Cost Per Animal')) },
        basic: null, basicItems: [], thriveReqs: []
      };
    });

    bn.rows.forEach(function (r) {
      var a = animals[norm(bn.get(r, 'Animal'))];
      if (!a) {
        if (!blank(bn.get(r, 'Animal'))) warnings.push('"' + bn.get(r, 'Animal') + '" is on Basic Needs but not on the Info tab.');
        return;
      }
      var b = { shelter: num(bn.get(r, SHELTER_COL)), terrain: {} };
      Object.keys(SPACE_COLS).forEach(function (s) { b[s] = [num(bn.get(r, SPACE_COLS[s][0])), num(bn.get(r, SPACE_COLS[s][1]))]; });
      terrainCols.forEach(function (c) {
        var v = num(r[c.index]);
        if (v === null) return;
        if (!b.terrain[c.key]) b.terrain[c.key] = { min: null, max: null };
        b.terrain[c.key][c.bound] = v;
      });
      a.basic = b;
    });

    // Requirements (Basic Items and Thrive Items)
    function classify(reqName, amount) {
      var n = norm(reqName);
      if (n === 'food grade 2' || n === 'food grade 1') return { type: 'food', grade: n === 'food grade 2' ? 2 : 1 };
      if (n === 'native plants') return { type: 'native' };
      if (groups[n]) return { type: 'group', group: n };
      if (animals[n]) return { type: 'species', species: n };
      if (amount.kind === 'area') {
        if (SPACE_NAMES[n]) return { type: 'space', space: SPACE_NAMES[n] };
        var base = n.replace(/ area$/, '');
        if (terrain[base]) return { type: 'terrainFlat', terrain: base };
        if (terrain[n]) return { type: 'terrainFlat', terrain: n };
      }
      return { type: 'item' };
    }
    function displayName(req, cls) {
      var s = String(req).replace(/\s+/g, ' ').trim();
      if (cls.type === 'terrainFlat' && !/ area$/i.test(s)) s += ' Area';
      return s;
    }

    bi.rows.forEach(function (r) {
      var an = bi.get(r, 'Animal'), req = bi.get(r, 'Requirement');
      if (blank(an) || blank(req)) return;
      var a = animals[norm(an)];
      if (!a) { warnings.push('"' + an + '" is on Basic Items but not on the Info tab.'); return; }
      var amt = parseAmount(bi.get(r, 'Quantity'), req);
      var cls = classify(req, amt);
      a.basicItems.push({ name: displayName(req, cls), key: norm(displayName(req, cls)), amount: amt, cls: cls, individual: false });
    });

    var allThrive = [];
    ti.rows.forEach(function (r) {
      var an = ti.get(r, 'Animal'), req = ti.get(r, 'Requirement');
      if (blank(an) || blank(req)) return;
      var amt = parseAmount(ti.get(r, 'Quantity'), req);
      var cls = classify(req, amt);
      var entry = { name: displayName(req, cls), key: norm(displayName(req, cls)), amount: amt, cls: cls, individual: bool(ti.get(r, 'Individual')) };
      if (norm(an) === 'all') { allThrive.push(entry); return; }
      var a = animals[norm(an)];
      if (!a) { warnings.push('"' + an + '" is on Thrive Items but not on the Info tab.'); return; }
      a.thriveReqs.push(entry);
    });

    Object.keys(groups).forEach(function (gk) {
      Object.keys(groups[gk].members).forEach(function (m) {
        if (!animals[m]) warnings.push('"' + m + '" is in ' + groups[gk].name + ' but not on the Info tab.');
      });
    });

    var pickable = Object.keys(animals).map(function (k) { return animals[k]; })
      .filter(function (a) { return a.done && a.usable.length; })
      .sort(function (x, y) { return x.name.localeCompare(y.name); });

    return { animals: animals, pickable: pickable, terrain: terrain, terrainOrder: terrainOrder, groups: groups,
             tooltips: tooltips, allThrive: allThrive, warnings: uniq(warnings) };
  }

  // ---------- calculation ----------
  function thriveReqsFor(model, a) { return a.thriveReqs.concat(model.allThrive); }

  function gradeLocked(model, a) {
    return thriveReqsFor(model, a).some(function (r) { return r.cls.type === 'food' && r.cls.grade === 2; });
  }

  function countOf(a, s) {
    if (a.collective) return Math.max(0, Math.floor(s.count || 0));
    return Math.max(0, Math.floor(s.males || 0)) + Math.max(0, Math.floor(s.females || 0));
  }

  function areaFor(pair, n) {
    if (!pair || n <= 0) return 0;
    var b = pair[0], add = pair[1];
    if (b === null && add === null) return 0;
    return (b || 0) + (n - 1) * (add || 0);
  }

  function rangeOf(entries) {
    var r = { any: false, lo: null, hi: null, loBy: [], hiBy: [], noMatch: false };
    entries.forEach(function (e) {
      if (e.lo !== null && e.lo !== undefined) {
        r.any = true;
        if (r.lo === null || e.lo > r.lo) { r.lo = e.lo; r.loBy = [e.who]; } else if (e.lo === r.lo) r.loBy.push(e.who);
      }
      if (e.hi !== null && e.hi !== undefined) {
        r.any = true;
        if (r.hi === null || e.hi < r.hi) { r.hi = e.hi; r.hiBy = [e.who]; } else if (e.hi === r.hi) r.hiBy.push(e.who);
      }
    });
    r.noMatch = r.lo !== null && r.hi !== null && r.lo > r.hi;
    return r;
  }

  function combineAmounts(entries) {
    // entries: [{value, individual, who}]
    var anyIndividual = entries.some(function (e) { return e.individual; });
    var total = 0;
    entries.forEach(function (e) {
      var v = e.value || 0;
      total = anyIndividual ? total + v : Math.max(total, v);
    });
    return { amount: total, individual: anyIndividual, who: uniq(entries.map(function (e) { return e.who; })) };
  }

  function combinations(arr, k, cb) {
    var res = [];
    (function rec(start, combo) {
      if (res.stop) return;
      if (combo.length === k) { if (cb(combo.slice()) === false) res.stop = true; return; }
      for (var i = start; i < arr.length; i++) { combo.push(arr[i]); rec(i + 1, combo); combo.pop(); if (res.stop) return; }
    })(0, []);
  }

  function fmtN(n) { return (Math.round(n * 10) / 10).toLocaleString('en-US'); }

  function calculate(model, selections, sizes) {
    var T = model.terrain;
    var sel = selections.map(function (s) {
      var a = model.animals[s.key];
      if (!a) return null;
      var n = countOf(a, s);
      var locked = s.thrive && gradeLocked(model, a);
      return { s: s, a: a, n: n, thrive: !!s.thrive, grade: locked ? 2 : (Number(s.grade) === 2 ? 2 : 1), gradeLocked: locked };
    }).filter(Boolean);

    var res = { count: sel.length, alerts: [], sel: sel };
    if (!sel.length) return res;

    var names = function (list) { return list.map(function (x) { return x.a ? x.a.name : x; }); };
    var speciesKeys = sel.map(function (x) { return x.a.key; });

    // --- Living together ---
    sel.forEach(function (x) {
      if (sel.length > 1 && x.a.alone) {
        res.alerts.push({ level: 'bad', who: x.a.name, text: 'This animal cannot live with any other animals.' });
      } else {
        var clash = sel.filter(function (o) { return o !== x && x.a.cannot.indexOf(o.a.key) >= 0; });
        if (clash.length) res.alerts.push({ level: 'bad', who: x.a.name,
          text: 'This animal cannot live with one or more of the other animals in the habitat (' + names(clash).join(', ') + ').' });
      }
    });

    // --- Group size ---
    sel.forEach(function (x) {
      var a = x.a, g = a.grp, n = x.n, msgs = [];
      function chk(v, min, max, label) {
        if (min !== null && v < min) msgs.push(label + ' needs at least ' + min + ' (you have ' + v + ').');
        if (max !== null && v > max) msgs.push(label + ' can have at most ' + max + ' (you have ' + v + ').');
      }
      if (n <= 0) {
        msgs.push(a.collective ? 'Enter how many collectives you are adding.' : 'Enter how many males and females you are adding.');
      } else if (a.collective) {
        chk(n, g.mixMin, g.mixMax, 'A group');
      } else {
        var m = Math.floor(x.s.males || 0), f = Math.floor(x.s.females || 0);
        if (m > 0 && f > 0) {
          chk(n, g.mixMin, g.mixMax, 'A mixed group');
          if (g.maxM !== null && m > g.maxM) msgs.push('A mixed group can have at most ' + g.maxM + ' male' + (g.maxM === 1 ? '' : 's') + ' (you have ' + m + ').');
          if (g.maxF !== null && f > g.maxF) msgs.push('A mixed group can have at most ' + g.maxF + ' female' + (g.maxF === 1 ? '' : 's') + ' (you have ' + f + ').');
        } else if (m > 0) {
          chk(m, g.mMin, g.mMax, 'A males-only group');
        } else {
          chk(f, g.fMin, g.fMax, 'A females-only group');
        }
      }
      msgs.forEach(function (t) { res.alerts.push({ level: 'warn', who: a.name, text: t }); });
    });

    // --- Habitat type ---
    var types = ['Habitat', 'Aquarium'];
    sel.forEach(function (x) { types = types.filter(function (t) { return x.a.usable.indexOf(t) >= 0; }); });
    res.types = { list: types, noMatch: !types.length,
      each: sel.map(function (x) { return { who: x.a.name, types: x.a.usable }; }) };
    var aquariumOnly = types.length === 1 && types[0] === 'Aquarium';
    res.aquariumOnly = aquariumOnly;

    // --- Ranges ---
    res.temp = rangeOf(sel.map(function (x) { return { who: x.a.name, lo: x.a.tMin, hi: x.a.tMax }; }));
    res.plants = rangeOf(sel.map(function (x) { return { who: x.a.name, lo: x.a.pMin, hi: x.a.pMax }; }));

    var withSal = sel.filter(function (x) { return x.a.salinity.length; });
    if (withSal.length) {
      var sal = withSal[0].a.salinity.map(norm);
      withSal.forEach(function (x) { var mine = x.a.salinity.map(norm); sal = sal.filter(function (v) { return mine.indexOf(v) >= 0; }); });
      var pretty = {};
      withSal.forEach(function (x) { x.a.salinity.forEach(function (v) { pretty[norm(v)] = v; }); });
      res.salinity = { any: true, list: sal.map(function (v) { return pretty[v]; }), noMatch: !sal.length,
        each: withSal.map(function (x) { return { who: x.a.name, list: x.a.salinity }; }) };
    } else res.salinity = { any: false };

    function shared(field) {
      var out = null, pretty = {};
      sel.forEach(function (x) {
        var mine = x.a[field].map(norm);
        x.a[field].forEach(function (v) { pretty[norm(v)] = v; });
        out = out === null ? mine : out.filter(function (v) { return mine.indexOf(v) >= 0; });
      });
      return (out || []).map(function (v) { return pretty[v]; });
    }
    res.nativeRange = shared('ranges');
    res.nativeBiome = shared('biomes');

    // --- Barrier & setup ---
    var gradeBest = null, heightBest = null, tierBest = null;
    sel.forEach(function (x) {
      var a = x.a;
      if (a.barrierGrade !== null && (!gradeBest || a.barrierGrade > gradeBest.v)) gradeBest = { v: a.barrierGrade, text: a.barrierGradeText, who: [a.name] };
      else if (gradeBest && a.barrierGrade === gradeBest.v) gradeBest.who.push(a.name);
      if (a.barrierHeight !== null && (!heightBest || a.barrierHeight > heightBest.v)) heightBest = { v: a.barrierHeight, who: [a.name] };
      else if (heightBest && a.barrierHeight === heightBest.v) heightBest.who.push(a.name);
      if (a.tier !== null && (!tierBest || a.tier > tierBest.v)) tierBest = { v: a.tier, who: [a.name] };
      else if (tierBest && a.tier === tierBest.v) tierBest.who.push(a.name);
    });
    res.setup = {
      grade: gradeBest, height: heightBest, tier: tierBest,
      climb: names(sel.filter(function (x) { return x.a.climbProof; })),
      roof: names(sel.filter(function (x) { return x.a.roof; })),
      noGuests: names(sel.filter(function (x) { return !x.a.guests; }))
    };

    // --- Thrive flat needs (space + terrain) from thriving animals ---
    var thriving = sel.filter(function (x) { return x.thrive; });
    var spaceThrive = {}, terrainFlat = {};
    thriving.forEach(function (x) {
      thriveReqsFor(model, x.a).forEach(function (r) {
        if (r.cls.type === 'space') {
          (spaceThrive[r.cls.space] = spaceThrive[r.cls.space] || []).push({ value: r.amount.value, individual: r.individual, who: x.a.name, name: r.name });
        } else if (r.cls.type === 'terrainFlat') {
          (terrainFlat[r.cls.terrain] = terrainFlat[r.cls.terrain] || []).push({ value: r.amount.value, individual: r.individual, who: x.a.name, name: r.name });
        }
      });
    });
    var sT = {};
    Object.keys(spaceThrive).forEach(function (k) { sT[k] = combineAmounts(spaceThrive[k]); });
    var tF = {};
    Object.keys(terrainFlat).forEach(function (k) {
      tF[k] = combineAmounts(terrainFlat[k]);
      tF[k].name = terrainFlat[k][0].name;
    });

    // --- Space ---
    var sp = { land: 0, shelter: 0, climb: 0, fly: 0, regular: 0, anyDepth: 0, deep: 0,
               parts: { land: [], shelter: [], climb: [], fly: [], water: [] }, regularWho: [], deepWho: [] };
    sel.forEach(function (x) {
      var b = x.a.basic, n = x.n;
      if (!b) return;
      var land = areaFor(b.land, n), climb = areaFor(b.climb, n), fly = areaFor(b.fly, n);
      var shelter = n > 0 && b.shelter !== null ? b.shelter * n : 0;
      var W = areaFor(b.water, n), D = areaFor(b.deep, n);
      if (land) { sp.land += land; sp.parts.land.push({ who: x.a.name, v: land }); }
      if (shelter) { sp.shelter += shelter; sp.parts.shelter.push({ who: x.a.name, v: shelter }); }
      if (climb) { sp.climb += climb; sp.parts.climb.push({ who: x.a.name, v: climb }); }
      if (fly) { sp.fly += fly; sp.parts.fly.push({ who: x.a.name, v: fly }); }
      if (W > 0 && D > 0) { sp.anyDepth += Math.max(W, D); sp.deep += D; sp.deepWho.push(x.a.name); sp.parts.water.push({ who: x.a.name, v: Math.max(W, D) }); }
      else if (W > 0) { sp.regular += W; sp.regularWho.push(x.a.name); sp.parts.water.push({ who: x.a.name, v: W }); }
      else if (D > 0) { sp.anyDepth += D; sp.deep += D; sp.deepWho.push(x.a.name); sp.parts.water.push({ who: x.a.name, v: D }); }
    });

    function withThrive(basicVal, key) {
      var t = sT[key];
      if (t && t.amount > basicVal) return { v: t.amount, basic: basicVal, raisedBy: t.who };
      return { v: basicVal, basic: basicVal, raisedBy: null };
    }
    var space = {
      shelter: withThrive(sp.shelter, 'shelter'),
      climb: withThrive(sp.climb, 'climb'),
      fly: withThrive(sp.fly, 'fly'),
      land: withThrive(sp.land, 'land')
    };
    var deepFinal = withThrive(sp.deep, 'deep');
    var waterBasic = sp.regular + sp.anyDepth;
    var waterNeeded = sp.regular + Math.max(sp.anyDepth, deepFinal.v);
    var waterFinal = { v: waterNeeded, basic: waterBasic, raisedBy: null };
    if (waterNeeded > waterBasic && deepFinal.raisedBy) waterFinal.raisedBy = deepFinal.raisedBy;
    if (sT.water && sT.water.amount > waterFinal.v) waterFinal = { v: sT.water.amount, basic: waterBasic, raisedBy: sT.water.who };
    space.water = waterFinal;
    space.deep = deepFinal;
    space.regular = sp.regular;
    space.regularWho = sp.regularWho;
    space.deepWho = sp.deepWho;
    space.parts = sp.parts;

    // --- Terrain ---
    var keys = model.terrainOrder;
    var lo = {}, hi = {}, rng = {};
    keys.forEach(function (k) {
      var entries = [];
      sel.forEach(function (x) {
        var t = x.a.basic && x.a.basic.terrain[k];
        if (t) entries.push({ who: x.a.name, lo: t.min, hi: t.max });
      });
      var r = rangeOf(entries);
      rng[k] = r;
      lo[k] = r.lo; hi[k] = r.hi;
    });

    function check(L, useFlats) {
      var need = {};
      function calcNeed(k) {
        if (need[k] !== undefined) return need[k];
        var v = Math.max(useFlats && tF[k] ? tF[k].amount : 0, lo[k] !== null ? L * lo[k] / 100 : 0);
        var s = 0;
        T[k].children.forEach(function (c) { s += calcNeed(c); });
        need[k] = Math.max(v, s);
        return need[k];
      }
      keys.forEach(calcNeed);
      var fails = [], eps = 1e-9;
      keys.forEach(function (k) {
        if (hi[k] !== null && need[k] > L * hi[k] / 100 + eps) fails.push({ type: 'cap', k: k });
        var ch = T[k].children;
        if (ch.length && ch.every(function (c) { return hi[c] !== null; })) {
          var cap = 0; ch.forEach(function (c) { cap += L * hi[c] / 100; });
          if (need[k] > cap + eps) fails.push({ type: 'childcaps', k: k });
        }
        if (T[k].overlay && !T[k].parent && need[k] > L + eps) fails.push({ type: 'overlay', k: k });
      });
      var sum = 0;
      keys.forEach(function (k) { if (!T[k].parent && !T[k].overlay) sum += need[k]; });
      if (sum > L + eps) fails.push({ type: 'sum' });
      return { ok: !fails.length, fails: fails, need: need };
    }

    var terr = { messages: [], noMatch: false, lines: [], raise: null };
    // Percentage-only feasibility (size doesn't matter for percentages)
    keys.forEach(function (k) {
      var r = rng[k];
      if (r.noMatch) {
        terr.noMatch = true;
        terr.messages.push(r.loBy.join(', ') + ' need' + (r.loBy.length > 1 ? '' : 's') + ' at least ' + r.lo + '% ' + T[k].name +
          ', but ' + r.hiBy.join(', ') + ' allow' + (r.hiBy.length > 1 ? '' : 's') + ' at most ' + r.hi + '%.');
      }
    });
    if (!terr.noMatch) {
      var pc = check(1000, false);
      pc.fails.forEach(function (f) {
        terr.noMatch = true;
        if (f.type === 'cap') terr.messages.push('The minimums for the types of ' + T[f.k].name + ' add up to more than ' + rng[f.k].hiBy.join(', ') + "'s " + hi[f.k] + '% limit for ' + T[f.k].name + '.');
        else if (f.type === 'childcaps') terr.messages.push('The limits on each type of ' + T[f.k].name + ' leave no way to reach the ' + lo[f.k] + '% minimum for ' + T[f.k].name + '.');
        else if (f.type === 'sum') terr.messages.push('The terrain minimums add up to more than 100% of the land.');
      });
    }
    // Flat thrive terrain amounts may need more land
    var hasFlats = Object.keys(tF).length > 0;
    var landFinal = space.land.v;
    if (!terr.noMatch && hasFlats && !aquariumOnly) {
      var L0 = Math.max(landFinal, 0);
      var first = L0 > 0 ? check(L0, true) : { ok: false, fails: [{ type: 'sum' }] };
      if (!first.ok) {
        var hiL = Math.max(L0, 1), found = false;
        for (var i = 0; i < 40; i++) { if (check(hiL, true).ok) { found = true; break; } hiL *= 2; }
        if (!found) {
          terr.noMatch = true;
          var zero = keys.filter(function (k) { return tF[k] && hi[k] === 0; });
          var anc = [];
          keys.forEach(function (k) {
            if (!tF[k]) return;
            var p = T[k].parent;
            while (p) { if (hi[p] === 0) anc.push({ k: k, p: p }); p = T[p].parent; }
          });
          if (zero.length) zero.forEach(function (k) { terr.messages.push(tF[k].who.join(', ') + ' need' + (tF[k].who.length > 1 ? '' : 's') + ' ' + tF[k].name + ', but ' + rng[k].hiBy.join(', ') + ' allow' + (rng[k].hiBy.length > 1 ? '' : 's') + ' no ' + T[k].name + '.'); });
          else if (anc.length) anc.forEach(function (x) { terr.messages.push(tF[x.k].who.join(', ') + ' need' + (tF[x.k].who.length > 1 ? '' : 's') + ' ' + tF[x.k].name + ', but ' + rng[x.p].hiBy.join(', ') + ' allow' + (rng[x.p].hiBy.length > 1 ? '' : 's') + ' no ' + T[x.p].name + '.'); });
          else terr.messages.push('The flat terrain needs for thriving cannot fit alongside the terrain percentage limits.');
        } else {
          var loL = Math.max(L0, 0);
          while (hiL - loL > 0.5) { var mid = (loL + hiL) / 2; if (check(mid, true).ok) hiL = mid; else loL = mid; }
          var newL = Math.ceil(hiL);
          while (!check(newL, true).ok) newL++;
          while (newL - 1 > L0 && check(newL - 1, true).ok) newL--;
          // explain why
          var why = 'so there is enough land for all the flat terrain needs';
          var f0 = first.fails[0];
          if (f0 && (f0.type === 'cap') && L0 > 0) {
            var flatInside = keys.filter(function (k) {
              if (!tF[k]) return false;
              var p = k; while (p) { if (p === f0.k) return true; p = T[p].parent; } return false;
            });
            var flatName = flatInside.length ? tF[flatInside[0]].name : T[f0.k].name;
            why = 'so ' + flatName + ' stays within ' + rng[f0.k].hiBy.join(', ') + "'s " + hi[f0.k] + '% limit for ' + T[f0.k].name;
          }
          terr.raise = { from: L0, to: newL, why: why };
          landFinal = newL;
        }
      }
    }
    space.landFinal = landFinal;
    space.minSize = landFinal + space.shelter.v + space.water.v;

    // --- Actual habitat size (optional inputs) ---
    var S = space.shelter.v, Wmin = space.water.v, Lmin = landFinal;
    var inp = sizes || {};
    var H = num(inp.total), Li = num(inp.land), Wi = num(inp.water);
    var sizeAlerts = [];
    if (H !== null && H < space.minSize) {
      sizeAlerts.push('A habitat size of ' + fmtN(H) + ' m² is smaller than the minimum of ' + fmtN(space.minSize) + ' m², so the minimum is used.');
      H = null;
    }
    var Lact = Li !== null ? Li : Lmin, Wact = Wi !== null ? Wi : Wmin;
    if (H !== null) {
      if (Li !== null && Wi !== null) {
        if (Math.abs(Li + S + Wi - H) > 0.5) sizeAlerts.push('Land + shelter + water (' + fmtN(Li + S + Wi) + ' m²) doesn’t add up to the habitat size of ' + fmtN(H) + ' m². The land and water you entered are used.');
      } else if (Li !== null) {
        Wact = H - S - Li;
      } else if (Wi !== null || !aquariumOnly) {
        Lact = H - S - Wact;
      } else {
        Wact = H - S - Lact;
      }
    }
    if (Lact < Lmin - 0.5) {
      sizeAlerts.push('Land needs to be at least ' + fmtN(Lmin) + ' m²' + (terr.raise ? ' (including the thrive terrain areas)' : '') + ', so the minimum is used.');
      Lact = Lmin;
    }
    if (Wact < Wmin - 0.5) {
      sizeAlerts.push('Water needs to be at least ' + fmtN(Wmin) + ' m², so the minimum is used.');
      Wact = Wmin;
    }
    space.actual = { land: Lact, water: Wact, total: Lact + S + Wact,
                     extraLand: Lact - Lmin, extraWater: Wact - Wmin, entered: num(inp.total) !== null || Li !== null || Wi !== null };
    sizeAlerts.forEach(function (t) { res.alerts.push({ level: 'warn', who: 'Habitat size', text: t }); });
    landFinal = Lact;

    // Terrain display lines (tree order)
    function relevant(k) {
      if (rng[k].any || tF[k]) return true;
      return T[k].children.some(relevant);
    }
    // Work out the percentage to paint for each terrain, including thrive areas
    // and the needs of its types, based on the final land size.
    var Lshow = (!aquariumOnly && landFinal > 0) ? landFinal : 0;
    var effNeed = check(Lshow || 1000, !!Lshow).need;
    function effRange(k) {
      var r = rng[k];
      var p = effNeed[k] / (Lshow || 1000) * 100;
      var lo2 = p > 1e-9 ? Math.ceil(p - 1e-6) : null;
      var hi2 = r.hi;
      var ch = T[k].children;
      if (ch.length && ch.every(function (c) { return hi[c] !== null; })) {
        var s = 0; ch.forEach(function (c) { s += hi[c]; });
        hi2 = hi2 === null ? s : Math.min(hi2, s);
      }
      if (lo2 !== null && hi2 !== null && lo2 > hi2 && !r.noMatch && !terr.noMatch) lo2 = hi2;
      return { any: lo2 !== null || hi2 !== null || r.any, lo: lo2, hi: hi2, noMatch: r.noMatch, loBy: r.loBy, hiBy: r.hiBy };
    }
    function walk(k, depth) {
      if (!relevant(k)) return;
      terr.lines.push({ key: k, name: T[k].name, depth: depth, range: effRange(k), overlay: T[k].overlay,
        parentName: T[k].parent ? T[T[k].parent].name : null });
      T[k].children.forEach(function (c) { walk(c, depth + 1); });
    }
    keys.forEach(function (k) { if (!T[k].parent) walk(k, 0); });
    terr.flats = [];
    keys.forEach(function (k) {
      if (tF[k]) terr.flats.push({ name: tF[k].name, amount: tF[k].amount, who: tF[k].who, parentName: T[k].parent ? T[T[k].parent].name : null });
    });
    terr.basedOn = Lshow;
    res.terrain = terr;
    res.space = space;

    // --- Basic items ---
    var basicMap = {}, basicOrder = [];
    sel.forEach(function (x) {
      x.a.basicItems.forEach(function (it) {
        if (it.cls.type !== 'item') return;
        if (!basicMap[it.key]) { basicMap[it.key] = { name: it.name, entries: [] }; basicOrder.push(it.key); }
        basicMap[it.key].entries.push({ value: it.amount.value, individual: false, who: x.a.name, unit: it.amount.kind });
      });
    });
    res.basicItems = basicOrder.map(function (k) {
      var c = combineAmounts(basicMap[k].entries);
      return { name: basicMap[k].name, key: k, amount: c.amount, who: c.who, unit: basicMap[k].entries[0].unit };
    }).sort(function (a, b) { return a.name.localeCompare(b.name); });

    // --- Thrive ---
    var th = { any: thriving.length > 0, items: [], checks: [], native: null, food: [] };
    if (th.any) {
      var itemMap = {}, itemOrder = [];
      thriving.forEach(function (x) {
        thriveReqsFor(model, x.a).forEach(function (r) {
          var t = r.cls.type;
          if (t === 'item') {
            if (!itemMap[r.key]) { itemMap[r.key] = { name: r.name, entries: [] }; itemOrder.push(r.key); }
            itemMap[r.key].entries.push({ value: r.amount.value, individual: r.individual, who: x.a.name, unit: r.amount.kind });
          } else if (t === 'group') {
            var g = model.groups[r.cls.group];
            var present = sel.filter(function (o) { return o.a.key !== x.a.key && g.members[o.a.key]; });
            var options = Object.keys(g.members).filter(function (m) { return m !== x.a.key; })
              .map(function (m) { return model.animals[m] ? model.animals[m].name : m; }).sort();
            th.checks.push({ who: x.a.name, name: g.name, met: present.length > 0, with: names(present), options: options, kind: 'group' });
          } else if (t === 'species') {
            var target = model.animals[r.cls.species];
            var has = speciesKeys.indexOf(r.cls.species) >= 0 && r.cls.species !== x.a.key;
            th.checks.push({ who: x.a.name, name: target.name, met: has, kind: 'species' });
          }
        });
      });
      th.items = itemOrder.map(function (k) {
        var entries = itemMap[k].entries.slice();
        var c = combineAmounts(entries);
        var bItem = basicMap[k];
        var who = c.who;
        var amount = c.amount;
        if (bItem) {
          var bc = combineAmounts(bItem.entries);
          amount = c.individual ? amount + bc.amount : Math.max(amount, bc.amount);
          who = uniq(who.concat(bc.who));
        }
        return { name: itemMap[k].name, key: k, amount: amount, who: who, individual: c.individual, unit: entries[0].unit, alsoBasic: !!bItem };
      }).sort(function (a, b) { return a.name.localeCompare(b.name); });

      // Native plants
      var natives = [];
      thriving.forEach(function (x) {
        thriveReqsFor(model, x.a).forEach(function (r) {
          if (r.cls.type === 'native') natives.push({ x: x, pct: r.amount.value || 0 });
        });
      });
      if (natives.length) {
        var pairLabel = {}, animalPairs = [];
        var cantMatch = [];
        natives.forEach(function (nv) {
          var ps = [];
          nv.x.a.ranges.forEach(function (rg) { nv.x.a.biomes.forEach(function (bm) {
            var key = norm(rg) + '|' + norm(bm);
            pairLabel[key] = rg + ' / ' + bm;
            ps.push(key);
          }); });
          if (!ps.length) cantMatch.push(nv.x.a.name);
          animalPairs.push({ who: nv.x.a.name, pct: nv.pct, pairs: ps });
        });
        var candidates = Object.keys(pairLabel);
        var best = null;
        if (!cantMatch.length) {
          for (var k2 = 1; k2 <= animalPairs.length && !best; k2++) {
            var tries = 0;
            combinations(candidates, k2, function (combo) {
              tries++;
              var assign = {};
              var ok = animalPairs.every(function (ap) {
                var p = combo.filter(function (c) { return ap.pairs.indexOf(c) >= 0; })[0];
                if (!p) return false;
                (assign[p] = assign[p] || []).push(ap);
                return true;
              });
              if (ok) {
                var cost = 0, groupsOut = [];
                combo.forEach(function (c) {
                  var list2 = assign[c] || [];
                  if (!list2.length) return;
                  var pct = Math.max.apply(null, list2.map(function (ap) { return ap.pct; }));
                  cost += pct;
                  groupsOut.push({ label: pairLabel[c], pct: pct, who: list2.map(function (ap) { return ap.who; }) });
                });
                if (!best || cost < best.total) best = { total: cost, groups: groupsOut };
              }
              if (tries > 200000) return false;
            });
          }
        }
        th.native = { best: best, cantMatch: cantMatch, noMatch: !!cantMatch.length || !best || best.total > 100 + 1e-9 };
      }

      thriving.forEach(function (x) { if (x.gradeLocked) th.food.push(x.a.name); });
    }
    res.thrive = th;

    // --- Food ---
    var food = { lines: [], total: 0, missing: [] };
    sel.forEach(function (x) {
      var cost = x.a.food[x.grade];
      if (cost === null) { food.missing.push(x.a.name); food.lines.push({ who: x.a.name, grade: x.grade, n: x.n, cost: null }); }
      else { food.total += cost * x.n; food.lines.push({ who: x.a.name, grade: x.grade, n: x.n, cost: cost, sub: cost * x.n }); }
    });
    res.food = food;

    return res;
  }

  return { buildModel: buildModel, calculate: calculate, norm: norm, gradeLocked: gradeLocked,
           // extra helpers shared with the Zoo Planner
           table: table, num: num, bool: bool, list: list, blank: blank, thriveReqsFor: thriveReqsFor, countOf: countOf };
})();
