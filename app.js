(() => {
  "use strict";
  const STORAGE_KEY = "tensionfacil.v1";
  const $ = id => document.getElementById(id);
  let state = loadState();
  let chart = null;

  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (parsed && Array.isArray(parsed.profiles) && parsed.profiles.length) return parsed;
    } catch (_) {}
    return {activeProfileId:"principal", profiles:[{id:"principal",name:"Principal",readings:[]}]};
  }
  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (_) { alert("No se pudieron guardar los datos. Exporta una copia y revisa el espacio disponible del navegador."); }
  }
  function profile() { return state.profiles.find(p => p.id === state.activeProfileId) || state.profiles[0]; }
  function dateInputValue(date = new Date()) {
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0,16);
  }
  function fmtDate(value) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? "Fecha inválida" : d.toLocaleString("es-CO",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"});
  }
  function safeText(value) { return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
  function category(s,d) {
    // Orientative labels only; blood pressure interpretation depends on clinical context and guidelines.
    if (s >= 180 || d >= 120) return {text:"Muy elevada",cls:"very-high"};
    if (s >= 140 || d >= 90) return {text:"Elevada",cls:"high"};
    if (s < 90 || d < 60) return {text:"Baja",cls:"low"};
    if (s >= 120 || d >= 80) return {text:"Por encima de lo ideal",cls:"high"};
    return {text:"Rango habitual",cls:"normal"};
  }
  function sortedReadings() { return [...profile().readings].sort((a,b) => new Date(b.date)-new Date(a.date)); }
  function avg(readings, key) {
    if (!readings.length) return null;
    return Math.round(readings.reduce((sum,r)=>sum+Number(r[key]),0)/readings.length);
  }
  function render() {
    const p = profile();
    $("activeProfileName").textContent = p.name;
    const readings = sortedReadings();
    $("totalCount").textContent = readings.length;
    if (readings.length) {
      const last = readings[0], status = category(Number(last.systolic), Number(last.diastolic));
      $("lastReading").textContent = `${last.systolic}/${last.diastolic}`;
      $("lastStatus").textContent = status.text;
      $("lastStatus").className = `status ${status.cls}`;
    } else {
      $("lastReading").textContent = "--/--";
      $("lastStatus").textContent = "Sin registros";
      $("lastStatus").className = "status neutral";
    }
    const since = Date.now() - 7*24*60*60*1000;
    const last7 = readings.filter(r => new Date(r.date).getTime() >= since);
    $("avg7").textContent = last7.length ? `${avg(last7,"systolic")}/${avg(last7,"diastolic")}` : "--/--";
    const body = $("historyBody");
    if (!readings.length) body.innerHTML = '<tr><td colspan="6" class="empty-cell">Todavía no hay mediciones.</td></tr>';
    else body.innerHTML = readings.map(r => `<tr><td>${safeText(fmtDate(r.date))}</td><td class="reading-value">${safeText(r.systolic)}/${safeText(r.diastolic)} <span class="muted">mmHg</span></td><td>${r.pulse ? safeText(r.pulse) : "—"}</td><td>${safeText(r.period || "—")}</td><td>${safeText(r.notes || "—")}</td><td><button class="delete-btn" data-delete="${safeText(r.id)}" type="button" aria-label="Eliminar medición">Eliminar</button></td></tr>`).join("");
    renderChart();
    renderProfileSelect();
  }
  function renderChart() {
    const canvas = $("pressureChart");
    if (!window.Chart) { $("chartFallback").classList.remove("hidden"); return; }
    $("chartFallback").classList.add("hidden");
    const days = Number($("chartRange").value || 30);
    const cutoff = Date.now() - days*86400000;
    const data = sortedReadings().filter(r => new Date(r.date).getTime() >= cutoff).reverse();
    if (chart) chart.destroy();
    chart = new Chart(canvas, {
      type:"line",
      data:{labels:data.map(r=>new Date(r.date).toLocaleDateString("es-CO",{day:"2-digit",month:"2-digit"})),
        datasets:[
          {label:"Sistólica",data:data.map(r=>Number(r.systolic)),borderColor:"#0d9488",backgroundColor:"#0d94881a",tension:.25,pointRadius:3},
          {label:"Diastólica",data:data.map(r=>Number(r.diastolic)),borderColor:"#6478c8",backgroundColor:"#6478c81a",tension:.25,pointRadius:3}
        ]},
      options:{responsive:true,maintainAspectRatio:false,interaction:{mode:"index",intersect:false},plugins:{legend:{position:"bottom"}},scales:{y:{beginAtZero:false,title:{display:true,text:"mmHg"}}}}
    });
  }
  function renderProfileSelect() {
    $("profileSelect").innerHTML = state.profiles.map(p=>`<option value="${safeText(p.id)}" ${p.id===state.activeProfileId?"selected":""}>${safeText(p.name)}</option>`).join("");
  }
  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }
  function exportCsv() {
    const rows = [["Fecha","Sistólica mmHg","Diastólica mmHg","Pulso lpm","Momento","Notas"]];
    sortedReadings().forEach(r=>rows.push([fmtDate(r.date),r.systolic,r.diastolic,r.pulse||"",r.period||"",r.notes||""]));
    const csv = "\uFEFF" + rows.map(row=>row.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(";")).join("\r\n");
    downloadBlob(new Blob([csv],{type:"text/csv;charset=utf-8"}),"tensionfacil-mediciones.csv");
  }
  function exportPdf() {
    if (!window.jspdf?.jsPDF) { alert("No se pudo cargar la biblioteca PDF. Comprueba tu conexión e inténtalo de nuevo."); return; }
    const {jsPDF} = window.jspdf, doc = new jsPDF();
    doc.setFontSize(18); doc.text("TensiónFácil — Informe de mediciones",14,18);
    doc.setFontSize(11); doc.text(`Perfil: ${profile().name}`,14,27);
    doc.text(`Generado: ${new Date().toLocaleString("es-CO")}`,14,34);
    const rows = sortedReadings().map(r=>[fmtDate(r.date),`${r.systolic}/${r.diastolic}`,r.pulse||"—",r.period||"—",r.notes||"—"]);
    if (typeof doc.autoTable === "function") {
      doc.autoTable({startY:42,head:[["Fecha","Presión (mmHg)","Pulso","Momento","Notas"]],body:rows,styles:{fontSize:8,cellPadding:2},headStyles:{fillColor:[13,148,136]}});
    } else { doc.text("No se pudo preparar la tabla del informe.",14,45); }
    const y = (doc.lastAutoTable?.finalY || 48) + 10;
    doc.setFontSize(9); doc.text("Este documento registra datos ingresados por el usuario; no es un diagnóstico médico.",14,Math.min(y,280),{maxWidth:180});
    doc.save("tensionfacil-informe.pdf");
  }
  $("readingDate").value = dateInputValue();
  $("readingForm").addEventListener("submit", e => {
    e.preventDefault();
    const systolic = Number($("systolic").value), diastolic = Number($("diastolic").value);
    const pulseText = $("pulse").value.trim(), pulse = pulseText ? Number(pulseText) : null;
    const date = new Date($("readingDate").value);
    const msg = $("formMessage"); msg.className = "form-message"; msg.textContent = "";
    if (!Number.isFinite(systolic) || systolic < 50 || systolic > 300 || !Number.isFinite(diastolic) || diastolic < 30 || diastolic > 200) {
      msg.textContent = "Revisa los valores de presión: deben estar dentro de los límites del formulario."; msg.classList.add("error"); return;
    }
    if (systolic <= diastolic) { msg.textContent = "La sistólica normalmente debe ser mayor que la diastólica. Verifica la lectura."; msg.classList.add("error"); return; }
    if (pulse !== null && (!Number.isFinite(pulse) || pulse < 25 || pulse > 250)) { msg.textContent = "Revisa el valor del pulso."; msg.classList.add("error"); return; }
    if (Number.isNaN(date.getTime())) { msg.textContent = "Introduce una fecha y hora válidas."; msg.classList.add("error"); return; }
    const reading = {id:crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),systolic,diastolic,pulse,date:date.toISOString(),period:$("period").value,notes:$("notes").value.trim()};
    profile().readings.push(reading); saveState(); render();
    e.target.reset(); $("readingDate").value = dateInputValue();
    msg.textContent = "Medición guardada correctamente.";
    const status = category(systolic,diastolic);
    if (status.cls === "very-high") alert("La lectura registrada es muy elevada. Si se confirma al repetirla tras unos minutos de reposo, busca orientación médica urgente. Si hay dolor de pecho, dificultad para respirar, debilidad, confusión o cambios de visión, solicita atención de emergencia.");
  });
  $("historyBody").addEventListener("click", e => {
    const btn = e.target.closest("[data-delete]"); if (!btn) return;
    if (!confirm("¿Eliminar esta medición? Esta acción no se puede deshacer.")) return;
    profile().readings = profile().readings.filter(r=>r.id!==btn.dataset.delete); saveState(); render();
  });
  $("chartRange").addEventListener("change",renderChart);
  $("exportCsvBtn").addEventListener("click",exportCsv);
  $("exportPdfBtn").addEventListener("click",exportPdf);
  $("profilesBtn").addEventListener("click",()=>{$("profilesDialog").showModal();renderProfileSelect();});
  $("settingsBtn").addEventListener("click",()=>$("settingsDialog").showModal());
  document.querySelectorAll("[data-close]").forEach(b=>b.addEventListener("click",()=>$(b.dataset.close).close()));
  $("profileSelect").addEventListener("change",()=>{state.activeProfileId=$("profileSelect").value;saveState();render();});
  $("newProfileForm").addEventListener("submit",e=>{
    e.preventDefault(); const name=$("newProfileName").value.trim();
    if (!name) return;
    if (state.profiles.some(p=>p.name.toLocaleLowerCase()===name.toLocaleLowerCase())) { alert("Ya existe un perfil con ese nombre."); return; }
    const p={id:crypto.randomUUID?crypto.randomUUID():String(Date.now()),name,readings:[]};
    state.profiles.push(p);state.activeProfileId=p.id;saveState();render();$("newProfileName").value="";
  });
  $("deleteProfileBtn").addEventListener("click",()=>{
    if (state.profiles.length===1) { alert("Debe existir al menos un perfil."); return; }
    if (!confirm(`¿Eliminar el perfil "${profile().name}" y todas sus mediciones? Exporta una copia si necesitas conservarlas.`)) return;
    state.profiles=state.profiles.filter(p=>p.id!==state.activeProfileId);state.activeProfileId=state.profiles[0].id;saveState();render();
  });
  $("backupBtn").addEventListener("click",()=>downloadBlob(new Blob([JSON.stringify(state,null,2)],{type:"application/json"}),`tensionfacil-copia-${new Date().toISOString().slice(0,10)}.json`));
  $("restoreFile").addEventListener("change",async e=>{
    const file=e.target.files?.[0]; if(!file)return;
    try {
      const incoming=JSON.parse(await file.text());
      if (!incoming || !Array.isArray(incoming.profiles) || !incoming.profiles.length || !incoming.profiles.every(p=>p && typeof p.name==="string" && Array.isArray(p.readings))) throw new Error("Formato incorrecto");
      if (!confirm("La restauración reemplazará todos los perfiles y registros actuales. ¿Continuar?")) return;
      state=incoming;
      if (!state.profiles.some(p=>p.id===state.activeProfileId)) state.activeProfileId=state.profiles[0].id;
      saveState();render();$("settingsDialog").close();alert("Copia restaurada.");
    } catch (_) { alert("No se pudo restaurar el archivo. Selecciona una copia JSON válida de TensiónFácil."); }
    finally { e.target.value=""; }
  });
  render();
})();