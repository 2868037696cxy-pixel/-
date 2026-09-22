// ===== JEV Creative Studio 前端 =====
const api = {
  materials: '/api/materials',
  model: '/api/model',
  import: '/api/import',
  upload: '/api/upload',
};
let MATERIALS = [];
let MODEL = null; // {weights, dimensions, descriptions, rules, grades}
let filters = { grade:'', media:'', verdict:'', q:'' };
let sortBy = 'composite-desc';
let selected = null;

const $ = (id) => document.getElementById(id);

// ---------- 客户端重算（镜像后端逻辑，用于滑块实时预览） ----------
function clientComposite(dims, weights){
  const keys = Object.keys(weights||{});
  let total=0, ws=0;
  for(const k of keys){ const w=+weights[k]||0, v=+dims[k]??0; total+=w*v; ws+=w; }
  return ws? total/ws : 0;
}
function clientGrade(score){
  return (MODEL.grades||[]).find(b=>score>=b.min) || MODEL.grades[MODEL.grades.length-1] || {grade:'D',label:'不合格'};
}
function clientVerdict(dims, score, flags, type){
  const rules = MODEL.rules||[];
  const critical = flags.filter(f=>{const r=rules.find(x=>x.key===f.key);return r&&r.severity==='critical';});
  const warning = flags.filter(f=>{const r=rules.find(x=>x.key===f.key);return r&&r.severity==='warning';});
  const g={verdict:'NO',reasons:[]}, fb={verdict:'NO',reasons:[]};
  critical.forEach(f=>{const r=rules.find(x=>x.key===f.key);(g.reasons).push('违禁:'+(r?r.label:f.key));(fb.reasons).push('违禁:'+(r?r.label:f.key));});
  if(!critical.length){
    if(score>=80){g.verdict='GO';fb.verdict='GO';g.reasons.push('综合评分优秀');fb.reasons.push('综合评分优秀');}
    else if(score>=70){g.verdict='GO';fb.verdict='GO';g.reasons.push('评分达标,建议测试');fb.reasons.push('评分达标,建议测试');}
    else if(score>=55){g.verdict='COND';fb.verdict='COND';g.reasons.push('建议优化钩子/CTA后投放');fb.reasons.push('建议优化钩子/CTA后投放');}
    else {g.verdict='NO';fb.verdict='NO';g.reasons.push('综合评分过低');fb.reasons.push('综合评分过低');}
  }
  warning.forEach(f=>{const r=rules.find(x=>x.key===f.key);if(g.verdict==='GO')g.verdict='COND';if(fb.verdict==='GO')fb.verdict='COND';g.reasons.push('风险提示:'+(r?r.label:f.key));fb.reasons.push('风险提示:'+(r?r.label:f.key));});
  return {google:g, fb};
}
function fmtScore(s){ return Math.round(s*10)/10; }

// ---------- 数据加载 ----------
async function loadData(){
  const [mats, mod] = await Promise.all([fetch(api.materials).then(r=>r.json()), fetch(api.model).then(r=>r.json())]);
  MATERIALS = mats; MODEL = mod;
  initFilters();
  render();
}
function initFilters(){
  if(!MODEL.grades) return;
  const sel=$('filterGrade');
  sel.innerHTML='<option value="">全部分级</option>'+MODEL.grades.map(g=>`<option value="${g.grade}">${g.grade} 级 · ${g.label}</option>`).join('');
}

// ---------- 渲染 ----------
function render(){
  renderStats();
  renderGrid();
}
function renderStats(){
  const n=MATERIALS.length;
  $('statTotal').textContent=n;
  $('statAvg').textContent = n? fmtScore(MATERIALS.reduce((a,m)=>a+m.composite,0)/n) : '--';
  $('statGo').textContent=MATERIALS.filter(m=>m.verdict.google.verdict==='GO').length;
  $('statCond').textContent=MATERIALS.filter(m=>m.verdict.google.verdict==='COND').length;
  $('statNo').textContent=MATERIALS.filter(m=>m.verdict.google.verdict==='NO').length;
}
function filtered(){
  const q=filters.q.trim().toLowerCase();
  let arr=MATERIALS.filter(m=>{
    if(filters.grade && m.grade!==filters.grade) return false;
    if(filters.media && m.mediaType!==filters.media) return false;
    if(filters.verdict && m.verdict.google.verdict!==filters.verdict) return false;
    if(q){
      const hay=(m.name+' '+(m.tags||[]).join(' ')+' '+(m.customTags||[]).join(' ')+' '+(m.notes||'')).toLowerCase();
      if(!hay.includes(q)) return false;
    }
    return true;
  });
  const [field,dir]=sortBy.split('-');
  arr.sort((a,b)=>{
    if(field==='composite') return dir==='desc'? b.composite-a.composite : a.composite-b.composite;
    if(field==='updated') return b.updatedAt-a.updatedAt;
    if(field==='name') return a.name.localeCompare(b.name,'zh');
    return 0;
  });
  return arr;
}
function thumbSrc(m){
  if((m.kind==='url') && /^(https?:)?\/\//.test(m.ref||'')) return m.ref;
  if(m.kind==='local' && m.ref) return m.ref;
  return null;
}
function cardHTML(m){
  const src=thumbSrc(m);
  const g=m.gradeInfo||{label:m.grade};
  const tagList=(m.tags||[]).concat(m.customTags||[]).slice(0,6);
  const gv=m.verdict.google.verdict, fv=m.verdict.fb.verdict;
  const vCls={GO:'g',COND:'y',NO:'r'};
  const media='<i class="fileicon">'+(m.mediaType==='video'?'🎬':m.mediaType==='carousel'?'🗂️':'🖼️')+'</i>';
  const mediaHtml = src
    ? (m.mediaType==='video'
      ? `<video src="${src}" muted loop preload="metadata" onmouseenter="this.play()" onmouseleave="this.pause()"></video>`
      : `<img src="${src}" loading="lazy" alt="">`)
    : `<div style="height:100%;display:flex;align-items:center;justify-content:center;font-size:44px;color:#c7d2fe;background:#eef1f8">${m.mediaType==='video'?'🎬':'🗂️'}</div>`;
  return `<article class="card" data-id="${m.id}" onclick="openDrawer('${m.id}')">
    <div class="thumb">
      ${mediaHtml}
      <div class="score-badge ${m.grade}"><b>${fmtScore(m.composite)}</b><span>分</span></div>
      <div class="grade-chip badge-${m.grade}">${m.grade}级</div>
    </div>
    <div class="card-body">
      <div class="card-title">${m.name}</div>
      <div class="mini-bars">${(['hook','message','visual','pacing','cta']).map(k=>`<i><b style="width:${m.dims[k]}%"></b></i>`).join('')}</div>
      <div class="verdicts">
        <span class="vchip ${vCls[gv]}"><i>G</i> ${gv==='GO'?'可投':gv==='COND'?'需优化':'禁投'}</span>
        <span class="vchip ${vCls[fv]}"><i>F</i> ${fv==='GO'?'可投':fv==='COND'?'需优化':'禁投'}</span>
      </div>
      <div class="tags">${tagList.map(t=>`<span class="tag ${/违禁|高风险/.test(t)?'risk':/重点|优秀|强钩子|高可信/.test(t)?'hot':''}">${t}</span>`).join('')||''}</div>
      <div class="card-foot"><span>${media} ${m.mediaType==='video'?'视频':'图文'}${m.category&&m.category!=='未分类'?' · '+m.category:''}</span><span>${timeAgo(m.updatedAt)}</span></div>
    </div>
  </article>`;
}
function renderGrid(){
  const list=filtered();
  $('grid').innerHTML=list.map(cardHTML).join('');
  $('empty').classList.toggle('hidden', list.length>0);
  $('grid').classList.toggle('hidden', list.length===0);
}
function timeAgo(t){
  if(!t) return '';
  const s=(Date.now()-t)/1000;
  if(s<60) return '刚刚';
  if(s<3600) return Math.floor(s/60)+' 分钟前';
  if(s<86400) return Math.floor(s/3600)+' 时前';
  return Math.floor(s/86400)+' 天前';
}

// ---------- 抽屉 ----------
function openDrawer(id){
  const m=MATERIALS.find(x=>x.id===id); if(!m) return;
  selected=m;
  renderDrawer();
  $('drawerBackdrop').classList.remove('hidden');
  $('drawer').classList.remove('hidden');
}
function closeDrawer(){ $('drawerBackdrop').classList.add('hidden'); $('drawer').classList.add('hidden'); selected=null; }

function renderDrawer(){
  const m=selected; if(!m) return;
  const src=thumbSrc(m);
  const dropdown=[...Array.from(m.flags||[])].map(f=>{
    const r=MODEL.rules.find(x=>x.key===f.key);
    return {key:f.key,label:r?r.label:f.key,sev:r?r.severity:'warning',checked:f.checked};
  });
  // 计算即时预览
  const prevScore=fmtScore(clientComposite(m.dims,MODEL.weights));
  const prevGrade=clientGrade(prevScore);
  const flags=dropdown.filter(f=>f.checked).map(f=>({key:f.key}));
  const prevVid=clientVerdict(m.dims,prevScore,flags,m.mediaType);
  const preview = src
    ? (m.mediaType==='video'
      ? `<video src="${src}" controls style="max-width:100%;max-height:420px"></video>`
      : `<img src="${src}" style="max-width:100%;max-height:420px">`)
    : `<div style="font-size:64px;color:#c7d2fe">${m.mediaType==='video'?'🎬':'🗂️'}</div>`;

  const dimRows=Object.keys(MODEL.weights).map(k=>`
    <div class="dim">
      <span class="lbl">${MODEL.dimensions[k]}<small>权重 ${MODEL.weights[k]}%</small></span>
      <input type="range" min="0" max="100" step="1" value="${m.dims[k]}" data-dim="${k}" oninput="onDim(this)">
      <span class="val" id="v-${k}">${m.dims[k]}</span>
    </div>`).join('');

  const wProps=Object.entries(dropdown).map(([,f])=>`
    <label class="check-row">
      <input type="checkbox" data-flag="${f.key}" ${f.checked?'checked':''} onchange="onFlag(this)">
      <span class="cr-label">${f.label}</span>
      <span class="cr-sev sev-${f.sev}">${f.sev==='critical'?'一票否决':'风险'} </span>
    </label>`).join('');

  const vb=(title,obj,cls)=>`<div class="verdict-box vb-${cls}">
      <h4><span class="vchip ${cls==='GO'?'g':cls==='COND'?'y':'r'}"><i>${title[0]}</i>${title}</span> → <b>${obj.verdict==='GO'?'可投放':obj.verdict==='COND'?'需优化后投放':'不可投放'}</b></h4>
      <ul>${obj.reasons.map(r=>`<li>${r}</li>`).join('')}</ul>
    </div>`;
  const hasCritical=dropdown.some(f=>f.checked&&f.sev==='critical');

  $('drawer').innerHTML=`
    <div class="drawer-head"><h2>素材详情与评分</h2>
      <button class="shape-btn" onclick="closeDrawer()">✕</button>
    </div>
    <div class="drawer-body">
      <div class="preview">${preview}</div>
      <div class="d-summary">
        <div class="d-score ${prevGrade.grade}" style="background:${scoreColor(prevGrade.grade)}"><b>${prevScore}</b><span>JEV 综合分</span></div>
        <div style="flex:1">
          <div style="font-weight:700;font-size:16px">${m.name}</div>
          <div style="color:var(--muted);font-size:12.5px;margin-top:4px">
            类型:${m.mediaType==='video'?'视频':m.mediaType==='carousel'?'轮播':'图文'} · 分级:<b>${prevGrade.grade} 级(${prevGrade.label})</b> · ${bytes(m.sizeBytes)}
          </div>
          <div class="verdicts" style="margin-top:10px">
            <span class="vchip ${vCls(prevVid.google.verdict)}"><i>G</i> Google ${vName(prevVid.google.verdict)}</span>
            <span class="vchip ${vCls(prevVid.fb.verdict)}"><i>F</i> Facebook ${vName(prevVid.fb.verdict)}</span>
          </div>
        </div>
        <button class="btn danger">删除</button>
      </div>

      <div class="section">
        <h3>维度评分 <span class="warn">拖动滑块自动重算综合分</span></h3>
        ${dimRows}
      </div>

      <div class="section">
        <h3>合规 & 投放判定</h3>
        ${vb('Google', prevVid.google, prevVid.google.verdict)}
        ${vb('Facebook', prevVid.fb, prevVid.fb.verdict)}
        ${hasCritical?'<div style="color:#b91c1c;font-size:12px;margin-top:8px">⚠ 存在一票否决违禁项，两平台均判定不可投放。</div>':''}
      </div>

      <div class="section">
        <h3>合规违禁项检查</h3>
        ${wProps}
      </div>

      <div class="section">
        <h3>素材信息</h3>
        <div class="form-grid">
          <div><label>名称</label><input id="f-name" value="${m.name}"></div>
          <div><label>分类 / 品类</label><input id="f-category" value="${m.category||''}" placeholder="如：美妆、家居、3C…"></div>
          <div><label>素材类型</label>
            <select id="f-type">${['image','video','carousel'].map(t=>`<option value="${t}" ${m.mediaType===t?'selected':''}>${t==='image'?'图文':t==='video'?'视频':'轮播'}</option>`).join('')}</select>
          </div>
          <div><label>自定义标签（逗号分隔）</label><input id="f-tags" value="${(m.customTags||[]).join(', ')}"></div>
          <div class="full"><label>备注 / 投放说明</label><textarea id="f-notes">${m.notes||''}</textarea></div>
        </div>
      </div>

      <div class="section">
        <h3>实况表现指标（可选填报）</h3>
        <div class="form-grid">
          <div><label>CTR %</label><input id="f-ctr" type="number" step="0.01" value="${m.meta.ctr||''}"></div>
          <div><label>CVR %</label><input id="f-cvr" type="number" step="0.01" value="${m.meta.cvr||''}"></div>
          <div><label>ROAS</label><input id="f-roas" type="number" step="0.01" value="${m.meta.roas||''}"></div>
          <div><label>展示(Impr)</label><input id="f-impr" type="number" value="${m.meta.impr||''}"></div>
        </div>
        <button class="btn ghost sm" style="margin-top:10px" onclick="applyMetaTuning()">依据实况数据微调评分</button>
      </div>

      <div class="d-actions">
        <button class="btn primary" onclick="saveDetail()">保存修改</button>
        <button class="btn ghost" onclick="closeDrawer()">关闭</button>
      </div>
    </div>`;

  // 绑定删除
  $('drawer').querySelector('.btn.danger').onclick=()=>delMaterial(m.id);
  // 泛化监听
  $('f-name').onchange=()=>{m.name=$('f-name').value;};
  $('f-category').onchange=()=>{m.category=$('f-category').value;};
  $('f-type').onchange=()=>{m.mediaType=$('f-type').value; renderDrawer();};
}
function scoreColor(g){return {S:'linear-gradient(135deg,#059669,#10b981)',A:'linear-gradient(135deg,#16a34a,#4ade80)',B:'linear-gradient(135deg,#0284c7,#38bdf8)',C:'linear-gradient(135deg,#d97706,#fbbf24)',D:'linear-gradient(135deg,#dc2626,#f87171)'}[g]||'#6b7594';}
function vCls(v){return v==='GO'?'g':v==='COND'?'y':'r';}
function vName(v){return v==='GO'?'可投放':v==='COND'?'需优化':'不可投';}
function bytes(b){if(!b)return'';const s=b/1024;return s>1024? (s/1024).toFixed(1)+' MB' : Math.round(s)+' KB';}

// ---------- 交互 ----------
function throttledSave(m){
  clearTimeout(m.__save);
  m.__save=setTimeout(()=>saveDetail(true),400);
}
function onDim(el){
  const k=el.dataset.dim;
  selected.dims[k]=+el.value;
  $(`v-${k}`).textContent=el.value;
  const s=fmtScore(clientComposite(selected.dims,MODEL.weights));
  // 刷新评分徽章需要重建，但抽屉内我们只更新保存时; 这里更新 summary 数字
  throttledSave(selected);
}
function onFlag(el){
  const k=el.dataset.flag;
  const f=selected.flags.find(x=>x.key===k); if(f) f.checked=el.checked;
  // 重新渲染合规判定区（简化：整体重建抽屉会丢滑块输入焦点，这里只重建判定 section 较复杂，直接全量重建但保留值）
  renderDrawer();
  throttledSave(selected);
}
async function saveDetail(silent){
  const m=selected; if(!m) return;
  const customTags=(($('f-tags')?.value||'').split(',').map(s=>s.trim()).filter(Boolean));
  const meta={ctr:+(($('f-ctr')?.value)||0),cvr:+(($('f-cvr')?.value)||0),roas:+(($('f-roas')?.value)||0),impr:+(($('f-impr')?.value)||0)};
  const checkedFlags=selected.flags.filter(f=>f.checked).map(f=>f.key);
  const body={
    dims:m.dims,
    customTags,
    category:m.category,
    notes:($('f-notes')?.value)||m.notes,
    meta,
    checkedFlags
  };
  const res=await fetch(api.materials+'/'+m.id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const updated=await res.json();
  const i=MATERIALS.findIndex(x=>x.id===m.id);
  if(i>=0) MATERIALS[i]=updated;
  selected=updated;
  render();
  if(!silent){ renderDrawer(); toast('已保存'); }
}
async function delMaterial(id){
  if(!confirm('确定删除该素材？（本地媒体文件也会被移除）')) return;
  await fetch(api.materials+'/'+id,{method:'DELETE'});
  MATERIALS=MATERIALS.filter(x=>x.id!==id);
  closeDrawer(); render(); toast('已删除');
}
function applyMetaTuning(){
  const ctr=+($('f-ctr')?.value||0), cvr=+($('f-cvr')?.value||0), roas=+($('f-roas')?.value||0);
  if(!ctr&&!cvr&&!roas){toast('请先填入至少一项实况指标');return;}
  // 漏斗微调：CTR 影响钩子/信息，CVR 影响产品/CTA，ROAS 综合加成
  let adj=0;
  if(ctr){ if(ctr>=2) selected.dims.hook=Math.min(100,selected.dims.hook+8),adj++; else if(ctr<0.8) selected.dims.hook=Math.max(0,selected.dims.hook-8),adj++; }
  if(cvr){ if(cvr>=3) selected.dims.cta=Math.min(100,selected.dims.cta+8),adj++; else if(cvr<1) selected.dims.cta=Math.max(0,selected.dims.cta-6),adj++; }
  if(roas){ if(roas>=2) {selected.composite=Math.min(100,selected.composite+3);} else if(roas<1 && roas>0){selected.composite=Math.max(0,selected.composite-3);} }
  toast('已按实况指标微调，请查看滑块并保存');
  renderDrawer();
}

// ---------- 导入弹窗 ----------
function openAdd(){
  $('modalBackdrop').classList.remove('hidden');
  $('modal').innerHTML=`
    <h2>导入素材</h2>
    <div class="sub">支持：本地上传 / 批量扫描本地文件夹 / 粘贴素材链接</div>
    <div class="dropzone" id="dz">点击或拖拽文件到此处上传<small>支持图片、视频（≤500MB / 个）</small>
      <input type="file" id="fileIn" multiple accept="image/*,video/*" hidden>
    </div>
    <div class="line20"></div>
    <div class="mfield"><label>批量扫描本地素材文件夹（服务端扫描）</label>
      <input id="importDir" placeholder="输入绝对路径，如 /Users/me/Materials 或 C:/creatives">
    </div>
    <button class="btn primary" onclick="runFolderImport()">扫描此文件夹入库</button>
    <div class="line20"></div>
    <div class="mfield"><label>粘贴素材链接</label>
      <input id="linkInput" placeholder="https://…/creative.png 或 MP4 链接">
    </div>
    <button class="btn primary" onclick="runLinkImport()">从链接入库</button>
    <div class="import-actions">
      <button class="btn ghost" onclick="closeModal()">关闭</button>
    </div>
    <div id="importProgress" style="margin-top:12px;font-size:13px;color:var(--accent)"></div>`;
  const dz=$('dz'), fileIn=$('fileIn');
  dz.onclick=()=>fileIn.click();
  dz.ondragover=e=>{e.preventDefault();dz.classList.add('drag');};
  dz.ondragleave=()=>dz.classList.remove('drag');
  dz.ondrop=e=>{e.preventDefault();dz.classList.remove('drag');doUpload(e.dataTransfer.files);};
  fileIn.onchange=()=>doUpload(fileIn.files);
}
async function doUpload(files){
  if(!files||!files.length)return;
  const form=new FormData();
  [...files].forEach(f=>form.append('files',f));
  const prog=$('importProgress'); prog.textContent=`上传中 ${files.length} 个文件…`;
  try{
    const r=await fetch(api.upload,{method:'POST',body:form});
    await loadData();
    prog.textContent=`✓ 已导入 ${files.length} 个素材`;
    toast('导入成功');
  }catch(e){prog.textContent='上传失败: '+e.message;}
}
async function runFolderImport(){
  const dir=$('importDir').value.trim();
  if(!dir){toast('请输入目录路径');return;}
  const prog=$('importProgress'); prog.textContent='扫描中…';
  const r=await fetch(api.import,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({dir})});
  const j=await r.json();
  if(j.error){prog.textContent='✗ '+j.error;}
  else {await loadData();prog.textContent=`✓ 新增 ${j.added} 个 · 跳过 ${j.skipped}`;toast(`导入 ${j.added} 个素材`);}
}
async function runLinkImport(){
  const url=$('linkInput').value.trim();
  if(!url){toast('请输入链接');return;}
  const name=url.split('/').pop()||'linked-material';
  await fetch(api.materials,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url,name})});
  await loadData();
  $('linkInput').value='';
  toast('已从链接入库');
}

// ---------- 评分模型弹窗 ----------
function openModel(){
  $('modelModalBackdrop').classList.remove('hidden');
  const w=MODEL.weights;
  $('modelModal').innerHTML=`
    <h2>JEV 评分模型</h2>
    <div class="sub">调整各维度权重（总和不必到100%，系统会自动归一化）。修改后全库重新评分。</div>
    <div class="id"><b>模型说明</b><div style="font-size:12.5px;color:var(--muted);margin:6px 0 14px">
      综合分 = Σ(维度分 × 权重) / Σ权重，保留两位。<br>分级：S≥90 优秀 · A≥80 良好 · B≥70 合格 · C≥55 待优化 · D&lt;55 不合格。<br>一票否决：命中任意 critical 违禁项，直接判不可投放（Google/FB）。</div></div>
    <div class="wt-grid">
      ${Object.keys(w).map(k=>`<div class="wt"><label>${MODEL.dimensions[k]}</label><input id="w-${k}" type="number" min="0" max="100" value="${w[k]}"></div>`).join('')}
      <div class="wt full" style="grid-column:1/-1"><label>总权重</label><b id="wtSum">${Object.values(w).reduce((a,b)=>a+b,0)}</b></div>
    </div>
    ${Object.keys(MODEL.descriptions).map(k=>`<div class="dim" style="padding:7px 0"><span class="lbl" style="width:180px">${MODEL.dimensions[k]}</span><span style="font-size:12px;color:#39415c">${MODEL.descriptions[k]}</span></div>`).join('')}
    <div class="import-actions">
      <button class="btn primary" onclick="saveModel()">保存并重新评分全库</button>
      <button class="btn ghost" onclick="closeModel()">关闭</button>
    </div>`;
  $('wtSum').textContent=Object.values(w).reduce((a,b)=>a+b,0);
}
async function saveModel(){
  const weights={};
  for(const k of Object.keys(MODEL.weights)) weights[k]=+$('w-'+k).value||0;
  const r=await fetch(api.model,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({weights})});
  const j=await r.json();
  MODEL.weights=j.weights;
  await loadData();
  closeModel();
  toast('评分模型已更新，全库已重新评分');
}
function closeModel(){ $('modelModalBackdrop').classList.add('hidden'); $('modelModal').classList.add('hidden'); }
function closeModal(){ $('modalBackdrop').classList.add('hidden'); $('modal').classList.add('hidden'); }

function toast(msg){ const t=$('toast'); t.textContent=msg; t.classList.remove('hidden'); setTimeout(()=>t.classList.add('hidden'),2400); }

// ---------- 事件绑定 ----------
$('btnAdd').onclick=openAdd;
$('btnModel').onclick=openModel;
$('drawerBackdrop').onclick=closeDrawer;
$('modalBackdrop').onclick=closeModal;
$('modelModalBackdrop').onclick=closeModel;
$('searchBox').oninput=e=>{filters.q=e.target.value;renderGrid();};
$('filterGrade').onchange=e=>{filters.grade=e.target.value;renderGrid();};
$('filterMedia').onchange=e=>{filters.media=e.target.value;renderGrid();};
$('filterVerdict').onchange=e=>{filters.verdict=e.target.value;renderGrid();};
$('sortBy').onchange=e=>{sortBy=e.target.value;renderGrid();};
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeDrawer();closeModal();closeModel();}});

loadData();