/* Details panel (draggable / resizable) + photo lightbox. Loaded after the main script. */
const thumb=i=>{const p=photo(i);return `<div class="ph" ${p?`data-z="${esc(p)}" data-t="${esc(i.type+" – "+i.loc)}"`:""}>${p?`<img src="${esc(p)}" alt="" loading="lazy">`:""}</div>`};
function itemHTML(i,btn=true){const c=calc(i),p=photo(i);
return `<div class="it"><div class="ph big" ${p?`data-z="${esc(p)}" data-t="${esc(i.type+" – "+i.loc)}"`:""}>${p?`<img src="${esc(p)}" alt="${esc(i.type)}" loading="lazy"><span class="zm">⤢ Enlarge</span>`:"No photo"}</div><div class="info"><b>${esc(i.type)}</b> · ${esc(i.loc||"no location")} <span class="note">#${i.n}</span><br>${pill(i.cond)} ${pill(c.st)}<br><span class="note">Last: ${fmt(i.last)} · Next due: ${fmt(c.next)}</span>${i.comment&&i.comment!="N/A"?`<br>${esc(i.comment)}`:""}${btn&&can?`<br><button class="btn s" data-e="${i.id}" style="margin-top:8px">Edit</button>`:""}</div></div>`}

const mob=()=>matchMedia("(max-width:900px)").matches;
function closePanel(){$("#sh").classList.remove("on")}
function openPanel(title,html,wire){const s=$("#sh");
 s.innerHTML=`<div class="sh-h" id="shh" title="Drag to move"><i class="grip"></i><b>${title}</b><button class="btn s" id="cl" aria-label="Close">✕</button></div><div class="sh-b">${html}</div>`;
 s.classList.add("on");s.style.height="";if(!mob()){const p=JSON.parse(LS.get("sep_pos")||"null");if(p)place(s,p.x,p.y)}else{s.style.left=s.style.top=""}
 $("#cl").onclick=closePanel;s.querySelector(".sh-b").scrollTop=0;wire&&wire(s)}
function place(s,x,y){const w=s.offsetWidth,h=Math.min(s.offsetHeight,innerHeight);s.style.right="auto";s.style.bottom="auto";s.style.left=Math.max(8-w+80,Math.min(innerWidth-80,x))+"px";s.style.top=Math.max(0,Math.min(innerHeight-60,y))+"px"}
function showOne(i){openPanel(`${esc(i.type)} – ${esc(i.loc)}`,itemHTML(i,false))}
function showGroup(g){openPanel(`${esc(g.type)} – ${esc(g.loc)} (${g.items.length})`,g.items.map(i=>itemHTML(i)).join(""),s=>s.querySelectorAll("[data-e]").forEach(b=>b.onclick=()=>openEdit(ITEMS.find(i=>i.id==b.dataset.e))))}
// drag the panel by its header (desktop: move; phone: pull up/down to resize, pull far down to close)
(()=>{let d=null;const s=()=>$("#sh");
 document.addEventListener("pointerdown",e=>{const h=e.target.closest("#shh");if(!h||e.target.closest("button"))return;const r=s().getBoundingClientRect();d={x:e.clientX-r.left,y:e.clientY-r.top};h.setPointerCapture(e.pointerId)});
 document.addEventListener("pointermove",e=>{if(!d)return;if(mob()){const h=innerHeight-e.clientY;s().style.height=Math.max(120,Math.min(innerHeight*.92,h))+"px";s().style.maxHeight="92vh"}else place(s(),e.clientX-d.x,e.clientY-d.y)});
 const up=e=>{if(!d)return;d=null;if(mob()){if(s().offsetHeight<innerHeight*.2)closePanel()}else{const r=s().getBoundingClientRect();LS.set("sep_pos",JSON.stringify({x:r.left,y:r.top}))}};
 document.addEventListener("pointerup",up);document.addEventListener("pointercancel",up);
 addEventListener("resize",()=>{if(!mob()&&s().classList.contains("on")&&s().style.left){const r=s().getBoundingClientRect();place(s(),r.left,r.top)}})})();

// photo lightbox: zoom (wheel, buttons, double-click, pinch) and pan
const lb=document.createElement("div");lb.id="lb";lb.innerHTML=`<div class="lt"><b id="lbt"></b><button id="lbo" aria-label="Zoom out">−</button><button id="lbi" aria-label="Zoom in">+</button><button id="lbr" aria-label="Reset">⟲</button><button id="lbc" aria-label="Close">✕</button></div><div class="lv" id="lv"><img id="lbm" alt=""></div>`;document.body.appendChild(lb);
let Z=1,X=0,Y=0;const im=()=>$("#lbm"),tf=()=>im().style.transform=`translate(calc(-50% + ${X}px),calc(-50% + ${Y}px)) scale(${Z})`;
const zset=(z,cx=0,cy=0)=>{z=Math.max(1,Math.min(8,z));X=X*(z/Z)+0;Y=Y*(z/Z);if(z==1){X=Y=0}Z=z;tf()};
function openLB(src,t){$("#lbt").textContent=t||"";im().src=src;Z=1;X=Y=0;tf();lb.classList.add("on")}
const closeLB=()=>lb.classList.remove("on");
document.addEventListener("click",e=>{const z=e.target.closest("[data-z]");if(z){e.stopPropagation();e.preventDefault();openLB(z.dataset.z,z.dataset.t)}},true);
$("#lbc").onclick=closeLB;$("#lbi").onclick=()=>zset(Z*1.5);$("#lbo").onclick=()=>zset(Z/1.5);$("#lbr").onclick=()=>zset(1);
addEventListener("keydown",e=>{if(!lb.classList.contains("on"))return;if(e.key=="Escape")closeLB();if(e.key=="+")zset(Z*1.5);if(e.key=="-")zset(Z/1.5)});
(()=>{const v=$("#lv"),pts=new Map();let g=null,pd=0;
 v.addEventListener("wheel",e=>{e.preventDefault();zset(Z*(e.deltaY<0?1.2:1/1.2))},{passive:false});
 v.addEventListener("dblclick",()=>zset(Z>1?1:2.5));
 v.addEventListener("click",e=>{if(e.target==v)closeLB()});
 v.addEventListener("pointerdown",e=>{v.setPointerCapture(e.pointerId);pts.set(e.pointerId,[e.clientX,e.clientY]);g={x:e.clientX-X,y:e.clientY-Y};if(pts.size==2){const[a,b]=[...pts.values()];pd=Math.hypot(a[0]-b[0],a[1]-b[1])}});
 v.addEventListener("pointermove",e=>{if(!pts.has(e.pointerId))return;pts.set(e.pointerId,[e.clientX,e.clientY]);
  if(pts.size==2){const[a,b]=[...pts.values()],d=Math.hypot(a[0]-b[0],a[1]-b[1]);if(pd)zset(Z*d/pd);pd=d}else if(Z>1&&g){X=e.clientX-g.x;Y=e.clientY-g.y;tf()}});
 const end=e=>{pts.delete(e.pointerId);pd=0;g=null};v.addEventListener("pointerup",end);v.addEventListener("pointercancel",end)})();

/* ---- app: install, share, offline worker ---- */
if("serviceWorker" in navigator)addEventListener("load",()=>navigator.serviceWorker.register("/sw.js").catch(()=>{}));
(()=>{const standalone=matchMedia("(display-mode: standalone)").matches||navigator.standalone===true;
 const ios=/iphone|ipad|ipod/i.test(navigator.userAgent)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1);
 const anchor=$("#rl");if(!anchor)return;
 const sh=document.createElement("button");sh.className="btn g";sh.id="shr";sh.textContent="Share";
 sh.onclick=async()=>{const d={title:"HSE - CPF",text:"Safety Equipment Register – CPF",url:location.origin};try{if(navigator.share)await navigator.share(d);else{await navigator.clipboard.writeText(d.url);toast&&toast("Link copied")}}catch(e){}};
 anchor.after(sh);
 if(standalone)return;
 let dp=null;const ib=document.createElement("button");ib.className="btn";ib.id="inst";ib.textContent="⬇ Install app";ib.style.display="none";sh.after(ib);
 const box=document.createElement("div");box.id="ins";box.innerHTML=`<div class="bx"><h3>Install HSE - CPF on iPhone / iPad</h3><ol><li>Open this page in <b>Safari</b></li><li>Tap the <b>Share</b> button <b>⎙</b></li><li>Choose <b>Add to Home Screen</b></li><li>Tap <b>Add</b></li></ol><button class="btn s" id="insx">Got it</button></div>`;document.body.appendChild(box);
 $("#insx").onclick=()=>box.classList.remove("on");box.onclick=e=>{if(e.target==box)box.classList.remove("on")};
 addEventListener("beforeinstallprompt",e=>{e.preventDefault();dp=e;ib.style.display=""});
 addEventListener("appinstalled",()=>{ib.style.display="none";dp=null});
 if(ios){ib.style.display=""}
 ib.onclick=async()=>{if(dp){dp.prompt();await dp.userChoice;dp=null;ib.style.display="none"}else box.classList.add("on")};
})();

/* ---- v2: safety banner, backup / restore, change password ---- */
window.freshBanner=()=>{let b=$("#fresh");if(!b){b=document.createElement("div");b.id="fresh";$("#ban").before(b)}
 b.style.display=window.FRESH?"block":"none";
 b.textContent=can?"⚠ Empty data store: you are seeing the original sample data, not your saved data. Do not edit. On the computer run deploy again (it reconnects your data automatically), then reload.":"⚠ Sample data is shown. Ask the administrator to check the data store."};
(()=>{const dlg=$("#xd");if(!dlg)return;const fm=dlg.querySelector(".fm")||dlg;
 const xl=$("#xl");if(xl)xl.textContent="Tools ▾";const h=fm.querySelector("h3");if(h)h.textContent="Excel & Backup";
 const a=document.createElement("div");a.id="adm";
 a.innerHTML=`<h4>Backup & security (admin)</h4><button class="btn s" id="bkd">Download backup (.json)</button><label>Restore from a backup file<input type="file" id="bkf" accept=".json,application/json"></label><label>Restore from automatic daily backup<select id="bks"></select></label><button class="btn s" id="bkr">Restore selected daily backup</button><button class="btn s" id="pwc">Change admin password</button>`;
 fm.appendChild(a);const xc=$("#xc");if(xc)fm.appendChild(xc);
 const sync=async()=>{a.classList.toggle("on",!!can);if(!can)return;try{const r=await API("GET","/api/backups");$("#bks").innerHTML=r.names.map(n=>`<option>${esc(n)}</option>`).join("")||"<option value=''>(none yet)</option>"}catch(e){}};
 if(xl)xl.addEventListener("click",sync);
 $("#bkd").onclick=async()=>{try{const r=await API("GET","/api/backup"),l=document.createElement("a");l.href=URL.createObjectURL(new Blob([JSON.stringify(r,null,1)],{type:"application/json"}));l.download="HSE-CPF-backup-"+fd(today())+".json";document.body.appendChild(l);l.click();l.remove();toast("Backup downloaded")}catch(e){toast("Backup failed: "+(e.message||e))}};
 const restore=async(body,label)=>{if(!confirm("Replace ALL current data with "+label+"?\nA safety copy of the current data is kept automatically."))return;try{const r=await API("POST","/api/restore",body);VER=r.ver;await load();$("#xd").close();toast("Restored "+r.count+" items")}catch(e){toast("Restore failed: "+(e.message||e))}};
 $("#bkf").onchange=async e=>{const f=e.target.files[0];e.target.value="";if(!f)return;try{const j=JSON.parse(await f.text());await restore({items:j.items||j},"the file "+f.name)}catch(x){toast("Not a valid backup file")}};
 $("#bkr").onclick=()=>{const n=$("#bks").value;if(n)restore({name:n},"the backup of "+n)};
 $("#pwc").onclick=async()=>{const c=prompt("Current password:");if(!c)return;const n=prompt("New password (at least 8 characters):");if(!n)return;if(n!==prompt("Type the new password again:"))return toast("Passwords do not match");
  try{const r=await API("POST","/api/password",{current:c,next:n});PW=r.token;LS.set("sep_pw",PW);toast("Password changed")}catch(e){toast(e.message||"Failed")}};
})();
