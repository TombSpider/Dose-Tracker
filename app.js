/* ================= Supabase client ================= */
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
}

const COLORS = ['#3E7C7C','#C88B3D','#B5533C','#5B6EA6','#77883F','#8C5B8C','#A6763E','#5C7A8A'];
function colorForIndex(i){ return COLORS[i % COLORS.length]; }
function genLocalId(){ return 'tmp'+Date.now().toString(36)+Math.random().toString(36).slice(2,7); }
function escapeHtml(str){ const d=document.createElement('div'); d.textContent = str==null?'':String(str); return d.innerHTML; }
function showToast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), 1900);
}

/* ================= in-memory state ================= */
let supplements = [];
let doseEntries = [];
let testTypes = [];      // each: {..., metrics:[...]}
let testResults = [];    // each: {..., values:[{metric_id, value, text_value}]}
let appSettings = { default_date_range_mode:'all', default_custom_start:null, default_custom_end:null };

let currentView = 'dashboard';
let filterPanelOpen = false;
let dateRangeMode = 'all';
let customStart = ''; let customEnd = '';

let doseForm = null;
let editingDoseEntryId = null;
let doseLogReturnView = 'dashboard';

let supplementForm = null;
let testTypeForm = null;
let testsTab = 'types'; // 'types' | 'results' | 'import'
let testResultForm = null;

let importParsedRows = []; // for PDF import review screen
let importBusy = false;

let statsTab = 'scatter';
let statsScatterSupId = null, statsScatterMetricKey = null, statsScatterLookback = 14;
let statsTimelineMetricKey = null, statsTimelineSupId = null;
let statsBASupId = null, statsBADate = '';
let statsAdherenceRange = '90d';

/* ================= data layer ================= */
async function loadAllData(){
  const [{data:supp}, {data:doses}, {data:types}, {data:results}, {data:settings}] = await Promise.all([
    sb.from('supplements').select('*').order('created_at'),
    sb.from('dose_entries').select('*').order('time', {ascending:false}),
    sb.from('test_types').select('*, test_metrics(*)').order('created_at'),
    sb.from('test_results').select('*, test_result_values(*)').order('date', {ascending:false}),
    sb.from('app_settings').select('*').maybeSingle()
  ]);
  supplements = supp || [];
  doseEntries = doses || [];
  testTypes = (types || []).map(t => ({...t, metrics: t.test_metrics || []}));
  testResults = (results || []).map(r => ({...r, values: r.test_result_values || []}));
  if (settings) appSettings = settings;
  dateRangeMode = appSettings.default_date_range_mode || 'all';
  customStart = appSettings.default_custom_start || '';
  customEnd = appSettings.default_custom_end || '';
}

async function refreshAndRender(){ await loadAllData(); render(); }

/* ================= auth ================= */
function renderAuthScreen(mode){
  mode = mode || 'signin';
  document.getElementById('authScreen').innerHTML = `
    <div style="max-width:380px; margin:60px auto; padding:0 20px;">
      <div class="eyebrow" style="text-align:center;">Personal Health Log</div>
      <h1 style="text-align:center; margin-bottom:24px;">Dose &amp; Test Log</h1>
      <div class="card">
        <div class="tabs">
          <div class="tab ${mode==='signin'?'active':''}" onclick="renderAuthScreen('signin')">Sign in</div>
          <div class="tab ${mode==='signup'?'active':''}" onclick="renderAuthScreen('signup')">Create account</div>
        </div>
        <label>Email</label>
        <input type="email" id="authEmail">
        <label>Password</label>
        <input type="password" id="authPassword">
        <button class="btn" onclick="${mode==='signin'?'doSignIn()':'doSignUp()'}">${mode==='signin'?'Sign in':'Create account'}</button>
        <div id="authMsg" class="hint" style="margin-top:10px;"></div>
      </div>
    </div>
  `;
}
async function doSignIn(){
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const msg = document.getElementById('authMsg');
  msg.textContent = 'Signing in…';
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) { msg.textContent = error.message; return; }
}
async function doSignUp(){
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const msg = document.getElementById('authMsg');
  msg.textContent = 'Creating account…';
  const { error } = await sb.auth.signUp({ email, password });
  if (error) { msg.textContent = error.message; return; }
  msg.textContent = 'Account created. If email confirmation is enabled in your Supabase project, check your inbox, then sign in.';
}
async function signOut(){
  await sb.auth.signOut();
}

async function boot(){
  const { data:{ session } } = await sb.auth.getSession();
  document.getElementById('loadingScreen').style.display = 'none';
  if (session) {
    document.getElementById('authScreen').style.display = 'none';
    document.getElementById('mainApp').style.display = 'block';
    await refreshAndRender();
  } else {
    document.getElementById('mainApp').style.display = 'none';
    document.getElementById('authScreen').style.display = 'block';
    renderAuthScreen('signin');
  }
}
sb.auth.onAuthStateChange((_event, session) => {
  if (session) {
    document.getElementById('authScreen').style.display = 'none';
    document.getElementById('mainApp').style.display = 'block';
    refreshAndRender();
  } else {
    document.getElementById('mainApp').style.display = 'none';
    document.getElementById('authScreen').style.display = 'block';
    renderAuthScreen('signin');
  }
});

/* ================= nav ================= */
function renderNav(){
  const items = [
    {id:'dashboard', label:'Dashboard', action:"goView('dashboard')"},
    {id:'doseLog', label:'Dose Log', action:"goView('doseLog')"},
    {id:'stats', label:'Stats', action:"goStats()"},
    {id:'manageSupplements', label:'Supplements', action:"goManageSupplements()"},
    {id:'manageTests', label:'Tests', action:"goManageTests()"},
    {id:'settings', label:'Settings', action:"goSettings()"}
  ];
  document.getElementById('navbar').innerHTML = items.map(it=>
    `<button class="navbtn ${currentView===it.id?'active':''}" onclick="${it.action}">${it.label}</button>`
  ).join('');
}
function goView(v){ currentView = v; render(); }

/* ================= date/time helpers ================= */
function nowLocalDatetimeValue(){ const d=new Date(); d.setMinutes(d.getMinutes()-d.getTimezoneOffset()); return d.toISOString().slice(0,16); }
function todayDateValue(){ const d=new Date(); d.setMinutes(d.getMinutes()-d.getTimezoneOffset()); return d.toISOString().slice(0,10); }
function fmtTime(iso){ return new Date(iso).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}); }
function fmtDayLabel(iso){
  const d=new Date(iso), today=new Date(), yest=new Date(); yest.setDate(today.getDate()-1);
  const same=(a,b)=>a.toDateString()===b.toDateString();
  if(same(d,today)) return 'Today'; if(same(d,yest)) return 'Yesterday';
  return d.toLocaleDateString([], {weekday:'short', month:'short', day:'numeric'});
}
function statusEmoji(v){ return {great:'🙂', ok:'😐', rough:'😕', na:''}[v] || ''; }

function getEffectiveDateRange(){
  const now = new Date();
  if(dateRangeMode==='30d'){ const s=new Date(); s.setDate(now.getDate()-30); return {start:s, end:now}; }
  if(dateRangeMode==='90d'){ const s=new Date(); s.setDate(now.getDate()-90); return {start:s, end:now}; }
  if(dateRangeMode==='custom' && customStart && customEnd){ return {start:new Date(customStart), end:new Date(customEnd+'T23:59:59')}; }
  let earliest = null;
  doseEntries.forEach(e=>{ const d=new Date(e.time); if(!earliest||d<earliest) earliest=d; });
  testResults.forEach(r=>{ const d=new Date(r.date); if(!earliest||d<earliest) earliest=d; });
  if(!earliest){ earliest = new Date(); earliest.setDate(now.getDate()-30); }
  return {start:earliest, end:now};
}

/* ================= dashboard / chart ================= */
function collectSeries(){
  const {start,end} = getEffectiveDateRange();
  const series = [];

  supplements.filter(s=>s.show_on_graph).forEach(sup=>{
    const all = doseEntries.filter(e=>e.supplement_id===sup.id);
    const dailyAll = {};
    all.forEach(e=>{ const key=new Date(e.time).toDateString(); dailyAll[key]=(dailyAll[key]||0)+(parseFloat(e.amount)||0); });
    const autoMax = Math.max(0, ...Object.values(dailyAll)) || 1;
    const domainMax = (sup.max_expected_dose!=null && sup.max_expected_dose!=='') ? parseFloat(sup.max_expected_dose) : autoMax;
    const points = Object.keys(dailyAll).map(k=>({date:new Date(k), value:dailyAll[k]}))
      .filter(p=>p.date>=start && p.date<=end).sort((a,b)=>a.date-b.date);
    series.push({type:'dose', key:'dose:'+sup.id, name:sup.name, color:sup.color, unit:sup.dose_unit, domainMin:0, domainMax, points});
  });

  testTypes.forEach(tt=>{
    (tt.metrics||[]).filter(m=>m.show_on_graph).forEach(metric=>{
      if(!metric.is_numeric) return;
      const results = testResults.filter(r=>r.test_type_id===tt.id);
      const allPts = [];
      results.forEach(r=>{
        const v = (r.values||[]).find(x=>x.metric_id===metric.id);
        if(v && v.value!=null) allPts.push({date:new Date(r.date), value:parseFloat(v.value)});
      });
      const pts = allPts.filter(p=>p.date>=start && p.date<=end).sort((a,b)=>a.date-b.date);
      let dMin = (metric.min!=null && metric.min!=='') ? parseFloat(metric.min) : (pts.length?Math.min(...pts.map(p=>p.value)):0);
      let dMax = (metric.max!=null && metric.max!=='') ? parseFloat(metric.max) : (pts.length?Math.max(...pts.map(p=>p.value)):1);
      pts.forEach(p=>{ if(p.value<dMin) dMin=p.value; if(p.value>dMax) dMax=p.value; });
      if(dMax===dMin) dMax=dMin+1;
      const target = (metric.target!=null && metric.target!=='') ? parseFloat(metric.target) : null;
      series.push({type:'test', key:'test:'+metric.id, name:tt.name+': '+metric.name, color:metric.color, unit:metric.unit, domainMin:dMin, domainMax:dMax, target, points:pts});
    });
  });
  return {series, start, end};
}

function renderChart(){
  const {series, start, end} = collectSeries();
  const W=600,H=230,pad={left:8,right:8,top:12,bottom:22};
  const plotW=W-pad.left-pad.right, plotH=H-pad.top-pad.bottom;
  const span = Math.max(1, end-start);
  const xScale = d => pad.left + ((d-start)/span)*plotW;

  if(!series.length || series.every(s=>s.points.length===0)){
    return `<div class="empty">No data to display. Toggle "show on graph" for a supplement or test metric on its edit screen.</div>`;
  }

  const doseSeries = series.filter(s=>s.type==='dose');
  let parts = [`<line x1="${pad.left}" y1="${pad.top+plotH}" x2="${pad.left+plotW}" y2="${pad.top+plotH}" stroke="#E4DFD2" stroke-width="1"/>`];

  series.forEach(s=>{
    if(s.type==='dose'){
      const idx = doseSeries.indexOf(s), nDose = doseSeries.length||1;
      const barW = Math.max(3, Math.min(10, plotW/60))/Math.max(1,nDose);
      s.points.forEach(p=>{
        const norm = Math.max(0, Math.min(1, (p.value-s.domainMin)/(s.domainMax-s.domainMin)));
        const cx = xScale(p.date) + (idx-(nDose-1)/2)*(barW+1);
        const barH = norm*plotH, y = pad.top+plotH-barH;
        parts.push(`<rect x="${(cx-barW/2).toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" fill="${s.color}" opacity="0.85" rx="1.5"/>`);
      });
    } else {
      if(s.points.length){
        const path = s.points.map((p,i)=>{
          const norm = Math.max(0, Math.min(1, (p.value-s.domainMin)/(s.domainMax-s.domainMin)));
          const x=xScale(p.date), y=pad.top+plotH-norm*plotH;
          return (i===0?'M':'L')+x.toFixed(1)+' '+y.toFixed(1);
        }).join(' ');
        parts.push(`<path d="${path}" fill="none" stroke="${s.color}" stroke-width="2"/>`);
        s.points.forEach(p=>{
          const norm = Math.max(0, Math.min(1, (p.value-s.domainMin)/(s.domainMax-s.domainMin)));
          const x=xScale(p.date), y=pad.top+plotH-norm*plotH;
          parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="${s.color}"/>`);
        });
        if(s.target!=null){
          const tnorm = Math.max(0, Math.min(1, (s.target-s.domainMin)/(s.domainMax-s.domainMin)));
          const ty = pad.top+plotH-tnorm*plotH;
          parts.push(`<line x1="${pad.left}" y1="${ty.toFixed(1)}" x2="${pad.left+plotW}" y2="${ty.toFixed(1)}" stroke="${s.color}" stroke-width="1" stroke-dasharray="4,3" opacity="0.6"/>`);
        }
      }
    }
  });

  const fmtShort = d => d.toLocaleDateString([], {month:'short', day:'numeric'});
  parts.push(`<text x="${pad.left}" y="${H-6}" font-size="10" fill="#8A8F98">${fmtShort(start)}</text>`);
  parts.push(`<text x="${pad.left+plotW}" y="${H-6}" font-size="10" fill="#8A8F98" text-anchor="end">${fmtShort(end)}</text>`);

  const legend = series.map(s=>{
    let extra = s.type==='dose' ? ` (daily total, max ${s.domainMax}${s.unit||''})` : (s.target!=null?` (target ${s.target}${s.unit||''})`:'');
    return `<div class="legend-item"><span class="swatch" style="background:${s.color}"></span>${escapeHtml(s.name)}${extra}</div>`;
  }).join('');

  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%; height:auto;">${parts.join('')}</svg><div class="legend">${legend}</div>`;
}

function toggleFilterPanel(){ filterPanelOpen=!filterPanelOpen; render(); }
async function toggleSupplementGraph(id){
  const sup = supplements.find(s=>s.id===id); if(!sup) return;
  await sb.from('supplements').update({show_on_graph: !sup.show_on_graph}).eq('id', id);
  await refreshAndRender();
}
async function toggleMetricGraphDirect(ttId, metricId, current){
  await sb.from('test_metrics').update({show_on_graph: !current}).eq('id', metricId);
  await refreshAndRender();
}
function setDateRangeMode(mode){ dateRangeMode=mode; render(); }
function setCustomStart(v){ customStart=v; }
function setCustomEnd(v){ customEnd=v; dateRangeMode='custom'; render(); }
async function saveDateRangeAsDefault(){
  await sb.from('app_settings').upsert({ user_id: (await sb.auth.getUser()).data.user.id, default_date_range_mode: dateRangeMode, default_custom_start: customStart||null, default_custom_end: customEnd||null });
  showToast('Default date range saved');
}

function renderFilterPanel(){
  const suppChips = supplements.map(s=>
    `<div class="chip ${s.show_on_graph?'active':''}" onclick="toggleSupplementGraph('${s.id}')"><span class="swatch" style="background:${s.color}"></span>${escapeHtml(s.name)}</div>`
  ).join('') || '<span style="font-size:12px;color:var(--gray);">No supplements yet</span>';

  let metricChips = '';
  testTypes.forEach(tt=>{
    (tt.metrics||[]).forEach(m=>{
      metricChips += `<div class="chip ${m.show_on_graph?'active':''}" onclick="toggleMetricGraphDirect('${tt.id}','${m.id}', ${!!m.show_on_graph})"><span class="swatch" style="background:${m.color}"></span>${escapeHtml(tt.name)}: ${escapeHtml(m.name)}</div>`;
    });
  });
  if(!metricChips) metricChips = '<span style="font-size:12px;color:var(--gray);">No test metrics yet</span>';

  return `
    <span class="filter-toggle" onclick="toggleFilterPanel()">${filterPanelOpen?'Hide filters ▴':'Filters ▾'}</span>
    <div class="filter-panel ${filterPanelOpen?'open':''}">
      <div class="filter-group-title">Date range</div>
      <div class="daterange-row">
        <div class="chip ${dateRangeMode==='30d'?'active':''}" onclick="setDateRangeMode('30d')">30 days</div>
        <div class="chip ${dateRangeMode==='90d'?'active':''}" onclick="setDateRangeMode('90d')">90 days</div>
        <div class="chip ${dateRangeMode==='all'?'active':''}" onclick="setDateRangeMode('all')">All time</div>
      </div>
      <div class="row" style="margin-top:8px;">
        <div><label>Custom start</label><input type="date" value="${customStart}" onchange="setCustomStart(this.value); setCustomEnd(customEnd||this.value)"></div>
        <div><label>Custom end</label><input type="date" value="${customEnd}" onchange="setCustomEnd(this.value)"></div>
      </div>
      <button class="btn secondary small" onclick="saveDateRangeAsDefault()">Save current date range as default</button>
      <div class="filter-group-title">Supplements shown on graph</div>
      <div class="chip-row">${suppChips}</div>
      <div class="filter-group-title">Test metrics shown on graph</div>
      <div class="chip-row">${metricChips}</div>
    </div>
  `;
}

function renderDashboard(){
  const buttons = supplements.map(s=>`
    <div class="supp-btn">
      <div class="supp-btn-left" onclick="goLogDose('${s.id}')"><div class="supp-name">${escapeHtml(s.name)}</div></div>
      <div class="supp-btn-right" onclick="quickLogDose('${s.id}')"><div class="supp-dose mono">${s.dose_amount}${s.dose_unit}</div></div>
    </div>`).join('');

  return `
    <div class="card"><h2>History</h2>${renderChart()}${renderFilterPanel()}</div>
    <div class="card">
      <h2>Log a dose</h2>
      <div class="supp-grid">${buttons}<div class="supp-btn add" onclick="goManageSupplements()">+ Add supplement</div></div>
    </div>
  `;
}

/* ================= log dose ================= */
function goLogDose(supplementId){
  const sup = supplements.find(s=>s.id===supplementId);
  doseForm = { id:null, supplement_id:supplementId, time:nowLocalDatetimeValue(), amount: sup?sup.dose_amount:'', unit: sup?sup.dose_unit:'mg', body_status:'na', brain_status:'na', notes:'' };
  editingDoseEntryId = null; doseLogReturnView = 'dashboard';
  currentView='logDose'; render();
}
async function quickLogDose(supplementId){
  const sup = supplements.find(s=>s.id===supplementId); if(!sup) return;
  await sb.from('dose_entries').insert({ supplement_id:supplementId, time:new Date().toISOString(), amount:sup.dose_amount, unit:sup.dose_unit, body_status:'na', brain_status:'na', notes:'' });
  showToast('Logged: '+sup.name+' '+sup.dose_amount+sup.dose_unit);
  await refreshAndRender();
}
function editDoseEntry(id){
  const e = doseEntries.find(x=>x.id===id); if(!e) return;
  const d = new Date(e.time); d.setMinutes(d.getMinutes()-d.getTimezoneOffset());
  doseForm = { id:e.id, supplement_id:e.supplement_id, time:d.toISOString().slice(0,16), amount:e.amount, unit:e.unit, body_status:e.body_status||'na', brain_status:e.brain_status||'na', notes:e.notes||'' };
  editingDoseEntryId=id; doseLogReturnView='doseLog';
  currentView='logDose'; render();
}
async function deleteDoseEntryConfirm(id){
  if(!confirm('Delete this dose entry?')) return;
  await sb.from('dose_entries').delete().eq('id', id);
  showToast('Entry deleted'); currentView='doseLog'; await refreshAndRender();
}
function updateDoseForm(field,val){ if(doseForm) doseForm[field]=val; }
async function saveDoseEntry(){
  if(!doseForm.time || doseForm.amount===''){ showToast('Add a time and dosage amount'); return; }
  const payload = { supplement_id:doseForm.supplement_id, time:new Date(doseForm.time).toISOString(), amount:doseForm.amount, unit:doseForm.unit, body_status:doseForm.body_status, brain_status:doseForm.brain_status, notes:doseForm.notes.trim() };
  if(editingDoseEntryId){ await sb.from('dose_entries').update(payload).eq('id', editingDoseEntryId); }
  else { await sb.from('dose_entries').insert(payload); }
  showToast('Entry saved');
  editingDoseEntryId=null; currentView=doseLogReturnView; await refreshAndRender();
}
function renderLogDose(){
  if(!doseForm) return `<div class="empty">No supplement selected.</div>`;
  const supOptions = supplements.map(s=>`<option value="${s.id}" ${s.id===doseForm.supplement_id?'selected':''}>${escapeHtml(s.name)}</option>`).join('');
  const unitOptions = ['mg','mcg','g','ml','drops','capsule(s)','tablet(s)','serving(s)'].map(u=>`<option ${u===doseForm.unit?'selected':''}>${u}</option>`).join('');
  const bodyOpts = ['great','ok','rough','na'].map(v=>`<div class="status-opt ${doseForm.body_status===v?'active':''}" onclick="updateDoseForm('body_status','${v}'); render()">${ {great:'🙂',ok:'😐',rough:'😕',na:'–'}[v] }</div>`).join('');
  const brainOpts = ['great','ok','rough','na'].map(v=>`<div class="status-opt ${doseForm.brain_status===v?'active':''}" onclick="updateDoseForm('brain_status','${v}'); render()">${ {great:'🙂',ok:'😐',rough:'😕',na:'–'}[v] }</div>`).join('');

  return `
    <span class="back-link" onclick="currentView='${doseLogReturnView}'; render()">← Back</span>
    <div class="card">
      <h2>${editingDoseEntryId?'Edit dose':'Log a dose'}</h2>
      <label>Supplement</label><select onchange="updateDoseForm('supplement_id', this.value)">${supOptions}</select>
      <label>Time taken</label><input type="datetime-local" value="${doseForm.time}" onchange="updateDoseForm('time', this.value)">
      <div class="row">
        <div><label>Dosage</label><input type="number" step="any" value="${doseForm.amount}" onchange="updateDoseForm('amount', this.value)"></div>
        <div><label>Unit</label><select onchange="updateDoseForm('unit', this.value)">${unitOptions}</select></div>
      </div>
      <label>How is your body today? 💪</label><div class="status-picker">${bodyOpts}</div>
      <label>How is your brain today? 🧠</label><div class="status-picker">${brainOpts}</div>
      <label>Notes / observations</label><textarea onchange="updateDoseForm('notes', this.value)">${escapeHtml(doseForm.notes)}</textarea>
      <button class="btn" onclick="saveDoseEntry()">Save entry</button>
      ${editingDoseEntryId?`<button class="btn danger" onclick="deleteDoseEntryConfirm('${editingDoseEntryId}')">Delete entry</button>`:''}
    </div>
  `;
}

/* ================= dose log ================= */
function renderDoseLog(){
  const entries = doseEntries.slice().sort((a,b)=>new Date(b.time)-new Date(a.time));
  if(!entries.length) return `<div class="card"><h2>Dose log</h2><div class="empty">No entries yet.</div></div>`;
  let html=''; let lastDay=null; let open=false;
  entries.forEach(e=>{
    const sup = supplements.find(s=>s.id===e.supplement_id);
    const label = fmtDayLabel(e.time);
    if(label!==lastDay){ if(open) html+='</div>'; html+=`<div class="day-divider">${label}</div><div class="timeline">`; open=true; lastDay=label; }
    html += `<div class="entry" onclick="editDoseEntry('${e.id}')">
      <div class="entry-head">
        <span class="entry-dose mono">${escapeHtml(sup?sup.name:'(deleted)')} — ${e.amount}${e.unit} ${statusEmoji(e.body_status)}${statusEmoji(e.brain_status)}</span>
        <span class="entry-time mono">${fmtTime(e.time)}</span>
      </div>
      ${e.notes?`<div class="entry-notes">${escapeHtml(e.notes)}</div>`:''}
    </div>`;
  });
  if(open) html+='</div>';
  return `<div class="card"><h2>Dose log</h2><div style="font-size:12px;color:var(--gray);margin-bottom:4px;">Tap any entry to edit</div>${html}</div>`;
}

/* ================= manage supplements ================= */
function goManageSupplements(){ currentView='manageSupplements'; supplementForm={id:null,name:'',dose_amount:'',dose_unit:'mg',show_on_graph:true,max_expected_dose:''}; render(); }
function newSupplementForm(){ supplementForm={id:null,name:'',dose_amount:'',dose_unit:'mg',show_on_graph:true,max_expected_dose:''}; render(); }
function editSupplementForm(id){ const s=supplements.find(x=>x.id===id); if(!s) return; supplementForm={...s, max_expected_dose: s.max_expected_dose!=null?s.max_expected_dose:''}; render(); }
function updateSupplementForm(field,val){ if(supplementForm) supplementForm[field]=val; }
function toggleSupplementFormGraph(){ supplementForm.show_on_graph = !supplementForm.show_on_graph; render(); }
async function saveSupplementForm(){
  if(!supplementForm.name.trim()){ showToast('Enter a supplement name'); return; }
  const payload = {
    name: supplementForm.name.trim(), dose_amount: supplementForm.dose_amount, dose_unit: supplementForm.dose_unit,
    show_on_graph: supplementForm.show_on_graph,
    max_expected_dose: supplementForm.max_expected_dose===''?null:supplementForm.max_expected_dose
  };
  if(supplementForm.id){ await sb.from('supplements').update(payload).eq('id', supplementForm.id); }
  else { payload.color = colorForIndex(supplements.length); await sb.from('supplements').insert(payload); }
  showToast('Supplement saved');
  supplementForm={id:null,name:'',dose_amount:'',dose_unit:'mg',show_on_graph:true,max_expected_dose:''};
  await refreshAndRender();
}
async function deleteSupplementConfirm(id){
  if(!confirm('Delete this supplement? Its past dose entries will remain but show as (deleted).')) return;
  await sb.from('supplements').delete().eq('id', id);
  showToast('Supplement deleted'); await refreshAndRender();
}
function renderManageSupplements(){
  const unitOptions = ['mg','mcg','g','ml','drops','capsule(s)','tablet(s)','serving(s)'].map(u=>`<option ${u===supplementForm.dose_unit?'selected':''}>${u}</option>`).join('');
  const list = supplements.map(s=>`
    <div class="list-row">
      <div><div class="list-row-main"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${s.color};margin-right:6px;"></span>${escapeHtml(s.name)}</div>
      <div class="list-row-sub">${s.dose_amount}${s.dose_unit} per dose ${s.show_on_graph?'· on graph':'· hidden from graph'}${s.max_expected_dose?' · max '+s.max_expected_dose+s.dose_unit:''}</div></div>
      <div class="list-actions"><span onclick="editSupplementForm('${s.id}')">Edit</span><span class="del" onclick="deleteSupplementConfirm('${s.id}')">Delete</span></div>
    </div>`).join('') || '<div class="empty">No supplements yet.</div>';

  return `
    <span class="back-link" onclick="goView('dashboard')">← Back</span>
    <div class="card">
      <h2>${supplementForm.id?'Edit supplement':'Add supplement'}</h2>
      <label>Name</label><input type="text" value="${escapeHtml(supplementForm.name)}" onchange="updateSupplementForm('name', this.value)">
      <div class="row">
        <div><label>Default dose</label><input type="number" step="any" value="${supplementForm.dose_amount}" onchange="updateSupplementForm('dose_amount', this.value)"></div>
        <div><label>Unit</label><select onchange="updateSupplementForm('dose_unit', this.value)">${unitOptions}</select></div>
      </div>
      <label>Max expected dose (for graph scaling)</label>
      <input type="number" step="any" value="${supplementForm.max_expected_dose}" placeholder="Leave blank to auto-scale to your largest logged day" onchange="updateSupplementForm('max_expected_dose', this.value)">
      <div class="hint">Overrides the graph's 100%-height ceiling for this supplement's bars. Useful when one supplement (e.g. a big single-serving item) would otherwise dwarf everything else on the chart.</div>
      <div class="checkbox-row">
        <input type="checkbox" id="suppShowGraph" ${supplementForm.show_on_graph?'checked':''} onclick="toggleSupplementFormGraph()">
        <label for="suppShowGraph">Show on main graph</label>
      </div>
      <button class="btn" onclick="saveSupplementForm()">${supplementForm.id?'Save changes':'Add supplement'}</button>
      ${supplementForm.id?`<button class="btn secondary" onclick="newSupplementForm()">Cancel edit</button>`:''}
    </div>
    <div class="card"><h2>Your supplements</h2>${list}</div>
  `;
}

/* ================= manage tests ================= */
function goManageTests(){ currentView='manageTests'; testsTab='types'; newTestTypeForm(); render(); }
function switchTestsTab(tab){ testsTab=tab; if(tab==='results' && !testResultForm) newTestResultForm(); if(tab==='import'){ importParsedRows=[]; } render(); }

function newTestTypeForm(){ testTypeForm={id:null,name:'',metrics:[]}; }
function editTestTypeForm(id){ const tt=testTypes.find(t=>t.id===id); if(!tt) return; testTypeForm=JSON.parse(JSON.stringify(tt)); render(); }
function updateTestTypeName(val){ testTypeForm.name=val; }
function addMetricRow(){
  const totalMetrics = testTypes.reduce((a,t)=>a+(t.metrics||[]).length,0);
  testTypeForm.metrics.push({id:genLocalId(), name:'', unit:'', target:'', min:'', max:'', color:colorForIndex(testTypeForm.metrics.length+totalMetrics), is_numeric:true, show_on_graph:true});
  render();
}
function removeMetricRow(idx){ testTypeForm.metrics.splice(idx,1); render(); }
function updateMetricField(idx, field, val){ testTypeForm.metrics[idx][field]=val; }
function toggleMetricFormGraph(idx){ testTypeForm.metrics[idx].show_on_graph = !testTypeForm.metrics[idx].show_on_graph; render(); }

async function saveTestTypeForm(){
  if(!testTypeForm.name.trim()){ showToast('Enter a test name'); return; }
  const cleanMetrics = testTypeForm.metrics.filter(m=>m.name.trim());
  if(!cleanMetrics.length){ showToast('Add at least one metric'); return; }

  let testTypeId = testTypeForm.id;
  if(testTypeId){
    await sb.from('test_types').update({name:testTypeForm.name.trim()}).eq('id', testTypeId);
  } else {
    const {data} = await sb.from('test_types').insert({name:testTypeForm.name.trim()}).select().single();
    testTypeId = data.id;
  }
  for(const m of cleanMetrics){
    const payload = { test_type_id:testTypeId, name:m.name.trim(), unit:m.unit, target:m.target===''?null:m.target, min:m.min===''?null:m.min, max:m.max===''?null:m.max, is_numeric:m.is_numeric!==false, show_on_graph: m.show_on_graph!==false };
    if(String(m.id).startsWith('tmp')){ payload.color = m.color; await sb.from('test_metrics').insert(payload); }
    else { await sb.from('test_metrics').update(payload).eq('id', m.id); }
  }
  showToast('Test type saved');
  newTestTypeForm(); await refreshAndRender();
}
async function deleteTestTypeConfirm(id){
  if(!confirm('Delete this test type and its metrics? Past results referencing it will remain but be hidden from the graph.')) return;
  await sb.from('test_types').delete().eq('id', id);
  showToast('Test type deleted'); await refreshAndRender();
}

function renderTestTypesTab(){
  const rows = testTypeForm.metrics.map((m,idx)=>`
    <div class="metric-row">
      <div class="metric-row-header"><span>Metric ${idx+1}</span><span class="remove-row" onclick="removeMetricRow(${idx})">remove</span></div>
      <div class="row">
        <div><label>Name</label><input type="text" value="${escapeHtml(m.name)}" onchange="updateMetricField(${idx},'name',this.value)"></div>
        <div><label>Unit</label><input type="text" value="${escapeHtml(m.unit)}" onchange="updateMetricField(${idx},'unit',this.value)"></div>
      </div>
      <div class="row">
        <div><label>Target</label><input type="number" step="any" value="${m.target}" onchange="updateMetricField(${idx},'target',this.value)"></div>
        <div><label>Min</label><input type="number" step="any" value="${m.min}" onchange="updateMetricField(${idx},'min',this.value)"></div>
        <div><label>Max</label><input type="number" step="any" value="${m.max}" onchange="updateMetricField(${idx},'max',this.value)"></div>
      </div>
      <div class="checkbox-row">
        <input type="checkbox" id="metricGraph${idx}" ${m.show_on_graph!==false?'checked':''} onclick="toggleMetricFormGraph(${idx})">
        <label for="metricGraph${idx}">Show on main graph</label>
      </div>
    </div>`).join('');

  const list = testTypes.map(tt=>`
    <div class="list-row">
      <div><div class="list-row-main">${escapeHtml(tt.name)}</div>
      <div class="list-row-sub">${(tt.metrics||[]).map(m=>escapeHtml(m.name)).join(', ')}</div></div>
      <div class="list-actions"><span onclick="editTestTypeForm('${tt.id}')">Edit</span><span class="del" onclick="deleteTestTypeConfirm('${tt.id}')">Delete</span></div>
    </div>`).join('') || '<div class="empty">No test types yet.</div>';

  return `
    <div class="card">
      <h2>${testTypeForm.id?'Edit test type':'Add test type'}</h2>
      <label>Test name</label><input type="text" value="${escapeHtml(testTypeForm.name)}" onchange="updateTestTypeName(this.value)">
      <div class="filter-group-title" style="margin-top:14px;">Metrics</div>
      ${rows || '<div class="empty">No metrics added yet.</div>'}
      <button class="btn secondary small" onclick="addMetricRow()">+ Add metric</button>
      <button class="btn" onclick="saveTestTypeForm()">${testTypeForm.id?'Save changes':'Add test type'}</button>
      ${testTypeForm.id?`<button class="btn secondary" onclick="newTestTypeForm(); render()">Cancel edit</button>`:''}
    </div>
    <div class="card"><h2>Your test types</h2>${list}</div>
  `;
}

/* ---- test results ---- */
function newTestResultForm(){ testResultForm={id:null, test_type_id: testTypes.length?testTypes[0].id:'', date:todayDateValue(), values:{}, notes:''}; }
function editTestResultForm(id){
  const r = testResults.find(x=>x.id===id); if(!r) return;
  const values = {}; (r.values||[]).forEach(v=>{ values[v.metric_id] = v.text_value!=null && v.text_value!=='' ? v.text_value : (v.value!=null?v.value:''); });
  testResultForm = { id:r.id, test_type_id:r.test_type_id, date:r.date, values, notes:r.notes||'' };
  render();
}
function updateResultField(field,val){ testResultForm[field]=val; if(field==='test_type_id') testResultForm.values={}; }
function updateResultValue(metricId,val){ testResultForm.values[metricId]=val; }
async function saveTestResultForm(){
  if(!testResultForm.test_type_id){ showToast('Add a test type first'); return; }
  if(!testResultForm.date){ showToast('Add a date'); return; }
  let resultId = testResultForm.id;
  const payload = { test_type_id:testResultForm.test_type_id, date:testResultForm.date, notes:testResultForm.notes };
  if(resultId){ await sb.from('test_results').update(payload).eq('id', resultId); await sb.from('test_result_values').delete().eq('test_result_id', resultId); }
  else { const {data} = await sb.from('test_results').insert(payload).select().single(); resultId = data.id; }

  const tt = testTypes.find(t=>t.id===testResultForm.test_type_id);
  const rows = [];
  (tt?tt.metrics:[]).forEach(m=>{
    const raw = testResultForm.values[m.id];
    if(raw===undefined || raw==='') return;
    const num = parseFloat(raw);
    if(!isNaN(num) && String(raw).trim()===String(num)){ rows.push({test_result_id:resultId, metric_id:m.id, value:num, text_value:null}); }
    else if(!isNaN(num)){ rows.push({test_result_id:resultId, metric_id:m.id, value:num, text_value:null}); }
    else { rows.push({test_result_id:resultId, metric_id:m.id, value:null, text_value:String(raw)}); }
  });
  if(rows.length) await sb.from('test_result_values').insert(rows);

  showToast('Test result saved');
  newTestResultForm(); await refreshAndRender();
}
async function deleteTestResultConfirm(id){
  if(!confirm('Delete this test result?')) return;
  await sb.from('test_results').delete().eq('id', id);
  showToast('Result deleted'); newTestResultForm(); await refreshAndRender();
}
function renderResultsTab(){
  if(!testTypes.length) return `<div class="card"><h2>Log a result</h2><div class="empty">Add a test type first (Test Types tab) before logging results.</div></div>`;
  const tt = testTypes.find(t=>t.id===testResultForm.test_type_id) || testTypes[0];
  const ttOptions = testTypes.map(t=>`<option value="${t.id}" ${t.id===testResultForm.test_type_id?'selected':''}>${escapeHtml(t.name)}</option>`).join('');
  const metricInputs = (tt.metrics||[]).map(m=>`
    <label>${escapeHtml(m.name)}${m.unit?' ('+escapeHtml(m.unit)+')':''}${(m.min!=null||m.max!=null)?' — range '+(m.min??'')+'–'+(m.max??''):''}</label>
    <input type="text" value="${testResultForm.values[m.id]!==undefined?escapeHtml(String(testResultForm.values[m.id])):''}" onchange="updateResultValue('${m.id}', this.value)">
  `).join('');

  const results = testResults.slice().sort((a,b)=>new Date(b.date)-new Date(a.date)).map(r=>{
    const rtt = testTypes.find(t=>t.id===r.test_type_id);
    const summary = rtt ? (r.values||[]).map(v=>{ const m=(rtt.metrics||[]).find(x=>x.id===v.metric_id); return m?escapeHtml(m.name)+': '+(v.text_value??v.value):''; }).filter(Boolean).join(', ') : '(test type deleted)';
    return `<div class="list-row" onclick="editTestResultForm('${r.id}')" style="cursor:pointer;">
      <div><div class="list-row-main">${rtt?escapeHtml(rtt.name):'(deleted)'}</div>
      <div class="list-row-sub">${new Date(r.date).toLocaleDateString()} — ${summary}</div></div>
      <div class="list-actions"><span>Edit</span></div>
    </div>`;
  }).join('') || '<div class="empty">No results logged yet.</div>';

  return `
    <div class="card">
      <h2>${testResultForm.id?'Edit result':'Log a result'}</h2>
      <label>Test type</label><select onchange="updateResultField('test_type_id', this.value)">${ttOptions}</select>
      <label>Date</label><input type="date" value="${testResultForm.date}" onchange="updateResultField('date', this.value)">
      ${metricInputs}
      <label>Notes</label><textarea onchange="updateResultField('notes', this.value)">${escapeHtml(testResultForm.notes)}</textarea>
      <button class="btn" onclick="saveTestResultForm()">${testResultForm.id?'Save changes':'Save result'}</button>
      ${testResultForm.id?`<button class="btn secondary" onclick="newTestResultForm(); render()">Cancel edit</button><button class="btn danger" onclick="deleteTestResultConfirm('${testResultForm.id}')">Delete result</button>`:''}
    </div>
    <div class="card"><h2>Past results</h2>${results}</div>
  `;
}

/* ---- PDF import ---- */
function parseReferenceRange(str){
  if(!str) return {min:null, max:null};
  str = str.trim();
  let m = str.match(/^<\s*=?\s*([\d.]+)/);
  if(m) return {min:null, max:parseFloat(m[1])};
  m = str.match(/^>\s*(?:or\s*=?\s*)?=?\s*([\d.]+)/i);
  if(m) return {min:parseFloat(m[1]), max:null};
  m = str.match(/^([\d.]+)\s*-\s*([\d.]+)/);
  if(m) return {min:parseFloat(m[1]), max:parseFloat(m[2])};
  return {min:null, max:null};
}
function convertValue(raw){
  raw = (raw||'').trim();
  if(/^positive$/i.test(raw)) return {value:1, text:null, is_numeric:true};
  if(/^negative$/i.test(raw)) return {value:0, text:null, is_numeric:true};
  let m = raw.match(/^(\d+)\s*:\s*(\d+)$/);
  if(m) return {value:parseFloat(m[2]), text:null, is_numeric:true};
  const num = parseFloat(raw);
  if(!isNaN(num) && /^[\d.]+$/.test(raw)) return {value:num, text:null, is_numeric:true};
  return {value:null, text:raw, is_numeric:false};
}

async function extractPdfLines(file){
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({data: buf}).promise;
  const lines = [];
  for(let p=1; p<=pdf.numPages; p++){
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const items = content.items.map(it=>({str:it.str, x:it.transform[4], y:Math.round(it.transform[5])}));
    items.sort((a,b)=> b.y-a.y || a.x-b.x);
    let curY = null, curLine = [];
    items.forEach(it=>{
      if(curY===null || Math.abs(it.y-curY)>3){
        if(curLine.length) lines.push(curLine.map(i=>i.str).join(' '));
        curLine = [it]; curY = it.y;
      } else { curLine.push(it); }
    });
    if(curLine.length) lines.push(curLine.map(i=>i.str).join(' '));
  }
  return lines;
}

function parseLabLines(lines){
  const rows = [];
  const skipWords = /^(Analyte|Value|Performing Sites|Key|These results|Quest,|Reference Range$)/i;
  lines.forEach(line=>{
    line = line.trim();
    if(!line || skipWords.test(line)) return;
    // Pattern: NAME  VALUE [H|L]  Reference Range: RANGE [unit]
    let m = line.match(/^([A-Za-z][A-Za-z0-9 ,()\/\-]+?)\s+([\d.]+|POSITIVE|NEGATIVE|\d+:\d+)\s*(H|L)?\s*(?:Reference Range:?\s*(.*))?$/);
    if(m){
      const name = m[1].trim();
      if(/^(Analyte|Client|Phone|Fax|Specimen|Patient)/i.test(name)) return;
      const rawValue = m[2];
      const rangeStr = (m[4]||'').trim();
      const {min, max} = parseReferenceRange(rangeStr);
      const conv = convertValue(rawValue);
      rows.push({ name, rawValue, flag:m[3]||'', unit:'', min, max, target:null, value:conv.value, text:conv.text, is_numeric:conv.is_numeric, include:true });
    }
  });
  return rows;
}

async function handlePdfUpload(inputEl){
  const file = inputEl.files[0]; if(!file) return;
  importBusy = true; render();
  try{
    const lines = await extractPdfLines(file);
    importParsedRows = parseLabLines(lines);
    if(!importParsedRows.length) showToast('No analytes recognized — check the review table or try pasting text instead');
    else showToast('Parsed '+importParsedRows.length+' result(s) — review before saving');
  } catch(err){
    console.error(err);
    showToast('Could not read PDF: '+err.message);
  }
  importBusy = false; render();
}
function updateImportRow(idx, field, val){ importParsedRows[idx][field]=val; }
function toggleImportRow(idx){ importParsedRows[idx].include = !importParsedRows[idx].include; render(); }
async function confirmImport(){
  const dateInput = document.getElementById('importDate');
  const date = dateInput ? dateInput.value : todayDateValue();
  const rowsToImport = importParsedRows.filter(r=>r.include);
  if(!rowsToImport.length){ showToast('Nothing selected to import'); return; }
  importBusy = true; render();
  for(const row of rowsToImport){
    let tt = testTypes.find(t=>t.name.toLowerCase()===row.name.toLowerCase());
    let ttId, metricId;
    if(tt){
      ttId = tt.id;
      const existingMetric = (tt.metrics||[])[0];
      metricId = existingMetric ? existingMetric.id : null;
    }
    if(!ttId){
      const {data} = await sb.from('test_types').insert({name:row.name}).select().single();
      ttId = data.id;
    }
    if(!metricId){
      const {data:metricData} = await sb.from('test_metrics').insert({
        test_type_id: ttId, name: row.name, unit: row.unit||null,
        target: row.target===''||row.target==null?null:row.target,
        min: row.min===''||row.min==null?null:row.min,
        max: row.max===''||row.max==null?null:row.max,
        color: colorForIndex(testTypes.reduce((a,t)=>a+(t.metrics||[]).length,0)),
        is_numeric: row.is_numeric, show_on_graph: true
      }).select().single();
      metricId = metricData.id;
    }
    const {data:resultData} = await sb.from('test_results').insert({ test_type_id: ttId, date, notes:'Imported from lab PDF' }).select().single();
    await sb.from('test_result_values').insert({ test_result_id: resultData.id, metric_id: metricId, value: row.is_numeric?row.value:null, text_value: row.is_numeric?null:row.text });
    // refresh local testTypes cache reference for subsequent rows in this loop
    await loadAllData();
  }
  importBusy = false;
  importParsedRows = [];
  showToast('Import complete');
  currentView='manageTests'; testsTab='results'; newTestResultForm();
  await refreshAndRender();
}

function renderImportTab(){
  if(importBusy){
    return `<div class="card"><h2>Import lab report</h2><div class="empty">Working…</div></div>`;
  }
  if(!importParsedRows.length){
    return `
      <div class="card">
        <h2>Import lab report</h2>
        <div class="hint" style="margin-bottom:10px;">Upload a Quest-format lab PDF. Each analyte becomes its own test type. Best-effort parsing — you'll review everything before it's saved.</div>
        <input type="file" accept="application/pdf" onchange="handlePdfUpload(this)">
      </div>`;
  }
  const rows = importParsedRows.map((r,idx)=>`
    <tr>
      <td><input type="checkbox" ${r.include?'checked':''} onclick="toggleImportRow(${idx})"></td>
      <td><input type="text" value="${escapeHtml(r.name)}" onchange="updateImportRow(${idx},'name',this.value)" style="width:130px;"></td>
      <td>${r.is_numeric ? `<input type="number" step="any" value="${r.value}" onchange="updateImportRow(${idx},'value',parseFloat(this.value))" style="width:70px;">` : `<input type="text" value="${escapeHtml(r.text||'')}" onchange="updateImportRow(${idx},'text',this.value)" style="width:90px;">`}</td>
      <td>${escapeHtml(r.flag||'')}</td>
      <td><input type="number" step="any" value="${r.min??''}" onchange="updateImportRow(${idx},'min',parseFloat(this.value))" style="width:55px;"></td>
      <td><input type="number" step="any" value="${r.max??''}" onchange="updateImportRow(${idx},'max',parseFloat(this.value))" style="width:55px;"></td>
    </tr>
  `).join('');

  return `
    <div class="card">
      <h2>Review before import</h2>
      <div class="hint">Uncheck anything you don't want imported. Fix any values that parsed incorrectly — reference range formats vary across the report and won't all parse cleanly.</div>
      <label>Result date (defaults to today — set to your collection date)</label>
      <input type="date" id="importDate" value="${todayDateValue()}">
      <table class="review">
        <thead><tr><th></th><th>Analyte</th><th>Value</th><th>Flag</th><th>Min</th><th>Max</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <button class="btn" onclick="confirmImport()">Import selected</button>
      <button class="btn secondary" onclick="importParsedRows=[]; render()">Start over</button>
    </div>
  `;
}

function renderManageTests(){
  return `
    <span class="back-link" onclick="goView('dashboard')">← Back</span>
    <div class="tabs">
      <div class="tab ${testsTab==='types'?'active':''}" onclick="switchTestsTab('types')">Test Types</div>
      <div class="tab ${testsTab==='results'?'active':''}" onclick="switchTestsTab('results')">Log Results</div>
      <div class="tab ${testsTab==='import'?'active':''}" onclick="switchTestsTab('import')">Import</div>
    </div>
    ${testsTab==='types'?renderTestTypesTab():testsTab==='results'?renderResultsTab():renderImportTab()}
  `;
}

/* ================= stats ================= */
function goStats(){ currentView='stats'; render(); }
function pearson(xs, ys){
  const n = xs.length; if(n<2) return null;
  const mx = xs.reduce((a,b)=>a+b,0)/n, my = ys.reduce((a,b)=>a+b,0)/n;
  let num=0, dx2=0, dy2=0;
  for(let i=0;i<n;i++){ const dx=xs[i]-mx, dy=ys[i]-my; num+=dx*dy; dx2+=dx*dx; dy2+=dy*dy; }
  if(dx2===0||dy2===0) return null;
  return num/Math.sqrt(dx2*dy2);
}
function allMetrics(){
  const list = [];
  testTypes.forEach(tt=>(tt.metrics||[]).forEach(m=>{ if(m.is_numeric) list.push({key:tt.id+'::'+m.id, ttId:tt.id, metricId:m.id, label:tt.name+': '+m.name}); }));
  return list;
}
function avgDoseInWindow(supplementId, beforeDate, days){
  const end = new Date(beforeDate);
  const start = new Date(end); start.setDate(end.getDate()-days);
  const entries = doseEntries.filter(e=>e.supplement_id===supplementId && new Date(e.time)>=start && new Date(e.time)<end);
  const dayTotals = {};
  entries.forEach(e=>{ const k=new Date(e.time).toDateString(); dayTotals[k]=(dayTotals[k]||0)+(parseFloat(e.amount)||0); });
  const vals = Object.values(dayTotals);
  return vals.length ? vals.reduce((a,b)=>a+b,0)/days : 0;
}
function metricValuesByDate(metricKey){
  const [ttId, metricId] = metricKey.split('::');
  return testResults.filter(r=>r.test_type_id===ttId).map(r=>{
    const v = (r.values||[]).find(x=>x.metric_id===metricId);
    return v && v.value!=null ? {date:r.date, value:parseFloat(v.value)} : null;
  }).filter(Boolean).sort((a,b)=>new Date(a.date)-new Date(b.date));
}

function renderStatsScatter(){
  const supOptions = supplements.map(s=>`<option value="${s.id}" ${s.id===statsScatterSupId?'selected':''}>${escapeHtml(s.name)}</option>`).join('');
  const metrics = allMetrics();
  const metricOptions = metrics.map(m=>`<option value="${m.key}" ${m.key===statsScatterMetricKey?'selected':''}>${escapeHtml(m.label)}</option>`).join('');
  if(!statsScatterSupId && supplements.length) statsScatterSupId = supplements[0].id;
  if(!statsScatterMetricKey && metrics.length) statsScatterMetricKey = metrics[0].key;

  let chart = '<div class="empty">Select a supplement and metric.</div>';
  let rInfo = '';
  if(statsScatterSupId && statsScatterMetricKey){
    const pts = metricValuesByDate(statsScatterMetricKey).map(p=>({date:p.date, y:p.value, x:avgDoseInWindow(statsScatterSupId, p.date, statsScatterLookback)}));
    if(pts.length>=2){
      const xs = pts.map(p=>p.x), ys = pts.map(p=>p.y);
      const r = pearson(xs,ys);
      rInfo = r!=null ? `<div class="r-value">r = ${r.toFixed(2)}</div><div class="hint">${Math.abs(r)<0.3?'Weak':Math.abs(r)<0.6?'Moderate':'Strong'} ${r>=0?'positive':'negative'} correlation across ${pts.length} test dates. With this few data points, treat as a lead worth investigating, not proof.</div>` : '<div class="hint">Not enough variation to compute a correlation.</div>';
      const W=320,H=220,pad=30;
      const minX=Math.min(...xs), maxX=Math.max(...xs)||1, minY=Math.min(...ys), maxY=Math.max(...ys)||1;
      const sx = x => pad + (maxX>minX ? (x-minX)/(maxX-minX) : 0.5)*(W-2*pad);
      const sy = y => H-pad - (maxY>minY ? (y-minY)/(maxY-minY) : 0.5)*(H-2*pad);
      const dots = pts.map(p=>`<circle cx="${sx(p.x).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="4" fill="#3E7C7C"/>`).join('');
      chart = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:340px;height:auto;">
        <line x1="${pad}" y1="${H-pad}" x2="${W-pad}" y2="${H-pad}" stroke="#E4DFD2"/>
        <line x1="${pad}" y1="${pad}" x2="${pad}" y2="${H-pad}" stroke="#E4DFD2"/>
        ${dots}
      </svg><div class="hint">x = avg daily dose in the ${statsScatterLookback} days before each test · y = test value</div>`;
    } else {
      chart = '<div class="empty">Need at least 2 test results for this metric to plot anything.</div>';
    }
  }

  return `
    <div class="stat-block">
      <h3>Dose vs. result scatter</h3>
      <div class="row">
        <div><label>Supplement</label><select onchange="statsScatterSupId=this.value; render()">${supOptions}</select></div>
        <div><label>Test metric</label><select onchange="statsScatterMetricKey=this.value; render()">${metricOptions}</select></div>
      </div>
      <label>Lookback window (days)</label>
      <input type="number" value="${statsScatterLookback}" onchange="statsScatterLookback=parseInt(this.value)||14; render()">
      ${chart}
      ${rInfo}
    </div>
  `;
}

function renderStatsTimeline(){
  const metrics = allMetrics();
  if(!statsTimelineMetricKey && metrics.length) statsTimelineMetricKey = metrics[0].key;
  if(!statsTimelineSupId && supplements.length) statsTimelineSupId = supplements[0].id;
  const metricOptions = metrics.map(m=>`<option value="${m.key}" ${m.key===statsTimelineMetricKey?'selected':''}>${escapeHtml(m.label)}</option>`).join('');
  const supOptions = supplements.map(s=>`<option value="${s.id}" ${s.id===statsTimelineSupId?'selected':''}>${escapeHtml(s.name)}</option>`).join('');

  let chart = '<div class="empty">No data.</div>';
  if(statsTimelineMetricKey){
    const pts = metricValuesByDate(statsTimelineMetricKey);
    const supEntries = statsTimelineSupId ? doseEntries.filter(e=>e.supplement_id===statsTimelineSupId).sort((a,b)=>new Date(a.time)-new Date(b.time)) : [];
    const firstDose = supEntries[0] ? new Date(supEntries[0].time) : null;
    if(pts.length){
      const W=340,H=200,pad=30;
      const dates = pts.map(p=>new Date(p.date).getTime());
      const vals = pts.map(p=>p.value);
      let minX=Math.min(...dates), maxX=Math.max(...dates);
      if(firstDose){ minX=Math.min(minX, firstDose.getTime()); maxX=Math.max(maxX, firstDose.getTime()); }
      const minY=Math.min(...vals), maxY=Math.max(...vals)||1;
      const sx = t => pad + (maxX>minX ? (t-minX)/(maxX-minX):0.5)*(W-2*pad);
      const sy = v => H-pad - (maxY>minY ? (v-minY)/(maxY-minY):0.5)*(H-2*pad);
      const path = pts.map((p,i)=>(i===0?'M':'L')+sx(new Date(p.date).getTime()).toFixed(1)+' '+sy(p.value).toFixed(1)).join(' ');
      const dots = pts.map(p=>`<circle cx="${sx(new Date(p.date).getTime()).toFixed(1)}" cy="${sy(p.value).toFixed(1)}" r="3.5" fill="#3E7C7C"/>`).join('');
      const marker = firstDose ? `<line x1="${sx(firstDose.getTime()).toFixed(1)}" y1="${pad}" x2="${sx(firstDose.getTime()).toFixed(1)}" y2="${H-pad}" stroke="#C88B3D" stroke-dasharray="3,3"/>` : '';
      chart = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:360px;height:auto;">
        <line x1="${pad}" y1="${H-pad}" x2="${W-pad}" y2="${H-pad}" stroke="#E4DFD2"/>
        <path d="${path}" fill="none" stroke="#3E7C7C" stroke-width="2"/>${dots}${marker}
      </svg>${firstDose?`<div class="hint"><span style="color:#C88B3D;">┊</span> marks first logged dose of the selected supplement</div>`:''}`;
    }
  }
  return `
    <div class="stat-block">
      <h3>Metric timeline with supplement marker</h3>
      <div class="row">
        <div><label>Test metric</label><select onchange="statsTimelineMetricKey=this.value; render()">${metricOptions}</select></div>
        <div><label>Supplement marker</label><select onchange="statsTimelineSupId=this.value; render()">${supOptions}</select></div>
      </div>
      ${chart}
    </div>
  `;
}

function renderStatsBeforeAfter(){
  if(!statsBASupId && supplements.length) statsBASupId = supplements[0].id;
  const supOptions = supplements.map(s=>`<option value="${s.id}" ${s.id===statsBASupId?'selected':''}>${escapeHtml(s.name)}</option>`).join('');
  let rowsHtml = '<div class="empty">Pick a supplement and start date.</div>';
  if(statsBASupId && statsBADate){
    const cutoff = new Date(statsBADate);
    const metrics = allMetrics();
    const rows = metrics.map(m=>{
      const pts = metricValuesByDate(m.key);
      const before = pts.filter(p=>new Date(p.date)<cutoff).map(p=>p.value);
      const after = pts.filter(p=>new Date(p.date)>=cutoff).map(p=>p.value);
      const avg = a => a.length ? (a.reduce((x,y)=>x+y,0)/a.length).toFixed(2) : '—';
      if(!before.length && !after.length) return '';
      return `<div class="list-row"><div><div class="list-row-main">${escapeHtml(m.label)}</div>
        <div class="list-row-sub">Before: ${avg(before)} (n=${before.length}) · After: ${avg(after)} (n=${after.length})</div></div></div>`;
    }).filter(Boolean).join('');
    rowsHtml = rows || '<div class="empty">No test results found around this date.</div>';
  }
  return `
    <div class="stat-block">
      <h3>Before / after comparison</h3>
      <div class="row">
        <div><label>Supplement</label><select onchange="statsBASupId=this.value; render()">${supOptions}</select></div>
        <div><label>Start date</label><input type="date" value="${statsBADate}" onchange="statsBADate=this.value; render()"></div>
      </div>
      ${rowsHtml}
    </div>
  `;
}

function renderStatsAdherence(){
  const {start,end} = (()=>{ const now=new Date(); const s=new Date(); s.setDate(now.getDate()-(statsAdherenceRange==='30d'?30:statsAdherenceRange==='90d'?90:365)); return {start:s,end:now}; })();
  const totalDays = Math.max(1, Math.round((end-start)/86400000));
  const rows = supplements.map(s=>{
    const daysWithDose = new Set(doseEntries.filter(e=>e.supplement_id===s.id && new Date(e.time)>=start && new Date(e.time)<=end).map(e=>new Date(e.time).toDateString()));
    const pct = Math.round((daysWithDose.size/totalDays)*100);
    return `<div style="margin-bottom:10px;">
      <div style="display:flex; justify-content:space-between; font-size:13px; margin-bottom:3px;"><span>${escapeHtml(s.name)}</span><span class="mono">${pct}%</span></div>
      <div style="height:8px; background:var(--paper-line); border-radius:4px; overflow:hidden;"><div style="height:100%; width:${pct}%; background:${s.color};"></div></div>
    </div>`;
  }).join('') || '<div class="empty">No supplements yet.</div>';
  return `
    <div class="stat-block">
      <h3>Adherence consistency</h3>
      <div class="daterange-row">
        <div class="chip ${statsAdherenceRange==='30d'?'active':''}" onclick="statsAdherenceRange='30d'; render()">30 days</div>
        <div class="chip ${statsAdherenceRange==='90d'?'active':''}" onclick="statsAdherenceRange='90d'; render()">90 days</div>
        <div class="chip ${statsAdherenceRange==='365d'?'active':''}" onclick="statsAdherenceRange='365d'; render()">1 year</div>
      </div>
      <div style="margin-top:12px;">${rows}</div>
      <div class="hint">% of days with at least one logged dose in the selected range.</div>
    </div>
  `;
}

function renderStatsMatrix(){
  const metrics = allMetrics();
  if(!supplements.length || !metrics.length) return `<div class="stat-block"><h3>Correlation overview</h3><div class="empty">Need at least one supplement and one numeric test metric.</div></div>`;
  const header = `<tr><th></th>${metrics.map(m=>`<th>${escapeHtml(m.label)}</th>`).join('')}</tr>`;
  const rows = supplements.map(s=>{
    const cells = metrics.map(m=>{
      const pts = metricValuesByDate(m.key).map(p=>({y:p.value, x:avgDoseInWindow(s.id, p.date, 14)}));
      if(pts.length<2) return `<td class="center">—</td>`;
      const r = pearson(pts.map(p=>p.x), pts.map(p=>p.y));
      if(r==null) return `<td class="center">—</td>`;
      const bg = r>0 ? `rgba(62,124,124,${Math.min(1,Math.abs(r))*0.5})` : `rgba(181,83,60,${Math.min(1,Math.abs(r))*0.5})`;
      return `<td class="center" style="background:${bg};">${r.toFixed(2)}</td>`;
    }).join('');
    return `<tr><td style="font-weight:650;">${escapeHtml(s.name)}</td>${cells}</tr>`;
  }).join('');
  return `
    <div class="stat-block">
      <h3>Correlation overview</h3>
      <div class="hint" style="margin-bottom:8px;">14-day average dose vs. each test value. Teal = positive correlation, rust = negative. Use this to spot pairs worth a closer look in the scatter chart above.</div>
      <div style="overflow-x:auto;"><table class="review">${header}${rows}</table></div>
    </div>
  `;
}

function renderStats(){
  const tabs = [
    {id:'scatter', label:'Scatter'},
    {id:'timeline', label:'Timeline'},
    {id:'beforeafter', label:'Before/After'},
    {id:'adherence', label:'Adherence'},
    {id:'matrix', label:'Matrix'}
  ];
  let body = '';
  if(statsTab==='scatter') body = renderStatsScatter();
  else if(statsTab==='timeline') body = renderStatsTimeline();
  else if(statsTab==='beforeafter') body = renderStatsBeforeAfter();
  else if(statsTab==='adherence') body = renderStatsAdherence();
  else body = renderStatsMatrix();

  return `
    <div class="card">
      <h2>Stats</h2>
      <div class="hint" style="margin-bottom:10px;">Exploratory only. With a handful of blood test dates, these surface patterns worth investigating or discussing with a doctor — not proof of cause and effect.</div>
      <div class="tabs">${tabs.map(t=>`<div class="tab ${statsTab===t.id?'active':''}" onclick="statsTab='${t.id}'; render()">${t.label}</div>`).join('')}</div>
      ${body}
    </div>
  `;
}

/* ================= settings: backup & restore ================= */
function goSettings(){ currentView='settings'; restorePending=null; render(); }
let restorePending = null; // {format, data, summary}

function downloadBackupNative(){
  const payload = {
    format: 'dtv3-native',
    exportedAt: new Date().toISOString(),
    supplements, doseEntries, testTypes, testResults
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'dose-tracker-backup-'+new Date().toISOString().slice(0,10)+'.json';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(url), 2000);
  showToast('Backup downloaded');
}

function handleRestoreFileSelect(inputEl){
  const file = inputEl.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = (e)=>{
    let data;
    try{ data = JSON.parse(e.target.result); }
    catch(err){ showToast('Could not read file: not valid JSON'); return; }

    let format, summary;
    if(data.format === 'legacy-v2-converted'){
      format = 'legacy';
      summary = {
        supplements: (data.supplements||[]).length,
        doseEntries: (data.dose_entries||[]).length,
        testTypes: (data.test_types||[]).length,
        testResults: (data.test_results||[]).length
      };
    } else if(data.format === 'dtv3-native' || Array.isArray(data.supplements)){
      format = 'native';
      summary = {
        supplements: (data.supplements||[]).length,
        doseEntries: (data.doseEntries||data.dose_entries||[]).length,
        testTypes: (data.testTypes||data.test_types||[]).length,
        testResults: (data.testResults||data.test_results||[]).length
      };
    } else {
      showToast('Unrecognized file format');
      return;
    }
    restorePending = {format, data, summary};
    render();
  };
  reader.readAsText(file);
}
function cancelRestore(){ restorePending = null; render(); }

async function confirmRestore(){
  if(!restorePending) return;
  const {format, data} = restorePending;
  restorePending = 'busy';
  render();
  try{
    if(format === 'legacy') await restoreLegacyFile(data);
    else await restoreNativeFile(data);
    showToast('Restore complete');
  } catch(err){
    console.error(err);
    showToast('Restore failed: '+err.message);
  }
  restorePending = null;
  await refreshAndRender();
  currentView = 'settings'; render();
}

async function restoreLegacyFile(data){
  const supplementIdMap = {};
  for(const s of (data.supplements||[])){
    let existing = supplements.find(x=>x.name.toLowerCase()===s.name.toLowerCase());
    if(existing){ supplementIdMap[s.legacy_id] = existing.id; }
    else {
      const {data:ins} = await sb.from('supplements').insert({
        name:s.name, dose_amount:s.dose_amount, dose_unit:s.dose_unit,
        color: s.color || colorForIndex(supplements.length), show_on_graph:true
      }).select().single();
      supplementIdMap[s.legacy_id] = ins.id;
      supplements.push(ins);
    }
  }

  const doseRows = (data.dose_entries||[]).map(e=>({
    supplement_id: supplementIdMap[e.legacy_supplement_id] || null,
    time: new Date(e.time).toISOString(),
    amount: e.amount, unit: e.unit,
    body_status: e.body_status || 'na', brain_status: e.brain_status || 'na',
    notes: e.notes || ''
  })).filter(r=>r.supplement_id);
  for(let i=0;i<doseRows.length;i+=200){
    await sb.from('dose_entries').insert(doseRows.slice(i,i+200));
  }

  const testTypeIdMap = {}, metricIdMap = {};
  for(const t of (data.test_types||[])){
    let existingTT = testTypes.find(x=>x.name.toLowerCase()===t.name.toLowerCase());
    let ttId;
    if(existingTT){ ttId = existingTT.id; }
    else {
      const {data:ins} = await sb.from('test_types').insert({name:t.name}).select().single();
      ttId = ins.id; existingTT = {...ins, metrics:[]}; testTypes.push(existingTT);
    }
    testTypeIdMap[t.legacy_id] = ttId;
    for(const m of (t.metrics||[])){
      let existingM = (existingTT.metrics||[]).find(x=>x.name.toLowerCase()===m.name.toLowerCase());
      if(existingM){ metricIdMap[m.legacy_id] = existingM.id; }
      else {
        const {data:insM} = await sb.from('test_metrics').insert({
          test_type_id:ttId, name:m.name, unit:m.unit,
          target:m.target===''||m.target==null?null:m.target,
          min:m.min===''||m.min==null?null:m.min,
          max:m.max===''||m.max==null?null:m.max,
          color:m.color||colorForIndex(existingTT.metrics.length), is_numeric:true, show_on_graph:true
        }).select().single();
        metricIdMap[m.legacy_id] = insM.id;
        existingTT.metrics.push(insM);
      }
    }
  }

  for(const r of (data.test_results||[])){
    const ttId = testTypeIdMap[r.legacy_test_type_id];
    if(!ttId) continue;
    const {data:resIns} = await sb.from('test_results').insert({test_type_id:ttId, date:r.date, notes:r.notes||''}).select().single();
    const valueRows = Object.entries(r.values||{}).map(([legacyMetricId,val])=>{
      const metricId = metricIdMap[legacyMetricId];
      if(!metricId) return null;
      const num = parseFloat(val);
      return { test_result_id: resIns.id, metric_id: metricId, value: isNaN(num)?null:num, text_value: isNaN(num)?String(val):null };
    }).filter(Boolean);
    if(valueRows.length) await sb.from('test_result_values').insert(valueRows);
  }
}

async function restoreNativeFile(data){
  const supList = data.supplements||[];
  const doseList = data.doseEntries||data.dose_entries||[];
  const ttList = data.testTypes||data.test_types||[];
  const trList = data.testResults||data.test_results||[];

  for(const s of supList){
    const {id, user_id, created_at, ...rest} = s;
    await sb.from('supplements').upsert({id, ...rest});
  }
  for(const e of doseList){
    const {id, user_id, ...rest} = e;
    await sb.from('dose_entries').upsert({id, ...rest});
  }
  for(const t of ttList){
    const {id, user_id, created_at, metrics, ...rest} = t;
    await sb.from('test_types').upsert({id, ...rest});
    for(const m of (metrics||t.test_metrics||[])){
      const {id:mid, ...mrest} = m;
      await sb.from('test_metrics').upsert({id:mid, ...mrest});
    }
  }
  for(const r of trList){
    const {id, user_id, values, test_result_values, ...rest} = r;
    await sb.from('test_results').upsert({id, ...rest});
    for(const v of (values||test_result_values||[])){
      const {id:vid, ...vrest} = v;
      await sb.from('test_result_values').upsert({id:vid, ...vrest});
    }
  }
}

function renderSettings(){
  let restoreSection;
  if(restorePending === 'busy'){
    restoreSection = `<div class="empty">Restoring… this can take a moment for larger files.</div>`;
  } else if(restorePending){
    const s = restorePending.summary;
    const label = restorePending.format === 'legacy' ? 'Legacy (pre-Supabase) backup detected' : 'Native backup detected — will restore/overwrite matching records exactly';
    restoreSection = `
      <div class="hint" style="margin-bottom:8px;">${label}</div>
      <div class="list-row"><div>Supplements</div><div class="mono">${s.supplements}</div></div>
      <div class="list-row"><div>Dose entries</div><div class="mono">${s.doseEntries}</div></div>
      <div class="list-row"><div>Test types</div><div class="mono">${s.testTypes}</div></div>
      <div class="list-row"><div>Test results</div><div class="mono">${s.testResults}</div></div>
      ${restorePending.format==='legacy' ? '<div class="hint" style="margin-top:8px;">Supplements/test types will be matched to existing ones by name where possible, rather than duplicated.</div>' : ''}
      <button class="btn" onclick="confirmRestore()">Confirm restore</button>
      <button class="btn secondary" onclick="cancelRestore()">Cancel</button>
    `;
  } else {
    restoreSection = `
      <div class="hint" style="margin-bottom:8px;">Accepts either a backup downloaded from this app, or a legacy-converted file from an earlier version.</div>
      <input type="file" accept="application/json" onchange="handleRestoreFileSelect(this)">
    `;
  }

  return `
    <div class="card">
      <h2>Backup</h2>
      <div class="hint" style="margin-bottom:8px;">Downloads everything currently in your account as a JSON file.</div>
      <button class="btn" onclick="downloadBackupNative()">Backup now</button>
    </div>
    <div class="card">
      <h2>Restore</h2>
      ${restoreSection}
    </div>
  `;
}

/* ================= render dispatch ================= */
function render(){
  renderNav();
  const app = document.getElementById('app');
  if(currentView==='dashboard') app.innerHTML = renderDashboard();
  else if(currentView==='logDose') app.innerHTML = renderLogDose();
  else if(currentView==='doseLog') app.innerHTML = `<span class="back-link" onclick="goView('dashboard')">← Back</span>` + renderDoseLog();
  else if(currentView==='manageSupplements') app.innerHTML = renderManageSupplements();
  else if(currentView==='manageTests') app.innerHTML = renderManageTests();
  else if(currentView==='stats') app.innerHTML = `<span class="back-link" onclick="goView('dashboard')">← Back</span>` + renderStats();
  else if(currentView==='settings') app.innerHTML = `<span class="back-link" onclick="goView('dashboard')">← Back</span>` + renderSettings();
}

/* ================= init ================= */
(async function requestPersistence(){ try{ if(navigator.storage && navigator.storage.persist) await navigator.storage.persist(); }catch(e){} })();
boot();
