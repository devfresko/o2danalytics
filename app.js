// ============================================================
//  O2D Analytics — app.js
//  Requires: apiconfig.js (loaded before this in index.html)
//  Chart.js loaded via CDN in index.html
// ============================================================

// ── Global State ────────────────────────────────────────────
var _D = {                     // master data cache
  orders:         [],
  orderDetails:   [],
  receivedItems:  [],
  returnedItems:  [],
  pdfs:           [],
  indents:        [],
  purchasedItems: [],
  reimbursements: [],
  dumpItems:      [],
  lastTs:         null
};

var _currentView  = APP_CONFIG.defaultView || 'kanban';
var _cbIdx        = 0;
var _chartInstances = {};      // keyed by canvas id
var _calYear      = new Date().getFullYear();
var _calMonth     = new Date().getMonth();
var _galleryMode  = 'load';    // 'load' | 'receive'
var _tblSort      = { col: 'Expected Delivery Date', dir: -1 };
var _tblFilter    = { search: '', status: '', wh: '' };
var _pivotRow     = 'Warehouse';
var _pivotCol     = '_status';
var _timelineOID  = '';
var _autoRefTimer = null;

// Pipeline status colours (must match CSS variables)
var STATUS_CLASS = {
  'Pending':       'pending',
  'WH Loaded':     'wh-loaded',
  'In-Transit':    'in-transit',
  'Delivered':     'delivered',
  'DEO Collected': 'deo',
  'DEO Approved':  'deo',
  'Invoiced':      'invoiced'
};

var KANBAN_COLS = [
  { key: 'Pending',       label: 'Pending',       icon: '⏳', color: '#6366F1' },
  { key: 'WH Loaded',     label: 'WH Loaded',     icon: '📦', color: '#8B5CF6' },
  { key: 'Delivered',     label: 'Delivered',      icon: '🚚', color: '#F59E0B' },
  { key: 'DEO Collected', label: 'DEO Collected',  icon: '✔️', color: '#3B82F6' },
  { key: 'DEO Approved',  label: 'DEO Approved',   icon: '✅', color: '#10B981' },
  { key: 'Invoiced',      label: 'Invoiced',       icon: '🧾', color: '#06B6D4' }
];

// ────────────────────────────────────────────────────────────
//  SECTION 1 — JSONP API LAYER
// ────────────────────────────────────────────────────────────

function _api(action, data, ok, err) {
  if (!GAS_URL || GAS_URL === 'PASTE_YOUR_GAS_DEPLOYMENT_URL_HERE') {
    _toast('⚠️ GAS URL not set in apiconfig.js', 'err');
    if (err) err({ message: 'GAS_URL not configured' });
    return;
  }

  var cbName = '_gcb' + (++_cbIdx);
  var timer;

  window[cbName] = function(r) {
    clearTimeout(timer);
    var s = document.getElementById('_s_' + cbName);
    if (s) s.parentNode.removeChild(s);
    try { delete window[cbName]; } catch(e) {}
    if (ok) ok(r);
  };

  timer = setTimeout(function() {
    var s = document.getElementById('_s_' + cbName);
    if (s) s.parentNode.removeChild(s);
    try { delete window[cbName]; } catch(e) {}
    if (err) err({ message: 'Request timed out after ' + (APP_CONFIG.apiTimeoutMs / 1000) + 's' });
  }, APP_CONFIG.apiTimeoutMs || 25000);

  var payload = encodeURIComponent(JSON.stringify({
    action: action,
    data:   data || {}
  }));

  var url = GAS_URL + '?callback=' + cbName + '&payload=' + payload;
  var s   = document.createElement('script');
  s.id    = '_s_' + cbName;
  s.src   = url;
  s.onerror = function() {
    clearTimeout(timer);
    try { delete window[cbName]; } catch(e) {}
    if (err) err({ message: 'Network error — check GAS URL' });
  };
  document.head.appendChild(s);
}

// ────────────────────────────────────────────────────────────
//  SECTION 2 — DATA LOADING
// ────────────────────────────────────────────────────────────

function _loadAll(silent) {
  _setStatus('loading', 'Loading…');
  if (!silent) _showOverlay('Fetching O2D data…');

  var btn = document.getElementById('refresh-btn');
  if (btn) btn.classList.add('spinning');

  _api('getAllData', {}, function(r) {
    if (btn) btn.classList.remove('spinning');
    _hideOverlay();

    if (!r || !r.success) {
      _setStatus('error', 'Error');
      _toast('Load failed: ' + (r && r.error ? r.error : 'unknown'), 'err');
      return;
    }

    _D.orders         = r.orders          || [];
    _D.orderDetails   = r.orderDetails    || [];
    _D.receivedItems  = r.receivedItems   || [];
    _D.returnedItems  = r.returnedItems   || [];
    _D.pdfs           = r.pdfs            || [];
    _D.indents        = r.indents         || [];
    _D.purchasedItems = r.purchasedItems  || [];
    _D.reimbursements = r.reimbursements  || [];
    _D.dumpItems      = r.dumpItems       || [];
    _D.lastTs         = r.ts || new Date().toISOString();

    var ts = _D.lastTs ? _D.lastTs.substring(11, 16) : '?';
    _setStatus('loaded', '✓ ' + ts);
    _toast('✓ ' + _D.orders.length + ' orders loaded', 'ok');
    _switchView(_currentView);
    _startAutoRefresh();

  }, function(e) {
    if (btn) btn.classList.remove('spinning');
    _hideOverlay();
    _setStatus('error', 'Failed');
    _toast('API Error: ' + e.message, 'err');
  });
}

function _startAutoRefresh() {
  if (_autoRefTimer) clearInterval(_autoRefTimer);
  if (!APP_CONFIG.autoRefreshMs) return;
  _autoRefTimer = setInterval(function() {
    _loadAll(true);
  }, APP_CONFIG.autoRefreshMs);
}

// ────────────────────────────────────────────────────────────
//  SECTION 3 — VIEW SWITCHER
// ────────────────────────────────────────────────────────────

function _switchView(name) {
  _currentView = name;

  // Update tabs
  var tabs = document.querySelectorAll('.view-tab');
  tabs.forEach(function(t) {
    t.classList.toggle('active', t.dataset.view === name);
  });

  // Scroll active tab into view
  var activeTab = document.querySelector('.view-tab.active');
  if (activeTab) activeTab.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });

  // Destroy old charts
  Object.keys(_chartInstances).forEach(function(k) {
    try { _chartInstances[k].destroy(); } catch(e) {}
    delete _chartInstances[k];
  });

  var vc = document.getElementById('view-container');
  if (!vc) return;

  if (!_D.orders.length && name !== 'chart' && name !== 'purchase') {
    vc.innerHTML = '<div class="empty-state"><div class="empty-icon">📡</div><p>No data yet. Pull to refresh.</p></div>';
    return;
  }

  var renders = {
    kanban:   _renderKanban,
    table:    _renderTable,
    chart:    _renderChart,
    calendar: _renderCalendar,
    timeline: _renderTimeline,
    list:     _renderList,
    gallery:  _renderGallery,
    pivot:    _renderPivot,
    map:      _renderMap,
    tree:     _renderTree,
    purchase: _renderPurchase
  };

  var fn = renders[name];
  if (fn) fn();
  else vc.innerHTML = '<div class="empty-state"><div class="empty-icon">🚧</div><p>View "' + name + '" not implemented.</p></div>';
}

// ────────────────────────────────────────────────────────────
//  SECTION 4 — HELPERS
// ────────────────────────────────────────────────────────────

function _esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function _statusPill(status) {
  var cls = STATUS_CLASS[status] || 'pending';
  return '<span class="status-pill ' + cls + '">' + _esc(status || 'Pending') + '</span>';
}

function _fmtDate(s) {
  if (!s) return '—';
  return String(s).substring(0, 10);
}

function _fmtDateTime(s) {
  if (!s) return '—';
  return String(s).substring(0, 16).replace('T', ' ');
}

function _fmtNum(n) {
  var v = parseFloat(n);
  return isNaN(v) ? '—' : v.toLocaleString('en-IN');
}

function _diffHours(a, b) {
  if (!a || !b) return null;
  var da = new Date(a), db = new Date(b);
  return ((db - da) / 3600000).toFixed(1);
}

function _orderCustomer(o) {
  var c = String(o['Customer Name'] || '').trim();
  // UUIDs are from AppSheet refs — show OrderID prefix instead
  if (c.length === 36 && c.indexOf('-') > 0) return o['Warehouse'] || o['OrderID'] || '—';
  return c || o['Warehouse'] || '—';
}

function _orderLocation(o) {
  var l = String(o['Delivery Location'] || '').trim();
  if (l.length === 36 && l.indexOf('-') > 0) return o['Warehouse'] || '?';
  return l || o['Warehouse'] || '?';
}

function _uniqueValues(arr, key) {
  var seen = {}, out = [];
  arr.forEach(function(r) {
    var v = String(r[key] || '').trim();
    if (v && !seen[v]) { seen[v] = 1; out.push(v); }
  });
  return out.sort();
}

// Filter orders based on current _tblFilter
function _filteredOrders() {
  return _D.orders.filter(function(o) {
    if (_tblFilter.status && o._status !== _tblFilter.status) return false;
    if (_tblFilter.wh && o['Warehouse'] !== _tblFilter.wh) return false;
    if (_tblFilter.search) {
      var q = _tblFilter.search.toLowerCase();
      var hay = [o['OrderID'], _orderCustomer(o), o['Delivery Boy'],
                 _orderLocation(o), o._status].join(' ').toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  });
}

// ── Chart.js default config ──────────────────────────────────
function _chartDefaults() {
  return {
    color: '#94A3B8',
    borderColor: 'rgba(255,255,255,0.06)',
    plugins: {
      legend: { labels: { color: '#94A3B8', font: { size: 11 } } },
      tooltip: {
        backgroundColor: '#152236',
        borderColor: 'rgba(255,255,255,0.1)',
        borderWidth: 1,
        titleColor: '#E2E8F0',
        bodyColor: '#94A3B8'
      }
    },
    scales: {
      x: { ticks: { color: '#64748B', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)' } },
      y: { ticks: { color: '#64748B', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.06)' } }
    }
  };
}

// ────────────────────────────────────────────────────────────
//  SECTION 5 — VIEW: KANBAN
// ────────────────────────────────────────────────────────────

function _renderKanban() {
  var vc = document.getElementById('view-container');

  // Group orders by status
  var groups = {};
  KANBAN_COLS.forEach(function(c) { groups[c.key] = []; });
  _D.orders.forEach(function(o) {
    var s = o._status || 'Pending';
    if (!groups[s]) groups[s] = [];
    groups[s].push(o);
  });

  var html = '<div id="view-kanban">';

  KANBAN_COLS.forEach(function(col) {
    var cards = groups[col.key] || [];
    html += '<div class="kanban-col">';
    html += '<div class="kanban-col-header" style="color:' + col.color + '">';
    html += col.icon + ' ' + _esc(col.label);
    html += '<span class="col-count">' + cards.length + '</span>';
    html += '</div>';
    html += '<div class="kanban-col-body">';

    if (!cards.length) {
      html += '<div style="padding:16px;text-align:center;font-size:11px;color:var(--text-dim)">No orders</div>';
    } else {
      // Show max 50 per column to keep DOM light
      cards.slice(0, 50).forEach(function(o) {
        var edd = _fmtDate(o['Expected Delivery Date']);
        html += '<div class="kanban-card" onclick="_openDetail(\'' + _esc(o['OrderID']) + '\')">';
        html += '<div class="kc-id">' + _esc(o['OrderID']) + '</div>';
        html += '<div class="kc-customer">' + _esc(_orderCustomer(o)) + '</div>';
        html += '<div class="kc-meta">';
        html += '<span class="kc-chip">📅 ' + edd + '</span>';
        if (o['Delivery Boy']) html += '<span class="kc-chip">🚴 ' + _esc(o['Delivery Boy']) + '</span>';
        if (o['Crates Loaded']) html += '<span class="kc-chip">📦 ' + o['Crates Loaded'] + '</span>';
        if (o['Warehouse']) html += '<span class="kc-chip">🏭 ' + _esc(o['Warehouse']) + '</span>';
        html += '</div></div>';
      });
      if (cards.length > 50) {
        html += '<div style="padding:8px;text-align:center;font-size:10px;color:var(--text-dim)">+' + (cards.length - 50) + ' more — use Table view</div>';
      }
    }

    html += '</div></div>';
  });

  html += '</div>';
  vc.innerHTML = html;
}

// ────────────────────────────────────────────────────────────
//  SECTION 6 — VIEW: TABLE
// ────────────────────────────────────────────────────────────

function _renderTable() {
  var vc   = document.getElementById('view-container');
  var whs  = _uniqueValues(_D.orders, 'Warehouse');
  var statuses = ['Pending','WH Loaded','Delivered','DEO Collected','DEO Approved','Invoiced'];

  var html = '';

  // Filter bar
  html += '<div class="filter-bar">';
  html += '<input id="tbl-search" type="search" placeholder="🔍 Search order, customer…" value="' + _esc(_tblFilter.search) + '" oninput="_tblSearch(this.value)" />';
  html += '<select id="tbl-status" onchange="_tblFilterStatus(this.value)">';
  html += '<option value="">All Status</option>';
  statuses.forEach(function(s) {
    html += '<option value="' + s + '"' + (_tblFilter.status === s ? ' selected' : '') + '>' + s + '</option>';
  });
  html += '</select>';
  html += '<select id="tbl-wh" onchange="_tblFilterWH(this.value)">';
  html += '<option value="">All WH</option>';
  whs.forEach(function(w) {
    html += '<option value="' + _esc(w) + '"' + (_tblFilter.wh === w ? ' selected' : '') + '>' + _esc(w) + '</option>';
  });
  html += '</select>';
  html += '<button class="btn btn-sm" onclick="_exportCSV()">⬇ CSV</button>';
  html += '</div>';

  var rows = _filteredOrders();

  // Sort
  rows.sort(function(a, b) {
    var av = String(a[_tblSort.col] || a._status || '');
    var bv = String(b[_tblSort.col] || b._status || '');
    return av < bv ? -_tblSort.dir : av > bv ? _tblSort.dir : 0;
  });

  html += '<div class="section-head"><h2>Orders</h2><span class="badge">' + rows.length + ' / ' + _D.orders.length + '</span></div>';
  html += '<div class="table-wrap"><table><thead><tr>';

  var cols = [
    { key: 'OrderID',                label: 'Order ID' },
    { key: 'Customer Name',          label: 'Customer' },
    { key: 'Expected Delivery Date', label: 'Delivery Date' },
    { key: 'Warehouse',              label: 'Warehouse' },
    { key: 'Delivery Boy',           label: 'Delivery Boy' },
    { key: 'Crates Loaded',          label: 'Crates' },
    { key: 'Returned Crates',        label: 'Ret. Crates' },
    { key: '_status',                label: 'Status' }
  ];

  cols.forEach(function(c) {
    var sorted = _tblSort.col === c.key;
    var dir    = sorted ? (_tblSort.dir === 1 ? '▲' : '▼') : '↕';
    html += '<th class="' + (sorted ? 'sorted' : '') + '" onclick="_tblSortBy(\'' + c.key + '\')">';
    html += _esc(c.label) + ' <span class="sort-icon">' + dir + '</span></th>';
  });
  html += '</tr></thead><tbody>';

  if (!rows.length) {
    html += '<tr><td colspan="' + cols.length + '" style="text-align:center;color:var(--text-dim);padding:24px">No matching orders</td></tr>';
  } else {
    rows.slice(0, 500).forEach(function(o) {
      html += '<tr onclick="_openDetail(\'' + _esc(o['OrderID']) + '\')">';
      html += '<td class="mono">' + _esc(o['OrderID']) + '</td>';
      html += '<td>' + _esc(_orderCustomer(o)) + '</td>';
      html += '<td>' + _fmtDate(o['Expected Delivery Date']) + '</td>';
      html += '<td>' + _esc(o['Warehouse'] || '—') + '</td>';
      html += '<td>' + _esc(o['Delivery Boy'] || '—') + '</td>';
      html += '<td>' + _fmtNum(o['Crates Loaded']) + '</td>';
      html += '<td>' + _fmtNum(o['Returned Crates']) + '</td>';
      html += '<td>' + _statusPill(o._status) + '</td>';
      html += '</tr>';
    });
    if (rows.length > 500) {
      html += '<tr><td colspan="' + cols.length + '" style="text-align:center;color:var(--text-dim);padding:12px;font-size:11px">Showing 500 of ' + rows.length + '. Refine filters to see more.</td></tr>';
    }
  }

  html += '</tbody></table></div>';
  vc.innerHTML = html;
}

function _tblSearch(v)        { _tblFilter.search = v; _renderTable(); }
function _tblFilterStatus(v)  { _tblFilter.status = v; _renderTable(); }
function _tblFilterWH(v)      { _tblFilter.wh     = v; _renderTable(); }
function _tblSortBy(col) {
  if (_tblSort.col === col) _tblSort.dir *= -1;
  else { _tblSort.col = col; _tblSort.dir = 1; }
  _renderTable();
}

// ────────────────────────────────────────────────────────────
//  SECTION 7 — VIEW: CHART
// ────────────────────────────────────────────────────────────

function _renderChart() {
  var vc = document.getElementById('view-container');

  var html = '<div class="kpi-row" id="kpi-row"></div>';
  html += '<div class="chart-grid">';
  html += '<div class="chart-card"><h3>📦 Orders by Status</h3><canvas id="ch-status"></canvas></div>';
  html += '<div class="chart-card"><h3>📅 Daily Order Volume (Last 14 Days)</h3><canvas id="ch-daily"></canvas></div>';
  html += '<div class="chart-card"><h3>🛒 Indent vs Purchased (Top 15 Items)</h3><canvas id="ch-indent"></canvas></div>';
  html += '<div class="chart-card"><h3>🚴 Delivery Boy Performance</h3><canvas id="ch-delivery"></canvas></div>';
  html += '<div class="chart-card"><h3>📦 Crates Loaded vs Returned</h3><canvas id="ch-crates"></canvas></div>';
  html += '<div class="chart-card"><h3>🏭 Orders by Warehouse</h3><canvas id="ch-warehouse"></canvas></div>';
  html += '</div>';
  vc.innerHTML = html;

  // ── KPI Row ──────────────────────────────────────────────
  var statusCount = {};
  var cratesTotal = 0, cratesRet = 0;
  _D.orders.forEach(function(o) {
    var s = o._status || 'Pending';
    statusCount[s] = (statusCount[s] || 0) + 1;
    cratesTotal += parseFloat(o['Crates Loaded']   || 0);
    cratesRet   += parseFloat(o['Returned Crates'] || 0);
  });
  var today = new Date().toISOString().substring(0, 10);
  var todayOrders = _D.orders.filter(function(o) {
    return String(o['Expected Delivery Date'] || '').substring(0, 10) === today;
  }).length;

  var kpiRow = document.getElementById('kpi-row');
  if (kpiRow) {
    kpiRow.innerHTML = [
      { label: 'Total Orders', value: _D.orders.length,                     sub: 'all time',           cls: 'accent1' },
      { label: "Today's",      value: todayOrders,                           sub: 'expected delivery',  cls: 'accent2' },
      { label: 'Invoiced',     value: statusCount['Invoiced'] || 0,          sub: 'completed pipeline', cls: 'accent2' },
      { label: 'Pending',      value: statusCount['Pending'] || 0,           sub: 'awaiting dispatch',  cls: 'accent3' },
      { label: 'Crates Out',   value: Math.round(cratesTotal),               sub: 'total loaded',       cls: '' },
      { label: 'Crates Back',  value: Math.round(cratesRet),                 sub: 'returned',           cls: 'accent4' },
      { label: 'Indents',      value: _D.indents.length,                     sub: 'purchase indents',   cls: '' },
      { label: 'Purchased',    value: _D.purchasedItems.length,              sub: 'line items bought',  cls: 'accent1' }
    ].map(function(k) {
      return '<div class="kpi-card ' + k.cls + '">' +
        '<div class="kpi-label">' + k.label + '</div>' +
        '<div class="kpi-value">' + k.value.toLocaleString('en-IN') + '</div>' +
        '<div class="kpi-sub">'  + k.sub   + '</div></div>';
    }).join('');
  }

  var defs = _chartDefaults();

  // ── Chart 1: Status Donut ────────────────────────────────
  var statusLabels = Object.keys(statusCount);
  var statusData   = statusLabels.map(function(k) { return statusCount[k]; });
  var statusColors = ['#6366F1','#8B5CF6','#F59E0B','#10B981','#3B82F6','#06B6D4','#EF4444'];
  _makeChart('ch-status', 'doughnut', {
    labels:   statusLabels,
    datasets: [{ data: statusData, backgroundColor: statusColors.slice(0, statusLabels.length), borderWidth: 0 }]
  }, { plugins: { legend: defs.plugins.legend, tooltip: defs.plugins.tooltip } });

  // ── Chart 2: Daily Volume (last 14 days) ────────────────
  var dayMap = {};
  _D.orders.forEach(function(o) {
    var d = String(o['Expected Delivery Date'] || '').substring(0, 10);
    if (d) dayMap[d] = (dayMap[d] || 0) + 1;
  });
  var allDays  = Object.keys(dayMap).sort().slice(-14);
  var dailyVol = allDays.map(function(d) { return dayMap[d]; });
  _makeChart('ch-daily', 'bar', {
    labels:   allDays.map(function(d) { return d.substring(5); }),
    datasets: [{ label: 'Orders', data: dailyVol,
                 backgroundColor: 'rgba(59,130,246,0.7)',
                 borderColor: '#3B82F6', borderWidth: 1, borderRadius: 4 }]
  }, defs);

  // ── Chart 3: Indent vs Purchased ────────────────────────
  var itemMap = {};
  _D.indents.forEach(function(r) {
    var it = String(r['Item Name'] || '').trim().substring(0, 20);
    if (!it) return;
    if (!itemMap[it]) itemMap[it] = { indent: 0, purchased: 0 };
    itemMap[it].indent += parseFloat(r['Qty'] || 0);
  });
  _D.purchasedItems.forEach(function(r) {
    var it = String(r['Item Name'] || '').trim().substring(0, 20);
    if (!it) return;
    if (!itemMap[it]) itemMap[it] = { indent: 0, purchased: 0 };
    itemMap[it].purchased += parseFloat(r['Qty'] || 0);
  });
  var itemKeys = Object.keys(itemMap).sort(function(a,b) {
    return (itemMap[b].indent + itemMap[b].purchased) - (itemMap[a].indent + itemMap[a].purchased);
  }).slice(0, 15);
  _makeChart('ch-indent', 'bar', {
    labels:   itemKeys,
    datasets: [
      { label: 'Indented',  data: itemKeys.map(function(k) { return itemMap[k].indent; }),
        backgroundColor: 'rgba(99,102,241,0.7)', borderRadius: 3 },
      { label: 'Purchased', data: itemKeys.map(function(k) { return itemMap[k].purchased; }),
        backgroundColor: 'rgba(16,185,129,0.7)', borderRadius: 3 }
    ]
  }, Object.assign({}, defs, { indexAxis: 'y' }));

  // ── Chart 4: Delivery Boy Performance ───────────────────
  var dbMap = {};
  _D.orders.forEach(function(o) {
    var b = String(o['Delivery Boy'] || 'Unassigned').trim();
    if (!dbMap[b]) dbMap[b] = { done: 0, pending: 0 };
    var done = ['Invoiced','DEO Approved','DEO Collected','Delivered'].indexOf(o._status) >= 0;
    if (done) dbMap[b].done++; else dbMap[b].pending++;
  });
  var dbKeys = Object.keys(dbMap);
  _makeChart('ch-delivery', 'bar', {
    labels:   dbKeys,
    datasets: [
      { label: 'Completed', data: dbKeys.map(function(k) { return dbMap[k].done; }),
        backgroundColor: 'rgba(16,185,129,0.8)', borderRadius: 3 },
      { label: 'Pending',   data: dbKeys.map(function(k) { return dbMap[k].pending; }),
        backgroundColor: 'rgba(239,68,68,0.7)',  borderRadius: 3 }
    ]
  }, defs);

  // ── Chart 5: Crates Loaded vs Returned by day ───────────
  var crateMap = {};
  _D.orders.forEach(function(o) {
    var d = String(o['Expected Delivery Date'] || '').substring(0, 10);
    if (!d) return;
    if (!crateMap[d]) crateMap[d] = { loaded: 0, ret: 0 };
    crateMap[d].loaded += parseFloat(o['Crates Loaded']   || 0);
    crateMap[d].ret    += parseFloat(o['Returned Crates'] || 0);
  });
  var crateDays = Object.keys(crateMap).sort().slice(-10);
  _makeChart('ch-crates', 'line', {
    labels:   crateDays.map(function(d) { return d.substring(5); }),
    datasets: [
      { label: 'Loaded',   data: crateDays.map(function(d) { return crateMap[d].loaded; }),
        borderColor: '#3B82F6', backgroundColor: 'rgba(59,130,246,0.1)',
        fill: true, tension: 0.4, pointRadius: 3 },
      { label: 'Returned', data: crateDays.map(function(d) { return crateMap[d].ret; }),
        borderColor: '#10B981', backgroundColor: 'rgba(16,185,129,0.1)',
        fill: true, tension: 0.4, pointRadius: 3 }
    ]
  }, defs);

  // ── Chart 6: Orders by Warehouse ────────────────────────
  var whMap = {};
  _D.orders.forEach(function(o) {
    var w = String(o['Warehouse'] || 'Unknown').trim();
    whMap[w] = (whMap[w] || 0) + 1;
  });
  var whKeys = Object.keys(whMap);
  _makeChart('ch-warehouse', 'pie', {
    labels:   whKeys,
    datasets: [{ data: whKeys.map(function(k) { return whMap[k]; }),
                 backgroundColor: ['#3B82F6','#06B6D4','#8B5CF6','#F59E0B','#10B981'],
                 borderWidth: 0 }]
  }, { plugins: { legend: defs.plugins.legend, tooltip: defs.plugins.tooltip } });
}

function _makeChart(id, type, data, opts) {
  var canvas = document.getElementById(id);
  if (!canvas) return;
  try {
    _chartInstances[id] = new Chart(canvas, {
      type: type,
      data: data,
      options: Object.assign({ responsive: true, maintainAspectRatio: true }, opts || {})
    });
  } catch(e) { console.warn('Chart error', id, e); }
}

// ────────────────────────────────────────────────────────────
//  SECTION 8 — VIEW: CALENDAR
// ────────────────────────────────────────────────────────────

function _renderCalendar() {
  var vc = document.getElementById('view-container');

  // Build day map
  var dayMap = {};
  _D.orders.forEach(function(o) {
    var d = String(o['Expected Delivery Date'] || '').substring(0, 10);
    if (d) {
      if (!dayMap[d]) dayMap[d] = [];
      dayMap[d].push(o);
    }
  });

  var today   = new Date();
  var todayStr = today.toISOString().substring(0, 10);
  var year    = _calYear;
  var month   = _calMonth;
  var months  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var days    = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  var firstDay  = new Date(year, month, 1).getDay();
  var totalDays = new Date(year, month + 1, 0).getDate();

  var html = '<div class="cal-header">';
  html += '<button class="cal-nav-btn" onclick="_calPrev()">‹</button>';
  html += '<span class="cal-title">' + months[month] + ' ' + year + '</span>';
  html += '<button class="cal-nav-btn" onclick="_calNext()">›</button>';
  html += '</div>';

  html += '<div class="cal-grid">';
  days.forEach(function(d) { html += '<div class="cal-day-name">' + d + '</div>'; });

  // Empty cells before first day
  for (var i = 0; i < firstDay; i++) { html += '<div class="cal-cell empty"></div>'; }

  for (var d2 = 1; d2 <= totalDays; d2++) {
    var dateStr = year + '-' + String(month + 1).padStart(2,'0') + '-' + String(d2).padStart(2,'0');
    var orders  = dayMap[dateStr] || [];
    var isToday = dateStr === todayStr;

    html += '<div class="cal-cell' + (isToday ? ' today' : '') + '" onclick="_calDayClick(\'' + dateStr + '\')">';
    html += '<div class="cal-day-num">' + d2 + '</div>';

    if (orders.length) {
      html += '<div class="cal-dots">';
      if (orders.length <= 3) {
        orders.forEach(function(o) {
          var s = o._status || 'Pending';
          var col = { Pending:'#6366F1', 'WH Loaded':'#8B5CF6', Delivered:'#F59E0B',
                     'DEO Approved':'#10B981', Invoiced:'#06B6D4' }[s] || '#3B82F6';
          html += '<div class="cal-dot" style="background:' + col + '" title="' + _esc(o['OrderID']) + '"></div>';
        });
      } else {
        html += '<div class="cal-dot many" style="background:#3B82F6">' + orders.length + '</div>';
      }
      html += '</div>';
    }
    html += '</div>';
  }

  html += '</div>';

  // Summary strip
  var monthTotal = 0;
  Object.keys(dayMap).forEach(function(d3) {
    if (d3.substring(0, 7) === year + '-' + String(month + 1).padStart(2, '0')) {
      monthTotal += dayMap[d3].length;
    }
  });
  html += '<div style="text-align:center;margin-top:14px;font-size:12px;color:var(--muted)">' + monthTotal + ' orders in ' + months[month] + ' ' + year + '</div>';

  vc.innerHTML = html;
}

function _calPrev() { _calMonth--; if (_calMonth < 0) { _calMonth = 11; _calYear--; } _renderCalendar(); }
function _calNext() { _calMonth++; if (_calMonth > 11) { _calMonth = 0;  _calYear++; } _renderCalendar(); }
function _calDayClick(dateStr) {
  var orders = _D.orders.filter(function(o) {
    return String(o['Expected Delivery Date'] || '').substring(0, 10) === dateStr;
  });
  if (!orders.length) { _toast('No orders on ' + dateStr); return; }
  _showDayModal(dateStr, orders);
}

function _showDayModal(dateStr, orders) {
  var html = '';
  orders.forEach(function(o) {
    html += '<div class="list-card" onclick="_openDetail(\'' + _esc(o['OrderID']) + '\')" style="margin-bottom:8px">';
    html += '<div class="list-card-left">';
    html += '<div class="list-card-id">' + _esc(o['OrderID']) + '</div>';
    html += '<div class="list-card-customer">' + _esc(_orderCustomer(o)) + '</div>';
    html += '</div>';
    html += '<div class="list-card-right">' + _statusPill(o._status) + '</div>';
    html += '</div>';
  });
  document.getElementById('modal-title').textContent = 'Orders — ' + dateStr + ' (' + orders.length + ')';
  document.getElementById('modal-body').innerHTML = html;
  _openModal();
}

// ────────────────────────────────────────────────────────────
//  SECTION 9 — VIEW: TIMELINE
// ────────────────────────────────────────────────────────────

function _renderTimeline() {
  var vc     = document.getElementById('view-container');
  var order  = _timelineOID ? _D.orders.find(function(o) { return o['OrderID'] === _timelineOID; }) : _D.orders[0];
  var orders = _D.orders;

  var html = '<div class="filter-bar" style="margin-bottom:14px">';
  html += '<select onchange="_timelineChange(this.value)" style="flex:1">';
  html += '<option value="">— Select Order —</option>';
  orders.slice(0, 200).forEach(function(o) {
    var sel = (order && o['OrderID'] === order['OrderID']) ? ' selected' : '';
    html += '<option value="' + _esc(o['OrderID']) + '"' + sel + '>' + _esc(o['OrderID']) + ' · ' + _esc(_orderCustomer(o)) + '</option>';
  });
  html += '</select></div>';

  if (!order) {
    html += '<div class="empty-state"><div class="empty-icon">⏱</div><p>Select an order above.</p></div>';
    vc.innerHTML = html;
    return;
  }

  var steps = [
    { label: 'Order Created',            planned: order['Timestamp'],       actual: order['Timestamp'] },
    { label: 'WH Loaded & Dispatched',   planned: order['_step1_planned'],  actual: order['_step1_actual'] },
    { label: 'Delivered & Received',     planned: order['_step2_planned'],  actual: order['_step2_actual'] },
    { label: 'Returns Collected by DEO', planned: order['_step4_planned'],  actual: order['_step4_actual'] },
    { label: 'Approved by DEO',          planned: order['_step5_planned'],  actual: order['_step5_actual'] },
    { label: 'Invoiced',                 planned: order['_step6_planned'],  actual: order['_step6_actual'] }
  ];

  html += '<div class="kpi-card" style="margin-bottom:16px">';
  html += '<div class="kpi-label">Order</div><div class="kpi-value" style="font-size:16px">' + _esc(order['OrderID']) + '</div>';
  html += '<div class="kpi-sub">' + _esc(_orderCustomer(order)) + ' · ' + _statusPill(order._status) + '</div>';
  html += '</div>';

  html += '<div class="timeline-wrap">';

  steps.forEach(function(step, idx) {
    var done      = !!step.actual;
    var dotClass  = done ? 'done' : 'pending';
    var cardClass = done ? 'done' : '';
    var delta     = null;
    var deltaClass= '';

    if (idx > 0 && steps[idx - 1].actual && step.actual) {
      var h = _diffHours(steps[idx - 1].actual, step.actual);
      if (h !== null) {
        delta = parseFloat(h);
        var planned_h = step.planned && steps[idx-1].planned ? _diffHours(steps[idx-1].planned, step.planned) : null;
        if (planned_h !== null) {
          deltaClass = delta > parseFloat(planned_h) ? 'late' : 'on-time';
        }
      }
    }

    html += '<div class="timeline-step">';
    html += '<div class="timeline-dot ' + dotClass + '">' + (done ? '✓' : (idx + 1)) + '</div>';
    html += '<div class="timeline-card ' + cardClass + '">';
    html += '<div class="timeline-label">' + _esc(step.label) + '</div>';
    html += '<div class="timeline-times">';

    html += '<div class="timeline-time-item">';
    html += '<span class="tt-label">Planned</span>';
    html += '<span class="tt-val">' + _fmtDateTime(step.planned) + '</span>';
    html += '</div>';

    html += '<div class="timeline-time-item">';
    html += '<span class="tt-label">Actual</span>';
    html += '<span class="tt-val' + (done ? '' : ' late') + '">' + (done ? _fmtDateTime(step.actual) : 'Pending') + '</span>';
    html += '</div>';

    if (delta !== null) {
      html += '<div class="timeline-time-item">';
      html += '<span class="tt-label">Duration</span>';
      html += '<span class="tt-val">' + delta + 'h</span>';
      html += '</div>';
    }

    html += '</div>';

    if (delta !== null) {
      html += '<div class="timeline-delta ' + deltaClass + '">';
      html += deltaClass === 'late' ? '⚠ Delayed by ' + delta + 'h from prev step' : '✓ On time (' + delta + 'h from prev step)';
      html += '</div>';
    }

    html += '</div></div>';
  });

  html += '</div>';
  vc.innerHTML = html;
}

function _timelineChange(oid) {
  _timelineOID = oid;
  _renderTimeline();
}

// ────────────────────────────────────────────────────────────
//  SECTION 10 — VIEW: LIST
// ────────────────────────────────────────────────────────────

function _renderList() {
  var vc  = document.getElementById('view-container');
  var today = new Date().toISOString().substring(0, 10);

  var html = '<div class="filter-bar">';
  html += '<input type="search" placeholder="🔍 Quick search…" oninput="_listSearch(this.value)" />';
  html += '</div>';

  var orders = _filteredOrders().slice(0, 300);

  // Group by delivery date
  var groups = {};
  orders.forEach(function(o) {
    var d = String(o['Expected Delivery Date'] || '').substring(0, 10) || 'No Date';
    if (!groups[d]) groups[d] = [];
    groups[d].push(o);
  });

  var sortedDates = Object.keys(groups).sort().reverse();

  html += '<div class="list-feed">';

  sortedDates.forEach(function(date) {
    var grp = groups[date];
    var label = date === today ? '📅 Today — ' + date : date;
    html += '<div class="section-head" style="margin-top:8px"><h2>' + label + '</h2><span class="badge">' + grp.length + '</span></div>';

    grp.forEach(function(o) {
      html += '<div class="list-card" onclick="_openDetail(\'' + _esc(o['OrderID']) + '\')">';
      html += '<div class="list-card-left">';
      html += '<div class="list-card-id">' + _esc(o['OrderID']) + '</div>';
      html += '<div class="list-card-customer">' + _esc(_orderCustomer(o)) + '</div>';
      html += '<div class="list-card-meta">';
      if (o['Warehouse'])    html += '<span>🏭 ' + _esc(o['Warehouse']) + '</span>';
      if (o['Delivery Boy']) html += '<span>🚴 ' + _esc(o['Delivery Boy']) + '</span>';
      if (o['Crates Loaded']) html += '<span>📦 ' + o['Crates Loaded'] + ' crates</span>';
      html += '</div></div>';
      html += '<div class="list-card-right">' + _statusPill(o._status) + '</div>';
      html += '</div>';
    });
  });

  if (!orders.length) {
    html += '<div class="empty-state"><div class="empty-icon">📝</div><p>No orders match.</p></div>';
  }

  html += '</div>';
  vc.innerHTML = html;
}

function _listSearch(v) {
  _tblFilter.search = v;
  _renderList();
}

// ────────────────────────────────────────────────────────────
//  SECTION 11 — VIEW: GALLERY
// ────────────────────────────────────────────────────────────

function _renderGallery() {
  var vc = document.getElementById('view-container');

  var html = '<div class="gallery-tabs">';
  html += '<button class="gallery-tab-btn' + (_galleryMode === 'load' ? ' active' : '') + '" onclick="_galleryMode(\'load\')">📦 Loading Photos</button>';
  html += '<button class="gallery-tab-btn' + (_galleryMode === 'receive' ? ' active' : '') + '" onclick="_galleryMode(\'receive\')">✅ Delivery Photos</button>';
  html += '<button class="gallery-tab-btn' + (_galleryMode === 'pdfs' ? ' active' : '') + '" onclick="_galleryMode(\'pdfs\')">📄 Indent PDFs</button>';
  html += '</div>';

  if (_galleryMode === 'pdfs') {
    html += _renderGalleryPDFs();
  } else {
    var photoKey = _galleryMode === 'load' ? 'Photo' : 'Receiving Photo';
    var withPhoto = _D.orders.filter(function(o) { return !!o[photoKey]; });
    var without   = _D.orders.filter(function(o) { return !o[photoKey]; });

    html += '<div class="section-head"><h2>' + (photoKey === 'Photo' ? 'Loading' : 'Delivery') + ' Photos</h2>';
    html += '<span class="badge">' + withPhoto.length + ' / ' + _D.orders.length + '</span></div>';

    html += '<div class="gallery-grid">';
    withPhoto.slice(0, 100).forEach(function(o) {
      var p = String(o[photoKey] || '');
      var src = _photoSrc(p);
      html += '<div class="gallery-item" onclick="_galleryOpenPhoto(\'' + _esc(src) + '\',\'' + _esc(o['OrderID']) + '\')">';
      if (src) {
        html += '<img src="' + _esc(src) + '" alt="' + _esc(o['OrderID']) + '" loading="lazy" onerror="this.parentElement.innerHTML=\'<div class=gallery-placeholder><div class=ph-icon>🖼</div>' + _esc(o['OrderID']) + '</div>\'" />';
      } else {
        html += '<div class="gallery-placeholder"><div class="ph-icon">🖼</div><span>' + _esc(o['OrderID']) + '</span></div>';
      }
      html += '<div class="gallery-label">' + _esc(o['OrderID']) + '</div>';
      html += '</div>';
    });

    // Placeholder tiles for orders without photos
    without.slice(0, 20).forEach(function(o) {
      html += '<div class="gallery-item" onclick="_openDetail(\'' + _esc(o['OrderID']) + '\')" style="opacity:0.4">';
      html += '<div class="gallery-placeholder"><div class="ph-icon">📷</div><span style="font-size:8px">' + _esc(o['OrderID']) + '</span></div>';
      html += '</div>';
    });

    html += '</div>';
  }

  vc.innerHTML = html;
}

function _renderGalleryPDFs() {
  var html = '<div class="section-head"><h2>Indent PDFs</h2><span class="badge">' + _D.pdfs.length + '</span></div>';
  if (!_D.pdfs.length) return html + '<div class="empty-state"><div class="empty-icon">📄</div><p>No PDFs found.</p></div>';

  html += '<div style="display:flex;flex-direction:column;gap:8px">';
  _D.pdfs.forEach(function(p) {
    html += '<div class="list-card">';
    html += '<div class="list-card-left">';
    html += '<div class="list-card-id">📄 ' + _esc(p['PDF Name'] || '?') + '</div>';
    html += '<div class="list-card-meta"><span>' + _fmtDate(p['Date']) + '</span></div>';
    html += '</div>';
    if (p['PDF Link']) {
      html += '<div class="list-card-right"><a href="' + _esc(p['PDF Link']) + '" target="_blank" class="btn btn-sm btn-primary">Open</a></div>';
    }
    html += '</div>';
  });
  html += '</div>';
  return html;
}

window._galleryMode = function(m) {
  _galleryMode = m;
  _renderGallery();
};

function _photoSrc(p) {
  if (!p) return '';
  if (p.startsWith('http')) return p;
  if (APP_CONFIG.drivePhotoBase) return APP_CONFIG.drivePhotoBase + '/' + p;
  return '';   // path-only refs from AppSheet can't be resolved without base
}

window._galleryOpenPhoto = function(src, orderID) {
  if (!src) { _openDetail(orderID); return; }
  var mb = document.getElementById('modal-body');
  mb.innerHTML = '<img src="' + _esc(src) + '" style="width:100%;border-radius:8px" />' +
    '<div style="margin-top:10px;font-family:monospace;font-size:12px;color:var(--muted)">' + _esc(orderID) + '</div>';
  document.getElementById('modal-title').textContent = 'Photo — ' + orderID;
  _openModal();
};

// ────────────────────────────────────────────────────────────
//  SECTION 12 — VIEW: DETAIL (modal)
// ────────────────────────────────────────────────────────────

window._openDetail = function(orderID) {
  var order = _D.orders.find(function(o) { return String(o['OrderID']).trim() === String(orderID).trim(); });
  if (!order) { _toast('Order not found: ' + orderID, 'err'); return; }

  var items    = _D.orderDetails.filter(function(r) { return String(r['OrderID']).trim() === String(orderID).trim(); });
  var recItems = _D.receivedItems.filter(function(r) { return String(r['OrderID']).trim() === String(orderID).trim(); });
  var retItems = _D.returnedItems.filter(function(r) { return String(r['OrderID']).trim() === String(orderID).trim(); });

  document.getElementById('modal-title').textContent = orderID;

  var html = '';

  // ── Status banner ────────────────────────────────────────
  html += '<div style="margin-bottom:16px;display:flex;align-items:center;gap:10px">';
  html += _statusPill(order._status);
  html += '<span style="font-size:11px;color:var(--muted)">EDD: ' + _fmtDate(order['Expected Delivery Date']) + '</span>';
  html += '</div>';

  // ── Key-value grid ───────────────────────────────────────
  html += '<div class="detail-section">';
  html += '<div class="detail-section-title">Order Info</div>';
  html += '<div class="detail-kv-grid">';

  var kvPairs = [
    ['Order ID',       order['OrderID'],                     true],
    ['Customer',       _orderCustomer(order),                false],
    ['Location',       _orderLocation(order),                false],
    ['Warehouse',      order['Warehouse'],                    false],
    ['Delivery Boy',   order['Delivery Boy'],                 false],
    ['Vehicle No.',    order['Vehicle No.'],                  false],
    ['Crates Loaded',  order['Crates Loaded'],                false],
    ['Ret. Crates',    order['Returned Crates'],              false],
    ['Invoice No.',    order['Invoice'],                      true],
    ['WH Status',      order['WH Status'],                    false]
  ];

  kvPairs.forEach(function(kv) {
    html += '<div class="detail-kv">';
    html += '<div class="dk-label">' + _esc(kv[0]) + '</div>';
    html += '<div class="dk-val' + (kv[2] ? ' mono' : '') + '">' + _esc(kv[1] || '—') + '</div>';
    html += '</div>';
  });
  html += '</div></div>';

  // ── Order Items ──────────────────────────────────────────
  html += '<div class="detail-section">';
  html += '<div class="detail-section-title">Line Items (' + items.length + ')</div>';
  if (items.length) {
    html += '<table class="detail-items-table">';
    html += '<thead><tr><th>#</th><th>Item Name</th><th>Qty</th><th>Recv.</th></tr></thead><tbody>';
    items.forEach(function(it, idx) {
      var recv = recItems.find(function(r) { return r['Item Name'] === it['Item Name']; });
      html += '<tr>';
      html += '<td style="color:var(--text-dim)">' + (idx + 1) + '</td>';
      html += '<td>' + _esc(it['Item Name'] || '—') + '</td>';
      html += '<td style="font-family:monospace;color:var(--accent);font-weight:700">' + _fmtNum(it['Qty']) + '</td>';
      html += '<td style="font-family:monospace;color:var(--success)">' + (recv ? _fmtNum(recv['Qty']) : '—') + '</td>';
      html += '</tr>';
    });
    html += '</tbody></table>';
  } else {
    html += '<p style="color:var(--text-dim);font-size:12px">No line items found in local cache.</p>';
  }
  html += '</div>';

  // ── Returned Items ───────────────────────────────────────
  if (retItems.length) {
    html += '<div class="detail-section">';
    html += '<div class="detail-section-title">Returned Items (' + retItems.length + ')</div>';
    html += '<table class="detail-items-table"><thead><tr><th>Item</th><th>Qty</th></tr></thead><tbody>';
    retItems.forEach(function(it) {
      html += '<tr><td>' + _esc(it['Item Name'] || '—') + '</td>';
      html += '<td style="font-family:monospace;color:var(--warning)">' + _fmtNum(it['Qty']) + '</td></tr>';
    });
    html += '</tbody></table></div>';
  }

  // ── Photos ───────────────────────────────────────────────
  html += '<div class="detail-section">';
  html += '<div class="detail-section-title">Photos</div>';
  html += '<div class="detail-photos">';

  var loadSrc = _photoSrc(order['Photo']);
  var recvSrc = _photoSrc(order['Receiving Photo']);

  html += '<div class="detail-photo-box">';
  if (loadSrc) {
    html += '<img src="' + _esc(loadSrc) + '" alt="Loading photo" onclick="_galleryOpenPhoto(\'' + _esc(loadSrc) + '\',\'' + _esc(order['OrderID']) + '\')" style="cursor:zoom-in" />';
  } else {
    html += '<div style="font-size:24px">📦</div><span>Loading Photo</span><span style="font-size:9px;margin-top:2px;color:var(--text-dim)">' + _esc(order['Photo'] || 'not uploaded') + '</span>';
  }
  html += '</div>';

  html += '<div class="detail-photo-box">';
  if (recvSrc) {
    html += '<img src="' + _esc(recvSrc) + '" alt="Delivery photo" onclick="_galleryOpenPhoto(\'' + _esc(recvSrc) + '\',\'' + _esc(order['OrderID']) + '\')" style="cursor:zoom-in" />';
  } else {
    html += '<div style="font-size:24px">🚚</div><span>Delivery Photo</span><span style="font-size:9px;margin-top:2px;color:var(--text-dim)">' + _esc(order['Receiving Photo'] || 'not uploaded') + '</span>';
  }
  html += '</div>';

  html += '</div></div>';

  // ── Timeline mini ────────────────────────────────────────
  html += '<div class="detail-section">';
  html += '<div class="detail-section-title">Pipeline Steps</div>';
  html += '<div class="timeline-wrap" style="padding-left:24px">';

  var miniSteps = [
    { label: 'Created',            ts: order['Timestamp']      },
    { label: 'WH Loaded',          ts: order['_step1_actual']  },
    { label: 'Received/Delivered',  ts: order['_step2_actual']  },
    { label: 'Returns Collected',   ts: order['_step4_actual']  },
    { label: 'DEO Approved',        ts: order['_step5_actual']  },
    { label: 'Invoiced',            ts: order['_step6_actual']  }
  ];

  miniSteps.forEach(function(ms) {
    var done = !!ms.ts;
    html += '<div class="timeline-step">';
    html += '<div class="timeline-dot ' + (done ? 'done' : 'pending') + '">' + (done ? '✓' : '·') + '</div>';
    html += '<div style="font-size:12px;color:' + (done ? 'var(--text)' : 'var(--text-dim)') + '">';
    html += _esc(ms.label) + (ms.ts ? ' <span style="color:var(--muted);font-size:10px;font-family:monospace">(' + _fmtDateTime(ms.ts) + ')</span>' : '');
    html += '</div></div>';
  });

  html += '</div></div>';

  // ── Invoice link ─────────────────────────────────────────
  if (order['Invoice Link']) {
    html += '<div class="detail-section">';
    html += '<a href="' + _esc(order['Invoice Link']) + '" target="_blank" class="btn btn-primary" style="width:100%;justify-content:center">🧾 Open Invoice</a>';
    html += '</div>';
  }

  // ── Remark ───────────────────────────────────────────────
  if (order['Step4 Remark To Tally Items']) {
    html += '<div class="detail-section">';
    html += '<div class="detail-section-title">DEO Remark</div>';
    html += '<div style="background:var(--bg-card2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px;font-size:12px;color:var(--text)">' + _esc(order['Step4 Remark To Tally Items']) + '</div>';
    html += '</div>';
  }

  document.getElementById('modal-body').innerHTML = html;
  _openModal();
};

// ────────────────────────────────────────────────────────────
//  SECTION 13 — VIEW: PIVOT
// ────────────────────────────────────────────────────────────

function _renderPivot() {
  var vc = document.getElementById('view-container');

  var rowOptions = [
    { key: 'Warehouse',    label: 'Warehouse' },
    { key: 'Delivery Boy', label: 'Delivery Boy' },
    { key: '_status',      label: 'Status' }
  ];
  var colOptions = [
    { key: '_status',      label: 'Status' },
    { key: 'Warehouse',    label: 'Warehouse' },
    { key: 'Delivery Boy', label: 'Delivery Boy' }
  ];

  var html = '<div class="pivot-controls">';
  html += '<select onchange="_pivotRowChange(this.value)">';
  rowOptions.forEach(function(o) {
    html += '<option value="' + o.key + '"' + (_pivotRow === o.key ? ' selected' : '') + '>Rows: ' + o.label + '</option>';
  });
  html += '</select>';
  html += '<select onchange="_pivotColChange(this.value)">';
  colOptions.forEach(function(o) {
    html += '<option value="' + o.key + '"' + (_pivotCol === o.key ? ' selected' : '') + '>Cols: ' + o.label + '</option>';
  });
  html += '</select>';
  html += '</div>';

  // Build pivot
  var rowVals = _uniqueValues(_D.orders, _pivotRow === '_status' ? '__status' : _pivotRow);
  if (_pivotRow === '_status') rowVals = ['Pending','WH Loaded','Delivered','DEO Collected','DEO Approved','Invoiced'];
  var colVals = _uniqueValues(_D.orders, _pivotCol === '_status' ? '__status' : _pivotCol);
  if (_pivotCol === '_status') colVals = ['Pending','WH Loaded','Delivered','DEO Collected','DEO Approved','Invoiced'];

  // Collect unique values properly
  if (_pivotRow !== '_status') rowVals = _uniqueValues(_D.orders, _pivotRow);
  if (_pivotCol !== '_status') colVals = _uniqueValues(_D.orders, _pivotCol);

  var matrix = {};
  var rowTotals = {};
  var colTotals = {};
  _D.orders.forEach(function(o) {
    var rv = String(o[_pivotRow === '_status' ? '_status' : _pivotRow] || 'Unknown').trim();
    var cv = String(o[_pivotCol === '_status' ? '_status' : _pivotCol] || 'Unknown').trim();
    if (!matrix[rv]) matrix[rv] = {};
    matrix[rv][cv] = (matrix[rv][cv] || 0) + 1;
    rowTotals[rv]  = (rowTotals[rv]  || 0) + 1;
    colTotals[cv]  = (colTotals[cv]  || 0) + 1;
  });

  // All rows that have data
  var allRows = Object.keys(matrix).sort();
  var allCols = Object.keys(colTotals).sort();

  html += '<div class="pivot-table-wrap"><table class="pivot-table"><thead><tr>';
  html += '<th style="min-width:120px">↓ ' + _pivotRow + ' / → ' + _pivotCol + '</th>';
  allCols.forEach(function(c) { html += '<th>' + _esc(c) + '</th>'; });
  html += '<th class="pivot-total">Total</th>';
  html += '</tr></thead><tbody>';

  allRows.forEach(function(rv) {
    html += '<tr><td class="pivot-row-head">' + _esc(rv) + '</td>';
    allCols.forEach(function(cv) {
      var n = (matrix[rv] && matrix[rv][cv]) || 0;
      html += '<td style="text-align:center;' + (n > 0 ? 'color:var(--text)' : 'color:var(--text-dim)') + '">' + (n || '—') + '</td>';
    });
    html += '<td class="pivot-total" style="text-align:center">' + (rowTotals[rv] || 0) + '</td>';
    html += '</tr>';
  });

  // Col totals row
  html += '<tr><td class="pivot-total">Total</td>';
  allCols.forEach(function(c) { html += '<td class="pivot-total" style="text-align:center">' + (colTotals[c] || 0) + '</td>'; });
  html += '<td class="pivot-total" style="text-align:center">' + _D.orders.length + '</td>';
  html += '</tr>';

  html += '</tbody></table></div>';

  // Item-level pivot below
  html += '<div style="margin-top:20px">';
  html += '<div class="section-head"><h2>Top 20 Items by Indent Qty</h2></div>';

  var itemTotals = {};
  _D.indents.forEach(function(r) {
    var it = String(r['Item Name'] || '').trim().substring(0, 30);
    if (!it) return;
    itemTotals[it] = (itemTotals[it] || 0) + parseFloat(r['Qty'] || 0);
  });
  var topItems = Object.keys(itemTotals).sort(function(a,b) { return itemTotals[b] - itemTotals[a]; }).slice(0, 20);

  html += '<div class="pivot-table-wrap"><table class="pivot-table"><thead><tr><th>Item</th><th>Total Indent Qty</th></tr></thead><tbody>';
  topItems.forEach(function(it) {
    html += '<tr><td class="pivot-row-head">' + _esc(it) + '</td><td style="text-align:right">' + itemTotals[it].toLocaleString('en-IN') + '</td></tr>';
  });
  html += '</tbody></table></div></div>';

  vc.innerHTML = html;
}

window._pivotRowChange = function(v) { _pivotRow = v; _renderPivot(); };
window._pivotColChange = function(v) { _pivotCol = v; _renderPivot(); };

// ────────────────────────────────────────────────────────────
//  SECTION 14 — VIEW: MAP
// ────────────────────────────────────────────────────────────

function _renderMap() {
  var vc = document.getElementById('view-container');

  // Group by warehouse (delivery location UUIDs can't be geocoded without a lookup table)
  var whMap = {};
  _D.orders.forEach(function(o) {
    var w = String(o['Warehouse'] || 'Unknown').trim();
    if (!whMap[w]) whMap[w] = { orders: [], statuses: {} };
    whMap[w].orders.push(o);
    var s = o._status || 'Pending';
    whMap[w].statuses[s] = (whMap[w].statuses[s] || 0) + 1;
  });

  var html = '<div class="map-note">📍 Delivery locations are stored as AppSheet UUIDs. Showing warehouse groupings. For pin-map, add a "City" column to Orders sheet and share the updated URL.</div>';

  html += '<div class="location-cards">';

  Object.keys(whMap).forEach(function(wh) {
    var data = whMap[wh];
    var total = data.orders.length;
    var inv   = data.statuses['Invoiced'] || 0;
    var pct   = total ? Math.round((inv / total) * 100) : 0;

    html += '<div class="location-card" onclick="_mapDrilldown(\'' + _esc(wh) + '\')">';
    html += '<div class="loc-icon">🏭</div>';
    html += '<div class="loc-name">' + _esc(wh) + '</div>';
    html += '<div class="loc-count">' + total + ' orders · ' + pct + '% done</div>';

    // Mini status breakdown
    html += '<div style="margin-top:8px;display:flex;gap:4px;flex-wrap:wrap">';
    Object.keys(data.statuses).forEach(function(s) {
      html += _statusPill(s) + ' <span style="font-size:9px;color:var(--text-dim)">' + data.statuses[s] + '</span> ';
    });
    html += '</div></div>';
  });

  html += '</div>';

  // Reimbursement summary if any
  if (_D.reimbursements.length) {
    html += '<div style="margin-top:20px">';
    html += '<div class="section-head"><h2>Reimbursements</h2><span class="badge">' + _D.reimbursements.length + '</span></div>';
    html += '<div class="table-wrap"><table><thead><tr>';
    html += '<th>Date</th><th>By</th><th>Category</th><th>Amount</th><th>Method</th></tr></thead><tbody>';
    _D.reimbursements.slice(0, 50).forEach(function(r) {
      html += '<tr>';
      html += '<td>' + _fmtDate(r['Date']) + '</td>';
      html += '<td>' + _esc(r['Expense By'] || '—') + '</td>';
      html += '<td>' + _esc(r['Category'] || '—') + '</td>';
      html += '<td style="font-family:monospace;color:var(--accent)">₹' + _fmtNum(r['Amount']) + '</td>';
      html += '<td>' + _esc(r['Payment Method'] || '—') + '</td>';
      html += '</tr>';
    });
    html += '</tbody></table></div></div>';
  }

  vc.innerHTML = html;
}

window._mapDrilldown = function(wh) {
  var orders = _D.orders.filter(function(o) { return String(o['Warehouse'] || '').trim() === wh; });
  _showDayModal(wh + ' — All Orders', orders);
};

// ────────────────────────────────────────────────────────────
//  SECTION 15 — VIEW: TREE
// ────────────────────────────────────────────────────────────

function _renderTree() {
  var vc = document.getElementById('view-container');

  // Build: Customer → Orders → Items
  var customerMap = {};
  _D.orders.forEach(function(o) {
    var c = _orderCustomer(o);
    if (!customerMap[c]) customerMap[c] = [];
    customerMap[c].push(o);
  });

  // Build order→items lookup
  var itemsMap = {};
  _D.orderDetails.forEach(function(r) {
    var oid = String(r['OrderID'] || '').trim();
    if (!itemsMap[oid]) itemsMap[oid] = [];
    itemsMap[oid].push(r);
  });

  var customers = Object.keys(customerMap).sort();

  var html = '<div class="tree-root">';

  customers.forEach(function(cust, ci) {
    var orders    = customerMap[cust];
    var nodeId    = 'cust-' + ci;
    var totalQty  = 0;
    orders.forEach(function(o) {
      var its = itemsMap[o['OrderID']] || [];
      its.forEach(function(it) { totalQty += parseFloat(it['Qty'] || 0); });
    });

    html += '<div class="tree-node" id="' + nodeId + '">';
    html += '<div class="tree-node-header" onclick="_treeToggle(\'' + nodeId + '\')">';
    html += '<span class="tree-chevron">▶</span>';
    html += '<span class="tree-node-label">👤 ' + _esc(cust) + '</span>';
    html += '<span class="tree-node-count">' + orders.length + ' orders</span>';
    html += '</div>';
    html += '<div class="tree-node-children">';

    orders.slice(0, 30).forEach(function(o, oi) {
      var orderNodeId = nodeId + '-o' + oi;
      var its         = itemsMap[o['OrderID']] || [];

      html += '<div class="tree-order-node" id="' + orderNodeId + '">';
      html += '<div class="tree-order-header" onclick="_treeOrderToggle(\'' + orderNodeId + '\')">';
      html += '<span class="tree-chevron">▶</span>';
      html += '<span class="tree-order-id">' + _esc(o['OrderID']) + '</span>';
      html += '<span style="margin-left:8px">' + _statusPill(o._status) + '</span>';
      html += '<span class="tree-order-meta">' + its.length + ' items · ' + _fmtDate(o['Expected Delivery Date']) + '</span>';
      html += '</div>';

      html += '<div class="tree-order-items">';
      if (its.length) {
        its.forEach(function(it) {
          html += '<div class="tree-item-row">';
          html += '<span class="tree-item-name">' + _esc(it['Item Name'] || '—') + '</span>';
          html += '<span class="tree-item-qty">' + _fmtNum(it['Qty']) + '</span>';
          html += '</div>';
        });
      } else {
        html += '<div style="font-size:11px;color:var(--text-dim)">No items in cache</div>';
      }
      html += '</div></div>';
    });

    if (orders.length > 30) {
      html += '<div style="padding:8px;font-size:10px;color:var(--text-dim)">+' + (orders.length - 30) + ' more orders…</div>';
    }

    html += '</div></div>';
  });

  html += '</div>';
  vc.innerHTML = html;
}

window._treeToggle = function(nodeId) {
  var node = document.getElementById(nodeId);
  if (node) node.classList.toggle('open');
};

window._treeOrderToggle = function(nodeId) {
  var node = document.getElementById(nodeId);
  if (node) node.classList.toggle('open');
};

// ────────────────────────────────────────────────────────────
//  SECTION 16 — VIEW: PURCHASE
// ────────────────────────────────────────────────────────────

function _renderPurchase() {
  var vc = document.getElementById('view-container');

  // Purchase KPIs
  var totalSpend = 0;
  _D.purchasedItems.forEach(function(r) {
    totalSpend += (parseFloat(r['Qty'] || 0) * parseFloat(r['Rate'] || 0));
  });

  var vendorMap = {};
  _D.purchasedItems.forEach(function(r) {
    var v = String(r['Vendor'] || 'Unknown').trim();
    if (!vendorMap[v]) vendorMap[v] = { qty: 0, spend: 0, items: 0 };
    vendorMap[v].qty   += parseFloat(r['Qty']  || 0);
    vendorMap[v].spend += parseFloat(r['Qty']  || 0) * parseFloat(r['Rate'] || 0);
    vendorMap[v].items ++;
  });

  var html = '<div class="kpi-row">';
  html += '<div class="kpi-card accent1"><div class="kpi-label">Total Indents</div><div class="kpi-value">' + _D.indents.length.toLocaleString('en-IN') + '</div><div class="kpi-sub">purchase lines</div></div>';
  html += '<div class="kpi-card accent2"><div class="kpi-label">Purchased Items</div><div class="kpi-value">' + _D.purchasedItems.length.toLocaleString('en-IN') + '</div><div class="kpi-sub">line items</div></div>';
  html += '<div class="kpi-card accent3"><div class="kpi-label">Est. Spend</div><div class="kpi-value" style="font-size:18px">₹' + Math.round(totalSpend).toLocaleString('en-IN') + '</div><div class="kpi-sub">qty × rate</div></div>';
  html += '<div class="kpi-card"><div class="kpi-label">Vendors</div><div class="kpi-value">' + Object.keys(vendorMap).length + '</div><div class="kpi-sub">unique vendors</div></div>';
  html += '</div>';

  // Vendor breakdown table
  html += '<div class="section-head"><h2>Vendor Spend Summary</h2></div>';
  var vendors = Object.keys(vendorMap).sort(function(a,b) { return vendorMap[b].spend - vendorMap[a].spend; });
  html += '<div class="table-wrap"><table><thead><tr><th>Vendor ID</th><th>Items Bought</th><th>Total Qty</th><th>Est. Spend (₹)</th></tr></thead><tbody>';
  vendors.slice(0, 30).forEach(function(v) {
    var vd = vendorMap[v];
    html += '<tr>';
    html += '<td class="mono">' + _esc(v) + '</td>';
    html += '<td>' + vd.items + '</td>';
    html += '<td style="font-family:monospace">' + vd.qty.toLocaleString('en-IN') + '</td>';
    html += '<td style="font-family:monospace;color:var(--accent);font-weight:700">₹' + Math.round(vd.spend).toLocaleString('en-IN') + '</td>';
    html += '</tr>';
  });
  html += '</tbody></table></div>';

  // Recent Purchased Items
  html += '<div class="section-head" style="margin-top:20px"><h2>Recent Purchases</h2><span class="badge">' + _D.purchasedItems.length + '</span></div>';
  html += '<div class="table-wrap"><table><thead><tr><th>Timestamp</th><th>Indent ID</th><th>Item</th><th>Qty</th><th>Rate</th><th>Vendor</th></tr></thead><tbody>';
  _D.purchasedItems.slice(0, 100).forEach(function(r) {
    html += '<tr>';
    html += '<td style="font-size:10px;font-family:monospace">' + _fmtDateTime(r['Timestamp']) + '</td>';
    html += '<td class="mono">' + _esc(String(r['Indent_Id'] || '').substring(0, 20)) + '</td>';
    html += '<td>' + _esc(String(r['Item Name'] || '').substring(0, 20)) + '</td>';
    html += '<td style="text-align:right;font-family:monospace">' + _fmtNum(r['Qty']) + '</td>';
    html += '<td style="text-align:right;font-family:monospace">₹' + _fmtNum(r['Rate']) + '</td>';
    html += '<td class="mono">' + _esc(r['Vendor'] || '—') + '</td>';
    html += '</tr>';
  });
  html += '</tbody></table></div>';

  // Dump items if any
  if (_D.dumpItems.length) {
    html += '<div class="section-head" style="margin-top:20px"><h2>📦 Dump Entries</h2><span class="badge">' + _D.dumpItems.length + '</span></div>';
    html += '<div class="table-wrap"><table><thead><tr><th>Timestamp</th><th>User</th><th>Item</th><th>Qty</th><th>Reason</th></tr></thead><tbody>';
    _D.dumpItems.forEach(function(r) {
      html += '<tr>';
      html += '<td style="font-size:10px">' + _fmtDateTime(r['Timestamp']) + '</td>';
      html += '<td>' + _esc(r['Useremail'] || '—') + '</td>';
      html += '<td>' + _esc(r['Item'] || '—') + '</td>';
      html += '<td style="font-family:monospace">' + _fmtNum(r['Qty']) + '</td>';
      html += '<td>' + _esc(r['Reason'] || '—') + '</td>';
      html += '</tr>';
    });
    html += '</tbody></table></div>';
  }

  vc.innerHTML = html;
}

// ────────────────────────────────────────────────────────────
//  SECTION 17 — CSV EXPORT
// ────────────────────────────────────────────────────────────

function _exportCSV() {
  var rows = _filteredOrders();
  var cols = ['OrderID','Customer Name','Expected Delivery Date','Warehouse',
              'Delivery Boy','Vehicle No.','Crates Loaded','Returned Crates',
              'WH Status','Email Status','Invoice','_status'];

  var csv = cols.join(',') + '\n';
  rows.forEach(function(o) {
    csv += cols.map(function(c) {
      var v = String(o[c] || '').replace(/"/g, '""');
      return '"' + v + '"';
    }).join(',') + '\n';
  });

  var blob = new Blob([csv], { type: 'text/csv' });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href   = url;
  a.download = 'o2d-orders-' + new Date().toISOString().substring(0, 10) + '.csv';
  a.click();
  URL.revokeObjectURL(url);
  _toast('✓ CSV downloaded (' + rows.length + ' rows)', 'ok');
}

// ────────────────────────────────────────────────────────────
//  SECTION 18 — MODAL
// ────────────────────────────────────────────────────────────

function _openModal() {
  document.getElementById('modal-overlay').classList.add('open');
  document.getElementById('modal-sheet').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function _closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
  document.getElementById('modal-sheet').classList.remove('open');
  document.body.style.overflow = '';
}

// ────────────────────────────────────────────────────────────
//  SECTION 19 — UI UTILITIES
// ────────────────────────────────────────────────────────────

function _showOverlay(msg) {
  var el = document.getElementById('loading-overlay');
  var p  = document.getElementById('loading-msg');
  if (p)  p.textContent = msg || 'Loading…';
  if (el) el.classList.remove('hidden');
}

function _hideOverlay() {
  var el = document.getElementById('loading-overlay');
  if (el) el.classList.add('hidden');
}

function _setStatus(cls, txt) {
  var el = document.getElementById('data-status');
  if (!el) return;
  el.className = cls;
  el.textContent = txt;
}

var _toastTimer;
function _toast(msg, type) {
  var el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'show' + (type ? ' ' + type : '');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(function() {
    el.className = '';
  }, 3000);
}

// ────────────────────────────────────────────────────────────
//  SECTION 20 — BOOT & EVENT WIRING
// ────────────────────────────────────────────────────────────

function _boot() {
  // Tab switcher
  document.querySelectorAll('.view-tab').forEach(function(btn) {
    btn.addEventListener('click', function() {
      _switchView(this.dataset.view);
    });
  });

  // Refresh button
  var refreshBtn = document.getElementById('refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', function() {
      _loadAll(false);
    });
  }

  // Export button (top bar)
  var exportBtn = document.getElementById('export-btn');
  if (exportBtn) {
    exportBtn.addEventListener('click', function() {
      if (_currentView === 'table') _exportCSV();
      else { _switchView('table'); _toast('Switch to Table view for CSV export'); }
    });
  }

  // Modal close
  var closeBtn = document.getElementById('modal-close-btn');
  if (closeBtn) closeBtn.addEventListener('click', _closeModal);

  var overlay = document.getElementById('modal-overlay');
  if (overlay) overlay.addEventListener('click', _closeModal);

  // Swipe down to close modal
  var sheet    = document.getElementById('modal-sheet');
  var startY   = 0;
  if (sheet) {
    sheet.addEventListener('touchstart', function(e) {
      startY = e.touches[0].clientY;
    }, { passive: true });
    sheet.addEventListener('touchend', function(e) {
      if (e.changedTouches[0].clientY - startY > 80) _closeModal();
    }, { passive: true });
  }

  // Read URL param ?view=xxx
  var urlParams = new URLSearchParams(window.location.search);
  var initView  = urlParams.get('view') || APP_CONFIG.defaultView || 'kanban';

  // Check if GAS URL is configured
  if (!GAS_URL || GAS_URL === 'PASTE_YOUR_GAS_DEPLOYMENT_URL_HERE') {
    _hideOverlay();
    _setStatus('error', 'No URL');
    document.getElementById('view-container').innerHTML =
      '<div class="empty-state">' +
      '<div class="empty-icon">⚙️</div>' +
      '<p style="margin-bottom:12px"><strong>Setup Required</strong></p>' +
      '<p>Open <code style="background:var(--bg-card2);padding:2px 6px;border-radius:4px">apiconfig.js</code> and paste your GAS deployment URL into <code>GAS_URL</code>, then commit.</p>' +
      '</div>';
    return;
  }

  _currentView = initView;
  _loadAll(false);
}

// Fire after DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _boot);
} else {
  _boot();
}
