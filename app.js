// ============================================================
//  O2D Analytics — app.js  v3  (Masters-aware)
//  Requires: apiconfig.js loaded first
//  Backend now returns _customerName, _locationName,
//  _itemName, _vendName on all rows
// ============================================================

/* ── Global State ─────────────────────────────────────────── */
var _D = {
  orders:[], orderDetails:[], receivedItems:[],
  returnedItems:[], pdfs:[], indents:[],
  purchasedItems:[], reimbursements:[], dumpItems:[],
  masters:{ customers:[], locations:[], items:[], vendors:[] },
  lastTs: null
};

/* In-memory lookup maps (built from masters after load) */
var _M = { cust:{}, loc:{}, item:{}, vend:{} };

var _view    = 'kanban';
var _cbIdx   = 0;
var _charts  = {};
var _calYear = new Date().getFullYear();
var _calMonth= new Date().getMonth();
var _galMode = 'load';
var _tblPage = 1;
var _TBL_PER = 50;
var _tlOID   = '';
var _pivRow  = 'Customer';
var _pivCol  = '_status';
var _autoT   = null;
var _invLink = '';

var _F = {
  search:'', status:'', customer:'', location:'', deliveryBoy:'',
  dateFrom:'', dateTo:'', itemCat:'', hasCrates:'',
  hasPhoto:'', invoiced:'', wh:''
};

/* ── Pipeline constants ──────────────────────────────────────*/
var S_BADGE = {
  'Pending':       'badge-pending',
  'WH Loaded':     'badge-wh-loaded',
  'Delivered':     'badge-delivered',
  'DEO Collected': 'badge-deo',
  'DEO Approved':  'badge-approved',
  'Invoiced':      'badge-invoiced'
};

var KAN_COLS = [
  { key:'Pending',       label:'Pending',       color:'#6366F1', icon:'fa-hourglass-start' },
  { key:'WH Loaded',     label:'WH Loaded',     color:'#7C3AED', icon:'fa-box' },
  { key:'Delivered',     label:'Delivered',     color:'#F59E0B', icon:'fa-truck' },
  { key:'DEO Collected', label:'DEO Collected', color:'#4285F4', icon:'fa-check-circle' },
  { key:'DEO Approved',  label:'DEO Approved',  color:'#34A853', icon:'fa-clipboard-check' },
  { key:'Invoiced',      label:'Invoiced',      color:'#06B6D4', icon:'fa-file-invoice' }
];

// ═══════════════════════════════════════════════════════════
//  1. JSONP API
// ═══════════════════════════════════════════════════════════
function _api(action, data, ok, fail) {
  if (!GAS_URL || GAS_URL === 'PASTE_YOUR_GAS_DEPLOYMENT_URL_HERE') {
    toast('⚠ Set GAS_URL in apiconfig.js', 'err'); if (fail) fail({message:'GAS_URL not set'}); return;
  }
  var cbN = '_gcb' + (++_cbIdx), t;
  window[cbN] = function(r) {
    clearTimeout(t);
    var s=document.getElementById('_s_'+cbN); if(s) s.parentNode.removeChild(s);
    try{delete window[cbN];}catch(e){}
    if (ok) ok(r);
  };
  t = setTimeout(function(){
    try{delete window[cbN];}catch(e){}
    if (fail) fail({message:'Timed out ('+(APP_CONFIG.apiTimeoutMs||25000)/1000+'s)'});
  }, APP_CONFIG.apiTimeoutMs||25000);

  var url = GAS_URL+'?callback='+cbN+'&payload='+encodeURIComponent(JSON.stringify({action:action,data:data||{}}));
  var s = document.createElement('script');
  s.id='_s_'+cbN; s.src=url;
  s.onerror=function(){ clearTimeout(t); try{delete window[cbN];}catch(e){} if(fail) fail({message:'Network error'}); };
  document.head.appendChild(s);
}

// ═══════════════════════════════════════════════════════════
//  2. DATA LOAD
// ═══════════════════════════════════════════════════════════
function loadAll(silent) {
  setBadge('loading','Loading…');
  if (!silent) setLoader('Fetching O2D data + Masters…');
  var ico=document.getElementById('refresh-ico'); if(ico) ico.classList.add('spinning');

  _api('getAllData', {}, function(r) {
    if(ico) ico.classList.remove('spinning');
    hideLoader();
    if (!r||!r.success) { setBadge('error','Error'); toast('Load failed: '+(r&&r.error?r.error:'unknown'),'err'); return; }

    _D.orders         = r.orders         || [];
    _D.orderDetails   = r.orderDetails   || [];
    _D.receivedItems  = r.receivedItems  || [];
    _D.returnedItems  = r.returnedItems  || [];
    _D.pdfs           = r.pdfs           || [];
    _D.indents        = r.indents        || [];
    _D.purchasedItems = r.purchasedItems || [];
    _D.reimbursements = r.reimbursements || [];
    _D.dumpItems      = r.dumpItems      || [];
    _D.masters        = r.masters        || {customers:[],locations:[],items:[],vendors:[]};
    _D.lastTs         = r.ts || '';

    // Build fast lookup maps
    _D.masters.customers.forEach(function(c){ _M.cust[c.uid]=c.name; });
    _D.masters.locations.forEach(function(l){ _M.loc[l.uid]={name:l.name,custUID:l.custUID}; });
    _D.masters.items.forEach(function(i){ _M.item[i.uid]=i; });
    _D.masters.vendors.forEach(function(v){ _M.vend[v.uid]=v.name; });

    var ts = _D.lastTs ? _D.lastTs.substring(11,16) : '';
    setBadge('ok','✓ '+_D.orders.length+' orders · '+ts);
    var sbts=document.getElementById('sb-last-ts'); if(sbts) sbts.textContent='Updated '+ts;
    var sbk=document.getElementById('sb-badge-kanban'); if(sbk) sbk.textContent=_D.orders.length;

    toast('✓ '+_D.orders.length+' orders, '+_D.masters.customers.length+' customers loaded','ok');
    switchView(_view, true);
    _startAuto();
  }, function(e){
    if(ico) ico.classList.remove('spinning');
    hideLoader(); setBadge('error','Failed'); toast('API Error: '+e.message,'err');
  });
}

function _startAuto() {
  if(_autoT) clearInterval(_autoT);
  if(!APP_CONFIG.autoRefreshMs) return;
  _autoT=setInterval(function(){ loadAll(true); }, APP_CONFIG.autoRefreshMs);
}

// ═══════════════════════════════════════════════════════════
//  3. VIEW SWITCHER
// ═══════════════════════════════════════════════════════════
var VIEW_NAMES = {
  kanban:'Kanban Board', table:'Orders Table', list:'Feed / List',
  chart:'Charts & KPIs', calendar:'Calendar', timeline:'Order Timeline',
  gallery:'Photo Gallery', pivot:'Pivot Table', map:'Location Map',
  tree:'Customer Tree', purchase:'Purchase / Indent'
};

function switchView(name, skipReset) {
  _view=name; if(!skipReset) _tblPage=1;
  document.querySelectorAll('.sb-nav-item').forEach(function(el){ el.classList.toggle('active', el.dataset.view===name); });
  document.querySelectorAll('#view-tabs .vtab').forEach(function(el){ el.classList.toggle('active', el.dataset.view===name); });
  var at=document.querySelector('#view-tabs .vtab.active'); if(at) at.scrollIntoView({block:'nearest',inline:'center',behavior:'smooth'});
  var tb=document.getElementById('tb-view-name'); if(tb) tb.textContent=VIEW_NAMES[name]||name;
  Object.keys(_charts).forEach(function(k){ try{_charts[k].destroy();}catch(e){} delete _charts[k]; });

  var c=document.getElementById('content'); if(!c) return;
  if (!_D.orders.length && name!=='purchase') {
    c.innerHTML = gasUrlNotSet()
      ? '<div class="empty"><i class="fas fa-cog" style="font-size:48px;color:var(--teal)"></i><p>Setup Required</p><small>Set <code>GAS_URL</code> in <strong>apiconfig.js</strong> then push to GitHub.</small></div>'
      : '<div class="empty"><i class="fas fa-satellite-dish"></i><p>No data loaded</p><small>Click Refresh to fetch data from Google Sheets.</small></div>';
    return;
  }
  var fn={kanban:renderKanban,table:renderTable,list:renderList,chart:renderChart,calendar:renderCalendar,timeline:renderTimeline,gallery:renderGallery,pivot:renderPivot,map:renderMap,tree:renderTree,purchase:renderPurchase}[name];
  if(fn) fn(); else c.innerHTML='<div class="empty"><i class="fas fa-tools"></i><p>'+name+'</p></div>';
}
function gasUrlNotSet(){ return !GAS_URL||GAS_URL==='PASTE_YOUR_GAS_DEPLOYMENT_URL_HERE'; }

// ═══════════════════════════════════════════════════════════
//  4. HELPERS
// ═══════════════════════════════════════════════════════════
function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function fmtDate(s)  { return s?String(s).substring(0,10):'—'; }
function fmtDT(s)    { return s?String(s).substring(0,16).replace('T',' '):'—'; }
function fmtNum(n)   { var v=parseFloat(n); return isNaN(v)?'—':v.toLocaleString('en-IN'); }
function diffH(a,b)  { if(!a||!b) return null; return ((new Date(b)-new Date(a))/3600000).toFixed(1); }
function today()     { return new Date().toISOString().substring(0,10); }

/* Resolved name accessors — use _customerName/_locationName if set by backend */
function custName(o) { return o._customerName || _M.cust[String(o['Customer Name']||'').trim()] || o['Customer Name'] || o['Warehouse'] || '—'; }
function locName(o)  { return o._locationName  || (_M.loc[String(o['Delivery Location']||'').trim()]&&_M.loc[String(o['Delivery Location']||'').trim()].name) || o['Delivery Location'] || o['Warehouse'] || '—'; }
function itemName(r) { return r._itemName || _M.item[String(r['Item Name']||'').trim()]&&_M.item[String(r['Item Name']||'').trim()].name || r['Item Name'] || '—'; }
function vendName(r) { return r._vendName || _M.vend[String(r['Vendor']||'').trim()] || r['Vendor'] || '—'; }

function uniq(arr,key){ var s={},r=[]; arr.forEach(function(x){ var v=String(x[key]||'').trim(); if(v&&!s[v]){s[v]=1;r.push(v);}}); return r.sort(); }
function sBadge(s)   { return '<span class="badge '+(S_BADGE[s]||'badge-pending')+'">'+esc(s||'Pending')+'</span>'; }
function photoSrc(p) { if(!p) return ''; if(p.startsWith('http')) return p; if(APP_CONFIG.drivePhotoBase) return APP_CONFIG.drivePhotoBase+'/'+p; return ''; }

/* Apply all active filters */
function filtered() {
  return _D.orders.filter(function(o){
    if (_F.status    && o._status !== _F.status) return false;
    if (_F.wh        && o['Warehouse'] !== _F.wh) return false;
    if (_F.deliveryBoy && o['Delivery Boy'] !== _F.deliveryBoy) return false;
    if (_F.customer  && custName(o) !== _F.customer) return false;
    if (_F.location  && locName(o)  !== _F.location) return false;
    if (_F.dateFrom  && fmtDate(o['Expected Delivery Date']) < _F.dateFrom) return false;
    if (_F.dateTo    && fmtDate(o['Expected Delivery Date']) > _F.dateTo)   return false;
    if (_F.hasCrates === 'yes' && !o['Crates Loaded']) return false;
    if (_F.hasCrates === 'no'  &&  o['Crates Loaded']) return false;
    if (_F.hasPhoto  === 'yes' && !o['Photo'])         return false;
    if (_F.hasPhoto  === 'no'  &&  o['Photo'])         return false;
    if (_F.invoiced  === 'yes' && !o['Invoice'])       return false;
    if (_F.invoiced  === 'no'  &&  o['Invoice'])       return false;
    if (_F.search) {
      var q=_F.search.toLowerCase();
      var h=[o['OrderID'],custName(o),locName(o),o['Delivery Boy'],o._status,o['Invoice']||'',o['Vehicle No.']||''].join(' ').toLowerCase();
      if(h.indexOf(q)===-1) return false;
    }
    return true;
  });
}

/* Filter bar HTML */
function filterBar(opts){
  opts=opts||{};
  var boys = uniq(_D.orders,'Delivery Boy');
  var whs  = uniq(_D.orders,'Warehouse');
  /* Build unique customer names from resolved field */
  var custSet={},custList=[];
  _D.orders.forEach(function(o){ var n=custName(o); if(n&&n!=='—'&&!custSet[n]){custSet[n]=1;custList.push(n);} });
  custList.sort();
  /* Build unique location names */
  var locSet={},locList=[];
  _D.orders.forEach(function(o){ var n=locName(o); if(n&&n!=='—'&&!locSet[n]){locSet[n]=1;locList.push(n);} });
  locList.sort();

  var html='<div class="filter-bar-compact">';

  /* Search */
  html+='<div class="fb-group" style="flex:3;min-width:220px"><div class="fb-label"><i class="fas fa-search" style="margin-right:3px"></i>Search</div>';
  html+='<div style="position:relative"><i class="fas fa-search" style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--sub);font-size:11px;pointer-events:none"></i>';
  html+='<input class="form-input" style="padding-left:30px;height:34px;font-size:12px" type="search" placeholder="Order ID, customer, item, vehicle…" value="'+esc(_F.search)+'" oninput="_fs(\'search\',this.value)"></div></div>';

  /* Status */
  html+='<div class="fb-group"><div class="fb-label">Status</div><select class="form-input" onchange="_fs(\'status\',this.value)">';
  html+='<option value="">All Status</option>';
  ['Pending','WH Loaded','Delivered','DEO Collected','DEO Approved','Invoiced'].forEach(function(s){ html+='<option value="'+s+'"'+(_F.status===s?' selected':'')+'>'+s+'</option>'; });
  html+='</select></div>';

  /* Customer — from resolved names */
  if(custList.length){
    html+='<div class="fb-group"><div class="fb-label">Customer</div><select class="form-input" onchange="_fs(\'customer\',this.value)">';
    html+='<option value="">All</option>';
    custList.slice(0,80).forEach(function(n){ html+='<option value="'+esc(n)+'"'+(_F.customer===n?' selected':'')+'>'+esc(n)+'</option>'; });
    html+='</select></div>';
  }

  /* Location */
  if(locList.length){
    html+='<div class="fb-group"><div class="fb-label">Location</div><select class="form-input" onchange="_fs(\'location\',this.value)">';
    html+='<option value="">All</option>';
    locList.slice(0,80).forEach(function(n){ html+='<option value="'+esc(n)+'"'+(_F.location===n?' selected':'')+'>'+esc(n)+'</option>'; });
    html+='</select></div>';
  }

  /* Delivery Boy */
  if(boys.length){
    html+='<div class="fb-group"><div class="fb-label">Delivery Boy</div><select class="form-input" onchange="_fs(\'deliveryBoy\',this.value)">';
    html+='<option value="">All</option>';
    boys.forEach(function(b){ html+='<option value="'+esc(b)+'"'+(_F.deliveryBoy===b?' selected':'')+'>'+esc(b)+'</option>'; });
    html+='</select></div>';
  }

  if(!opts.compact){
    /* Warehouse */
    if(whs.length){
      html+='<div class="fb-group"><div class="fb-label">Warehouse</div><select class="form-input" onchange="_fs(\'wh\',this.value)">';
      html+='<option value="">All</option>';
      whs.forEach(function(w){ html+='<option value="'+esc(w)+'"'+(_F.wh===w?' selected':'')+'>'+esc(w)+'</option>'; });
      html+='</select></div>';
    }
    /* Date range */
    html+='<div class="fb-group"><div class="fb-label">EDD From</div><input class="form-input" type="date" value="'+esc(_F.dateFrom)+'" onchange="_fs(\'dateFrom\',this.value)"></div>';
    html+='<div class="fb-group"><div class="fb-label">EDD To</div><input class="form-input" type="date" value="'+esc(_F.dateTo)+'" onchange="_fs(\'dateTo\',this.value)"></div>';
    /* Photo */
    html+='<div class="fb-group"><div class="fb-label">Loading Photo</div><select class="form-input" onchange="_fs(\'hasPhoto\',this.value)"><option value="">Any</option><option value="yes"'+(_F.hasPhoto==='yes'?' selected':'')+'>Has Photo</option><option value="no"'+(_F.hasPhoto==='no'?' selected':'')+'>No Photo</option></select></div>';
    /* Invoice */
    html+='<div class="fb-group"><div class="fb-label">Invoice</div><select class="form-input" onchange="_fs(\'invoiced\',this.value)"><option value="">Any</option><option value="yes"'+(_F.invoiced==='yes'?' selected':'')+'>Invoiced</option><option value="no"'+(_F.invoiced==='no'?' selected':'')+'>Not Invoiced</option></select></div>';
    /* Crates */
    html+='<div class="fb-group"><div class="fb-label">Crates</div><select class="form-input" onchange="_fs(\'hasCrates\',this.value)"><option value="">Any</option><option value="yes"'+(_F.hasCrates==='yes'?' selected':'')+'>Has Crates</option><option value="no"'+(_F.hasCrates==='no'?' selected':'')+'>No Crates</option></select></div>';
  }

  html+='<div class="fb-group" style="flex:none"><div class="fb-label">&nbsp;</div><div style="display:flex;gap:6px"><button class="btn btn-secondary btn-sm" onclick="_clearF()"><i class="fas fa-times"></i> Clear</button></div></div>';
  html+='</div>';

  /* Active filter chips */
  var active=Object.keys(_F).filter(function(k){return _F[k];});
  if(active.length){
    html+='<div class="filter-row" style="margin-bottom:8px">';
    active.forEach(function(k){ html+='<span class="fpill active teal">'+esc(k)+': '+esc(_F[k])+' <i class="fas fa-times" style="cursor:pointer;margin-left:4px" onclick="_fs(\''+k+'\',\'\')"></i></span>'; });
    html+='</div>';
  }
  return html;
}

window._fs=function(k,v){ _F[k]=v; _tblPage=1; var fn={table:renderTable,list:renderList,kanban:renderKanban}[_view]; if(fn)fn(); };
window._clearF=function(){ Object.keys(_F).forEach(function(k){_F[k]='';_tblPage=1;}); switchView(_view); };

// ═══════════════════════════════════════════════════════════
//  5. KANBAN
// ═══════════════════════════════════════════════════════════
function renderKanban(){
  var c=document.getElementById('content');
  var rows=filtered();
  var grp={}; KAN_COLS.forEach(function(col){grp[col.key]=[];});
  rows.forEach(function(o){ var s=o._status||'Pending'; if(!grp[s])grp[s]=[]; grp[s].push(o); });

  var html=filterBar({compact:true});
  html+='<div id="kanban-board">';
  KAN_COLS.forEach(function(col){
    var cards=grp[col.key]||[];
    html+='<div class="k-col">';
    html+='<div class="k-col-head"><div class="k-col-dot" style="background:'+col.color+'"></div>';
    html+='<i class="fas '+col.icon+'" style="color:'+col.color+';font-size:12px"></i>';
    html+='<span style="color:'+col.color+'">'+esc(col.label)+'</span>';
    html+='<span class="k-col-count">'+cards.length+'</span></div>';
    html+='<div class="k-col-body scroll">';
    if(!cards.length){
      html+='<div style="padding:20px;text-align:center;font-size:11px;color:var(--sub)"><i class="fas fa-inbox" style="font-size:22px;display:block;margin-bottom:6px;opacity:.4"></i>No orders</div>';
    } else {
      cards.slice(0,40).forEach(function(o){
        var edd=fmtDate(o['Expected Delivery Date']); var isT=edd===today();
        html+='<div class="k-card" onclick="openDetail(\''+esc(o['OrderID'])+'\')">';
        html+='<div class="k-card-id">'+esc(o['OrderID'])+'</div>';
        html+='<div class="k-card-cust" title="'+esc(custName(o))+'">'+esc(custName(o))+'</div>';
        html+='<div style="font-size:10px;color:var(--muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="'+esc(locName(o))+'">📍 '+esc(locName(o))+'</div>';
        html+='<div class="k-card-meta">';
        html+='<span class="k-chip"><i class="fas fa-calendar'+(isT?' style="color:var(--teal)"':'')+'"></i> '+edd+'</span>';
        if(o['Delivery Boy'])  html+='<span class="k-chip"><i class="fas fa-motorcycle"></i> '+esc(o['Delivery Boy'])+'</span>';
        if(o['Crates Loaded']) html+='<span class="k-chip"><i class="fas fa-box"></i> '+o['Crates Loaded']+'</span>';
        if(o['Invoice'])       html+='<span class="k-chip" style="color:var(--teal)"><i class="fas fa-file-invoice"></i> INV</span>';
        html+='</div></div>';
      });
      if(cards.length>40) html+='<div style="padding:8px;text-align:center;font-size:10px;color:var(--sub)">+' +(cards.length-40)+' more → Table view</div>';
    }
    html+='</div></div>';
  });
  html+='</div>';
  c.innerHTML=html;
}

// ═══════════════════════════════════════════════════════════
//  6. TABLE
// ═══════════════════════════════════════════════════════════
var _tblSort={col:'Expected Delivery Date',dir:-1};

function renderTable(){
  var c=document.getElementById('content');
  var rows=filtered();
  rows.sort(function(a,b){
    var av=String(a[_tblSort.col]||a._status||''), bv=String(b[_tblSort.col]||b._status||'');
    return av<bv?-_tblSort.dir:av>bv?_tblSort.dir:0;
  });
  var total=rows.length, start=(_tblPage-1)*_TBL_PER, pRows=rows.slice(start,start+_TBL_PER), tPages=Math.ceil(total/_TBL_PER)||1;

  var cols=[
    {key:'OrderID',               label:'Order ID'},
    {key:'_customerName',         label:'Customer'},
    {key:'_locationName',         label:'Delivery Location'},
    {key:'Expected Delivery Date',label:'EDD'},
    {key:'Delivery Boy',          label:'Del. Boy'},
    {key:'Vehicle No.',           label:'Vehicle'},
    {key:'Crates Loaded',         label:'Crates'},
    {key:'Returned Crates',       label:'Ret.'},
    {key:'Invoice',               label:'Invoice'},
    {key:'_status',               label:'Status'}
  ];

  var html=filterBar({});
  html+='<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">';
  html+='<div style="font-size:12px;color:var(--muted)"><strong style="color:var(--text)">'+total+'</strong> orders · Showing '+(start+1)+'–'+Math.min(start+_TBL_PER,total)+'</div>';
  html+='<button class="btn btn-secondary btn-sm" onclick="exportCSV()"><i class="fas fa-file-csv"></i> Export</button></div>';

  html+='<div class="tbl-wrap"><table class="tbl"><thead><tr>';
  cols.forEach(function(col){
    var sorted=_tblSort.col===col.key;
    html+='<th class="'+(sorted?'sorted':'')+'" onclick="_ts2(\''+col.key+'\')">'+esc(col.label)+'<span class="sort-ico">'+(sorted?(_tblSort.dir===1?'▲':'▼'):'↕')+'</span></th>';
  });
  html+='<th></th></tr></thead><tbody>';

  if(!pRows.length){
    html+='<tr><td colspan="'+(cols.length+1)+'" style="text-align:center;padding:32px;color:var(--muted)"><i class="fas fa-inbox" style="font-size:22px;display:block;margin-bottom:8px;opacity:.4"></i>No matching orders</td></tr>';
  } else {
    pRows.forEach(function(o){
      html+='<tr onclick="openDetail(\''+esc(o['OrderID'])+'\')">';
      html+='<td class="mono">'+esc(o['OrderID'])+'</td>';
      html+='<td>'+esc(custName(o))+'</td>';
      html+='<td>'+esc(locName(o))+'</td>';
      html+='<td>'+fmtDate(o['Expected Delivery Date'])+'</td>';
      html+='<td>'+esc(o['Delivery Boy']||'—')+'</td>';
      html+='<td style="font-family:monospace;font-size:11px">'+esc(o['Vehicle No.']||'—')+'</td>';
      html+='<td class="num">'+fmtNum(o['Crates Loaded'])+'</td>';
      html+='<td class="num">'+fmtNum(o['Returned Crates'])+'</td>';
      html+='<td style="font-size:11px;font-family:monospace">'+esc(o['Invoice']||'—')+'</td>';
      html+='<td>'+sBadge(o._status)+'</td>';
      html+='<td onclick="event.stopPropagation()"><button class="act-btn ab-view" onclick="openDetail(\''+esc(o['OrderID'])+'\')" title="View Detail"><i class="fas fa-eye"></i></button></td>';
      html+='</tr>';
    });
  }
  html+='</tbody></table>';
  html+='<div class="pager"><div class="pager-info">'+total+' orders, page '+_tblPage+' of '+tPages+'</div>';
  html+='<div class="pager-btns">';
  html+='<button class="pager-btn" '+(_tblPage<=1?'disabled':'')+' onclick="_pg(1)"><i class="fas fa-angle-double-left"></i></button>';
  html+='<button class="pager-btn" '+(_tblPage<=1?'disabled':'')+' onclick="_pg('+(_tblPage-1)+')"><i class="fas fa-angle-left"></i></button>';
  html+='<span class="pager-page">'+_tblPage+' / '+tPages+'</span>';
  html+='<button class="pager-btn" '+(_tblPage>=tPages?'disabled':'')+' onclick="_pg('+(_tblPage+1)+')"><i class="fas fa-angle-right"></i></button>';
  html+='<button class="pager-btn" '+(_tblPage>=tPages?'disabled':'')+' onclick="_pg('+tPages+')"><i class="fas fa-angle-double-right"></i></button>';
  html+='</div></div></div>';
  c.innerHTML=html;
}
window._ts2=function(col){ if(_tblSort.col===col)_tblSort.dir*=-1; else{_tblSort.col=col;_tblSort.dir=1;} _tblPage=1; renderTable(); };
window._pg=function(p){ _tblPage=p; renderTable(); };

// ═══════════════════════════════════════════════════════════
//  7. LIST
// ═══════════════════════════════════════════════════════════
function renderList(){
  var c=document.getElementById('content');
  var rows=filtered(); var todayStr=today();
  var grp={}; rows.forEach(function(o){ var d=fmtDate(o['Expected Delivery Date'])||'No Date'; if(!grp[d])grp[d]=[]; grp[d].push(o); });
  var dates=Object.keys(grp).sort().reverse();
  var html=filterBar({compact:true});
  html+='<div class="list-feed">';
  dates.forEach(function(d){
    var g=grp[d]; var isT=d===todayStr;
    html+='<div class="sec-hd" style="margin-top:10px">';
    html+='<h3>'+(isT?'<i class="fas fa-star" style="color:var(--teal)"></i> Today — ':'')+d+'</h3>';
    html+='<span class="cnt">'+g.length+'</span><div class="line"></div></div>';
    g.forEach(function(o){
      html+='<div class="list-card" onclick="openDetail(\''+esc(o['OrderID'])+'\')">';
      html+='<div class="list-card-left">';
      html+='<div class="list-card-id">'+esc(o['OrderID'])+'</div>';
      html+='<div class="list-card-cust">'+esc(custName(o))+'</div>';
      html+='<div style="font-size:11px;color:var(--teal);margin-top:1px">📍 '+esc(locName(o))+'</div>';
      html+='<div class="list-card-meta">';
      if(o['Delivery Boy'])  html+='<span><i class="fas fa-motorcycle"></i> '+esc(o['Delivery Boy'])+'</span>';
      if(o['Crates Loaded']) html+='<span><i class="fas fa-box"></i> '+o['Crates Loaded']+' crates</span>';
      if(o['Vehicle No.'])   html+='<span><i class="fas fa-truck"></i> '+esc(o['Vehicle No.'])+'</span>';
      if(o['Invoice'])       html+='<span style="color:var(--teal)"><i class="fas fa-file-invoice"></i> '+esc(o['Invoice'])+'</span>';
      html+='</div></div>';
      html+='<div class="list-card-right">'+sBadge(o._status)+'</div></div>';
    });
  });
  if(!rows.length) html+='<div class="empty"><i class="fas fa-inbox"></i><p>No matching orders</p></div>';
  html+='</div>';
  c.innerHTML=html;
}

// ═══════════════════════════════════════════════════════════
//  8. CHART
// ═══════════════════════════════════════════════════════════
function renderChart(){
  var c=document.getElementById('content');
  var sc={},crT=0,crR=0,tod=0;
  _D.orders.forEach(function(o){
    var s=o._status||'Pending'; sc[s]=(sc[s]||0)+1;
    crT+=parseFloat(o['Crates Loaded']||0); crR+=parseFloat(o['Returned Crates']||0);
    if(fmtDate(o['Expected Delivery Date'])===today()) tod++;
  });
  var spend=0;
  _D.purchasedItems.forEach(function(r){ spend+=parseFloat(r['Qty']||0)*parseFloat(r['Rate']||0); });

  var kpis=[
    {l:'Total Orders',v:_D.orders.length,s:'all time',cls:'sc-teal'},
    {l:"Today's EDD",v:tod,s:'expected today',cls:'sc-green'},
    {l:'Invoiced',v:sc['Invoiced']||0,s:'pipeline done',cls:'sc-blue'},
    {l:'DEO Approved',v:sc['DEO Approved']||0,s:'approved',cls:'sc-cyan'},
    {l:'Pending',v:sc['Pending']||0,s:'not dispatched',cls:'sc-amber'},
    {l:'WH Loaded',v:sc['WH Loaded']||0,s:'en route',cls:'sc-purple'},
    {l:'Crates Out',v:Math.round(crT),s:'total loaded',cls:'sc-slate'},
    {l:'Crates Back',v:Math.round(crR),s:'returned',cls:'sc-red'},
    {l:'Customers',v:_D.masters.customers.length,s:'master records',cls:'sc-teal'},
    {l:'Locations',v:_D.masters.locations.length,s:'delivery points',cls:'sc-green'},
    {l:'Items',v:_D.masters.items.length,s:'catalogue items',cls:'sc-blue'},
    {l:'Est. Spend',v:'₹'+Math.round(spend/1000)+'K',s:'qty×rate',cls:'sc-amber',raw:true}
  ];

  var html='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:12px;margin-bottom:24px">';
  kpis.forEach(function(k){
    html+='<div class="stat-card '+k.cls+'"><div class="stat-label">'+k.l+'</div><div class="stat-val" style="font-size:'+(k.raw?'18':'24')+'px">'+(k.raw?k.v:typeof k.v==='number'?k.v.toLocaleString('en-IN'):k.v)+'</div><div class="stat-sub">'+k.s+'</div></div>';
  });
  html+='</div>';

  html+='<div class="chart-grid">';
  html+='<div class="chart-card"><h3><i class="fas fa-chart-pie" style="color:var(--teal);margin-right:5px"></i>Orders by Status</h3><canvas id="ch-s" height="220"></canvas></div>';
  html+='<div class="chart-card"><h3><i class="fas fa-chart-bar" style="color:var(--blue);margin-right:5px"></i>Daily Volume (Last 14 Days)</h3><canvas id="ch-d" height="220"></canvas></div>';
  html+='<div class="chart-card"><h3><i class="fas fa-boxes" style="color:var(--green);margin-right:5px"></i>Indent vs Purchased (Top 15 Items)</h3><canvas id="ch-i" height="220"></canvas></div>';
  html+='<div class="chart-card"><h3><i class="fas fa-motorcycle" style="color:var(--amber);margin-right:5px"></i>Delivery Boy Performance</h3><canvas id="ch-b" height="220"></canvas></div>';
  html+='<div class="chart-card"><h3><i class="fas fa-box" style="color:var(--purple);margin-right:5px"></i>Crates Loaded vs Returned</h3><canvas id="ch-c" height="220"></canvas></div>';
  html+='<div class="chart-card"><h3><i class="fas fa-users" style="color:var(--cyan);margin-right:5px"></i>Top 10 Customers by Orders</h3><canvas id="ch-cust" height="220"></canvas></div>';
  html+='</div>';
  c.innerHTML=html;

  var go={color:'#64748B',plugins:{legend:{labels:{color:'#64748B',font:{size:11,family:'Inter'}}},tooltip:{backgroundColor:'#1E293B',borderColor:'#334155',borderWidth:1,titleColor:'#F8FAFC',bodyColor:'#94A3B8',padding:10}},scales:{x:{ticks:{color:'#94A3B8',font:{size:10}},grid:{color:'rgba(0,0,0,.04)'}},y:{ticks:{color:'#94A3B8',font:{size:10}},grid:{color:'rgba(0,0,0,.06)'}}}};

  /* Status donut */
  var sl=Object.keys(sc), sc2=['#6366F1','#7C3AED','#F59E0B','#4285F4','#34A853','#06B6D4','#EA4335'];
  mkChart('ch-s','doughnut',{labels:sl,datasets:[{data:sl.map(function(k){return sc[k];}),backgroundColor:sc2.slice(0,sl.length),borderWidth:0}]},{plugins:go.plugins,cutout:'65%'});

  /* Daily bar */
  var dm={}; _D.orders.forEach(function(o){ var d=fmtDate(o['Expected Delivery Date']); if(d)dm[d]=(dm[d]||0)+1; });
  var dd=Object.keys(dm).sort().slice(-14);
  mkChart('ch-d','bar',{labels:dd.map(function(d){return d.substring(5);}),datasets:[{label:'Orders',data:dd.map(function(d){return dm[d];}),backgroundColor:'rgba(14,124,134,.75)',borderColor:'#0E7C86',borderWidth:1,borderRadius:5}]},go);

  /* Indent vs purchased — USE RESOLVED ITEM NAMES */
  var im={};
  _D.indents.forEach(function(r){ var n=itemName(r).substring(0,20); if(!n||n==='—')return; if(!im[n])im[n]={i:0,p:0}; im[n].i+=parseFloat(r['Qty']||0); });
  _D.purchasedItems.forEach(function(r){ var n=itemName(r).substring(0,20); if(!n||n==='—')return; if(!im[n])im[n]={i:0,p:0}; im[n].p+=parseFloat(r['Qty']||0); });
  var ik=Object.keys(im).sort(function(a,b){return(im[b].i+im[b].p)-(im[a].i+im[a].p);}).slice(0,15);
  mkChart('ch-i','bar',{labels:ik,datasets:[{label:'Indented',data:ik.map(function(k){return im[k].i;}),backgroundColor:'rgba(99,102,241,.75)',borderRadius:3},{label:'Purchased',data:ik.map(function(k){return im[k].p;}),backgroundColor:'rgba(52,168,83,.75)',borderRadius:3}]},Object.assign({},go,{indexAxis:'y'}));

  /* Delivery boy */
  var bm={}; _D.orders.forEach(function(o){ var b=String(o['Delivery Boy']||'?').trim(); if(!bm[b])bm[b]={d:0,p:0}; if(['Invoiced','DEO Approved','DEO Collected','Delivered'].indexOf(o._status)>=0)bm[b].d++;else bm[b].p++; });
  var bk=Object.keys(bm);
  mkChart('ch-b','bar',{labels:bk,datasets:[{label:'Completed',data:bk.map(function(k){return bm[k].d;}),backgroundColor:'rgba(52,168,83,.8)',borderRadius:4},{label:'Pending',data:bk.map(function(k){return bm[k].p;}),backgroundColor:'rgba(234,67,53,.7)',borderRadius:4}]},go);

  /* Crates */
  var cm={}; _D.orders.forEach(function(o){ var d=fmtDate(o['Expected Delivery Date']); if(!d)return; if(!cm[d])cm[d]={l:0,r:0}; cm[d].l+=parseFloat(o['Crates Loaded']||0); cm[d].r+=parseFloat(o['Returned Crates']||0); });
  var cd=Object.keys(cm).sort().slice(-14);
  mkChart('ch-c','line',{labels:cd.map(function(d){return d.substring(5);}),datasets:[{label:'Loaded',data:cd.map(function(d){return cm[d].l;}),borderColor:'#0E7C86',backgroundColor:'rgba(14,124,134,.08)',fill:true,tension:.4,pointRadius:3},{label:'Returned',data:cd.map(function(d){return cm[d].r;}),borderColor:'#34A853',backgroundColor:'rgba(52,168,83,.08)',fill:true,tension:.4,pointRadius:3}]},go);

  /* Top customers — USE RESOLVED NAMES */
  var custM={};
  _D.orders.forEach(function(o){ var n=custName(o); if(n&&n!=='—') custM[n]=(custM[n]||0)+1; });
  var ck=Object.keys(custM).sort(function(a,b){return custM[b]-custM[a];}).slice(0,10);
  mkChart('ch-cust','bar',{labels:ck.map(function(n){return n.length>18?n.substring(0,18)+'…':n;}),datasets:[{label:'Orders',data:ck.map(function(k){return custM[k];}),backgroundColor:'rgba(6,182,212,.75)',borderRadius:4}]},Object.assign({},go,{indexAxis:'y'}));
}
function mkChart(id,type,data,opts){
  var el=document.getElementById(id); if(!el)return;
  try{_charts[id]=new Chart(el,{type:type,data:data,options:Object.assign({responsive:true,maintainAspectRatio:false},opts||{})});}catch(e){console.warn('Chart',id,e);}
}

// ═══════════════════════════════════════════════════════════
//  9. CALENDAR
// ═══════════════════════════════════════════════════════════
function renderCalendar(){
  var c=document.getElementById('content');
  var dm={}; _D.orders.forEach(function(o){ var d=fmtDate(o['Expected Delivery Date']); if(d){if(!dm[d])dm[d]=[];dm[d].push(o);} });
  var todayStr=today(),months=['January','February','March','April','May','June','July','August','September','October','November','December'],days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  var y=_calYear,m=_calMonth,fd=new Date(y,m,1).getDay(),tot=new Date(y,m+1,0).getDate();
  var html='<div class="cal-nav"><button class="cal-nav-btn" onclick="calPrev()"><i class="fas fa-chevron-left"></i></button>';
  html+='<div class="cal-month-label">'+months[m]+' '+y+'</div>';
  html+='<button class="cal-nav-btn" onclick="calNext()"><i class="fas fa-chevron-right"></i></button></div>';
  html+='<div class="cal-grid">';
  days.forEach(function(d){html+='<div class="cal-day-name">'+d+'</div>';});
  for(var i=0;i<fd;i++) html+='<div class="cal-cell empty"></div>';
  for(var d2=1;d2<=tot;d2++){
    var ds=y+'-'+String(m+1).padStart(2,'0')+'-'+String(d2).padStart(2,'0');
    var ords=dm[ds]||[],isT=ds===todayStr;
    html+='<div class="cal-cell'+(isT?' today':'')+'" onclick="calDay(\''+ds+'\')" title="'+ds+': '+ords.length+' orders">';
    html+='<div class="cal-day-num">'+d2+'</div>';
    if(ords.length){
      html+='<div class="cal-dots">';
      if(ords.length<=4){ords.forEach(function(o){var col={Pending:'#6366F1','WH Loaded':'#7C3AED',Delivered:'#F59E0B','DEO Approved':'#34A853',Invoiced:'#06B6D4'}[o._status]||'#4285F4';html+='<div class="cal-dot" style="background:'+col+'" title="'+esc(o['OrderID'])+'"></div>';});}
      else html+='<div class="cal-dot-many" style="background:var(--teal)">'+ords.length+'</div>';
      html+='</div>';
    }
    html+='</div>';
  }
  html+='</div>';
  var mTot=0; Object.keys(dm).forEach(function(d){if(d.substring(0,7)===y+'-'+String(m+1).padStart(2,'0'))mTot+=dm[d].length;});
  html+='<div style="text-align:center;margin-top:14px;font-size:12px;color:var(--muted)">'+mTot+' orders scheduled in '+months[m]+' '+y+'</div>';
  c.innerHTML=html;
}
window.calPrev=function(){_calMonth--;if(_calMonth<0){_calMonth=11;_calYear--;}renderCalendar();};
window.calNext=function(){_calMonth++;if(_calMonth>11){_calMonth=0;_calYear++;}renderCalendar();};
window.calDay=function(ds){
  var ords=_D.orders.filter(function(o){return fmtDate(o['Expected Delivery Date'])===ds;});
  if(!ords.length){toast('No orders on '+ds);return;}
  var html='<div style="display:flex;flex-direction:column;gap:8px">';
  ords.forEach(function(o){html+='<div class="list-card" onclick="document.getElementById(\'day-modal\').classList.remove(\'show\');openDetail(\''+esc(o['OrderID'])+'\')"><div class="list-card-left"><div class="list-card-id">'+esc(o['OrderID'])+'</div><div class="list-card-cust">'+esc(custName(o))+'</div><div style="font-size:10px;color:var(--teal)">📍 '+esc(locName(o))+'</div></div><div class="list-card-right">'+sBadge(o._status)+'</div></div>';});
  html+='</div>';
  document.getElementById('day-modal-title').textContent='Orders — '+ds+' ('+ords.length+')';
  document.getElementById('day-modal-body').innerHTML=html;
  document.getElementById('day-modal').classList.add('show');
};

// ═══════════════════════════════════════════════════════════
//  10. TIMELINE
// ═══════════════════════════════════════════════════════════
function renderTimeline(){
  var c=document.getElementById('content');
  var order=_tlOID?_D.orders.find(function(o){return o['OrderID']===_tlOID;}):_D.orders[0];
  var html='<div style="margin-bottom:16px"><select class="form-input" style="max-width:480px" onchange="_tlSel(this.value)">';
  html+='<option value="">— Select an order —</option>';
  _D.orders.slice(0,300).forEach(function(o){html+='<option value="'+esc(o['OrderID'])+'"'+(order&&o['OrderID']===order['OrderID']?' selected':'')+'>'+esc(o['OrderID'])+' · '+esc(custName(o))+'</option>';});
  html+='</select></div>';
  if(!order){html+='<div class="empty"><i class="fas fa-stream"></i><p>Select an order above</p></div>';c.innerHTML=html;return;}

  html+='<div class="card card-p" style="margin-bottom:20px"><div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">';
  html+='<div><div class="stat-label">Order</div><div style="font-size:16px;font-weight:800;color:var(--teal);font-family:monospace">'+esc(order['OrderID'])+'</div></div>';
  html+='<div><div class="stat-label">Customer</div><div style="font-weight:600;font-size:13px">'+esc(custName(order))+'</div></div>';
  html+='<div><div class="stat-label">Location</div><div style="font-weight:600;font-size:13px;color:var(--teal)">'+esc(locName(order))+'</div></div>';
  html+='<div><div class="stat-label">EDD</div><div style="font-weight:600">'+fmtDate(order['Expected Delivery Date'])+'</div></div>';
  html+='<div>'+sBadge(order._status)+'</div>';
  if(order['Delivery Boy']) html+='<div><div class="stat-label">Del. Boy</div><div style="font-weight:600">'+esc(order['Delivery Boy'])+'</div></div>';
  html+='</div></div>';

  var steps=[
    {label:'Order Created',           p:order['Timestamp'],      a:order['Timestamp']},
    {label:'WH Loaded & Dispatched',  p:order['_step1_planned'], a:order['_step1_actual']},
    {label:'Delivered & Received',    p:order['_step2_planned'], a:order['_step2_actual']},
    {label:'Returns Collected by DEO',p:order['_step4_planned'], a:order['_step4_actual']},
    {label:'Approved by DEO',         p:order['_step5_planned'], a:order['_step5_actual']},
    {label:'Invoiced',                p:order['_step6_planned'], a:order['_step6_actual']}
  ];
  html+='<div class="tl-wrap">';
  steps.forEach(function(step,idx){
    var done=!!step.a,delta=null,dCls='';
    if(idx>0&&steps[idx-1].a&&step.a){delta=parseFloat(diffH(steps[idx-1].a,step.a));dCls=delta>24?'late':'on-time';}
    html+='<div class="tl-step">';
    html+='<div class="tl-dot '+(done?(dCls==='late'?'late':'done'):'')+'">'+(done?'<i class="fas fa-check" style="font-size:7px"></i>':(idx+1))+'</div>';
    html+='<div class="tl-card '+(done?(dCls==='late'?'late':'done'):'')+'">';
    html+='<div class="tl-label">'+esc(step.label)+'</div>';
    html+='<div class="tl-times">';
    html+='<div class="tl-time-item"><div class="tl-time-label">Planned</div><div class="tl-time-val">'+fmtDT(step.p)+'</div></div>';
    html+='<div class="tl-time-item"><div class="tl-time-label">Actual</div><div class="tl-time-val'+(done?'':' pending')+'">'+(done?fmtDT(step.a):'Pending…')+'</div></div>';
    if(delta!==null) html+='<div class="tl-time-item"><div class="tl-time-label">Duration</div><div class="tl-time-val">'+delta+'h</div></div>';
    html+='</div>';
    if(delta!==null) html+='<div class="tl-delta '+dCls+'"><i class="fas fa-'+(dCls==='late'?'exclamation-triangle':'check')+'" style="margin-right:4px"></i>'+(dCls==='late'?'Delayed by '+delta+'h':'On time ('+delta+'h from prev step)')+'</div>';
    html+='</div></div>';
  });
  html+='</div>';
  c.innerHTML=html;
}
window._tlSel=function(oid){_tlOID=oid;renderTimeline();};

// ═══════════════════════════════════════════════════════════
//  11. GALLERY
// ═══════════════════════════════════════════════════════════
function renderGallery(){
  var c=document.getElementById('content');
  var html='<div class="gallery-tabs">';
  html+='<button class="gal-tab'+(_galMode==='load'?' active':'')+'" onclick="_gm(\'load\')"><i class="fas fa-box" style="margin-right:5px"></i>Loading Photos</button>';
  html+='<button class="gal-tab'+(_galMode==='recv'?' active':'')+'" onclick="_gm(\'recv\')"><i class="fas fa-check-circle" style="margin-right:5px"></i>Delivery Photos</button>';
  html+='<button class="gal-tab'+(_galMode==='pdf'?' active':'')+'"  onclick="_gm(\'pdf\')" ><i class="fas fa-file-pdf" style="margin-right:5px"></i>Indent PDFs</button>';
  html+='</div>';
  if(_galMode==='pdf'){html+=galPDFs();c.innerHTML=html;return;}
  var pKey=_galMode==='load'?'Photo':'Receiving Photo';
  var withP=_D.orders.filter(function(o){return!!o[pKey];}),without=_D.orders.filter(function(o){return!o[pKey];});
  html+='<div class="sec-hd"><h3>'+(_galMode==='load'?'Loading':'Delivery')+' Photos</h3><span class="cnt">'+withP.length+' / '+_D.orders.length+'</span><div class="line"></div></div>';
  html+='<div class="gal-grid">';
  withP.slice(0,120).forEach(function(o){
    var src=photoSrc(o[pKey]);
    html+='<div class="gal-item" onclick="_go(\''+esc(src)+'\',\''+esc(o['OrderID'])+'\')">';
    if(src) html+='<img src="'+esc(src)+'" alt="'+esc(o['OrderID'])+'" loading="lazy" onerror="this.style.display=\'none\';this.nextSibling.style.display=\'flex\'" />';
    html+='<div class="gal-placeholder" style="'+(src?'display:none':'')+'" ><i class="fas fa-camera"></i><span>'+esc(o['OrderID'])+'</span></div>';
    html+='<div class="gal-lbl">'+esc(custName(o).substring(0,18))+'</div></div>';
  });
  without.slice(0,30).forEach(function(o){
    html+='<div class="gal-item" style="opacity:.3" onclick="openDetail(\''+esc(o['OrderID'])+'\')" title="No photo: '+esc(o['OrderID'])+'"><div class="gal-placeholder"><i class="fas fa-ban"></i><span style="font-size:8px">'+esc(o['OrderID'])+'</span></div></div>';
  });
  html+='</div>';
  if(withP.length>120) html+='<div style="text-align:center;margin-top:12px;font-size:12px;color:var(--muted)">Showing 120 of '+withP.length+' photos</div>';
  c.innerHTML=html;
}
function galPDFs(){
  if(!_D.pdfs.length) return '<div class="empty"><i class="fas fa-file-pdf"></i><p>No PDFs found</p></div>';
  var html='<div style="display:flex;flex-direction:column;gap:8px">';
  _D.pdfs.forEach(function(p){html+='<div class="list-card"><div class="list-card-left"><div class="list-card-id"><i class="fas fa-file-pdf" style="color:var(--red);margin-right:4px"></i>'+esc(p['PDF Name']||'?')+'</div><div class="list-card-meta"><span><i class="fas fa-calendar"></i> '+fmtDate(p['Date'])+'</span></div></div>'+(p['PDF Link']?'<div class="list-card-right"><a href="'+esc(p['PDF Link'])+'" target="_blank" class="btn btn-primary btn-sm"><i class="fas fa-external-link-alt"></i> Open</a></div>':'')+'</div>';});
  return html+'</div>';
}
window._gm=function(m){_galMode=m;renderGallery();};
window._go=function(src,oid){
  if(!src){openDetail(oid);return;}
  document.getElementById('detail-title').textContent='Photo — '+oid;
  document.getElementById('detail-sub').textContent='';
  document.getElementById('detail-body').innerHTML='<img src="'+esc(src)+'" style="width:100%;border-radius:10px"/>';
  document.getElementById('detail-invoice-btn').style.display='none';
  document.getElementById('detail-overlay').classList.add('show');
};

// ═══════════════════════════════════════════════════════════
//  12. ORDER DETAIL DRAWER
// ═══════════════════════════════════════════════════════════
window.openDetail=function(oid){
  var order=_D.orders.find(function(o){return String(o['OrderID']).trim()===String(oid).trim();});
  if(!order){toast('Order not found: '+oid,'err');return;}
  var items   =_D.orderDetails.filter(function(r){return String(r['OrderID']).trim()===String(oid).trim();});
  var recItems=_D.receivedItems.filter(function(r){return String(r['OrderID']).trim()===String(oid).trim();});
  var retItems=_D.returnedItems.filter(function(r){return String(r['OrderID']).trim()===String(oid).trim();});

  document.getElementById('detail-title').textContent=order['OrderID'];
  document.getElementById('detail-sub').innerHTML=esc(custName(order))+' &nbsp;·&nbsp; '+sBadge(order._status);
  _invLink=order['Invoice Link']||'';
  document.getElementById('detail-invoice-btn').style.display=_invLink?'':'none';

  var html='';

  /* Header banner */
  html+='<div class="info-box teal" style="margin-bottom:16px">';
  html+='<i class="fas fa-map-marker-alt"></i>';
  html+='<div><strong>'+esc(locName(order))+'</strong><div style="font-size:11px;margin-top:2px">'+esc(custName(order))+'</div></div></div>';

  /* Order KVs */
  html+='<div class="sec-hd"><h3>Order Info</h3><div class="line"></div></div>';
  html+='<div class="kv-grid">';
  [
    ['Order ID',      order['OrderID'],                    true ],
    ['Customer',      custName(order),                     false],
    ['Location',      locName(order),                      false],
    ['Warehouse',     order['Warehouse'],                   false],
    ['EDD',           fmtDate(order['Expected Delivery Date']),false],
    ['Delivery Boy',  order['Delivery Boy'],                false],
    ['Vehicle No.',   order['Vehicle No.'],                 false],
    ['Crates Loaded', order['Crates Loaded'],               false],
    ['Ret. Crates',   order['Returned Crates'],             false],
    ['Invoice No.',   order['Invoice'],                     true ],
    ['WH Status',     order['WH Status'],                   false],
    ['Email Status',  order['Email Status'],                false]
  ].forEach(function(kv){
    html+='<div class="kv-item"><div class="kv-label">'+esc(kv[0])+'</div><div class="kv-val'+(kv[2]?' mono':'')+'">'+esc(kv[1]||'—')+'</div></div>';
  });
  html+='</div>';

  /* Line items with resolved names */
  html+='<div class="sec-hd" style="margin-top:16px"><h3>Line Items</h3><span class="cnt">'+items.length+'</span><div class="line"></div></div>';
  if(items.length){
    html+='<div class="tbl-wrap"><table class="tbl"><thead><tr><th>#</th><th>Item</th><th>Category</th><th>Unit</th><th class="num">Ordered</th><th class="num">Received</th></tr></thead><tbody>';
    items.forEach(function(it,idx){
      var rv=recItems.find(function(r){return r['Item Name']===it['Item Name'];});
      var info=it._itemInfo||(_M.item[String(it['Item Name']||'').trim()])||{};
      html+='<tr><td style="color:var(--sub)">'+(idx+1)+'</td>';
      html+='<td><div style="font-weight:600">'+esc(itemName(it))+'</div><div style="font-size:9px;color:var(--sub);font-family:monospace">'+esc(it['Item Name']||'')+'</div></td>';
      html+='<td><span class="badge" style="background:#F1F5F9;color:var(--slate);border:1px solid var(--border)">'+esc(info.cat||'—')+'</span></td>';
      html+='<td style="color:var(--muted);font-size:11px">'+esc(info.unit||'—')+'</td>';
      html+='<td class="num" style="color:var(--teal);font-weight:700">'+fmtNum(it['Qty'])+'</td>';
      html+='<td class="num" style="color:var(--green)">'+(rv?fmtNum(rv['Qty']):'—')+'</td></tr>';
    });
    html+='</tbody></table></div>';
  } else {
    html+='<div class="empty" style="padding:20px"><i class="fas fa-inbox"></i><p style="font-size:12px">No items in local cache</p></div>';
  }

  /* Returned items with names */
  if(retItems.length){
    html+='<div class="sec-hd" style="margin-top:14px"><h3>Returned Items</h3><span class="cnt">'+retItems.length+'</span><div class="line"></div></div>';
    html+='<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Item</th><th class="num">Qty</th></tr></thead><tbody>';
    retItems.forEach(function(it){html+='<tr><td>'+esc(itemName(it))+'</td><td class="num" style="color:var(--amber-d)">'+fmtNum(it['Qty'])+'</td></tr>';});
    html+='</tbody></table></div>';
  }

  /* Photos */
  html+='<div class="sec-hd" style="margin-top:14px"><h3>Photos</h3><div class="line"></div></div>';
  html+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">';
  var lSrc=photoSrc(order['Photo']),rSrc=photoSrc(order['Receiving Photo']);
  ['Loading','Delivery'].forEach(function(type){
    var src=type==='Loading'?lSrc:rSrc;
    var orig=type==='Loading'?order['Photo']:order['Receiving Photo'];
    html+='<div style="aspect-ratio:4/3;background:#F8FAFC;border:1px solid var(--border);border-radius:10px;overflow:hidden;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:6px;color:var(--sub)">';
    if(src) html+='<img src="'+esc(src)+'" style="width:100%;height:100%;object-fit:cover;cursor:zoom-in" onclick="_go(\''+esc(src)+'\',\''+esc(order['OrderID'])+'\')" />';
    else html+='<i class="fas fa-'+(type==='Loading'?'box':'truck')+'" style="font-size:22px"></i><span style="font-size:10px">'+type+' Photo</span><span style="font-size:9px;color:var(--sub)">'+esc(orig||'Not uploaded')+'</span>';
    html+='</div>';
  });
  html+='</div>';

  /* Mini timeline */
  html+='<div class="sec-hd"><h3>Pipeline Steps</h3><div class="line"></div></div>';
  html+='<div class="tl-wrap">';
  [{l:'Created',t:order['Timestamp']},{l:'WH Loaded',t:order['_step1_actual']},{l:'Delivered',t:order['_step2_actual']},{l:'Returns Collected',t:order['_step4_actual']},{l:'DEO Approved',t:order['_step5_actual']},{l:'Invoiced',t:order['_step6_actual']}].forEach(function(s){
    html+='<div class="tl-step"><div class="tl-dot '+(s.t?'done':'')+'">'+(s.t?'<i class="fas fa-check" style="font-size:7px"></i>':'·')+'</div>';
    html+='<div style="font-size:12px;color:'+(s.t?'var(--text)':'var(--sub)')+';padding:4px 0">'+esc(s.l)+(s.t?' <span style="color:var(--muted);font-size:10px;font-family:monospace">('+fmtDT(s.t)+')</span>':'')+'</div></div>';
  });
  html+='</div>';

  /* DEO Remark */
  if(order['Step4 Remark To Tally Items']){
    html+='<div class="sec-hd" style="margin-top:14px"><h3>DEO Remark</h3><div class="line"></div></div>';
    html+='<div class="info-box teal"><i class="fas fa-info-circle"></i><div>'+esc(order['Step4 Remark To Tally Items'])+'</div></div>';
  }

  document.getElementById('detail-body').innerHTML=html;
  document.getElementById('detail-overlay').classList.add('show');
};
window.closeDetail=function(){document.getElementById('detail-overlay').classList.remove('show');};
window.openInvoice=function(){if(_invLink)window.open(_invLink,'_blank');};

// ═══════════════════════════════════════════════════════════
//  13. PIVOT
// ═══════════════════════════════════════════════════════════
function renderPivot(){
  var c=document.getElementById('content');
  var rOpts=[{k:'Customer',l:'Customer (resolved)'},{k:'Delivery Boy',l:'Delivery Boy'},{k:'_status',l:'Status'},{k:'Warehouse',l:'Warehouse'}];
  var cOpts=[{k:'_status',l:'Status'},{k:'Customer',l:'Customer'},{k:'Delivery Boy',l:'Delivery Boy'},{k:'Warehouse',l:'Warehouse'}];
  var html='<div style="display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap">';
  html+='<div class="fb-group"><div class="fb-label">Rows</div><select class="form-input" onchange="_pR(this.value)">';
  rOpts.forEach(function(o){html+='<option value="'+o.k+'"'+(_pivRow===o.k?' selected':'')+'>'+o.l+'</option>';});
  html+='</select></div><div class="fb-group"><div class="fb-label">Columns</div><select class="form-input" onchange="_pC(this.value)">';
  cOpts.forEach(function(o){html+='<option value="'+o.k+'"'+(_pivCol===o.k?' selected':'')+'>'+o.l+'</option>';});
  html+='</select></div></div>';

  /* Build matrix using RESOLVED customer names */
  var mat={},rT={},cT={};
  _D.orders.forEach(function(o){
    var rv=(_pivRow==='Customer'?custName(o):String(o[_pivRow]||'Unknown')).trim()||'Unknown';
    var cv=(_pivCol==='Customer'?custName(o):String(o[_pivCol]||'Unknown')).trim()||'Unknown';
    if(!mat[rv])mat[rv]={};
    mat[rv][cv]=(mat[rv][cv]||0)+1;
    rT[rv]=(rT[rv]||0)+1;
    cT[cv]=(cT[cv]||0)+1;
  });
  /* Sort rows by total desc */
  var rows=Object.keys(mat).sort(function(a,b){return rT[b]-rT[a];}).slice(0,30);
  var cols=Object.keys(cT).sort();

  html+='<div class="pivot-wrap"><table class="pivot"><thead><tr><th>↓ '+esc(_pivRow)+' / → '+esc(_pivCol)+'</th>';
  cols.forEach(function(col){html+='<th>'+esc(col)+'</th>';});
  html+='<th class="pivot-total">Total</th></tr></thead><tbody>';
  rows.forEach(function(rv){
    html+='<tr><td class="pivot-row-head" title="'+esc(rv)+'">'+esc(rv.length>30?rv.substring(0,30)+'…':rv)+'</td>';
    cols.forEach(function(cv){var n=(mat[rv]&&mat[rv][cv])||0;html+='<td class="num'+(n?'':' zero')+'">'+(n||'—')+'</td>';});
    html+='<td class="num pivot-total">'+(rT[rv]||0)+'</td></tr>';
  });
  html+='<tr><td class="pivot-total">Total</td>';
  cols.forEach(function(cv){html+='<td class="num pivot-total">'+(cT[cv]||0)+'</td>';});
  html+='<td class="num pivot-total">'+_D.orders.length+'</td></tr>';
  html+='</tbody></table></div>';
  if(Object.keys(mat).length>30) html+='<div style="text-align:center;margin-top:8px;font-size:11px;color:var(--sub)">Showing top 30 rows of '+Object.keys(mat).length+'</div>';

  /* Item pivot with resolved names */
  var iMap={};
  _D.indents.forEach(function(r){var n=itemName(r);if(!n||n==='—')return;iMap[n]=(iMap[n]||0)+parseFloat(r['Qty']||0);});
  var iKeys=Object.keys(iMap).sort(function(a,b){return iMap[b]-iMap[a];}).slice(0,25);
  html+='<div class="sec-hd" style="margin-top:20px"><h3>Top 25 Items by Indent Qty</h3><div class="line"></div></div>';
  html+='<div class="pivot-wrap"><table class="pivot"><thead><tr><th>Item Name</th><th>Total Indent Qty</th></tr></thead><tbody>';
  iKeys.forEach(function(it){html+='<tr><td class="pivot-row-head">'+esc(it)+'</td><td class="num">'+iMap[it].toLocaleString('en-IN')+'</td></tr>';});
  html+='</tbody></table></div>';
  c.innerHTML=html;
}
window._pR=function(v){_pivRow=v;renderPivot();};
window._pC=function(v){_pivCol=v;renderPivot();};

// ═══════════════════════════════════════════════════════════
//  14. MAP / LOCATION
// ═══════════════════════════════════════════════════════════
function renderMap(){
  var c=document.getElementById('content');
  /* Group by resolved location name */
  var lm={};
  _D.orders.forEach(function(o){
    var ln=locName(o)||'Unknown';
    if(!lm[ln])lm[ln]={orders:[],sc:{}};
    lm[ln].orders.push(o);
    var s=o._status||'Pending'; lm[ln].sc[s]=(lm[ln].sc[s]||0)+1;
  });
  var locKeys=Object.keys(lm).sort(function(a,b){return lm[b].orders.length-lm[a].orders.length;});

  var html='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;margin-bottom:20px">';
  html+='<div class="stat-card sc-teal"><div class="stat-label">Locations</div><div class="stat-val">'+locKeys.length+'</div><div class="stat-sub">delivery points</div></div>';
  html+='<div class="stat-card sc-green"><div class="stat-label">Customers</div><div class="stat-val">'+_D.masters.customers.length+'</div><div class="stat-sub">master records</div></div>';
  html+='<div class="stat-card sc-blue"><div class="stat-label">Orders</div><div class="stat-val">'+_D.orders.length+'</div><div class="stat-sub">total</div></div>';
  html+='</div>';

  html+='<div class="loc-cards">';
  locKeys.slice(0,60).forEach(function(ln){
    var d=lm[ln];var total=d.orders.length;var inv=d.sc['Invoiced']||0;var pct=total?Math.round(inv/total*100):0;
    html+='<div class="loc-card" onclick="_locDrill(\''+esc(ln)+'\')">';
    html+='<div class="loc-icon"><i class="fas fa-map-marker-alt" style="color:var(--teal)"></i></div>';
    html+='<div class="loc-name" title="'+esc(ln)+'">'+esc(ln.length>28?ln.substring(0,28)+'…':ln)+'</div>';
    html+='<div class="loc-count">'+total+' orders</div>';
    html+='<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:3px">';
    Object.keys(d.sc).forEach(function(s){html+=sBadge(s)+'<span style="font-size:9px;color:var(--muted);margin-right:3px">'+d.sc[s]+'</span>';});
    html+='</div>';
    html+='<div class="loc-bar"><div class="loc-bar-fill" style="width:'+pct+'%"></div></div>';
    html+='<div style="font-size:10px;color:var(--muted);margin-top:4px">'+pct+'% invoiced</div>';
    html+='</div>';
  });
  html+='</div>';

  /* Reimbursements */
  if(_D.reimbursements.length){
    html+='<div class="sec-hd" style="margin-top:24px"><h3>Reimbursements</h3><span class="cnt">'+_D.reimbursements.length+'</span><div class="line"></div></div>';
    html+='<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th>By</th><th>Category</th><th>Method</th><th class="num">Amount</th></tr></thead><tbody>';
    _D.reimbursements.slice(0,50).forEach(function(r){html+='<tr><td>'+fmtDate(r['Date'])+'</td><td>'+esc(r['Expense By']||'—')+'</td><td>'+esc(r['Category']||'—')+'</td><td>'+esc(r['Payment Method']||'—')+'</td><td class="num" style="color:var(--teal)">₹'+fmtNum(r['Amount'])+'</td></tr>';});
    html+='</tbody></table></div>';
  }
  c.innerHTML=html;
}
window._locDrill=function(ln){
  var ords=_D.orders.filter(function(o){return locName(o)===ln;});
  var html='<div style="display:flex;flex-direction:column;gap:8px">';
  ords.slice(0,60).forEach(function(o){html+='<div class="list-card" onclick="document.getElementById(\'day-modal\').classList.remove(\'show\');openDetail(\''+esc(o['OrderID'])+'\')"><div class="list-card-left"><div class="list-card-id">'+esc(o['OrderID'])+'</div><div class="list-card-cust">'+esc(custName(o))+'</div><div style="font-size:10px;color:var(--teal)">'+fmtDate(o['Expected Delivery Date'])+'</div></div><div class="list-card-right">'+sBadge(o._status)+'</div></div>';});
  if(ords.length>60) html+='<div style="padding:8px;text-align:center;font-size:11px;color:var(--sub)">+' +(ords.length-60)+' more</div>';
  html+='</div>';
  document.getElementById('day-modal-title').textContent=ln+' ('+ords.length+')';
  document.getElementById('day-modal-body').innerHTML=html;
  document.getElementById('day-modal').classList.add('show');
};

// ═══════════════════════════════════════════════════════════
//  15. TREE (Customer → Orders → Items, all resolved)
// ═══════════════════════════════════════════════════════════
function renderTree(){
  var c=document.getElementById('content');
  var cm={};
  _D.orders.forEach(function(o){ var cu=custName(o); if(!cm[cu])cm[cu]=[]; cm[cu].push(o); });
  var im={};
  _D.orderDetails.forEach(function(r){ var oid=String(r['OrderID']||'').trim(); if(!im[oid])im[oid]=[]; im[oid].push(r); });

  var html='<div class="filter-bar-compact" style="margin-bottom:14px"><div class="fb-group" style="flex:1"><div class="fb-label">Search Customer or Order</div><div style="position:relative"><i class="fas fa-search" style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--sub);font-size:11px;pointer-events:none"></i><input class="form-input" style="padding-left:30px;height:34px;font-size:12px" type="search" placeholder="Customer name, hotel, order ID…" oninput="_treeSrch(this.value)"></div></div></div>';
  html+='<div class="tree-root" id="tree-root">';
  Object.keys(cm).sort().forEach(function(cust,ci){
    var ords=cm[cust],nid='tn-'+ci;
    html+='<div class="tree-node" id="'+nid+'">';
    html+='<div class="tree-node-head" onclick="treeT(\''+nid+'\')">';
    html+='<i class="fas fa-chevron-right tree-chevron"></i>';
    html+='<span class="tree-node-label"><i class="fas fa-building" style="color:var(--teal);margin-right:8px"></i>'+esc(cust)+'</span>';
    html+='<span class="tree-node-count">'+ords.length+' orders</span></div>';
    html+='<div class="tree-children">';
    ords.slice(0,30).forEach(function(o,oi){
      var onid=nid+'-o'+oi,its=im[o['OrderID']]||[];
      html+='<div class="tree-order" id="'+onid+'">';
      html+='<div class="tree-order-head" onclick="treeOT(\''+onid+'\')">';
      html+='<i class="fas fa-chevron-right tree-chevron"></i>';
      html+='<span class="tree-order-id">'+esc(o['OrderID'])+'</span>';
      html+=sBadge(o._status);
      html+='<span style="font-size:10px;color:var(--teal);margin-left:6px">📍 '+esc(locName(o).substring(0,20))+'</span>';
      html+='<span class="tree-order-meta">'+its.length+' items · '+fmtDate(o['Expected Delivery Date'])+'</span>';
      html+='<button class="btn btn-sm" style="padding:2px 8px;font-size:10px;margin-left:auto" onclick="event.stopPropagation();openDetail(\''+esc(o['OrderID'])+'\')"><i class="fas fa-eye"></i></button>';
      html+='</div>';
      html+='<div class="tree-order-items">';
      if(its.length){its.forEach(function(it){
        var info=it._itemInfo||(_M.item[String(it['Item Name']||'').trim()])||{};
        html+='<div class="tree-item-row">';
        html+='<span class="tree-item-name">'+esc(itemName(it))+'<span style="color:var(--sub);font-size:9px;margin-left:4px">['+esc(info.cat||'')+']</span></span>';
        html+='<span style="color:var(--muted);font-size:9px;margin-right:8px">'+esc(info.unit||'')+'</span>';
        html+='<span class="tree-item-qty">'+fmtNum(it['Qty'])+'</span></div>';
      });}
      else html+='<div style="font-size:11px;color:var(--sub);padding:4px">No items cached</div>';
      html+='</div></div>';
    });
    if(ords.length>30) html+='<div style="padding:8px;font-size:10px;color:var(--sub)">+' +(ords.length-30)+' more orders…</div>';
    html+='</div></div>';
  });
  html+='</div>';
  c.innerHTML=html;
}
window.treeT=function(id){var n=document.getElementById(id);if(n)n.classList.toggle('open');};
window.treeOT=function(id){var n=document.getElementById(id);if(n)n.classList.toggle('open');};
window._treeSrch=function(q){
  q=q.toLowerCase();
  document.querySelectorAll('#tree-root .tree-node').forEach(function(node){
    var txt=(node.querySelector('.tree-node-label')||{}).textContent||'';
    var orderTxts=''; node.querySelectorAll('.tree-order-id').forEach(function(el){orderTxts+=el.textContent;});
    node.style.display=(!q||txt.toLowerCase().indexOf(q)>=0||orderTxts.toLowerCase().indexOf(q)>=0)?'':'none';
  });
};

// ═══════════════════════════════════════════════════════════
//  16. PURCHASE (with resolved item & vendor names)
// ═══════════════════════════════════════════════════════════
function renderPurchase(){
  var c=document.getElementById('content');
  var spend=0; _D.purchasedItems.forEach(function(r){spend+=parseFloat(r['Qty']||0)*parseFloat(r['Rate']||0);});

  /* Vendor aggregation using resolved names */
  var vm={};
  _D.purchasedItems.forEach(function(r){
    var vn=vendName(r);
    if(!vm[vn])vm[vn]={qty:0,spend:0,items:0};
    vm[vn].qty+=parseFloat(r['Qty']||0);
    vm[vn].spend+=parseFloat(r['Qty']||0)*parseFloat(r['Rate']||0);
    vm[vn].items++;
  });

  /* Item category breakdown */
  var catM={Fruit:0,Veg:0,Other:0};
  _D.indents.forEach(function(r){
    var info=r._itemInfo||(_M.item[String(r['Item Name']||'').trim()])||{};
    var cat=info.cat||'Other';
    catM[cat]=(catM[cat]||0)+parseFloat(r['Qty']||0);
  });

  var html='<div class="purchase-summary">';
  html+='<h2>Estimated Purchase Spend</h2>';
  html+='<div class="big-num">₹'+Math.round(spend).toLocaleString('en-IN')+'</div>';
  html+='<div class="ps-sub">'+_D.purchasedItems.length+' line items · '+Object.keys(vm).length+' vendors · '+_D.indents.length+' indents</div>';
  html+='</div>';

  html+='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px;margin-bottom:20px">';
  [{l:'Indents',v:_D.indents.length,cls:'sc-teal'},{l:'Purchased Lines',v:_D.purchasedItems.length,cls:'sc-green'},{l:'Active Vendors',v:Object.keys(vm).length,cls:'sc-blue'},{l:'Fruit Indent (KG)',v:Math.round(catM['Fruit']||0),cls:'sc-amber'},{l:'Veg Indent (KG)',v:Math.round(catM['Veg']||0),cls:'sc-green'},{l:'Dump Entries',v:_D.dumpItems.length,cls:'sc-red'}].forEach(function(k){
    html+='<div class="stat-card '+k.cls+'"><div class="stat-label">'+k.l+'</div><div class="stat-val" style="font-size:20px">'+k.v.toLocaleString('en-IN')+'</div></div>';
  });
  html+='</div>';

  /* Vendor spend table — resolved names */
  var vk=Object.keys(vm).sort(function(a,b){return vm[b].spend-vm[a].spend;});
  html+='<div class="sec-hd"><h3>Vendor Spend Summary</h3><span class="cnt">'+vk.length+'</span><div class="line"></div></div>';
  html+='<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Vendor Name</th><th class="num">Items Bought</th><th class="num">Total Qty</th><th class="num">Est. Spend (₹)</th></tr></thead><tbody>';
  vk.slice(0,30).forEach(function(vn){html+='<tr><td style="font-weight:600">'+esc(vn)+'</td><td class="num">'+vm[vn].items+'</td><td class="num">'+vm[vn].qty.toLocaleString('en-IN')+'</td><td class="num" style="color:var(--teal);font-weight:700">₹'+Math.round(vm[vn].spend).toLocaleString('en-IN')+'</td></tr>';});
  html+='</tbody></table></div>';

  /* Recent purchases — resolved item + vendor names */
  html+='<div class="sec-hd" style="margin-top:20px"><h3>Recent Purchases</h3><span class="cnt">'+_D.purchasedItems.length+'</span><div class="line"></div></div>';

  /* Filters for purchase */
  var cats=uniq(_D.masters.items,'cat'); var subs=uniq(_D.masters.items,'subcat');
  html+='<div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap">';
  html+='<select class="form-input" style="height:32px;font-size:12px" id="pur-cat" onchange="_purFilter()">';
  html+='<option value="">All Categories</option>';
  cats.forEach(function(ca){html+='<option>'+esc(ca)+'</option>';});
  html+='</select>';
  html+='<select class="form-input" style="height:32px;font-size:12px" id="pur-sub" onchange="_purFilter()">';
  html+='<option value="">All Sub-Categories</option>';
  subs.forEach(function(s){html+='<option>'+esc(s)+'</option>';});
  html+='</select>';
  html+='<input class="form-input" style="height:32px;font-size:12px;min-width:180px" type="search" id="pur-search" placeholder="Search item or vendor…" oninput="_purFilter()">';
  html+='</div>';

  html+='<div id="pur-table-wrap">';
  html+=_purTable(_D.purchasedItems);
  html+='</div>';

  /* Indent table */
  html+='<div class="sec-hd" style="margin-top:20px"><h3>Purchase Indents</h3><span class="cnt">'+_D.indents.length+'</span><div class="line"></div></div>';
  html+='<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Item Name</th><th>Category</th><th>Unit</th><th class="num">Qty</th><th>Indent Date</th></tr></thead><tbody>';
  _D.indents.slice(0,100).forEach(function(r){
    var info=r._itemInfo||(_M.item[String(r['Item Name']||'').trim()])||{};
    html+='<tr><td><div style="font-weight:600">'+esc(itemName(r))+'</div></td>';
    html+='<td><span class="badge" style="background:#F1F5F9;color:var(--slate);border:1px solid var(--border)">'+esc(info.cat||'—')+'</span></td>';
    html+='<td style="color:var(--muted)">'+esc(info.unit||'—')+'</td>';
    html+='<td class="num" style="color:var(--teal);font-weight:700">'+fmtNum(r['Qty'])+'</td>';
    html+='<td>'+fmtDate(r['Timestamp'])+'</td></tr>';
  });
  html+='</tbody></table></div>';

  /* Dump */
  if(_D.dumpItems.length){
    html+='<div class="sec-hd" style="margin-top:20px"><h3>Dump Entries</h3><span class="cnt">'+_D.dumpItems.length+'</span><div class="line"></div></div>';
    html+='<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Timestamp</th><th>User</th><th>Item</th><th class="num">Qty</th><th>Reason</th></tr></thead><tbody>';
    _D.dumpItems.forEach(function(r){html+='<tr><td style="font-size:10px">'+fmtDT(r['Timestamp'])+'</td><td>'+esc(r['Useremail']||'—')+'</td><td>'+esc(r['Item']||'—')+'</td><td class="num">'+fmtNum(r['Qty'])+'</td><td>'+esc(r['Reason']||'—')+'</td></tr>';});
    html+='</tbody></table></div>';
  }
  c.innerHTML=html;
}

function _purTable(data){
  if(!data.length) return '<div class="empty"><i class="fas fa-inbox"></i><p>No items match</p></div>';
  var html='<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Item Name</th><th>Category</th><th>Vendor</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount (₹)</th><th>Date</th></tr></thead><tbody>';
  data.slice(0,150).forEach(function(r){
    var info=r._itemInfo||(_M.item[String(r['Item Name']||'').trim()])||{};
    var amt=parseFloat(r['Qty']||0)*parseFloat(r['Rate']||0);
    html+='<tr><td><div style="font-weight:600">'+esc(itemName(r))+'</div><div style="font-size:9px;color:var(--sub)">'+esc(r['Item Name']||'')+'</div></td>';
    html+='<td><span class="badge" style="background:#F1F5F9;color:var(--slate);border:1px solid var(--border)">'+esc(info.cat||'—')+'</span></td>';
    html+='<td style="font-weight:500">'+esc(vendName(r))+'</td>';
    html+='<td class="num">'+fmtNum(r['Qty'])+'<span style="color:var(--sub);font-size:9px;margin-left:3px">'+esc(info.unit||'')+'</span></td>';
    html+='<td class="num">₹'+fmtNum(r['Rate'])+'</td>';
    html+='<td class="num" style="color:var(--teal);font-weight:700">₹'+Math.round(amt).toLocaleString('en-IN')+'</td>';
    html+='<td style="font-size:10px">'+fmtDate(r['Timestamp'])+'</td></tr>';
  });
  html+='</tbody></table></div>';
  if(data.length>150) html+='<div style="text-align:center;padding:8px;font-size:11px;color:var(--sub)">Showing 150 of '+data.length+'</div>';
  return html;
}

window._purFilter=function(){
  var cat=(document.getElementById('pur-cat')||{}).value||'';
  var sub=(document.getElementById('pur-sub')||{}).value||'';
  var q=((document.getElementById('pur-search')||{}).value||'').toLowerCase();
  var data=_D.purchasedItems.filter(function(r){
    var info=r._itemInfo||(_M.item[String(r['Item Name']||'').trim()])||{};
    if(cat&&info.cat!==cat) return false;
    if(sub&&info.subcat!==sub) return false;
    if(q){var h=(itemName(r)+' '+vendName(r)).toLowerCase();if(h.indexOf(q)===-1)return false;}
    return true;
  });
  var wrap=document.getElementById('pur-table-wrap');
  if(wrap) wrap.innerHTML=_purTable(data);
};

// ═══════════════════════════════════════════════════════════
//  17. CSV EXPORT
// ═══════════════════════════════════════════════════════════
function exportCSV(){
  var rows=filtered();
  var cols=['OrderID','_customerName','_locationName','Expected Delivery Date','Delivery Boy','Vehicle No.','Crates Loaded','Returned Crates','WH Status','Email Status','Invoice','_status'];
  var csv=cols.join(',')+'\n';
  rows.forEach(function(o){csv+=cols.map(function(k){return '"'+String(o[k]||'').replace(/"/g,'""')+'"';}).join(',')+'\n';});
  var a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
  a.download='o2d-'+today()+'.csv';
  a.click();
  URL.revokeObjectURL(a.href);
  toast('✓ CSV downloaded ('+rows.length+' rows, with resolved names)','ok');
}

// ═══════════════════════════════════════════════════════════
//  18. UI UTILS
// ═══════════════════════════════════════════════════════════
function setLoader(msg){var el=document.getElementById('loader'),t=document.getElementById('loader-txt');if(t)t.textContent=msg||'Loading…';if(el)el.classList.remove('hidden');}
function hideLoader(){var el=document.getElementById('loader');if(el)el.classList.add('hidden');}
function setBadge(cls,txt){var el=document.getElementById('data-badge');if(!el)return;el.className=cls;el.innerHTML=(cls==='loading'?'<i class="fas fa-circle-notch spinning" style="margin-right:4px"></i>':'')+txt;}
var _tT;
function toast(msg,type){var el=document.getElementById('toast');if(!el)return;el.textContent=msg;el.className='show'+(type?' '+type:'');clearTimeout(_tT);_tT=setTimeout(function(){el.className='';},3500);}

// ═══════════════════════════════════════════════════════════
//  19. BOOT
// ═══════════════════════════════════════════════════════════
function boot(){
  if(gasUrlNotSet()){
    hideLoader(); setBadge('error','Setup Required');
    document.getElementById('content').innerHTML=
      '<div class="empty"><i class="fas fa-cog" style="font-size:48px;color:var(--teal)"></i>'+
      '<p>GAS URL Not Configured</p>'+
      '<small>Open <strong>apiconfig.js</strong>, paste your Apps Script deployment URL into <code>GAS_URL</code>, then commit to GitHub.</small></div>';
    return;
  }
  var p=new URLSearchParams(window.location.search);
  _view=p.get('view')||APP_CONFIG.defaultView||'kanban';
  loadAll(false);
}
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot); else boot();
