// ============================================================
//  O2D Analytics — app.js  CRUD Edition
//  Roles: management (full CRUD) | user (read + status update)
// ============================================================

/* ── Session ─────────────────────────────────────────────── */
var _SESSION = null; // { email, name, role }

/* ── Data Store ──────────────────────────────────────────── */
var _D = {
  orders:[], orderDetails:[], receivedItems:[], returnedItems:[],
  pdfs:[], indents:[], purchasedItems:[], dumpItems:[],
  reimbursements:[],
  masters:{ customers:[], locations:[], items:[], vendors:[] },
  lastTs:null
};
var _M = { cust:{}, loc:{}, item:{}, vend:{} };

/* ── View & filter state ─────────────────────────────────── */
var _view    = 'kanban';
var _cbIdx   = 0;
var _charts  = {};
var _calYear = new Date().getFullYear();
var _calMonth= new Date().getMonth();
var _galMode = 'load';
var _tblPage = 1; var _TBL   = 50;
var _tlOID   = '';
var _pivRow  = 'Customer'; var _pivCol = 'Status';
var _autoT   = null;
var _masterTab = 'customers';

var _F = { search:'', status:'', customer:'', location:'', deliveryBoy:'',
           dateFrom:'', dateTo:'', hasPhoto:'', invoiced:'', wh:'' };

/* ── Pipeline ─────────────────────────────────────────────── */
var PIPELINE = [
  { key:'Pending',       label:'Pending',       color:'#6366F1', bg:'#EEF2FF', bc:'#C7D2FE', icon:'fa-hourglass-start',  step:null },
  { key:'WH Loaded',     label:'WH Loaded',     color:'#7C3AED', bg:'#F5F3FF', bc:'#DDD6FE', icon:'fa-box',              step:'_step1_actual' },
  { key:'Delivered',     label:'Delivered',     color:'#F59E0B', bg:'#FEF3C7', bc:'#FDE68A', icon:'fa-truck',            step:'_step2_actual' },
  { key:'DEO Collected', label:'DEO Collected', color:'#3B82F6', bg:'#DBEAFE', bc:'#BFDBFE', icon:'fa-check-circle',     step:'_step4_actual' },
  { key:'DEO Approved',  label:'DEO Approved',  color:'#22C55E', bg:'#DCFCE7', bc:'#A7F3D0', icon:'fa-clipboard-check',  step:'_step5_actual' },
  { key:'Invoiced',      label:'Invoiced',      color:'#06B6D4', bg:'#ECFEFF', bc:'#A5F3FC', icon:'fa-file-invoice',     step:'_step6_actual' }
];

var PMAP = {}; PIPELINE.forEach(function(p){ PMAP[p.key]=p; });

var VN = {
  kanban:'Kanban Board', table:'Orders Table', list:'Live Feed',
  chart:'Charts & KPIs', calendar:'Calendar', timeline:'Order Timeline',
  gallery:'Photo Gallery', pivot:'Pivot Matrix', map:'Location Map',
  tree:'Customer Tree', purchase:'Purchase & Indent', masters:'Masters CRUD'
};

/* ─────────────────────────────────────────────────────────────
   1. API LAYER
   Always injects _SESSION auth. Pass explicit authOverride for login.
───────────────────────────────────────────────────────────── */
function _api(action, data, ok, fail, authOverride) {
  if (!GAS_URL || GAS_URL.indexOf('PASTE') >= 0) {
    toast('Set GAS_URL in apiconfig.js', 'err'); if(fail) fail({message:'Not configured'}); return;
  }
  var cb='_gcb'+(++_cbIdx); var t;
  window[cb]=function(r){
    clearTimeout(t);
    var s=document.getElementById('_s_'+cb); if(s) s.parentNode.removeChild(s);
    try{delete window[cb];}catch(e){}
    if(ok) ok(r);
  };
  t=setTimeout(function(){
    try{delete window[cb];}catch(e){}
    if(fail) fail({message:'Request timed out. Check GAS deployment.'});
  }, APP_CONFIG.apiTimeoutMs||28000);

  // Use explicit authOverride (for login), else use _SESSION
  var auth = authOverride || (_SESSION ? {email:_SESSION.email, password:_SESSION.password} : null);
  var pl = {action:action, data:data||{}, auth:auth};
  var url = GAS_URL+'?callback='+cb+'&payload='+encodeURIComponent(JSON.stringify(pl));
  var s=document.createElement('script'); s.id='_s_'+cb; s.src=url;
  s.onerror=function(){clearTimeout(t);try{delete window[cb];}catch(e){}if(fail)fail({message:'Network error. Check internet connection.'});};
  document.head.appendChild(s);
}

/* ─────────────────────────────────────────────────────────────
   2. AUTH
───────────────────────────────────────────────────────────── */
function doLogin() {
  var email = ((document.getElementById('li-email')||{}).value||'').trim();
  var pass  = (document.getElementById('li-pass')||{}).value||'';
  var btn   = document.getElementById('login-btn');
  if (!email || !pass) { showLoginErr('Enter email and password.'); return; }
  btn.innerHTML = '<i class="fas fa-circle-notch spinning"></i> Signing in…'; btn.disabled=true;
  showLoginErr('');

  // Pass auth explicitly as authOverride — _SESSION is null at login time
  _api('login', {}, function(r) {
    btn.innerHTML='<i class="fas fa-sign-in-alt"></i> Sign In'; btn.disabled=false;
    if (!r || !r.success) {
      showLoginErr(r && r.error ? r.error : 'Invalid email or password.');
      return;
    }
    _SESSION = { email:email, password:pass, name:r.user.name, role:r.user.role };
    document.getElementById('login-wrap').style.display = 'none';
    _applyRole();
    loadAll(false);
  }, function(e) {
    btn.innerHTML='<i class="fas fa-sign-in-alt"></i> Sign In'; btn.disabled=false;
    showLoginErr('Connection failed: ' + e.message);
  }, {email:email, password:pass}); // ← authOverride passed here
}

function showLoginErr(msg){
  var e=document.getElementById('login-err');
  if(!e) return;
  if(!msg){e.textContent='';e.classList.remove('show');return;}
  e.textContent=msg;
  e.classList.add('show');
}
function doLogout(){_SESSION=null;document.getElementById('login-wrap').style.display='flex';_D.orders=[];toast('Signed out');}
function isManagement(){return _SESSION&&_SESSION.role==='management';}

function _applyRole() {
  var n=_SESSION.name||_SESSION.email;
  var av=document.getElementById('sb-avatar'); if(av)av.textContent=n.substring(0,2).toUpperCase();
  var un=document.getElementById('sb-uname'); if(un)un.textContent=n;
  var ur=document.getElementById('sb-urole'); if(ur){ur.textContent=_SESSION.role;ur.className='sb-urole '+_SESSION.role;}
  // Show masters nav only for management
  var mn=document.getElementById('masters-nav'); var mt=document.getElementById('masters-tab');
  var ml=document.getElementById('masters-label'); var md=document.getElementById('masters-divider');
  if(isManagement()){
    if(mn)mn.style.display=''; if(mt)mt.style.display='';
    if(ml)ml.style.display=''; if(md)md.style.display='';
  } else {
    if(mn)mn.style.display='none'; if(mt)mt.style.display='none';
    if(ml)ml.style.display='none'; if(md)md.style.display='none';
  }
}

/* ─────────────────────────────────────────────────────────────
   3. DATA LOAD
───────────────────────────────────────────────────────────── */
function loadAll(silent) {
  setBadge('loading','Loading…');
  if(!silent){showLoader('Fetching O2D data…');}
  var ico=document.getElementById('ref-ico'); if(ico)ico.classList.add('spinning');

  _api('getAllData',{},function(r){
    if(ico)ico.classList.remove('spinning'); hideLoader();
    if(!r||!r.success){setBadge('error','Error');toast('Load failed: '+(r&&r.error?r.error:'unknown'),'err');return;}

    _D.orders=r.orders||[]; _D.orderDetails=r.orderDetails||[]; _D.receivedItems=r.receivedItems||[];
    _D.returnedItems=r.returnedItems||[]; _D.pdfs=r.pdfs||[]; _D.indents=r.indents||[];
    _D.purchasedItems=r.purchasedItems||[]; _D.dumpItems=r.dumpItems||[];
    _D.reimbursements=r.reimbursements||[]; _D.masters=r.masters||{customers:[],locations:[],items:[],vendors:[]};
    _D.lastTs=r.ts||'';

    _M.cust={}; _D.masters.customers.forEach(function(c){_M.cust[c.uid]=c.name;});
    _M.loc={};  _D.masters.locations.forEach(function(l){_M.loc[l.uid]={name:l.name,custUID:l.custUID};});
    _M.item={}; _D.masters.items.forEach(function(i){_M.item[i.uid]=i;});
    _M.vend={}; _D.masters.vendors.forEach(function(v){_M.vend[v.uid]=v.name;});

    var ts=_D.lastTs?_D.lastTs.substring(11,16):'';
    setBadge('ok','✓ '+_D.orders.length+' orders · '+ts);
    var sbk=document.getElementById('sb-k-cnt'); if(sbk)sbk.textContent=_D.orders.length;
    toast('✓ '+_D.orders.length+' orders loaded','ok');
    sv(_view,true);
    if(_autoT)clearInterval(_autoT);
    if(APP_CONFIG.autoRefreshMs) _autoT=setInterval(function(){loadAll(true);},APP_CONFIG.autoRefreshMs);
  },function(e){
    var ico=document.getElementById('ref-ico'); if(ico)ico.classList.remove('spinning');
    hideLoader(); setBadge('error','Failed'); toast('API Error: '+e.message,'err');
  });
}

/* ─────────────────────────────────────────────────────────────
   4. VIEW SWITCH
───────────────────────────────────────────────────────────── */
function sv(name, skipReset) {
  _view=name; if(!skipReset)_tblPage=1;
  document.querySelectorAll('.sb-item').forEach(function(el){el.classList.toggle('active',el.dataset.view===name);});
  document.querySelectorAll('#vtabs .vtab').forEach(function(el){el.classList.toggle('active',el.dataset.view===name);});
  var at=document.querySelector('#vtabs .vtab.active'); if(at)at.scrollIntoView({block:'nearest',inline:'center',behavior:'smooth'});
  var tb=document.getElementById('tb-vname'); if(tb)tb.textContent=VN[name]||name;
  // Show Add button only on relevant management views
  var addBtn=document.getElementById('tb-add-btn');
  if(addBtn) addBtn.style.display=isManagement()&&['table','purchase','masters'].indexOf(name)>=0?'':'none';
  Object.keys(_charts).forEach(function(k){try{_charts[k].destroy();}catch(e){}delete _charts[k];});

  var c=document.getElementById('content'); if(!c) return;
  if(!_D.orders.length&&!['purchase','chart','masters'].includes(name)){
    c.innerHTML='<div class="empty"><div class="empty-ico"><i class="fas fa-satellite-dish"></i></div><p>No data loaded</p><small>Click Refresh to fetch data</small></div>'; return;
  }
  var fn={kanban:rKanban,table:rTable,list:rList,chart:rChart,calendar:rCalendar,timeline:rTimeline,gallery:rGallery,pivot:rPivot,map:rMap,tree:rTree,purchase:rPurchase,masters:rMasters}[name];
  if(fn)fn(); else c.innerHTML='<div class="empty"><div class="empty-ico"><i class="fas fa-tools"></i></div><p>'+name+'</p></div>';
}

function handleAdd(){
  var adds={table:()=>openOrderForm(null),purchase:()=>openIndentForm(null),masters:()=>openMasterForm(_masterTab,null)};
  if(adds[_view])adds[_view]();
}

/* ─────────────────────────────────────────────────────────────
   5. HELPERS
───────────────────────────────────────────────────────────── */
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function fd(s){return s?String(s).substring(0,10):'—';}
function fdt(s){return s?String(s).substring(0,16).replace('T',' '):'—';}
function fn2(n){var v=parseFloat(n);return isNaN(v)?'—':v.toLocaleString('en-IN');}
function dh(a,b){if(!a||!b)return null;return ((new Date(b)-new Date(a))/3600000).toFixed(1);}
function tod(){return new Date().toISOString().substring(0,10);}

function cN(o){return o._customerName||_M.cust[String(o['Customer Name']||'').trim()]||'—';}
function lN(o){var u=String(o['Delivery Location']||'').trim();return o._locationName||(_M.loc[u]&&_M.loc[u].name)||'—';}
function iN(r){return r._itemName||(_M.item[String(r['Item Name']||'').trim()]&&_M.item[String(r['Item Name']||'').trim()].name)||'—';}
function vN(r){return r._vendName||_M.vend[String(r['Vendor']||'').trim()]||'—';}

function uniqN(arr,getFn){var s={},r=[];arr.forEach(function(x){var v=getFn(x);if(v&&v!=='—'&&!s[v]){s[v]=1;r.push(v);}});return r.sort();}
function uniqK(arr,key){var s={},r=[];arr.forEach(function(x){var v=String(x[key]||'').trim();if(v&&!s[v]){s[v]=1;r.push(v);}});return r.sort();}

function sBadge(s){
  var p=PMAP[s]; if(!p)p=PMAP['Pending'];
  return '<span class="badge" style="background:'+p.bg+';color:'+p.color+';border-color:'+p.bc+'"><i class="fas '+p.icon+'" style="font-size:9px"></i> '+esc(s||'Pending')+'</span>';
}

function filtered(){
  return _D.orders.filter(function(o){
    if(_F.status&&o._status!==_F.status)return false;
    if(_F.customer&&cN(o)!==_F.customer)return false;
    if(_F.location&&lN(o)!==_F.location)return false;
    if(_F.deliveryBoy&&o['Delivery Boy']!==_F.deliveryBoy)return false;
    if(_F.wh&&o['Warehouse']!==_F.wh)return false;
    if(_F.dateFrom&&fd(o['Expected Delivery Date'])<_F.dateFrom)return false;
    if(_F.dateTo&&fd(o['Expected Delivery Date'])>_F.dateTo)return false;
    if(_F.hasPhoto==='yes'&&!o['Photo'])return false;
    if(_F.hasPhoto==='no'&&o['Photo'])return false;
    if(_F.invoiced==='yes'&&!o['Invoice'])return false;
    if(_F.invoiced==='no'&&o['Invoice'])return false;
    if(_F.search){
      var q=_F.search.toLowerCase();
      var hay=[cN(o),lN(o),o['Delivery Boy'],o._status,o['Invoice']||'',o['Vehicle No.']||''].join(' ').toLowerCase();
      if(hay.indexOf(q)===-1)return false;
    }
    return true;
  });
}

function filterBar(compact){
  var custs=uniqN(_D.orders,cN); var locs=uniqN(_D.orders,lN);
  var boys=uniqK(_D.orders,'Delivery Boy'); var whs=uniqK(_D.orders,'Warehouse');
  var h='<div class="fbar">';
  // Search
  h+='<div class="fb-g wide"><label>Search</label><div class="fb-search"><i class="fas fa-search"></i><input class="fi fb-search" type="search" placeholder="Customer, location, vehicle…" value="'+esc(_F.search)+'" oninput="_fs(\'search\',this.value)"></div></div>';
  // Status
  h+='<div class="fb-g"><label>Status</label><select class="fi" onchange="_fs(\'status\',this.value)"><option value="">All Status</option>';
  PIPELINE.forEach(function(p){h+='<option value="'+p.key+'"'+(_F.status===p.key?' selected':'')+'>'+p.label+'</option>';});
  h+='</select></div>';
  // Customer
  if(custs.length){h+='<div class="fb-g"><label>Customer</label><select class="fi" onchange="_fs(\'customer\',this.value)"><option value="">All</option>';custs.slice(0,80).forEach(function(n){h+='<option value="'+esc(n)+'"'+(_F.customer===n?' selected':'')+'>'+esc(n.length>30?n.substring(0,30)+'…':n)+'</option>';});h+='</select></div>';}
  // Location
  if(!compact&&locs.length){h+='<div class="fb-g"><label>Location</label><select class="fi" onchange="_fs(\'location\',this.value)"><option value="">All</option>';locs.slice(0,80).forEach(function(n){h+='<option value="'+esc(n)+'"'+(_F.location===n?' selected':'')+'>'+esc(n.length>30?n.substring(0,30)+'…':n)+'</option>';});h+='</select></div>';}
  // Delivery boy
  if(boys.length){h+='<div class="fb-g"><label>Delivery Boy</label><select class="fi" onchange="_fs(\'deliveryBoy\',this.value)"><option value="">All</option>';boys.forEach(function(b){h+='<option value="'+esc(b)+'"'+(_F.deliveryBoy===b?' selected':'')+'>'+esc(b)+'</option>';});h+='</select></div>';}
  if(!compact){
    if(whs.length){h+='<div class="fb-g"><label>Warehouse</label><select class="fi" onchange="_fs(\'wh\',this.value)"><option value="">All</option>';whs.forEach(function(w){h+='<option value="'+esc(w)+'"'+(_F.wh===w?' selected':'')+'>'+esc(w)+'</option>';});h+='</select></div>';}
    h+='<div class="fb-g"><label>EDD From</label><input class="fi" type="date" value="'+esc(_F.dateFrom)+'" onchange="_fs(\'dateFrom\',this.value)"></div>';
    h+='<div class="fb-g"><label>EDD To</label><input class="fi" type="date" value="'+esc(_F.dateTo)+'" onchange="_fs(\'dateTo\',this.value)"></div>';
    h+='<div class="fb-g"><label>Photo</label><select class="fi" onchange="_fs(\'hasPhoto\',this.value)"><option value="">Any</option><option value="yes"'+(_F.hasPhoto==='yes'?' selected':'')+'>Has Photo</option><option value="no"'+(_F.hasPhoto==='no'?' selected':'')+'>No Photo</option></select></div>';
    h+='<div class="fb-g"><label>Invoice</label><select class="fi" onchange="_fs(\'invoiced\',this.value)"><option value="">Any</option><option value="yes"'+(_F.invoiced==='yes'?' selected':'')+'>Invoiced</option><option value="no"'+(_F.invoiced==='no'?' selected':'')+'>Not Invoiced</option></select></div>';
  }
  h+='<div class="fb-g" style="flex:none"><label>&nbsp;</label><button class="btn btn-ghost btn-sm" onclick="_clearF()"><i class="fas fa-times"></i> Clear</button></div>';
  h+='</div>';
  // Active chips
  var active=Object.keys(_F).filter(function(k){return _F[k];});
  if(active.length){
    h+='<div class="active-filters">';
    active.forEach(function(k){h+='<span class="af-chip">'+esc(k)+': '+esc(_F[k])+'<button onclick="_fs(\''+k+'\',\'\')"><i class="fas fa-times"></i></button></span>';});
    h+='</div>';
  }
  return h;
}

window._fs=function(k,v){_F[k]=v;_tblPage=1;var fn={table:rTable,list:rList,kanban:rKanban}[_view];if(fn)fn();};
window._clearF=function(){Object.keys(_F).forEach(function(k){_F[k]='';});_tblPage=1;sv(_view);};

/* ─────────────────────────────────────────────────────────────
   6. KANBAN
───────────────────────────────────────────────────────────── */
function rKanban(){
  var c=document.getElementById('content');
  var rows=filtered();
  var grp={}; PIPELINE.forEach(function(p){grp[p.key]=[];});
  rows.forEach(function(o){var s=o._status||'Pending';if(!grp[s])grp[s]=[];grp[s].push(o);});

  var h=filterBar(true);
  h+='<div id="kb">';
  PIPELINE.forEach(function(p){
    var cards=grp[p.key]||[];
    h+='<div class="k-col"><div class="k-col-hd">';
    h+='<div class="k-dot" style="background:'+p.color+'"></div>';
    h+='<span class="k-label" style="color:'+p.color+'">'+esc(p.label)+'</span>';
    h+='<span class="k-cnt">'+cards.length+'</span></div>';
    h+='<div class="k-body">';
    if(!cards.length){h+='<div style="padding:20px;text-align:center;color:var(--fog);font-size:11px"><i class="fas fa-inbox" style="font-size:20px;display:block;margin-bottom:6px;opacity:.4"></i>Empty</div>';}
    else{
      cards.slice(0,40).forEach(function(o){
        var edd=fd(o['Expected Delivery Date']); var isT=edd===tod();
        h+='<div class="k-card" onclick="openDetail(\''+esc(o['OrderID'])+'\')">';
        if(isT) h+='<div style="font-size:9px;font-weight:800;color:var(--brand);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px"><i class="fas fa-star"></i> Today</div>';
        h+='<div class="k-card-cust">'+esc(cN(o))+'</div>';
        h+='<div class="k-card-loc"><i class="fas fa-map-marker-alt" style="font-size:9px"></i> '+esc(lN(o))+'</div>';
        h+='<div class="k-card-chips">';
        h+='<span class="k-chip"><i class="fas fa-calendar" style="font-size:9px"></i> '+edd+'</span>';
        if(o['Delivery Boy'])h+='<span class="k-chip"><i class="fas fa-motorcycle" style="font-size:9px"></i> '+esc(o['Delivery Boy'])+'</span>';
        if(o['Crates Loaded'])h+='<span class="k-chip"><i class="fas fa-box" style="font-size:9px"></i> '+o['Crates Loaded']+'</span>';
        if(o['Invoice'])h+='<span class="k-chip" style="color:var(--brand);font-weight:700"><i class="fas fa-file-invoice" style="font-size:9px"></i> Invoiced</span>';
        h+='</div></div>';
      });
      if(cards.length>40)h+='<div style="padding:8px;text-align:center;font-size:10px;color:var(--fog)">+' +(cards.length-40)+' more</div>';
    }
    h+='</div></div>';
  });
  h+='</div>';
  c.innerHTML=h;
}

/* ─────────────────────────────────────────────────────────────
   7. TABLE
───────────────────────────────────────────────────────────── */
var _tblSort={col:'Expected Delivery Date',dir:-1};

function rTable(){
  var c=document.getElementById('content');
  var rows=filtered();
  rows.sort(function(a,b){
    var av=String(a[_tblSort.col]||a._status||cN(a)||'');
    var bv=String(b[_tblSort.col]||b._status||cN(b)||'');
    return av<bv?-_tblSort.dir:av>bv?_tblSort.dir:0;
  });
  var tot=rows.length, st=(_tblPage-1)*_TBL, pr=rows.slice(st,st+_TBL), tp=Math.ceil(tot/_TBL)||1;
  var cols=[
    {key:'_customerName',label:'Customer'},
    {key:'_locationName',label:'Location'},
    {key:'Expected Delivery Date',label:'EDD'},
    {key:'Delivery Boy',label:'Del. Boy'},
    {key:'Vehicle No.',label:'Vehicle'},
    {key:'Crates Loaded',label:'Crates'},
    {key:'Invoice',label:'Invoice'},
    {key:'_status',label:'Status'}
  ];
  var h=filterBar(false);
  h+='<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">';
  h+='<div style="font-size:12px;color:var(--slate)"><strong style="color:var(--ink)">'+tot+'</strong> orders · '+(st+1)+'–'+Math.min(st+_TBL,tot)+'</div>';
  h+='<div style="display:flex;gap:6px">';
  if(isManagement()) h+='<button class="btn btn-primary btn-sm" onclick="openOrderForm(null)"><i class="fas fa-plus"></i> New Order</button>';
  h+='<button class="btn btn-ghost btn-sm" onclick="exportCSV()"><i class="fas fa-file-csv"></i> Export</button></div></div>';

  h+='<div class="tbl-wrap"><table class="tbl"><thead><tr>';
  cols.forEach(function(col){
    var s=_tblSort.col===col.key;
    h+='<th class="'+(s?'sorted':'')+'" onclick="_tS(\''+col.key+'\')">'+esc(col.label)+'<span class="si">'+(s?(_tblSort.dir===1?'▲':'▼'):'↕')+'</span></th>';
  });
  if(isManagement()) h+='<th>Actions</th>';
  h+='</tr></thead><tbody>';

  if(!pr.length){h+='<tr><td colspan="'+(cols.length+(isManagement()?1:0))+'" style="text-align:center;padding:36px;color:var(--fog)"><i class="fas fa-inbox" style="font-size:24px;display:block;margin-bottom:10px;opacity:.4"></i>No matching orders</td></tr>';}
  else{
    pr.forEach(function(o){
      h+='<tr onclick="openDetail(\''+esc(o['OrderID'])+'\')">';
      h+='<td><div style="font-weight:700;color:var(--ink)">'+esc(cN(o))+'</div></td>';
      h+='<td style="color:var(--brand);font-size:12px">'+esc(lN(o))+'</td>';
      h+='<td>'+fd(o['Expected Delivery Date'])+'</td>';
      h+='<td>'+esc(o['Delivery Boy']||'—')+'</td>';
      h+='<td style="font-size:11px;color:var(--slate)">'+esc(o['Vehicle No.']||'—')+'</td>';
      h+='<td class="num">'+fn2(o['Crates Loaded'])+'</td>';
      h+='<td style="font-size:11px;font-weight:600;color:var(--brand)">'+esc(o['Invoice']||'—')+'</td>';
      h+='<td>'+sBadge(o._status)+'</td>';
      if(isManagement()){
        h+='<td onclick="event.stopPropagation()" style="white-space:nowrap">';
        h+='<button class="ab edit" onclick="openOrderForm(\''+esc(o['OrderID'])+'\')" title="Edit"><i class="fas fa-pencil"></i></button> ';
        h+='<button class="ab del" onclick="confirmDelete(\'order\',\''+esc(o['OrderID'])+'\',\''+esc(cN(o))+'\')" title="Delete"><i class="fas fa-trash"></i></button>';
        h+='</td>';
      }
      h+='</tr>';
    });
  }
  h+='</tbody></table>';
  h+='<div class="pager"><div class="pager-info">Page '+_tblPage+' of '+tp+' · '+tot+' orders</div>';
  h+='<div class="pager-btns"><button class="pg-btn" '+(_tblPage<=1?'disabled':'')+' onclick="_pg(1)"><i class="fas fa-angle-double-left"></i></button>';
  h+='<button class="pg-btn" '+(_tblPage<=1?'disabled':'')+' onclick="_pg('+(_tblPage-1)+')"><i class="fas fa-angle-left"></i></button>';
  h+='<span class="pg-page">'+_tblPage+' / '+tp+'</span>';
  h+='<button class="pg-btn" '+(_tblPage>=tp?'disabled':'')+' onclick="_pg('+(_tblPage+1)+')"><i class="fas fa-angle-right"></i></button>';
  h+='<button class="pg-btn" '+(_tblPage>=tp?'disabled':'')+' onclick="_pg('+tp+')"><i class="fas fa-angle-double-right"></i></button></div></div></div>';
  c.innerHTML=h;
}
window._tS=function(col){if(_tblSort.col===col)_tblSort.dir*=-1;else{_tblSort.col=col;_tblSort.dir=1;}_tblPage=1;rTable();};
window._pg=function(p){_tblPage=p;rTable();};

/* ─────────────────────────────────────────────────────────────
   8. LIST
───────────────────────────────────────────────────────────── */
function rList(){
  var c=document.getElementById('content');
  var rows=filtered(); var td=tod();
  var grp={}; rows.forEach(function(o){var d=fd(o['Expected Delivery Date'])||'No Date';if(!grp[d])grp[d]=[];grp[d].push(o);});
  var dates=Object.keys(grp).sort().reverse();
  var h=filterBar(true);
  h+='<div class="list-feed">';
  dates.forEach(function(d){
    var g=grp[d]; var isT=d===td;
    h+='<div class="sh" style="margin-top:12px"><h3>'+(isT?'<i class="fas fa-bolt" style="color:var(--amber)"></i> TODAY':'📅 '+d)+'</h3><span class="cnt">'+g.length+'</span><div class="ln"></div></div>';
    g.forEach(function(o){
      h+='<div class="lc" onclick="openDetail(\''+esc(o['OrderID'])+'\')">';
      h+='<div class="lc-left">';
      h+='<div class="lc-cust">'+esc(cN(o))+'</div>';
      h+='<div class="lc-loc"><i class="fas fa-map-marker-alt" style="font-size:10px"></i> '+esc(lN(o))+'</div>';
      h+='<div class="lc-meta">';
      if(o['Delivery Boy'])h+='<span><i class="fas fa-motorcycle"></i> '+esc(o['Delivery Boy'])+'</span>';
      if(o['Crates Loaded'])h+='<span><i class="fas fa-box"></i> '+o['Crates Loaded']+' crates</span>';
      if(o['Vehicle No.'])h+='<span><i class="fas fa-truck"></i> '+esc(o['Vehicle No.'])+'</span>';
      if(o['Invoice'])h+='<span style="color:var(--brand);font-weight:700"><i class="fas fa-file-invoice"></i> '+esc(o['Invoice'])+'</span>';
      h+='</div></div>';
      h+='<div class="lc-right">'+sBadge(o._status)+'</div></div>';
    });
  });
  if(!rows.length)h+='<div class="empty"><div class="empty-ico"><i class="fas fa-inbox"></i></div><p>No matching orders</p></div>';
  h+='</div>';
  c.innerHTML=h;
}

/* ─────────────────────────────────────────────────────────────
   9. CHART
───────────────────────────────────────────────────────────── */
function rChart(){
  var c=document.getElementById('content');
  var sc={},crT=0,crR=0,todCnt=0;
  _D.orders.forEach(function(o){var s=o._status||'Pending';sc[s]=(sc[s]||0)+1;crT+=parseFloat(o['Crates Loaded']||0);crR+=parseFloat(o['Returned Crates']||0);if(fd(o['Expected Delivery Date'])===tod())todCnt++;});
  var spend=0; _D.purchasedItems.forEach(function(r){spend+=parseFloat(r['Qty']||0)*parseFloat(r['Rate']||0);});

  var kpis=[
    {l:'Total Orders',v:_D.orders.length,s:'all time',cls:'teal'},
    {l:"Today's EDD",v:todCnt,s:'expected today',cls:'green'},
    {l:'Invoiced',v:sc['Invoiced']||0,s:'completed',cls:'cyan'},
    {l:'DEO Approved',v:sc['DEO Approved']||0,s:'approved',cls:'blue'},
    {l:'Pending',v:sc['Pending']||0,s:'not dispatched',cls:'amber'},
    {l:'Crates Out',v:Math.round(crT),s:'total loaded',cls:'purple'},
    {l:'Crates Back',v:Math.round(crR),s:'returned',cls:'red'},
    {l:'Customers',v:_D.masters.customers.length,s:'master records',cls:'teal'},
    {l:'Items',v:_D.masters.items.length,s:'catalogue',cls:'green'},
    {l:'Vendors',v:_D.masters.vendors.length,s:'active',cls:'blue'},
    {l:'Indents',v:_D.indents.length,s:'purchase lines',cls:'amber'},
    {l:'Est. Spend',v:'₹'+Math.round(spend/1000)+'K',s:'qty×rate',cls:'purple',raw:true}
  ];
  var h='<div class="kpi-grid">';
  kpis.forEach(function(k){h+='<div class="kpi '+k.cls+'"><div class="kpi-label">'+k.l+'</div><div class="kpi-val" style="font-size:'+(k.raw?'20':'26')+'px">'+(k.raw?k.v:k.v.toLocaleString('en-IN'))+'</div><div class="kpi-sub">'+k.s+'</div></div>';});
  h+='</div>';
  h+='<div class="chart-grid">';
  h+='<div class="chart-card"><h3><i class="fas fa-chart-pie" style="color:var(--brand)"></i>Orders by Status</h3><canvas id="ch0" height="220"></canvas></div>';
  h+='<div class="chart-card"><h3><i class="fas fa-chart-bar" style="color:var(--blue)"></i>Daily Volume (14 days)</h3><canvas id="ch1" height="220"></canvas></div>';
  h+='<div class="chart-card"><h3><i class="fas fa-boxes" style="color:var(--green)"></i>Indent vs Purchased (Top 15)</h3><canvas id="ch2" height="220"></canvas></div>';
  h+='<div class="chart-card"><h3><i class="fas fa-motorcycle" style="color:var(--amber)"></i>Delivery Boy Performance</h3><canvas id="ch3" height="220"></canvas></div>';
  h+='<div class="chart-card"><h3><i class="fas fa-box" style="color:var(--purple)"></i>Crates Trend (14 days)</h3><canvas id="ch4" height="220"></canvas></div>';
  h+='<div class="chart-card"><h3><i class="fas fa-building" style="color:var(--cyan)"></i>Top 10 Customers</h3><canvas id="ch5" height="220"></canvas></div>';
  h+='</div>';
  c.innerHTML=h;

  var go={color:'#64748B',plugins:{legend:{labels:{color:'#64748B',font:{size:11,family:'Inter'}}},tooltip:{backgroundColor:'#1E293B',borderColor:'#334155',borderWidth:1,titleColor:'#F8FAFC',bodyColor:'#94A3B8',padding:10}},scales:{x:{ticks:{color:'#94A3B8',font:{size:10}},grid:{color:'rgba(0,0,0,.03)'}},y:{ticks:{color:'#94A3B8',font:{size:10}},grid:{color:'rgba(0,0,0,.05)'}}}};

  var sl=PIPELINE.map(function(p){return p.key;}), sc2=PIPELINE.map(function(p){return p.color;});
  mkC('ch0','doughnut',{labels:sl,datasets:[{data:sl.map(function(k){return sc[k]||0;}),backgroundColor:sc2,borderWidth:0}]},{plugins:go.plugins,cutout:'65%'});

  var dm={}; _D.orders.forEach(function(o){var d=fd(o['Expected Delivery Date']);if(d)dm[d]=(dm[d]||0)+1;});
  var dd=Object.keys(dm).sort().slice(-14);
  mkC('ch1','bar',{labels:dd.map(function(d){return d.substring(5);}),datasets:[{label:'Orders',data:dd.map(function(d){return dm[d];}),backgroundColor:'rgba(14,124,134,.75)',borderColor:'#0E7C86',borderWidth:1,borderRadius:6}]},go);

  var im={}; _D.indents.forEach(function(r){var n=iN(r).substring(0,18);if(!n||n==='—')return;if(!im[n])im[n]={i:0,p:0};im[n].i+=parseFloat(r['Qty']||0);});
  _D.purchasedItems.forEach(function(r){var n=iN(r).substring(0,18);if(!n||n==='—')return;if(!im[n])im[n]={i:0,p:0};im[n].p+=parseFloat(r['Qty']||0);});
  var ik=Object.keys(im).sort(function(a,b){return(im[b].i+im[b].p)-(im[a].i+im[a].p);}).slice(0,15);
  mkC('ch2','bar',{labels:ik,datasets:[{label:'Indented',data:ik.map(function(k){return im[k].i;}),backgroundColor:'rgba(99,102,241,.75)',borderRadius:3},{label:'Purchased',data:ik.map(function(k){return im[k].p;}),backgroundColor:'rgba(34,197,94,.7)',borderRadius:3}]},Object.assign({},go,{indexAxis:'y'}));

  var bm={}; _D.orders.forEach(function(o){var b=String(o['Delivery Boy']||'?').trim();if(!bm[b])bm[b]={d:0,p:0};if(['Invoiced','DEO Approved','DEO Collected','Delivered'].indexOf(o._status)>=0)bm[b].d++;else bm[b].p++;});
  var bk=Object.keys(bm);
  mkC('ch3','bar',{labels:bk,datasets:[{label:'Completed',data:bk.map(function(k){return bm[k].d;}),backgroundColor:'rgba(34,197,94,.8)',borderRadius:4},{label:'Pending',data:bk.map(function(k){return bm[k].p;}),backgroundColor:'rgba(239,68,68,.7)',borderRadius:4}]},go);

  var cm={}; _D.orders.forEach(function(o){var d=fd(o['Expected Delivery Date']);if(!d)return;if(!cm[d])cm[d]={l:0,r:0};cm[d].l+=parseFloat(o['Crates Loaded']||0);cm[d].r+=parseFloat(o['Returned Crates']||0);});
  var cd=Object.keys(cm).sort().slice(-14);
  mkC('ch4','line',{labels:cd.map(function(d){return d.substring(5);}),datasets:[{label:'Loaded',data:cd.map(function(d){return cm[d].l;}),borderColor:'#0E7C86',backgroundColor:'rgba(14,124,134,.08)',fill:true,tension:.4,pointRadius:3},{label:'Returned',data:cd.map(function(d){return cm[d].r;}),borderColor:'#22C55E',backgroundColor:'rgba(34,197,94,.08)',fill:true,tension:.4,pointRadius:3}]},go);

  var custM={}; _D.orders.forEach(function(o){var n=cN(o);if(n&&n!=='—')custM[n]=(custM[n]||0)+1;});
  var ck=Object.keys(custM).sort(function(a,b){return custM[b]-custM[a];}).slice(0,10);
  mkC('ch5','bar',{labels:ck.map(function(n){return n.length>22?n.substring(0,22)+'…':n;}),datasets:[{label:'Orders',data:ck.map(function(k){return custM[k];}),backgroundColor:'rgba(6,182,212,.75)',borderRadius:4}]},Object.assign({},go,{indexAxis:'y'}));
}
function mkC(id,type,data,opts){var el=document.getElementById(id);if(!el)return;try{_charts[id]=new Chart(el,{type:type,data:data,options:Object.assign({responsive:true,maintainAspectRatio:false},opts||{})});}catch(e){console.warn(id,e);}}

/* ─────────────────────────────────────────────────────────────
   10. CALENDAR
───────────────────────────────────────────────────────────── */
function rCalendar(){
  var c=document.getElementById('content');
  var dm={}; _D.orders.forEach(function(o){var d=fd(o['Expected Delivery Date']);if(d){if(!dm[d])dm[d]=[];dm[d].push(o);}});
  var td=tod(),months=['January','February','March','April','May','June','July','August','September','October','November','December'],days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  var y=_calYear,m=_calMonth,fd2=new Date(y,m,1).getDay(),tot=new Date(y,m+1,0).getDate();
  var h='<div class="cal-nav"><button class="cal-nav-btn" onclick="calP()"><i class="fas fa-chevron-left"></i></button>';
  h+='<div class="cal-month">'+months[m]+' '+y+'</div><button class="cal-nav-btn" onclick="calN()"><i class="fas fa-chevron-right"></i></button></div>';
  h+='<div class="cal-grid">';
  days.forEach(function(d){h+='<div class="cal-dn">'+d+'</div>';});
  for(var i=0;i<fd2;i++)h+='<div class="cal-cell emp"></div>';
  for(var d=1;d<=tot;d++){
    var ds=y+'-'+String(m+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');
    var ords=dm[ds]||[],isT=ds===td;
    h+='<div class="cal-cell'+(isT?' today':'')+'" onclick="calDay(\''+ds+'\')" title="'+ords.length+' orders">';
    h+='<div class="cal-num">'+d+'</div>';
    if(ords.length){h+='<div class="cal-dots">';if(ords.length<=4){ords.forEach(function(o){var p=PMAP[o._status]||PMAP['Pending'];h+='<div class="cal-dot" style="background:'+p.color+'" title="'+esc(cN(o))+'"></div>';});}else h+='<div class="cal-dot-many" style="background:var(--brand)">'+ords.length+'</div>';h+='</div>';}
    h+='</div>';
  }
  h+='</div>';
  var mt=0; Object.keys(dm).forEach(function(d){if(d.substring(0,7)===y+'-'+String(m+1).padStart(2,'0'))mt+=dm[d].length;});
  h+='<div style="text-align:center;margin-top:14px;font-size:12px;color:var(--fog)">'+mt+' orders in '+months[m]+' '+y+'</div>';
  c.innerHTML=h;
}
window.calP=function(){_calMonth--;if(_calMonth<0){_calMonth=11;_calYear--;}rCalendar();};
window.calN=function(){_calMonth++;if(_calMonth>11){_calMonth=0;_calYear++;}rCalendar();};
window.calDay=function(ds){
  var ords=_D.orders.filter(function(o){return fd(o['Expected Delivery Date'])===ds;});
  if(!ords.length){toast('No orders on '+ds);return;}
  openDrawer('<i class="fas fa-calendar-alt"></i>','Orders — '+ds,'background:var(--brand-l);color:var(--brand)');
  var h='<div style="display:flex;flex-direction:column;gap:8px">';
  ords.forEach(function(o){h+='<div class="lc" onclick="closeDrawer();openDetail(\''+esc(o['OrderID'])+'\')"><div class="lc-left"><div class="lc-cust">'+esc(cN(o))+'</div><div class="lc-loc">'+esc(lN(o))+'</div></div><div class="lc-right">'+sBadge(o._status)+'</div></div>';});
  h+='</div>';
  document.getElementById('drw-body').innerHTML=h;
  document.getElementById('drw-foot').innerHTML='<button class="btn btn-ghost" onclick="closeDrawer()">Close</button>';
};

/* ─────────────────────────────────────────────────────────────
   11. TIMELINE
───────────────────────────────────────────────────────────── */
function rTimeline(){
  var c=document.getElementById('content');
  var order=_tlOID?_D.orders.find(function(o){return o['OrderID']===_tlOID;}):_D.orders[0];
  var h='<div style="margin-bottom:16px"><select class="fi" style="max-width:480px" onchange="_tlS(this.value)"><option value="">— Select an order —</option>';
  _D.orders.slice(0,300).forEach(function(o){h+='<option value="'+esc(o['OrderID'])+'"'+(order&&o['OrderID']===order['OrderID']?' selected':'')+'>'+esc(cN(o))+' · '+fd(o['Expected Delivery Date'])+'</option>';});
  h+='</select></div>';
  if(!order){h+='<div class="empty"><div class="empty-ico"><i class="fas fa-history"></i></div><p>Select an order</p></div>';c.innerHTML=h;return;}

  h+='<div class="card card-p" style="margin-bottom:20px;display:flex;align-items:center;gap:16px;flex-wrap:wrap">';
  h+='<div><div style="font-size:11px;color:var(--fog);font-weight:700;text-transform:uppercase">Customer</div><div style="font-size:16px;font-weight:800;color:var(--ink)">'+esc(cN(order))+'</div></div>';
  h+='<div><div style="font-size:11px;color:var(--fog)">Location</div><div style="font-size:13px;font-weight:600;color:var(--brand)">'+esc(lN(order))+'</div></div>';
  h+='<div><div style="font-size:11px;color:var(--fog)">EDD</div><div style="font-weight:600">'+fd(order['Expected Delivery Date'])+'</div></div>';
  h+=sBadge(order._status);
  if(order['Delivery Boy'])h+='<div><div style="font-size:11px;color:var(--fog)">Delivery Boy</div><div style="font-weight:600">'+esc(order['Delivery Boy'])+'</div></div>';
  h+='</div>';

  var steps=[
    {n:'Order Created',p:order['Timestamp'],a:order['Timestamp']},
    {n:'WH Loaded & Dispatched',p:order['_step1_planned'],a:order['_step1_actual']},
    {n:'Delivered & Received',p:order['_step2_planned'],a:order['_step2_actual']},
    {n:'Returns Collected',p:order['_step4_planned'],a:order['_step4_actual']},
    {n:'Approved by DEO',p:order['_step5_planned'],a:order['_step5_actual']},
    {n:'Invoiced',p:order['_step6_planned'],a:order['_step6_actual']}
  ];
  h+='<div class="tl">';
  steps.forEach(function(s,idx){
    var done=!!s.a,delta=null,dc='';
    if(idx>0&&steps[idx-1].a&&s.a){delta=parseFloat(dh(steps[idx-1].a,s.a));dc=delta>24?'late':'ok';}
    h+='<div class="tl-step">';
    h+='<div class="tl-dot '+(done?(dc==='late'?'late':'done'):'')+'">'+(done?'<i class="fas fa-check" style="font-size:7px"></i>':(idx+1))+'</div>';
    h+='<div class="tl-card '+(done?(dc==='late'?'late':'done'):'')+'"><div class="tl-name">'+esc(s.n)+'</div>';
    h+='<div class="tl-times"><div class="tl-ti"><div class="l">Planned</div><div class="v">'+fdt(s.p)+'</div></div>';
    h+='<div class="tl-ti"><div class="l">Actual</div><div class="v'+(done?'':' nd')+'">'+(done?fdt(s.a):'Pending…')+'</div></div>';
    if(delta!==null)h+='<div class="tl-ti"><div class="l">Duration</div><div class="v">'+delta+'h</div></div>';
    h+='</div>';
    if(delta!==null)h+='<div class="tl-delta '+dc+'"><i class="fas fa-'+(dc==='late'?'exclamation-triangle':'check-circle')+'"></i> '+(dc==='late'?'Delayed by '+delta+'h':'On time ('+delta+'h)')+'</div>';
    h+='</div></div>';
  });
  h+='</div>';
  c.innerHTML=h;
}
window._tlS=function(oid){_tlOID=oid;rTimeline();};

/* ─────────────────────────────────────────────────────────────
   12. GALLERY
───────────────────────────────────────────────────────────── */
function rGallery(){
  var c=document.getElementById('content');
  var h='<div class="gal-tabs"><button class="gal-tab-btn'+(_galMode==='load'?' active':'')+'" onclick="_gm(\'load\')"><i class="fas fa-box"></i> Loading Photos</button><button class="gal-tab-btn'+(_galMode==='recv'?' active':'')+'" onclick="_gm(\'recv\')"><i class="fas fa-check-circle"></i> Delivery Photos</button><button class="gal-tab-btn'+(_galMode==='pdf'?' active':'')+'" onclick="_gm(\'pdf\')"><i class="fas fa-file-pdf"></i> PDFs</button></div>';
  if(_galMode==='pdf'){
    if(!_D.pdfs.length)h+='<div class="empty"><div class="empty-ico"><i class="fas fa-file-pdf"></i></div><p>No PDFs</p></div>';
    else{h+='<div style="display:flex;flex-direction:column;gap:8px">';_D.pdfs.forEach(function(p){h+='<div class="lc"><div class="lc-left"><div class="lc-cust">'+esc(p['PDF Name']||'?')+'</div><div class="lc-meta"><span>'+fd(p['Date'])+'</span></div></div>'+(p['PDF Link']?'<div class="lc-right"><a href="'+esc(p['PDF Link'])+'" target="_blank" class="btn btn-primary btn-sm"><i class="fas fa-external-link-alt"></i> Open</a></div>':'')+'</div>';});h+='</div>';}
    c.innerHTML=h;return;
  }
  var pk=_galMode==='load'?'Photo':'Receiving Photo';
  var with_=_D.orders.filter(function(o){return!!o[pk];}),wo=_D.orders.filter(function(o){return!o[pk];});
  h+='<div class="sh"><h3>'+(_galMode==='load'?'Loading':'Delivery')+' Photos</h3><span class="cnt">'+with_.length+' / '+_D.orders.length+'</span><div class="ln"></div></div>';
  h+='<div class="gal-grid">';
  with_.slice(0,120).forEach(function(o){
    var src=pSrc(o[pk]);
    h+='<div class="gal-item" onclick="_gO(\''+esc(src)+'\',\''+esc(o['OrderID'])+'\')">';
    if(src)h+='<img src="'+esc(src)+'" alt="'+esc(cN(o))+'" loading="lazy" onerror="this.style.display=\'none\';this.nextSibling.style.display=\'flex\'"/>';
    h+='<div class="gal-ph" style="'+(src?'display:none':'')+'" ><i class="fas fa-camera"></i><span style="font-size:9px;text-align:center">'+esc(cN(o).substring(0,15))+'</span></div>';
    h+='<div class="gal-label">'+esc(cN(o).substring(0,18))+'</div></div>';
  });
  wo.slice(0,20).forEach(function(o){h+='<div class="gal-item" style="opacity:.3" onclick="openDetail(\''+esc(o['OrderID'])+'\')" title="No photo"><div class="gal-ph"><i class="fas fa-ban"></i><span style="font-size:8px;text-align:center">'+esc(cN(o).substring(0,12))+'</span></div></div>';});
  h+='</div>';
  c.innerHTML=h;
}
function pSrc(p){if(!p)return'';if(p.startsWith('http'))return p;if(APP_CONFIG.drivePhotoBase)return APP_CONFIG.drivePhotoBase+'/'+p;return'';}
window._gm=function(m){_galMode=m;rGallery();};
window._gO=function(src,oid){
  if(!src){openDetail(oid);return;}
  openDrawer('<i class="fas fa-image"></i>','Photo — '+esc(cN(_D.orders.find(function(o){return o['OrderID']===oid;})||{})),'background:#F1F5F9;color:var(--slate)');
  document.getElementById('drw-body').innerHTML='<img src="'+esc(src)+'" style="width:100%;border-radius:10px"/>';
  document.getElementById('drw-foot').innerHTML='<a href="'+esc(src)+'" target="_blank" class="btn btn-primary btn-sm"><i class="fas fa-external-link-alt"></i> Open Full</a><button class="btn btn-ghost" onclick="closeDrawer()">Close</button>';
};

/* ─────────────────────────────────────────────────────────────
   13. PIVOT
───────────────────────────────────────────────────────────── */
function rPivot(){
  var c=document.getElementById('content');
  var rOpts=[{k:'Customer',l:'Customer'},{k:'Delivery Boy',l:'Delivery Boy'},{k:'Status',l:'Status'},{k:'Warehouse',l:'Warehouse'}];
  var cOpts=[{k:'Status',l:'Status'},{k:'Customer',l:'Customer'},{k:'Delivery Boy',l:'Delivery Boy'}];
  var h='<div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap">';
  h+='<div class="fb-g"><label>Rows</label><select class="fi" onchange="_pR(this.value)">';rOpts.forEach(function(o){h+='<option value="'+o.k+'"'+(_pivRow===o.k?' selected':'')+'>'+o.l+'</option>';});h+='</select></div>';
  h+='<div class="fb-g"><label>Columns</label><select class="fi" onchange="_pC(this.value)">';cOpts.forEach(function(o){h+='<option value="'+o.k+'"'+(_pivCol===o.k?' selected':'')+'>'+o.l+'</option>';});h+='</select></div></div>';

  var rKey=_pivRow==='Customer'?'_cN':_pivRow==='Status'?'_status':_pivRow;
  var cKey=_pivCol==='Customer'?'_cN':_pivCol==='Status'?'_status':_pivCol;
  var mat={},rT={},cT={};
  _D.orders.forEach(function(o){
    var rv=(_pivRow==='Customer'?cN(o):String(o[rKey]||'Unknown')).trim()||'Unknown';
    var cv=(_pivCol==='Customer'?cN(o):String(o[cKey]||'Unknown')).trim()||'Unknown';
    if(!mat[rv])mat[rv]={};mat[rv][cv]=(mat[rv][cv]||0)+1;rT[rv]=(rT[rv]||0)+1;cT[cv]=(cT[cv]||0)+1;
  });
  var rows=Object.keys(mat).sort(function(a,b){return rT[b]-rT[a];}).slice(0,30);
  var cols=Object.keys(cT).sort();
  h+='<div class="pivot-wrap"><table class="pivot"><thead><tr><th>'+esc(_pivRow)+' / '+esc(_pivCol)+'</th>';
  cols.forEach(function(col){h+='<th>'+esc(col)+'</th>';});h+='<th class="p-tot">Total</th></tr></thead><tbody>';
  rows.forEach(function(rv){
    h+='<tr><td class="p-rhd" title="'+esc(rv)+'">'+esc(rv.length>28?rv.substring(0,28)+'…':rv)+'</td>';
    cols.forEach(function(cv){var n=(mat[rv]&&mat[rv][cv])||0;h+='<td class="p-n'+(n?'':' p-0')+'">'+(n||'—')+'</td>';});
    h+='<td class="p-n p-tot">'+(rT[rv]||0)+'</td></tr>';
  });
  h+='<tr><td class="p-tot">Total</td>';cols.forEach(function(cv){h+='<td class="p-n p-tot">'+(cT[cv]||0)+'</td>';});h+='<td class="p-n p-tot">'+_D.orders.length+'</td></tr>';
  h+='</tbody></table></div>';
  if(Object.keys(mat).length>30)h+='<div style="text-align:center;margin-top:8px;font-size:11px;color:var(--fog)">Top 30 of '+Object.keys(mat).length+' shown</div>';
  c.innerHTML=h;
}
window._pR=function(v){_pivRow=v;rPivot();};window._pC=function(v){_pivCol=v;rPivot();};

/* ─────────────────────────────────────────────────────────────
   14. MAP
───────────────────────────────────────────────────────────── */
function rMap(){
  var c=document.getElementById('content');
  var lm={};
  _D.orders.forEach(function(o){var ln=lN(o)||'Unknown';if(!lm[ln])lm[ln]={orders:[],sc:{}};lm[ln].orders.push(o);var s=o._status||'Pending';lm[ln].sc[s]=(lm[ln].sc[s]||0)+1;});
  var lk=Object.keys(lm).sort(function(a,b){return lm[b].orders.length-lm[a].orders.length;});
  var h='<div class="kpi-grid" style="margin-bottom:20px">';
  h+='<div class="kpi teal"><div class="kpi-label">Locations</div><div class="kpi-val">'+lk.length+'</div></div>';
  h+='<div class="kpi green"><div class="kpi-label">Customers</div><div class="kpi-val">'+_D.masters.customers.length+'</div></div>';
  h+='<div class="kpi blue"><div class="kpi-label">Orders</div><div class="kpi-val">'+_D.orders.length+'</div></div>';
  h+='</div>';
  h+='<div class="loc-cards">';
  lk.slice(0,60).forEach(function(ln){
    var d=lm[ln];var tot=d.orders.length;var inv=d.sc['Invoiced']||0;var pct=tot?Math.round(inv/tot*100):0;
    h+='<div class="loc-card" onclick="_lD(\''+esc(ln)+'\')">';
    h+='<div style="font-size:20px;margin-bottom:8px"><i class="fas fa-map-marker-alt" style="color:var(--brand)"></i></div>';
    h+='<div class="loc-card-name" title="'+esc(ln)+'">'+esc(ln.length>26?ln.substring(0,26)+'…':ln)+'</div>';
    h+='<div class="loc-card-cnt">'+tot+' orders</div>';
    h+='<div style="margin:8px 0;display:flex;flex-wrap:wrap;gap:3px">';
    Object.keys(d.sc).forEach(function(s){h+=sBadge(s)+'<span style="font-size:9px;color:var(--fog);margin-right:3px"> '+d.sc[s]+'</span>';});
    h+='</div>';
    h+='<div class="loc-bar"><div class="loc-fill" style="width:'+pct+'%"></div></div>';
    h+='<div class="loc-pct">'+pct+'% invoiced</div></div>';
  });
  h+='</div>';
  c.innerHTML=h;
}
window._lD=function(ln){
  var ords=_D.orders.filter(function(o){return lN(o)===ln;});
  openDrawer('<i class="fas fa-map-marker-alt"></i>',ln,'background:var(--brand-l);color:var(--brand)');
  var h='<div style="display:flex;flex-direction:column;gap:8px">';
  ords.slice(0,60).forEach(function(o){h+='<div class="lc" onclick="closeDrawer();openDetail(\''+esc(o['OrderID'])+'\')"><div class="lc-left"><div class="lc-cust">'+esc(cN(o))+'</div><div class="lc-meta"><span>'+fd(o['Expected Delivery Date'])+'</span></div></div><div class="lc-right">'+sBadge(o._status)+'</div></div>';});
  h+='</div>';
  document.getElementById('drw-body').innerHTML=h;
  document.getElementById('drw-foot').innerHTML='<button class="btn btn-ghost" onclick="closeDrawer()">Close</button>';
};

/* ─────────────────────────────────────────────────────────────
   15. TREE
───────────────────────────────────────────────────────────── */
function rTree(){
  var c=document.getElementById('content');
  var cm={}; _D.orders.forEach(function(o){var cu=cN(o);if(!cm[cu])cm[cu]=[];cm[cu].push(o);});
  var im={}; _D.orderDetails.forEach(function(r){var oid=String(r['OrderID']||'').trim();if(!im[oid])im[oid]=[];im[oid].push(r);});
  var h='<div class="fbar"><div class="fb-g" style="flex:1"><label>Search Customer or Location</label><div class="fb-search"><i class="fas fa-search"></i><input class="fi fb-search" type="search" placeholder="Hotel, restaurant, company…" oninput="_tSrch(this.value)"></div></div></div>';
  h+='<div class="tree" id="tree-root">';
  Object.keys(cm).sort().forEach(function(cust,ci){
    var ords=cm[cust],nid='tn-'+ci;
    h+='<div class="t-node" id="'+nid+'"><div class="t-hd" onclick="tT(\''+nid+'\')"><i class="fas fa-chevron-right t-chevron"></i><span class="t-label"><i class="fas fa-building" style="color:var(--brand);margin-right:8px;font-size:12px"></i>'+esc(cust)+'</span><span class="t-count">'+ords.length+' orders</span></div>';
    h+='<div class="t-children">';
    ords.slice(0,30).forEach(function(o,oi){
      var onid=nid+'-o'+oi,its=im[o['OrderID']]||[];
      h+='<div class="t-order" id="'+onid+'"><div class="t-ohd" onclick="tOT(\''+onid+'\')">';
      h+='<i class="fas fa-chevron-right t-chevron"></i>';
      h+=sBadge(o._status);
      h+='<span style="margin-left:8px;font-size:12px;color:var(--brand)"><i class="fas fa-map-marker-alt" style="font-size:10px"></i> '+esc(lN(o).substring(0,22))+'</span>';
      h+='<span style="font-size:11px;color:var(--fog);margin-left:auto">'+its.length+' items · '+fd(o['Expected Delivery Date'])+'</span>';
      h+='<button class="btn btn-ghost btn-xs" style="margin-left:8px" onclick="event.stopPropagation();openDetail(\''+esc(o['OrderID'])+'\')"><i class="fas fa-eye"></i></button>';
      h+='</div><div class="t-oitems">';
      if(its.length){its.forEach(function(it){var info=it._itemInfo||(_M.item[String(it['Item Name']||'').trim()])||{};h+='<div class="t-irow"><span class="t-iname">'+esc(iN(it))+'<span style="color:var(--fog);font-size:9px;margin-left:4px">['+esc(info.cat||'')+']</span></span><span style="color:var(--fog);font-size:10px">'+esc(info.unit||'')+'</span><span class="t-iqty">'+fn2(it['Qty'])+'</span></div>';});}
      else h+='<div style="font-size:11px;color:var(--fog);padding:4px">No items in cache</div>';
      h+='</div></div>';
    });
    if(ords.length>30)h+='<div style="padding:8px;font-size:10px;color:var(--fog)">+' +(ords.length-30)+' more orders…</div>';
    h+='</div></div>';
  });
  h+='</div>';
  c.innerHTML=h;
}
window.tT=function(id){var n=document.getElementById(id);if(n)n.classList.toggle('open');};
window.tOT=function(id){var n=document.getElementById(id);if(n)n.classList.toggle('open');};
window._tSrch=function(q){q=q.toLowerCase();document.querySelectorAll('#tree-root .t-node').forEach(function(n){var t=(n.querySelector('.t-label')||{}).textContent||'';var os='';n.querySelectorAll('.t-ohd').forEach(function(el){os+=el.textContent;});n.style.display=(!q||t.toLowerCase().indexOf(q)>=0||os.toLowerCase().indexOf(q)>=0)?'':'none';});};

/* ─────────────────────────────────────────────────────────────
   16. PURCHASE
───────────────────────────────────────────────────────────── */
function rPurchase(){
  var c=document.getElementById('content');
  var spend=0; _D.purchasedItems.forEach(function(r){spend+=parseFloat(r['Qty']||0)*parseFloat(r['Rate']||0);});
  var vm={};
  _D.purchasedItems.forEach(function(r){var vn=vN(r);if(!vm[vn])vm[vn]={qty:0,spend:0,items:0};vm[vn].qty+=parseFloat(r['Qty']||0);vm[vn].spend+=parseFloat(r['Qty']||0)*parseFloat(r['Rate']||0);vm[vn].items++;});
  var catM={'Fruit':0,'Veg':0,'Other':0};
  _D.indents.forEach(function(r){var info=r._itemInfo||(_M.item[String(r['Item Name']||'').trim()])||{};var cat=info.cat||'Other';catM[cat]=(catM[cat]||0)+parseFloat(r['Qty']||0);});

  var h='<div class="pur-hero"><h2>Estimated Purchase Spend</h2><div class="big">₹'+Math.round(spend).toLocaleString('en-IN')+'</div><div class="sub">'+_D.purchasedItems.length+' line items · '+Object.keys(vm).length+' vendors · '+_D.indents.length+' indents</div></div>';
  h+='<div class="kpi-grid">';
  [{l:'Indents',v:_D.indents.length,cls:'teal'},{l:'Purchased',v:_D.purchasedItems.length,cls:'green'},{l:'Vendors',v:Object.keys(vm).length,cls:'blue'},{l:'Fruit (KG)',v:Math.round(catM['Fruit']||0),cls:'amber'},{l:'Veg (KG)',v:Math.round(catM['Veg']||0),cls:'green'},{l:'Dump',v:_D.dumpItems.length,cls:'red'}].forEach(function(k){h+='<div class="kpi '+k.cls+'"><div class="kpi-label">'+k.l+'</div><div class="kpi-val" style="font-size:22px">'+k.v.toLocaleString('en-IN')+'</div></div>';});
  h+='</div>';

  // Vendor table
  var vk=Object.keys(vm).sort(function(a,b){return vm[b].spend-vm[a].spend;});
  h+='<div class="sh"><h3>Vendor Spend</h3><span class="cnt">'+vk.length+'</span><div class="ln"></div>';
  if(isManagement())h+='<button class="btn btn-primary btn-sm" onclick="openPurchasedForm(null)"><i class="fas fa-plus"></i> Add Purchase</button>';
  h+='</div>';
  h+='<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Vendor</th><th class="num">Lines</th><th class="num">Qty</th><th class="num">Spend (₹)</th></tr></thead><tbody>';
  vk.slice(0,25).forEach(function(vn){h+='<tr><td style="font-weight:600">'+esc(vn)+'</td><td class="num">'+vm[vn].items+'</td><td class="num">'+vm[vn].qty.toLocaleString('en-IN')+'</td><td class="num" style="color:var(--brand);font-weight:700">₹'+Math.round(vm[vn].spend).toLocaleString('en-IN')+'</td></tr>';});
  h+='</tbody></table></div>';

  // Purchased items with filters
  h+='<div class="sh" style="margin-top:20px"><h3>Purchased Items</h3><span class="cnt">'+_D.purchasedItems.length+'</span><div class="ln"></div></div>';
  var cats=['Fruit','Veg'],subs=[];
  _D.masters.items.forEach(function(i){if(i.subcat&&subs.indexOf(i.subcat)<0)subs.push(i.subcat);});
  h+='<div class="fbar"><div class="fb-g"><label>Category</label><select class="fi" id="pc-cat" onchange="_purF()"><option value="">All</option>';
  cats.forEach(function(ca){h+='<option>'+esc(ca)+'</option>';});h+='</select></div>';
  h+='<div class="fb-g"><label>Sub-Category</label><select class="fi" id="pc-sub" onchange="_purF()"><option value="">All</option>';
  subs.forEach(function(s){h+='<option>'+esc(s)+'</option>';});h+='</select></div>';
  h+='<div class="fb-g wide"><label>Search Item or Vendor</label><div class="fb-search"><i class="fas fa-search"></i><input class="fi fb-search" type="search" id="pc-q" placeholder="Item name, vendor…" oninput="_purF()"></div></div></div>';
  h+='<div id="pur-tbl">'+purTbl(_D.purchasedItems)+'</div>';

  // Indent table
  h+='<div class="sh" style="margin-top:20px"><h3>Purchase Indents</h3><span class="cnt">'+_D.indents.length+'</span><div class="ln"></div>';
  if(isManagement())h+='<button class="btn btn-primary btn-sm" onclick="openIndentForm(null)"><i class="fas fa-plus"></i> Add Indent</button>';
  h+='</div>';
  h+='<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Item</th><th>Category</th><th>Unit</th><th class="num">Qty</th><th>Date</th>';
  if(isManagement())h+='<th></th>';
  h+='</tr></thead><tbody>';
  _D.indents.slice(0,100).forEach(function(r){
    var info=r._itemInfo||(_M.item[String(r['Item Name']||'').trim()])||{};
    h+='<tr><td><div style="font-weight:600">'+esc(iN(r))+'</div></td>';
    h+='<td><span class="badge br">'+esc(info.cat||'—')+'</span></td>';
    h+='<td style="color:var(--fog)">'+esc(info.unit||'—')+'</td>';
    h+='<td class="num" style="color:var(--brand);font-weight:700">'+fn2(r['Qty'])+'</td>';
    h+='<td>'+fd(r['Timestamp'])+'</td>';
    if(isManagement())h+='<td style="white-space:nowrap"><button class="ab edit" onclick="openIndentForm(\''+esc(r['UID'])+'\')" title="Edit"><i class="fas fa-pencil"></i></button> <button class="ab del" onclick="confirmDelete(\'indent\',\''+esc(r['UID'])+'\',\''+esc(iN(r))+'\')" title="Delete"><i class="fas fa-trash"></i></button></td>';
    h+='</tr>';
  });
  h+='</tbody></table></div>';

  if(_D.dumpItems.length){
    h+='<div class="sh" style="margin-top:20px"><h3>Dump Entries</h3><span class="cnt">'+_D.dumpItems.length+'</span><div class="ln"></div>';
    if(isManagement())h+='<button class="btn btn-primary btn-sm" onclick="openDumpForm()"><i class="fas fa-plus"></i> Add</button>';
    h+='</div>';
    h+='<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th>By</th><th>Item</th><th class="num">Qty</th><th>Reason</th>';
    if(isManagement())h+='<th></th>';
    h+='</tr></thead><tbody>';
    _D.dumpItems.forEach(function(r){h+='<tr><td>'+fd(r['Timestamp'])+'</td><td>'+esc(r['Useremail']||'—')+'</td><td>'+esc(r['Item']||'—')+'</td><td class="num">'+fn2(r['Qty'])+'</td><td>'+esc(r['Reason']||'—')+'</td>'+(isManagement()?'<td><button class="ab del" onclick="confirmDelete(\'dump\',\''+esc(r['UID'])+'\',\'Dump entry\')" title="Delete"><i class="fas fa-trash"></i></button></td>':'')+'</tr>';});
    h+='</tbody></table></div>';
  }
  c.innerHTML=h;
}

function purTbl(data){
  if(!data.length)return'<div class="empty"><div class="empty-ico"><i class="fas fa-inbox"></i></div><p>No items match</p></div>';
  var h='<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Item</th><th>Category</th><th>Vendor</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount (₹)</th><th>Date</th>';
  if(isManagement())h+='<th></th>';
  h+='</tr></thead><tbody>';
  data.slice(0,150).forEach(function(r){
    var info=r._itemInfo||(_M.item[String(r['Item Name']||'').trim()])||{};
    var amt=parseFloat(r['Qty']||0)*parseFloat(r['Rate']||0);
    h+='<tr><td><div style="font-weight:600">'+esc(iN(r))+'</div></td>';
    h+='<td><span class="badge br">'+esc(info.cat||'—')+'</span></td>';
    h+='<td style="font-weight:500">'+esc(vN(r))+'</td>';
    h+='<td class="num">'+fn2(r['Qty'])+'<span style="color:var(--fog);font-size:9px;margin-left:3px">'+esc(info.unit||'')+'</span></td>';
    h+='<td class="num">₹'+fn2(r['Rate'])+'</td>';
    h+='<td class="num" style="color:var(--brand);font-weight:700">₹'+Math.round(amt).toLocaleString('en-IN')+'</td>';
    h+='<td style="font-size:11px">'+fd(r['Timestamp'])+'</td>';
    if(isManagement())h+='<td style="white-space:nowrap"><button class="ab edit" onclick="openPurchasedForm(\''+esc(r['UID'])+'\')" title="Edit"><i class="fas fa-pencil"></i></button> <button class="ab del" onclick="confirmDelete(\'purchased\',\''+esc(r['UID'])+'\',\''+esc(iN(r))+'\')" title="Delete"><i class="fas fa-trash"></i></button></td>';
    h+='</tr>';
  });
  if(data.length>150)h+='<tr><td colspan="'+(isManagement()?8:7)+'" style="text-align:center;padding:10px;font-size:11px;color:var(--fog)">Showing 150 of '+data.length+'</td></tr>';
  return h+'</tbody></table></div>';
}
window._purF=function(){
  var cat=(document.getElementById('pc-cat')||{}).value||'';
  var sub=(document.getElementById('pc-sub')||{}).value||'';
  var q=((document.getElementById('pc-q')||{}).value||'').toLowerCase();
  var data=_D.purchasedItems.filter(function(r){
    var info=r._itemInfo||(_M.item[String(r['Item Name']||'').trim()])||{};
    if(cat&&info.cat!==cat)return false;
    if(sub&&info.subcat!==sub)return false;
    if(q&&(iN(r)+' '+vN(r)).toLowerCase().indexOf(q)===-1)return false;
    return true;
  });
  var wrap=document.getElementById('pur-tbl'); if(wrap)wrap.innerHTML=purTbl(data);
};

/* ─────────────────────────────────────────────────────────────
   17. MASTERS CRUD (management only)
───────────────────────────────────────────────────────────── */
function rMasters(){
  if(!isManagement()){document.getElementById('content').innerHTML='<div class="empty"><div class="empty-ico"><i class="fas fa-lock"></i></div><p>Management access required</p></div>';return;}
  var c=document.getElementById('content');
  var tabs=['customers','locations','items','vendors'];
  var icons={customers:'fa-building',locations:'fa-map-marker-alt',items:'fa-apple-alt',vendors:'fa-store'};
  var labels={customers:'Customers ('+_D.masters.customers.length+')',locations:'Locations ('+_D.masters.locations.length+')',items:'Items ('+_D.masters.items.length+')',vendors:'Vendors ('+_D.masters.vendors.length+')'};
  var h='<div class="mtabs">';
  tabs.forEach(function(t){h+='<button class="mtab'+(_masterTab===t?' active':'')+'" onclick="_mTab(\''+t+'\')">'+esc(labels[t])+'</button>';});
  h+='</div>';
  h+='<div style="display:flex;align-items:center;justify-content:flex-end;margin-bottom:12px"><button class="btn btn-primary btn-sm" onclick="openMasterForm(\''+_masterTab+'\',null)"><i class="fas fa-plus"></i> Add '+_masterTab.slice(0,-1).charAt(0).toUpperCase()+_masterTab.slice(0,-1).slice(1)+'</button></div>';

  if(_masterTab==='customers'){
    h+='<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Company Name</th><th>Contact Person</th><th>Phone</th><th>Email</th><th></th></tr></thead><tbody>';
    _D.masters.customers.forEach(function(r){h+='<tr><td style="font-weight:600">'+esc(r.name)+'</td><td>'+esc(r['Contact Person Name']||'—')+'</td><td>'+esc(r['Contact Person Number']||'—')+'</td><td>'+esc(r['Email']||'—')+'</td><td style="white-space:nowrap"><button class="ab edit" onclick="openMasterForm(\'customers\',\''+esc(r.uid)+'\')"><i class="fas fa-pencil"></i></button> <button class="ab del" onclick="confirmDelete(\'customer\',\''+esc(r.uid)+'\',\''+esc(r.name)+'\')"><i class="fas fa-trash"></i></button></td></tr>';});
    h+='</tbody></table></div>';
  } else if(_masterTab==='locations'){
    h+='<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Location Name</th><th>Customer</th><th>Remark</th><th></th></tr></thead><tbody>';
    _D.masters.locations.forEach(function(r){var custName=_M.cust[r.custUID]||r.custUID||'—';h+='<tr><td style="font-weight:600">'+esc(r.name)+'</td><td>'+esc(custName)+'</td><td style="font-size:11px;color:var(--fog)">'+esc(r.remark||'—')+'</td><td style="white-space:nowrap"><button class="ab edit" onclick="openMasterForm(\'locations\',\''+esc(r.uid)+'\')"><i class="fas fa-pencil"></i></button> <button class="ab del" onclick="confirmDelete(\'location\',\''+esc(r.uid)+'\',\''+esc(r.name)+'\')"><i class="fas fa-trash"></i></button></td></tr>';});
    h+='</tbody></table></div>';
  } else if(_masterTab==='items'){
    h+='<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Item Name</th><th>Category</th><th>Sub-Category</th><th>Unit</th><th></th></tr></thead><tbody>';
    _D.masters.items.forEach(function(r){h+='<tr><td style="font-weight:600">'+esc(r.name)+'</td><td><span class="badge br">'+esc(r.cat||'—')+'</span></td><td style="font-size:11px;color:var(--slate)">'+esc(r.subcat||'—')+'</td><td style="color:var(--fog)">'+esc(r.unit||'—')+'</td><td style="white-space:nowrap"><button class="ab edit" onclick="openMasterForm(\'items\',\''+esc(r.uid)+'\')"><i class="fas fa-pencil"></i></button> <button class="ab del" onclick="confirmDelete(\'item\',\''+esc(r.uid)+'\',\''+esc(r.name)+'\')"><i class="fas fa-trash"></i></button></td></tr>';});
    h+='</tbody></table></div>';
  } else if(_masterTab==='vendors'){
    h+='<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Vendor Name</th><th>Contact</th><th>Phone</th><th></th></tr></thead><tbody>';
    _D.masters.vendors.forEach(function(r){h+='<tr><td style="font-weight:600">'+esc(r.name)+'</td><td>'+esc(r['Contact Person Name']||'—')+'</td><td>'+esc(r['Contact Person Number']||'—')+'</td><td style="white-space:nowrap"><button class="ab edit" onclick="openMasterForm(\'vendors\',\''+esc(r.uid)+'\')"><i class="fas fa-pencil"></i></button> <button class="ab del" onclick="confirmDelete(\'vendor\',\''+esc(r.uid)+'\',\''+esc(r.name)+'\')"><i class="fas fa-trash"></i></button></td></tr>';});
    h+='</tbody></table></div>';
  }
  c.innerHTML=h;
}
window._mTab=function(t){_masterTab=t;rMasters();};

/* ─────────────────────────────────────────────────────────────
   18. DETAIL DRAWER
───────────────────────────────────────────────────────────── */
window.openDetail=function(oid){
  var order=_D.orders.find(function(o){return String(o['OrderID']).trim()===String(oid).trim();});
  if(!order){toast('Order not found','err');return;}
  var items=_D.orderDetails.filter(function(r){return String(r['OrderID']).trim()===String(oid).trim();});
  var recItms=_D.receivedItems.filter(function(r){return String(r['OrderID']).trim()===String(oid).trim();});
  var retItms=_D.returnedItems.filter(function(r){return String(r['OrderID']).trim()===String(oid).trim();});

  openDrawer('<i class="fas fa-box-open"></i>',cN(order),'background:var(--brand-l);color:var(--brand)',lN(order)+' · '+sBadge(order._status));

  var h='';
  // Location hero
  h+='<div class="info-box teal" style="margin-bottom:16px"><i class="fas fa-map-marker-alt"></i><div><strong>'+esc(lN(order))+'</strong><div style="font-size:11px;margin-top:2px;opacity:.8">'+esc(cN(order))+'</div></div></div>';

  // Status stepper (for user role — advance pipeline)
  h+='<div class="sh"><h3>Pipeline Status</h3><div class="ln"></div></div>';
  h+=sBadge(order._status);
  h+='<div class="status-stepper">';
  var curIdx=PIPELINE.findIndex(function(p){return p.key===order._status;}); if(curIdx<0)curIdx=0;
  PIPELINE.forEach(function(p,i){
    var step=p.step;
    var done=!!order[step]||(p.key==='Pending');
    if(i<curIdx){
      // Already done — show undo option for management
      if(isManagement()&&step)
        h+='<button class="ss-btn done" onclick="updateStatus(\''+esc(oid)+'\',\''+p.key+'\',true)"><i class="fas fa-check"></i> '+esc(p.label)+'</button>';
      else
        h+='<button class="ss-btn done" disabled><i class="fas fa-check"></i> '+esc(p.label)+'</button>';
    } else if(i===curIdx){
      // Current
      if(i<PIPELINE.length-1)
        h+='<button class="ss-btn next" onclick="updateStatus(\''+esc(oid)+'\',\''+PIPELINE[i+1].key+'\',false)"><i class="fas fa-arrow-right"></i> Move to '+esc(PIPELINE[i+1].label)+'</button>';
    }
  });
  h+='</div>';

  // KV grid
  h+='<div class="sh" style="margin-top:16px"><h3>Order Details</h3><div class="ln"></div>';
  if(isManagement())h+='<button class="btn btn-ghost btn-xs" onclick="openOrderForm(\''+esc(oid)+'\')"><i class="fas fa-pencil"></i> Edit</button>';
  h+='</div>';
  h+='<div class="kv-grid">';
  [['Customer',cN(order)],['Location',lN(order)],['Warehouse',order['Warehouse']],['EDD',fd(order['Expected Delivery Date'])],['Delivery Boy',order['Delivery Boy']],['Vehicle',order['Vehicle No.']],['Crates Loaded',order['Crates Loaded']],['Ret. Crates',order['Returned Crates']],['Invoice',order['Invoice']],['WH Status',order['WH Status']]].forEach(function(kv){
    h+='<div class="kv-item"><div class="kv-label">'+esc(kv[0])+'</div><div class="kv-val">'+esc(kv[1]||'—')+'</div></div>';
  });
  h+='</div>';

  // Line items
  h+='<div class="sh" style="margin-top:14px"><h3>Line Items</h3><span class="cnt">'+items.length+'</span><div class="ln"></div></div>';
  if(items.length){
    h+='<div class="tbl-wrap"><table class="tbl"><thead><tr><th>#</th><th>Item</th><th>Cat.</th><th>Unit</th><th class="num">Ordered</th><th class="num">Received</th></tr></thead><tbody>';
    items.forEach(function(it,idx){
      var rv=recItms.find(function(r){return r['Item Name']===it['Item Name'];});
      var info=it._itemInfo||(_M.item[String(it['Item Name']||'').trim()])||{};
      h+='<tr><td style="color:var(--fog)">'+(idx+1)+'</td><td style="font-weight:600">'+esc(iN(it))+'</td>';
      h+='<td><span class="badge br" style="font-size:9px">'+esc(info.cat||'—')+'</span></td>';
      h+='<td style="color:var(--fog);font-size:11px">'+esc(info.unit||'—')+'</td>';
      h+='<td class="num" style="color:var(--brand);font-weight:700">'+fn2(it['Qty'])+'</td>';
      h+='<td class="num" style="color:var(--green-d)">'+(rv?fn2(rv['Qty']):'—')+'</td></tr>';
    });
    h+='</tbody></table></div>';
  }

  // Returned items
  if(retItms.length){
    h+='<div class="sh" style="margin-top:12px"><h3>Returned Items</h3><span class="cnt">'+retItms.length+'</span><div class="ln"></div></div>';
    h+='<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Item</th><th class="num">Qty</th></tr></thead><tbody>';
    retItms.forEach(function(it){h+='<tr><td>'+esc(iN(it))+'</td><td class="num" style="color:var(--amber-d)">'+fn2(it['Qty'])+'</td></tr>';});
    h+='</tbody></table></div>';
  }

  // Photos
  h+='<div class="sh" style="margin-top:14px"><h3>Photos</h3><div class="ln"></div></div>';
  h+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">';
  ['Photo','Receiving Photo'].forEach(function(pk){
    var src=pSrc(order[pk]);
    h+='<div style="aspect-ratio:4/3;background:var(--elevated);border:1px solid var(--border);border-radius:10px;overflow:hidden;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:6px;color:var(--fog)">';
    if(src)h+='<img src="'+esc(src)+'" style="width:100%;height:100%;object-fit:cover;cursor:zoom-in" onclick="_gO(\''+esc(src)+'\',\'\')" />';
    else h+='<i class="fas '+(pk==='Photo'?'fa-box':'fa-truck')+'" style="font-size:20px"></i><span style="font-size:10px">'+esc(pk==='Photo'?'Loading Photo':'Delivery Photo')+'</span><span style="font-size:9px;color:var(--mist)">Not uploaded</span>';
    h+='</div>';
  });
  h+='</div>';

  // Mini timeline
  h+='<div class="sh"><h3>Pipeline Steps</h3><div class="ln"></div></div>';
  h+='<div class="tl">';
  [{l:'Created',t:order['Timestamp']},{l:'WH Loaded',t:order['_step1_actual']},{l:'Delivered',t:order['_step2_actual']},{l:'Returns Collected',t:order['_step4_actual']},{l:'DEO Approved',t:order['_step5_actual']},{l:'Invoiced',t:order['_step6_actual']}].forEach(function(s){
    h+='<div class="tl-step"><div class="tl-dot '+(s.t?'done':'')+'">'+(s.t?'<i class="fas fa-check" style="font-size:7px"></i>':'·')+'</div>';
    h+='<div style="font-size:12px;color:'+(s.t?'var(--ink)':'var(--fog)')+';padding:4px 0">'+esc(s.l)+(s.t?' <span style="color:var(--fog);font-size:10px;font-family:monospace">('+fdt(s.t)+')</span>':'')+'</div></div>';
  });
  h+='</div>';

  if(order['Step4 Remark To Tally Items'])h+='<div class="info-box amber" style="margin-top:12px"><i class="fas fa-comment"></i><div>'+esc(order['Step4 Remark To Tally Items'])+'</div></div>';
  if(order['Invoice Link'])h+='<div style="margin-top:12px"><a href="'+esc(order['Invoice Link'])+'" target="_blank" class="btn btn-primary" style="width:100%;justify-content:center"><i class="fas fa-file-invoice"></i> View Invoice</a></div>';

  document.getElementById('drw-body').innerHTML=h;
  document.getElementById('drw-foot').innerHTML='<button class="btn btn-ghost" onclick="closeDrawer()">Close</button>'+(isManagement()?'<button class="btn btn-danger btn-sm" onclick="confirmDelete(\'order\',\''+esc(oid)+'\',\''+esc(cN(order))+'\')"><i class="fas fa-trash"></i> Delete</button>':'');
};

/* Status update */
window.updateStatus=function(oid,newStatus,clear){
  _api('updateOrderStatus',{orderID:oid,status:newStatus,clearTimestamp:!!clear},function(r){
    if(!r||!r.success){toast(r&&r.error?r.error:'Update failed','err');return;}
    toast('✓ Status → '+newStatus,'ok');
    loadAll(true);
    setTimeout(function(){openDetail(oid);},1500);
  },function(e){toast('Error: '+e.message,'err');});
};

/* ─────────────────────────────────────────────────────────────
   19. ORDER FORM (CRUD)
───────────────────────────────────────────────────────────── */
window.openOrderForm=function(orderID){
  if(!isManagement()){toast('Management only','err');return;}
  var order=orderID?_D.orders.find(function(o){return o['OrderID']===orderID;}):null;
  var title=(order?'Edit':'New')+' Order';
  openDrawer('<i class="fas fa-'+(order?'pencil':'plus')+'"></i>',title,'background:'+(order?'var(--amber-l)':'var(--brand-l)')+';color:'+(order?'var(--amber-d)':'var(--brand)'));

  // Build customer & location options
  var custOpts='<option value="">Select Customer</option>';
  _D.masters.customers.forEach(function(cust){custOpts+='<option value="'+esc(cust.uid)+'"'+(order&&order['Customer Name']===cust.uid?' selected':'')+'>'+esc(cust.name)+'</option>';});

  var locOpts='<option value="">Select Location</option>';
  _D.masters.locations.forEach(function(loc){locOpts+='<option value="'+esc(loc.uid)+'"'+(order&&order['Delivery Location']===loc.uid?' selected':'')+'>'+esc(loc.name)+'</option>';});

  var h='<div id="order-form">';
  h+='<div class="fgroup"><label class="flabel">Customer *</label><select class="fi" id="of-cust" onchange="_ofLocFilter(this.value)">'+custOpts+'</select></div>';
  h+='<div class="fgroup"><label class="flabel">Delivery Location *</label><select class="fi" id="of-loc">'+locOpts+'</select></div>';
  h+='<div class="frow"><div class="fgroup"><label class="flabel">Expected Delivery Date</label><input class="fi" id="of-edd" type="date" value="'+esc(fd(order&&order['Expected Delivery Date']))+'"></div>';
  h+='<div class="fgroup"><label class="flabel">Warehouse</label><input class="fi" id="of-wh" value="'+esc(order&&order['Warehouse']||'')+'" placeholder="Warehouse name"></div></div>';
  h+='<div class="frow"><div class="fgroup"><label class="flabel">Delivery Boy</label><input class="fi" id="of-db" value="'+esc(order&&order['Delivery Boy']||'')+'" placeholder="Name"></div>';
  h+='<div class="fgroup"><label class="flabel">Vehicle No.</label><input class="fi" id="of-veh" value="'+esc(order&&order['Vehicle No.']||'')+'" placeholder="DL-00-AB-0000"></div></div>';
  h+='<div class="frow"><div class="fgroup"><label class="flabel">Crates Loaded</label><input class="fi" id="of-cl" type="number" value="'+esc(order&&order['Crates Loaded']||0)+'"></div>';
  h+='<div class="fgroup"><label class="flabel">Returned Crates</label><input class="fi" id="of-rc" type="number" value="'+esc(order&&order['Returned Crates']||0)+'"></div></div>';
  h+='<div class="frow"><div class="fgroup"><label class="flabel">Invoice No.</label><input class="fi" id="of-inv" value="'+esc(order&&order['Invoice']||'')+'" placeholder="INV-XXXX"></div>';
  h+='<div class="fgroup"><label class="flabel">Invoice Link</label><input class="fi" id="of-invl" value="'+esc(order&&order['Invoice Link']||'')+'" placeholder="Google Drive URL"></div></div>';
  h+='</div>';

  document.getElementById('drw-body').innerHTML=h;
  document.getElementById('drw-foot').innerHTML=
    '<button class="btn btn-ghost" onclick="closeDrawer()">Cancel</button>'+
    '<button class="btn btn-primary" onclick="_saveOrder(\''+esc(orderID||'')+'\')"><i class="fas fa-save"></i> '+(order?'Update':'Create')+'</button>';
};

window._ofLocFilter=function(custUID){
  var sel=document.getElementById('of-loc'); if(!sel)return;
  var cur=sel.value;
  var opts='<option value="">Select Location</option>';
  _D.masters.locations.filter(function(l){return !custUID||l.custUID===custUID;}).forEach(function(loc){opts+='<option value="'+esc(loc.uid)+'"'+(loc.uid===cur?' selected':'')+'>'+esc(loc.name)+'</option>';});
  sel.innerHTML=opts;
};

window._saveOrder=function(oid){
  var g=function(id){return (document.getElementById(id)||{}).value||'';};
  var data={
    'Customer Name':g('of-cust'),'Delivery Location':g('of-loc'),
    'Expected Delivery Date':g('of-edd'),'Warehouse':g('of-wh'),
    'Delivery Boy':g('of-db'),'Vehicle No.':g('of-veh'),
    'Crates Loaded':g('of-cl'),'Returned Crates':g('of-rc'),
    'Invoice':g('of-inv'),'Invoice Link':g('of-invl')
  };
  if(!data['Customer Name']||!data['Delivery Location']){toast('Customer and Location required','err');return;}
  var action=oid?'updateOrder':'createOrder';
  if(oid)data.orderID=oid;
  setDrwLoading(true);
  _api(action,data,function(r){
    setDrwLoading(false);
    if(!r||!r.success){toast(r&&r.error?r.error:'Save failed','err');return;}
    toast('✓ Order '+(oid?'updated':'created'),'ok'); closeDrawer(); loadAll(true);
  },function(e){setDrwLoading(false);toast('Error: '+e.message,'err');});
};

/* ─────────────────────────────────────────────────────────────
   20. INDENT / PURCHASED / DUMP FORMS
───────────────────────────────────────────────────────────── */
window.openIndentForm=function(uid){
  if(!isManagement()){toast('Management only','err');return;}
  var rec=uid?_D.indents.find(function(r){return r['UID']===uid;}):null;
  openDrawer('<i class="fas fa-clipboard-list"></i>',(rec?'Edit':'New')+' Indent','background:var(--blue-l);color:var(--blue-d)');
  var itemOpts='<option value="">Select Item</option>';
  _D.masters.items.forEach(function(i){itemOpts+='<option value="'+esc(i.uid)+'"'+(rec&&rec['Item Name']===i.uid?' selected':'')+'>'+esc(i.name)+' ('+esc(i.unit)+')</option>';});
  var h='<div class="fgroup"><label class="flabel">Item *</label><select class="fi" id="if-item">'+itemOpts+'</select></div>';
  h+='<div class="fgroup"><label class="flabel">Quantity *</label><input class="fi" id="if-qty" type="number" min="0" step="0.5" value="'+esc(rec&&rec['Qty']||'')+'" placeholder="0"></div>';
  document.getElementById('drw-body').innerHTML=h;
  document.getElementById('drw-foot').innerHTML='<button class="btn btn-ghost" onclick="closeDrawer()">Cancel</button><button class="btn btn-primary" onclick="_saveIndent(\''+esc(uid||'')+'\')"><i class="fas fa-save"></i> '+(rec?'Update':'Create')+'</button>';
};

window._saveIndent=function(uid){
  var g=function(id){return (document.getElementById(id)||{}).value||'';};
  var data={'Item Name':g('if-item'),'Qty':g('if-qty')};
  if(!data['Item Name']||!data['Qty']){toast('Item and Qty required','err');return;}
  var action=uid?'updateIndent':'createIndent'; if(uid)data.uid=uid;
  setDrwLoading(true);
  _api(action,data,function(r){setDrwLoading(false);if(!r||!r.success){toast(r&&r.error?r.error:'Save failed','err');return;}toast('✓ Indent saved','ok');closeDrawer();loadAll(true);},function(e){setDrwLoading(false);toast('Error: '+e.message,'err');});
};

window.openPurchasedForm=function(uid){
  if(!isManagement()){toast('Management only','err');return;}
  var rec=uid?_D.purchasedItems.find(function(r){return r['UID']===uid;}):null;
  openDrawer('<i class="fas fa-shopping-bag"></i>',(rec?'Edit':'New')+' Purchase','background:var(--green-l);color:var(--green-d)');
  var itemOpts='<option value="">Select Item</option>';
  _D.masters.items.forEach(function(i){itemOpts+='<option value="'+esc(i.uid)+'"'+(rec&&rec['Item Name']===i.uid?' selected':'')+'>'+esc(i.name)+' ('+esc(i.unit)+')</option>';});
  var vendOpts='<option value="">Select Vendor</option>';
  _D.masters.vendors.forEach(function(v){vendOpts+='<option value="'+esc(v.uid)+'"'+(rec&&rec['Vendor']===v.uid?' selected':'')+'>'+esc(v.name)+'</option>';});
  var h='<div class="fgroup"><label class="flabel">Item *</label><select class="fi" id="pf-item">'+itemOpts+'</select></div>';
  h+='<div class="fgroup"><label class="flabel">Vendor *</label><select class="fi" id="pf-vend">'+vendOpts+'</select></div>';
  h+='<div class="frow"><div class="fgroup"><label class="flabel">Qty *</label><input class="fi" id="pf-qty" type="number" min="0" step="0.5" value="'+esc(rec&&rec['Qty']||'')+'"></div>';
  h+='<div class="fgroup"><label class="flabel">Rate (₹) *</label><input class="fi" id="pf-rate" type="number" min="0" step="0.5" value="'+esc(rec&&rec['Rate']||'')+'"></div></div>';
  document.getElementById('drw-body').innerHTML=h;
  document.getElementById('drw-foot').innerHTML='<button class="btn btn-ghost" onclick="closeDrawer()">Cancel</button><button class="btn btn-primary" onclick="_savePurchased(\''+esc(uid||'')+'\')"><i class="fas fa-save"></i> '+(rec?'Update':'Create')+'</button>';
};
window._savePurchased=function(uid){
  var g=function(id){return (document.getElementById(id)||{}).value||'';};
  var data={'Item Name':g('pf-item'),'Vendor':g('pf-vend'),'Qty':g('pf-qty'),'Rate':g('pf-rate')};
  if(!data['Item Name']||!data['Vendor']||!data['Qty']||!data['Rate']){toast('All fields required','err');return;}
  var action=uid?'updatePurchased':'createPurchased'; if(uid)data.uid=uid;
  setDrwLoading(true);
  _api(action,data,function(r){setDrwLoading(false);if(!r||!r.success){toast(r&&r.error?r.error:'Save failed','err');return;}toast('✓ Purchase entry saved','ok');closeDrawer();loadAll(true);},function(e){setDrwLoading(false);toast('Error: '+e.message,'err');});
};

window.openDumpForm=function(){
  if(!isManagement()){toast('Management only','err');return;}
  openDrawer('<i class="fas fa-trash-alt"></i>','Log Dump Entry','background:var(--red-l);color:var(--red-d)');
  var itemOpts='<option value="">Select Item</option>';
  _D.masters.items.forEach(function(i){itemOpts+='<option value="'+esc(i.uid)+'">'+esc(i.name)+'</option>';});
  var h='<div class="fgroup"><label class="flabel">Item *</label><select class="fi" id="df-item">'+itemOpts+'</select></div>';
  h+='<div class="frow"><div class="fgroup"><label class="flabel">Qty *</label><input class="fi" id="df-qty" type="number" min="0" step="0.5"></div><div class="fgroup"><label class="flabel">Reason</label><input class="fi" id="df-reason" placeholder="Damaged, expired…"></div></div>';
  document.getElementById('drw-body').innerHTML=h;
  document.getElementById('drw-foot').innerHTML='<button class="btn btn-ghost" onclick="closeDrawer()">Cancel</button><button class="btn btn-danger" onclick="_saveDump()"><i class="fas fa-save"></i> Log Dump</button>';
};
window._saveDump=function(){
  var g=function(id){return (document.getElementById(id)||{}).value||'';};
  var data={'Item':g('df-item'),'Qty':g('df-qty'),'Reason':g('df-reason')};
  if(!data['Item']||!data['Qty']){toast('Item and Qty required','err');return;}
  setDrwLoading(true);
  _api('createDump',data,function(r){setDrwLoading(false);if(!r||!r.success){toast(r&&r.error?r.error:'Save failed','err');return;}toast('✓ Dump logged','ok');closeDrawer();loadAll(true);},function(e){setDrwLoading(false);toast('Error: '+e.message,'err');});
};

/* Masters form */
window.openMasterForm=function(tab,uid){
  if(!isManagement()){toast('Management only','err');return;}
  var singulars={customers:'Customer',locations:'Location',items:'Item',vendors:'Vendor'};
  var sn=singulars[tab]||tab;
  var rec=null;
  if(uid){var arr=_D.masters[tab]||[];rec=arr.find(function(r){return r.uid===uid;});}
  openDrawer('<i class="fas fa-database"></i>',(rec?'Edit':'New')+' '+sn,'background:var(--blue-l);color:var(--blue-d)');
  var h='';
  if(tab==='customers'||tab==='vendors'){
    var fn=rec?rec['Contact Person Name']||rec['name']||'':sn;
    h+='<div class="fgroup"><label class="flabel">Company Name *</label><input class="fi" id="mf-name" value="'+esc(rec?rec.name||'':'')+'" placeholder="Company name"></div>';
    h+='<div class="frow"><div class="fgroup"><label class="flabel">Contact Person</label><input class="fi" id="mf-cp" value="'+esc(rec&&rec['Contact Person Name']||'')+'"></div>';
    h+='<div class="fgroup"><label class="flabel">Phone</label><input class="fi" id="mf-ph" value="'+esc(rec&&rec['Contact Person Number']||'')+'"></div></div>';
    h+='<div class="fgroup"><label class="flabel">Email</label><input class="fi" id="mf-email" type="email" value="'+esc(rec&&rec['Email']||'')+'"></div>';
  } else if(tab==='locations'){
    var custOpts2='<option value="">Select Customer</option>';
    _D.masters.customers.forEach(function(c){custOpts2+='<option value="'+esc(c.uid)+'"'+(rec&&rec.custUID===c.uid?' selected':'')+'>'+esc(c.name)+'</option>';});
    h+='<div class="fgroup"><label class="flabel">Customer *</label><select class="fi" id="mf-cust">'+custOpts2+'</select></div>';
    h+='<div class="fgroup"><label class="flabel">Location Name *</label><input class="fi" id="mf-loc" value="'+esc(rec?rec.name||'':'')+'" placeholder="Hotel name, address…"></div>';
    h+='<div class="fgroup"><label class="flabel">Remark</label><input class="fi" id="mf-rem" value="'+esc(rec&&rec['Remark']||'')+'"></div>';
  } else if(tab==='items'){
    h+='<div class="fgroup"><label class="flabel">Item Name *</label><input class="fi" id="mf-item" value="'+esc(rec?rec.name||'':'')+'" placeholder="APPLE KINNAUR"></div>';
    h+='<div class="frow"><div class="fgroup"><label class="flabel">Category</label><select class="fi" id="mf-cat"><option value="">—</option><option value="Fruit"'+(rec&&rec.cat==='Fruit'?' selected':'')+'>Fruit</option><option value="Veg"'+(rec&&rec.cat==='Veg'?' selected':'')+'>Veg</option></select></div>';
    h+='<div class="fgroup"><label class="flabel">Unit</label><select class="fi" id="mf-unit"><option value="">—</option><option value="KG"'+(rec&&rec.unit==='KG'?' selected':'')+'>KG</option><option value="PCS"'+(rec&&rec.unit==='PCS'?' selected':'')+'>PCS</option><option value="PKT"'+(rec&&rec.unit==='PKT'?' selected':'')+'>PKT</option></select></div></div>';
    h+='<div class="fgroup"><label class="flabel">Sub-Category</label><input class="fi" id="mf-sub" value="'+esc(rec&&rec.subcat||'')+'"></div>';
  }
  document.getElementById('drw-body').innerHTML=h;
  document.getElementById('drw-foot').innerHTML='<button class="btn btn-ghost" onclick="closeDrawer()">Cancel</button><button class="btn btn-primary" onclick="_saveMaster(\''+tab+'\',\''+esc(uid||'')+'\')"><i class="fas fa-save"></i> '+(rec?'Update':'Create')+'</button>';
};
window._saveMaster=function(tab,uid){
  var g=function(id){return (document.getElementById(id)||{}).value||'';};
  var data={};
  if(uid)data.uid=uid;
  if(tab==='customers'||tab==='vendors'){ data['Company Name']=g('mf-name');data['Contact Person Name']=g('mf-cp');data['Contact Person Number']=g('mf-ph');data['Email']=g('mf-email'); if(!data['Company Name']){toast('Name required','err');return;} }
  else if(tab==='locations'){ data['Customer']=g('mf-cust');data['Location']=g('mf-loc');data['Remark']=g('mf-rem'); if(!data['Customer']||!data['Location']){toast('Customer and Location required','err');return;} }
  else if(tab==='items'){ data['Item Name']=g('mf-item');data['Category']=g('mf-cat');data['Unit']=g('mf-unit');data['Sub-Category']=g('mf-sub'); if(!data['Item Name']){toast('Item name required','err');return;} }
  var action=(uid?'update':'create')+{customers:'Customer',locations:'Location',items:'Item',vendors:'Vendor'}[tab];
  setDrwLoading(true);
  _api(action,data,function(r){setDrwLoading(false);if(!r||!r.success){toast(r&&r.error?r.error:'Save failed','err');return;}toast('✓ '+tab.slice(0,-1)+' saved','ok');closeDrawer();loadAll(true);},function(e){setDrwLoading(false);toast('Error: '+e.message,'err');});
};

/* ─────────────────────────────────────────────────────────────
   21. DELETE CONFIRM
───────────────────────────────────────────────────────────── */
window.confirmDelete=function(type,uid,name){
  var mask=document.getElementById('confirm-mask'); if(!mask)return;
  var ico=document.getElementById('conf-ico'); if(ico){ico.innerHTML='<i class="fas fa-trash-alt" style="color:var(--red)"></i>';ico.style.background='var(--red-l)';}
  var t=document.getElementById('conf-title'); if(t)t.textContent='Delete '+type+'?';
  var m=document.getElementById('conf-msg'); if(m)m.textContent='Delete "'+name+'"? This action cannot be undone.';
  var ok=document.getElementById('conf-ok');
  if(ok){
    ok.onclick=function(){
      closeConfirm();
      var actionMap={
        order:'deleteOrder',indent:'deleteIndent',purchased:'deletePurchased',dump:'deleteDump',
        customer:'deleteCustomer',location:'deleteLocation',item:'deleteItem',vendor:'deleteVendor'
      };
      var dataMap={
        order:{orderID:uid},indent:{uid:uid},purchased:{uid:uid},dump:{uid:uid},
        customer:{uid:uid},location:{uid:uid},item:{uid:uid},vendor:{uid:uid}
      };
      _api(actionMap[type],dataMap[type],function(r){
        if(!r||!r.success){toast(r&&r.error?r.error:'Delete failed','err');return;}
        toast('✓ Deleted: '+name,'ok');
        closeDrawer(); loadAll(true);
      },function(e){toast('Error: '+e.message,'err');});
    };
  }
  mask.classList.add('open');
};
function closeConfirm(){var m=document.getElementById('confirm-mask');if(m)m.classList.remove('open');}
document.addEventListener('keydown',function(e){if(e.key==='Escape'){closeConfirm();closeDrawer();}});

/* ─────────────────────────────────────────────────────────────
   22. DRAWER UTILS
───────────────────────────────────────────────────────────── */
function openDrawer(icoHTML, title, icoStyle, sub){
  var ico=document.getElementById('drw-ico'); if(ico){ico.innerHTML=icoHTML;ico.style.cssText=icoStyle||'';}
  var t=document.getElementById('drw-title'); if(t)t.textContent=title||'';
  var s=document.getElementById('drw-sub'); if(s)s.innerHTML=sub||'';
  document.getElementById('drw-body').innerHTML='';
  document.getElementById('drw-foot').innerHTML='<button class="btn btn-ghost" onclick="closeDrawer()">Close</button>';
  document.getElementById('drawer-mask').classList.add('open');
  document.getElementById('drawer').classList.add('open');
}
function closeDrawer(){
  document.getElementById('drawer-mask').classList.remove('open');
  document.getElementById('drawer').classList.remove('open');
}
function setDrwLoading(on){
  var btns=document.querySelectorAll('#drw-foot .btn');
  btns.forEach(function(b){b.disabled=on;});
  var saveBtns=document.querySelectorAll('#drw-foot .btn-primary');
  saveBtns.forEach(function(b){if(on)b.innerHTML='<i class="fas fa-circle-notch spinning"></i> Saving…';});
}

/* ─────────────────────────────────────────────────────────────
   23. CSV EXPORT
───────────────────────────────────────────────────────────── */
function exportCSV(){
  var rows=filtered();
  var cols=[['Customer',function(o){return cN(o);}],['Location',function(o){return lN(o);}],['EDD',function(o){return fd(o['Expected Delivery Date']);}],['Status',function(o){return o._status||'';}],['Delivery Boy',function(o){return o['Delivery Boy']||'';}],['Vehicle',function(o){return o['Vehicle No.']||'';}],['Crates Loaded',function(o){return o['Crates Loaded']||'';}],['Ret. Crates',function(o){return o['Returned Crates']||'';}],['Invoice',function(o){return o['Invoice']||'';}]];
  var csv=cols.map(function(c){return c[0];}).join(',')+'\n';
  rows.forEach(function(o){csv+=cols.map(function(c){return'"'+String(c[1](o)).replace(/"/g,'""')+'"';}).join(',')+'\n';});
  var a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
  a.download='o2d-'+tod()+'.csv'; a.click(); URL.revokeObjectURL(a.href);
  toast('✓ CSV exported ('+rows.length+' rows, no UIDs)','ok');
}

/* ─────────────────────────────────────────────────────────────
   24. UI UTILS
───────────────────────────────────────────────────────────── */
function showLoader(msg){var el=document.getElementById('loader');var t=document.getElementById('loader-txt');if(t)t.textContent=msg||'Loading…';if(el)el.classList.remove('hidden');}
function hideLoader(){var el=document.getElementById('loader');if(el)el.classList.add('hidden');}
function setBadge(cls,txt){var el=document.getElementById('data-badge');if(!el)return;el.className=cls;el.innerHTML=(cls==='loading'?'<i class="fas fa-circle-notch spinning"></i> ':'')+txt;}
var _tT;
function toast(msg,type){var el=document.getElementById('toast');if(!el)return;el.textContent=msg;el.className='show'+(type?' '+type:'');clearTimeout(_tT);_tT=setTimeout(function(){el.className='';},3500);}

function toggleSB(){
  var sb=document.getElementById('sb');
  if(window.innerWidth<769){sb.classList.toggle('mobile-open');document.getElementById('sb-mask').classList.toggle('show');return;}
  sb.classList.toggle('collapsed');
  var ic=document.getElementById('sb-ico');if(ic){ic.className='fas fa-chevron-'+(sb.classList.contains('collapsed')?'right':'left');ic.style.fontSize='10px';}
}
function closeMobileSB(){document.getElementById('sb').classList.remove('mobile-open');document.getElementById('sb-mask').classList.remove('show');}

/* ─────────────────────────────────────────────────────────────
   25. BOOT
───────────────────────────────────────────────────────────── */
function boot(){
  if(!GAS_URL||GAS_URL.indexOf('PASTE')>=0){
    document.getElementById('login-wrap').style.display='none';
    hideLoader();
    document.getElementById('content').innerHTML='<div class="empty"><div class="empty-ico"><i class="fas fa-cog" style="color:var(--brand)"></i></div><p>Set GAS_URL in apiconfig.js</p><small>Paste your Apps Script deployment URL and push to GitHub</small></div>';
    return;
  }
  // Auto-focus email on login page
  var em=document.getElementById('li-email'); if(em) setTimeout(function(){em.focus();},100);
  // Mobile detect
  if(window.innerWidth<769){var mb=document.getElementById('mobile-menu-btn');if(mb)mb.style.display='';}
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
