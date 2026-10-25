/* FILO — panel de la barbería. Gestiona las mismas reservas, horarios y cierres que usa la web. */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const WD = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const WD_S = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
  const MO = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const ORDER = [1, 2, 3, 4, 5, 6, 0]; // la semana empieza en lunes
  const parseD = (s) => new Date(s + 'T12:00:00Z');
  const addDays = (s, n) => { const d = parseD(s); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const fmtDay = (s) => { const d = parseD(s); return `${WD[d.getUTCDay()]} ${d.getUTCDate()} de ${MO[d.getUTCMonth()]}`; };
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const monthStart = (s) => s.slice(0, 8) + '01'; // taste-skill-ignore: día 1 del mes, no numeración
  const monthEnd = (s) => { const d = parseD(monthStart(s)); d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0); return d.toISOString().slice(0, 10); };
  const shiftMonth = (s, n) => { const d = parseD(monthStart(s)); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };
  const STATUS = { pendiente: 'Pendiente', confirmada: 'Confirmada', cancelada: 'Cancelada' };
  const badge = (s) => `<span class="badge st-${s}">${STATUS[s] || s}</span>`;

  const st = {
    set: null, now: null, view: null, timer: 0,
    ag: { mode: 'list', range: 'today', from: null, to: null, pro: '', status: 'active', q: '', month: null, day: null, bookings: [], closures: [] },
    cl: { month: null, from: null, to: null, closures: [], bookings: [] },
    home: { bookings: [], closures: [] },
    dirty: { horarios: false, negocio: false }
  };

  async function api(path, opts = {}) {
    let r;
    try {
      r = await fetch(path, { credentials: 'same-origin', ...opts, headers: { 'Content-Type': 'application/json', 'X-Filo': '1', ...(opts.headers || {}) } });
    } catch (e) { throw Object.assign(new Error('No hay conexión con el servidor. Comprueba la red e inténtalo de nuevo.'), { status: 0 }); }
    let data = {};
    try { data = await r.json(); } catch (e) { /* sin cuerpo */ }
    if (r.status === 401 && !path.endsWith('/login')) { showLogin(); throw Object.assign(new Error('La sesión ha caducado.'), { status: 401 }); }
    if (!r.ok) throw Object.assign(new Error(data.error || 'El servidor no ha respondido correctamente.'), { status: r.status, data });
    return data;
  }

  let toastT = 0;
  function toast(msg, isError) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.toggle('is-error', !!isError);
    t.classList.add('is-on');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('is-on'), isError ? 6000 : 3200);
  }

  /* ---------------- Equipo ---------------- */
  const pros = () => st.set.professionals;
  const activePros = () => pros().filter((p) => p.active);
  const pro = (id) => pros().find((p) => p.id === id) || { id, name: id, first: id, photo: '' };
  const single = () => activePros().length <= 1 && pros().length <= 1;

  /* ---------------- Acceso ---------------- */
  function showLogin() {
    clearInterval(st.timer);
    $('#shell').hidden = true; $('#login').hidden = false;
    setTimeout(() => $('#pw').focus(), 30);
  }
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#loginBtn'); btn.disabled = true; $('#loginErr').textContent = '';
    try {
      await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: $('#pw').value }) });
      $('#pw').value = '';
      await start();
    } catch (err) {
      $('#loginErr').textContent = err.message;
      $('#pw').select();
    } finally { btn.disabled = false; }
  });
  $('#logout').addEventListener('click', async () => {
    try { await api('/api/admin/logout', { method: 'POST' }); } catch (e) { /* ya sin sesión */ }
    showLogin();
  });

  async function start() {
    const s = await api('/api/admin/settings');
    st.set = s; st.now = s.now;
    st.ag.month = monthStart(st.now.date); st.ag.day = st.now.date;
    st.cl.month = monthStart(st.now.date);
    fillProSelects();
    $('#login').hidden = true; $('#shell').hidden = false;
    route();
    clearInterval(st.timer);
    st.timer = setInterval(() => {
      if (document.hidden || $$('dialog[open]').length) return;
      if (st.view === 'inicio') loadHome(true);
      if (st.view === 'agenda') loadAgenda(true);
    }, 30000);
  }

  function fillProSelects() {
    const opts = pros().map((p) => `<option value="${esc(p.id)}">${esc(p.name)}${p.active ? '' : ' (inactivo)'}</option>`).join('');
    $('#agPro').innerHTML = '<option value="">Todo el equipo</option>' + opts;
    $('#agPro').value = st.ag.pro;
    $('#clPro').innerHTML = '<option value="">Toda la barbería</option>' + activePros().map((p) => `<option value="${esc(p.id)}">Solo ${esc(p.name)}</option>`).join('');
    const one = single();
    $('#agPro').hidden = one; $('#clProWrap').hidden = one; $('#mProWrap').hidden = one; $('#hrProsCard').hidden = one;
  }

  /* ---------------- Navegación ---------------- */
  const VIEWS = ['inicio', 'agenda', 'cierres', 'horarios', 'negocio'];
  function route() {
    const v = location.hash.slice(1);
    showView(VIEWS.includes(v) ? v : 'inicio');
  }
  addEventListener('hashchange', () => { if (!$('#shell').hidden) route(); });
  addEventListener('beforeunload', (e) => { if (st.dirty.horarios || st.dirty.negocio) { e.preventDefault(); e.returnValue = ''; } });

  function showView(v) {
    st.view = v;
    VIEWS.forEach((x) => { $('#v-' + x).hidden = x !== v; });
    $$('#nav a').forEach((a) => { if (a.dataset.view === v) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    document.title = `${cap(v)} — FILO`;
    scrollTo(0, 0);
    if (v === 'inicio') loadHome();
    if (v === 'agenda') { syncAgendaControls(); loadAgenda(); }
    if (v === 'cierres') loadClosures();
    if (v === 'horarios') renderHours();
    if (v === 'negocio') renderBusiness();
  }
  // Accesos que llegan a la agenda con un filtro ya puesto
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-goto]');
    if (!a) return;
    const g = a.dataset.goto;
    if (g === 'calendar') { st.ag.mode = 'calendar'; st.ag.day = st.now.date; st.ag.month = monthStart(st.now.date); }
    else { st.ag.mode = 'list'; st.ag.range = g; }
    if (st.view === 'agenda') { e.preventDefault(); syncAgendaControls(); loadAgenda(); }
  });
  $$('[data-refresh]').forEach((b) => b.addEventListener('click', () => loadHome()));

  /* ---------------- Inicio ---------------- */
  async function loadHome(quiet) {
    const today = st.now.date;
    try {
      const d = await api(`/api/admin/bookings?from=${today}&to=${addDays(today, 30)}`);
      st.now = d.now; st.home = d;
      renderHome();
    } catch (err) { if (!quiet && err.status !== 401) $('#homeStats').innerHTML = `<div class="card empty"><strong>No se han podido cargar las citas.</strong>${esc(err.message)}</div>`; }
  }

  const upcomingActive = (list) => list.filter((b) => b.status !== 'cancelada' && (b.date > st.now.date || (b.date === st.now.date && b.end > st.now.time)));

  function renderHome() {
    const today = st.now.date, all = st.home.bookings;
    $('#homeDate').textContent = cap(fmtDay(today)) + ' · ' + st.now.time;
    const todays = all.filter((b) => b.date === today);
    const count = (s) => all.filter((b) => b.status === s).length;
    const pend = count('pendiente');
    $('#homeStats').innerHTML = `
      <a class="stat" href="#agenda" data-goto="today"><b>${todays.filter((b) => b.status !== 'cancelada').length}</b><span>citas hoy</span></a>
      <a class="stat ${pend ? 'is-wait' : ''}" href="#agenda" data-goto="upcoming"><b>${pend}</b><span>pendientes de confirmar</span></a>
      <div class="stat"><b>${count('confirmada')}</b><span>confirmadas</span></div>
      <div class="stat"><b>${count('cancelada')}</b><span>canceladas</span></div>`;
    const next = upcomingActive(all)[0];
    $('#homeNext').innerHTML = next ? `
      <div class="next">
        <p class="next-when">${next.date === today ? 'Hoy' : cap(fmtDay(next.date))}, ${esc(next.time)}–${esc(next.end)}</p>
        <div class="next-who"><strong>${esc(next.name)}</strong><span>${esc(next.phone)}</span>${single() ? '' : `<span>con ${esc(pro(next.professional).name)}</span>`}${badge(next.status)}</div>
        <div class="next-actions">
          <button type="button" class="btn btn-ghost" data-open="${esc(next.code)}">Ver detalle</button>
          ${next.status === 'pendiente' ? `<button type="button" class="btn btn-primary" data-confirm="${esc(next.code)}">Confirmar</button>` : ''}
        </div>
      </div>` : '<div class="empty"><strong>No hay citas próximas.</strong>Las reservas nuevas de la web aparecerán aquí.</div>';
    const activeToday = todays.filter((b) => b.status !== 'cancelada');
    $('#homeToday').innerHTML = activeToday.length ? `<ul class="mini">${activeToday.map(miniRow).join('')}</ul>`
      : `<div class="empty"><strong>Hoy no hay citas.</strong>${studioClosedOn(today, st.home.closures) ? 'La barbería está marcada como cerrada.' : ''}</div>`;
    const later = upcomingActive(all).filter((b) => b.date > today).slice(0, 8);
    let lastDay = '';
    $('#homeUpcoming').innerHTML = later.length ? `<ul class="mini">${later.map((b) => {
      const head = b.date !== lastDay ? `<li class="mini-day">${esc(cap(fmtDay(b.date)))}</li>` : '';
      lastDay = b.date;
      return head + miniRow(b);
    }).join('')}</ul>` : '<div class="empty"><strong>Sin citas en los próximos 30 días.</strong></div>';
    const cl = groupClosures(st.home.closures.filter((c) => c.date <= addDays(today, 14)));
    $('#homeClosures').innerHTML = cl.length ? `<p class="home-closed"><strong>Cierres próximos:</strong> ${cl.slice(0, 3).map((g) => esc(closureWhen(g) + (g.professional ? ` (${pro(g.professional).first})` : ''))).join(' · ')}</p>` : '';
  }
  function miniRow(b) {
    return `<li><button type="button" class="mini-row" data-open="${esc(b.code)}"><time>${esc(b.time)}–${esc(b.end)}</time><span class="who">${esc(b.name)}${single() ? '' : `<small>${esc(pro(b.professional).first)}</small>`}</span>${badge(b.status)}</button></li>`;
  }
  const studioClosedOn = (d, closures) => closures.some((c) => c.date === d && !c.professional && !c.start);

  /* ---------------- Agenda ---------------- */
  function agendaRange() {
    const a = st.ag, today = st.now.date;
    if (a.mode === 'calendar') return [monthStart(a.month), monthEnd(a.month)];
    if (a.range === 'today') return [today, today];
    if (a.range === 'upcoming') return [today, addDays(today, 90)];
    if (a.range === 'date') return [a.from || today, a.from || today];
    const f = a.from || today, t = a.to && a.to >= f ? a.to : addDays(f, 6);
    return [f, t];
  }
  function syncAgendaControls() {
    const a = st.ag;
    $$('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === a.mode)));
    $$('#agRange [data-range]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.range === a.range)));
    $('#agRange').hidden = a.mode === 'calendar';
    $('#agDates').hidden = a.mode === 'calendar' || !(a.range === 'date' || a.range === 'range');
    $('#agTo-wrap').hidden = a.range !== 'range';
    $('#agCalWrap').hidden = a.mode !== 'calendar';
    if (!a.from) a.from = st.now.date;
    $('#agFrom').value = a.from; $('#agTo').value = a.to || addDays(a.from, 6);
    $('#agStatus').value = a.status;
  }
  $$('[data-mode]').forEach((b) => b.addEventListener('click', () => { st.ag.mode = b.dataset.mode; syncAgendaControls(); loadAgenda(); }));
  $$('#agRange [data-range]').forEach((b) => b.addEventListener('click', () => { st.ag.range = b.dataset.range; syncAgendaControls(); loadAgenda(); }));
  $('#agFrom').addEventListener('change', (e) => { st.ag.from = e.target.value || st.now.date; loadAgenda(); });
  $('#agTo').addEventListener('change', (e) => { st.ag.to = e.target.value; loadAgenda(); });
  $('#agPro').addEventListener('change', (e) => { st.ag.pro = e.target.value; renderAgenda(); });
  $('#agStatus').addEventListener('change', (e) => { st.ag.status = e.target.value; renderAgenda(); });
  $('#agQ').addEventListener('input', (e) => { st.ag.q = e.target.value; renderAgenda(); });
  $('#agPrev').addEventListener('click', () => { st.ag.month = shiftMonth(st.ag.month, -1); loadAgenda(); });
  $('#agNext').addEventListener('click', () => { st.ag.month = shiftMonth(st.ag.month, 1); loadAgenda(); });

  let agSeq = 0;
  async function loadAgenda(quiet) {
    const [from, to] = agendaRange();
    const seq = ++agSeq; // si cambia el filtro antes de responder, la respuesta vieja se descarta
    const list = $('#agList');
    if (!quiet) { list.setAttribute('aria-busy', 'true'); list.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>'; }
    try {
      const d = await api(`/api/admin/bookings?from=${from}&to=${to}`);
      if (seq !== agSeq) return;
      st.now = d.now; st.ag.bookings = d.bookings; st.ag.closures = d.closures;
      renderAgenda();
    } catch (err) {
      if (seq !== agSeq || err.status === 401) return;
      list.innerHTML = `<div class="card empty"><strong>No se han podido cargar las citas.</strong>${esc(err.message)}<button type="button" class="btn btn-ghost" id="agRetry">Reintentar</button></div>`;
      $('#agRetry').addEventListener('click', () => loadAgenda());
    } finally { if (seq === agSeq) list.setAttribute('aria-busy', 'false'); }
  }

  function agendaFilter(list) {
    const a = st.ag, q = a.q.trim().toLowerCase(), qd = q.replace(/\D/g, '');
    return list.filter((b) => {
      if (a.pro && b.professional !== a.pro) return false;
      if (a.status === 'active' && b.status === 'cancelada') return false;
      if (!['active', 'all'].includes(a.status) && b.status !== a.status) return false;
      if (q && !(b.name.toLowerCase().includes(q) || (qd.length >= 3 && b.phone.replace(/\D/g, '').includes(qd)) || b.code.toLowerCase() === q)) return false;
      return true;
    });
  }

  function renderAgenda() {
    const a = st.ag, list = $('#agList');
    const rows = agendaFilter(a.bookings);
    if (a.mode === 'calendar') {
      renderCalendar($('#agCal'), a.month, {
        info: (d) => {
          const n = agendaFilter(a.bookings.filter((b) => b.date === d)).filter((b) => b.status !== 'cancelada').length;
          return { count: n, closed: studioClosedOn(d, a.closures), part: a.closures.some((c) => c.date === d) && !studioClosedOn(d, a.closures) };
        },
        label: (i) => (i.closed ? 'cerrado' : i.count ? `${i.count} cita${i.count > 1 ? 's' : ''}` : ''),
        on: (d) => d === a.day,
        pick: (d) => { a.day = d; renderAgenda(); }
      });
      $('#agMonth').textContent = `${MO[parseD(a.month).getUTCMonth()]} ${parseD(a.month).getUTCFullYear()}`;
    }
    const shown = a.mode === 'calendar' ? rows.filter((b) => b.date === a.day) : rows;
    const [from, to] = agendaRange();
    const span = a.mode === 'calendar' ? cap(fmtDay(a.day)) : from === to ? cap(fmtDay(from)) : `Del ${fmtDay(from)} al ${fmtDay(to)}`;
    $('#agFinding').textContent = `${span} · ${shown.length} ${shown.length === 1 ? 'cita' : 'citas'}${a.q ? ` que coinciden con «${a.q}»` : ''}`;
    if (!shown.length) {
      const closed = a.mode === 'calendar' ? studioClosedOn(a.day, a.closures) : false;
      list.innerHTML = `<div class="card empty"><strong>${a.q ? 'Ninguna cita coincide con la búsqueda.' : closed ? 'Ese día la barbería está cerrada.' : 'No hay citas en este periodo.'}</strong>${a.q || a.pro || a.status !== 'active' ? 'Prueba a quitar filtros.' : 'Las reservas hechas desde la web aparecerán aquí al momento.'}</div>`;
      return;
    }
    const byDay = {};
    shown.forEach((b) => (byDay[b.date] ||= []).push(b));
    list.innerHTML = Object.keys(byDay).sort().map((d) => {
      const cl = a.closures.filter((c) => c.date === d);
      const note = cl.length ? `<span class="closed-note">${cl.map((c) => (c.start ? `Cierre ${c.start}–${c.end}` : 'Cerrado') + (c.professional ? ` (${esc(pro(c.professional).first)})` : '')).join(' · ')}</span>` : '';
      return `<section class="day-group"><h3>${esc(cap(fmtDay(d)))}${d === st.now.date ? ' · hoy' : ''} ${note}</h3><div class="rows">${byDay[d].map(rowHtml).join('')}</div></section>`;
    }).join('');
  }
  function rowHtml(b) {
    const p = pro(b.professional);
    return `<button type="button" class="row ${b.status === 'cancelada' ? 'is-cancelled' : ''}" data-open="${esc(b.code)}">
      <time>${esc(b.time)}–${esc(b.end)}</time>
      <span class="name">${esc(b.name)}</span>
      <span class="phone" data-pro="${single() ? '' : '· ' + esc(p.first)}">${esc(b.phone)}</span>
      <span class="pro">${single() ? '' : esc(p.name)}</span>
      ${badge(b.status)}
      <span class="code">${esc(b.code)}</span>
    </button>`;
  }

  /* ---------------- Calendario (agenda y cierres) ---------------- */
  function renderCalendar(el, month, { info, label, on, pick, sel, range, minDate }) {
    const first = parseD(monthStart(month)), last = monthEnd(month);
    const lead = (first.getUTCDay() + 6) % 7;
    let d = addDays(monthStart(month), -lead);
    let html = WD_S.map((w) => `<span class="wd" aria-hidden="true">${w}</span>`).join('');
    for (let i = 0; i < 42; i++) {
      if (i >= 35 && d > last) break;
      const out = d.slice(0, 7) !== month.slice(0, 7), past = d < st.now.date, inf = info(d);
      // Días que la barbería no abre según su horario semanal
      const rest = !inf.closed && !(st.set.schedule.week[parseD(d).getUTCDay()] || {}).open;
      const cls = [out && 'out', past && 'past', d === st.now.date && 'today', inf.count && 'has', inf.closed && 'closed', inf.part && 'part', rest && 'rest',
        on && on(d) && 'is-on', sel && sel(d) && 'sel', range && range(d) && 'in-range'].filter(Boolean).join(' ');
      const lab = rest && !inf.count ? 'no abre' : label(inf);
      const dis = minDate && d < minDate;
      html += `<button type="button" class="${cls}" data-d="${d}" ${dis ? 'disabled' : ''} aria-label="${esc(cap(fmtDay(d)))}${lab ? ', ' + esc(lab) : ''}"><span class="n">${parseD(d).getUTCDate()}</span><span class="c">${esc(lab)}</span></button>`;
      d = addDays(d, 1);
    }
    el.innerHTML = html;
    el.onclick = (e) => { const b = e.target.closest('button[data-d]'); if (b && !b.disabled) pick(b.dataset.d); };
  }

  /* ---------------- Detalle, confirmar, cancelar, reprogramar ---------------- */
  const findBooking = (code) => [...st.ag.bookings, ...st.home.bookings, ...st.cl.bookings].find((b) => b.code === code);
  document.addEventListener('click', (e) => {
    const o = e.target.closest('[data-open]');
    if (o) { openBooking(o.dataset.open); return; }
    const c = e.target.closest('[data-confirm]');
    if (c) { const b = findBooking(c.dataset.confirm); if (b) askConfirm(b); return; }
    if (e.target.closest('[data-close]')) e.target.closest('dialog').close();
  });

  let current = null;
  function openBooking(code) {
    const b = findBooking(code);
    if (!b) return;
    current = b;
    const p = pro(b.professional);
    $('#dbTitle').textContent = b.name;
    $('#dbErr').textContent = '';
    const hist = (b.history || []).map((h) => `<li>${esc(h.at.replace('T', ' ').slice(0, 16))} · ${esc(h.what)}${h.by ? ' (' + esc(h.by) + ')' : ''}</li>`).join('');
    $('#dbBody').innerHTML = `
      <dl class="detail">
        <div><dt>Día</dt><dd>${esc(cap(fmtDay(b.date)))}</dd></div>
        <div><dt>Hora</dt><dd>${esc(b.time)}–${esc(b.end)}</dd></div>
        <div><dt>Teléfono</dt><dd><a href="tel:${esc(b.phone.replace(/[^\d+]/g, ''))}">${esc(b.phone)}</a></dd></div>
        <div><dt>Barbero</dt><dd>${esc(p.name)}${b.autoAssigned ? ' <span class="opt">(asignado)</span>' : ''}</dd></div>
        <div><dt>Estado</dt><dd>${badge(b.status)}</dd></div>
        <div><dt>Código</dt><dd>${esc(b.code)}</dd></div>
      </dl>
      ${hist ? `<ul class="history" aria-label="Historial">${hist}</ul>` : ''}`;
    const acts = [];
    if (b.status !== 'cancelada') acts.push('<button type="button" class="btn btn-ghost spacer" id="dbCancel">Cancelar cita</button>', '<button type="button" class="btn btn-ghost" id="dbMove">Reprogramar</button>');
    if (b.status === 'pendiente') acts.push('<button type="button" class="btn btn-primary" id="dbConfirm">Confirmar</button>');
    if (!acts.length) acts.push('<button type="button" class="btn btn-ghost" data-close>Cerrar</button>');
    $('#dbActions').innerHTML = acts.join('');
    $('#dbConfirm')?.addEventListener('click', () => askConfirm(b));
    $('#dbCancel')?.addEventListener('click', () => askCancel(b));
    $('#dbMove')?.addEventListener('click', () => openMove(b));
    const dlg = $('#dlgBook');
    if (!dlg.open) dlg.showModal();
  }

  // Diálogo de confirmación: ejecuta la acción y muestra el error sin cerrarse si falla
  function ask({ title, text, ok, danger, run }) {
    const dlg = $('#dlgAsk'), btn = $('#daOk');
    $('#daTitle').textContent = title; $('#daText').textContent = text; $('#daErr').textContent = '';
    btn.textContent = ok; btn.className = 'btn ' + (danger ? 'btn-danger' : 'btn-primary'); btn.disabled = false;
    btn.onclick = async () => {
      btn.disabled = true; $('#daErr').textContent = '';
      try { await run(); dlg.close(); }
      catch (err) { $('#daErr').textContent = err.message; }
      finally { btn.disabled = false; }
    };
    dlg.showModal();
  }
  const whenTxt = (b) => `${fmtDay(b.date)} a las ${b.time}`;

  async function patch(b, body, msg) {
    const r = await api(`/api/admin/bookings/${b.code}`, { method: 'PATCH', body: JSON.stringify(body) });
    toast(msg);
    $('#dlgBook').open && $('#dlgBook').close();
    refreshAfterChange();
    return r;
  }
  function refreshAfterChange() {
    if (st.view === 'inicio') loadHome(true);
    if (st.view === 'agenda') loadAgenda(true);
    if (st.view === 'cierres') loadClosures();
  }
  function askConfirm(b) {
    ask({ title: 'Confirmar cita', text: `Se confirmará la cita de ${b.name} el ${whenTxt(b)}.`, ok: 'Confirmar cita',
      run: () => patch(b, { action: 'confirm' }, 'Cita confirmada.') });
  }
  function askCancel(b) {
    ask({ title: 'Cancelar cita', text: `Se cancelará la cita de ${b.name} el ${whenTxt(b)} y la hora volverá a quedar libre en la web. Avisa al cliente si es necesario.`,
      ok: 'Cancelar cita', danger: true, run: () => patch(b, { action: 'cancel' }, 'Cita cancelada. La hora vuelve a estar libre.') });
  }

  let moving = null;
  function openMove(b) {
    moving = b;
    $('#dmText').textContent = `${b.name}: ahora el ${whenTxt(b)}${single() ? '' : ' con ' + pro(b.professional).name}.`;
    $('#mDate').value = b.date; $('#mDate').min = st.now.date;
    $('#mPro').innerHTML = activePros().map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
    $('#mPro').value = activePros().some((p) => p.id === b.professional) ? b.professional : activePros()[0].id;
    $('#dmErr').textContent = '';
    $('#dlgMove').showModal();
    loadSlots();
  }
  let slotSeq = 0;
  async function loadSlots() {
    const d = $('#mDate').value, p = $('#mPro').value, box = $('#mSlots'), seq = ++slotSeq;
    if (!d) { box.innerHTML = '<p class="none">Elige un día.</p>'; return; }
    box.innerHTML = '<p class="none">Buscando horas libres…</p>';
    try {
      const a = await api(`/api/admin/availability?from=${d}&to=${d}&exclude=${moving.code}`);
      if (seq !== slotSeq) return;
      const day = a.days[d];
      const times = day && !day.closed ? (day.pros[p] || []) : [];
      box.innerHTML = times.length ? times.map((t) => `<label><input type="radio" name="mTime" value="${t}" ${d === moving.date && p === moving.professional && t === moving.time ? 'checked' : ''}><span>${t}</span></label>`).join('')
        : `<p class="none">${day && day.closed ? 'Ese día la barbería está cerrada.' : day && day.off.includes(p) ? `${esc(pro(p).first)} no trabaja ese día.` : 'No hay horas libres ese día.'}</p>`;
    } catch (err) { if (seq === slotSeq) box.innerHTML = `<p class="none">${esc(err.message)}</p>`; }
  }
  $('#mDate').addEventListener('change', loadSlots);
  $('#mPro').addEventListener('change', loadSlots);
  $('#moveForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const t = $('input[name="mTime"]:checked'), d = $('#mDate').value, p = $('#mPro').value;
    if (!t) { $('#dmErr').textContent = 'Elige una hora libre.'; return; }
    if (d === moving.date && t.value === moving.time && p === moving.professional) { $('#dmErr').textContent = 'Elige un día, una hora o un barbero distintos.'; return; }
    const b = moving;
    ask({ title: 'Reprogramar cita', ok: 'Guardar el cambio',
      text: `La cita de ${b.name} pasa del ${whenTxt(b)} al ${fmtDay(d)} a las ${t.value}${single() ? '' : ' con ' + pro(p).name}. Es la misma reserva (mismo código); no se crea otra.`,
      run: async () => {
        try {
          await patch(b, { action: 'reschedule', date: d, time: t.value, professional: p }, 'Cita reprogramada.');
          $('#dlgMove').close();
        } catch (err) { loadSlots(); throw err; }
      } });
  });

  /* ---------------- Cierres ---------------- */
  async function loadClosures() {
    const m = st.cl.month;
    try {
      const [c, b] = await Promise.all([api('/api/admin/closures'), api(`/api/admin/bookings?from=${monthStart(m)}&to=${monthEnd(m)}`)]);
      st.now = c.now; st.cl.closures = c.closures; st.cl.bookings = b.bookings; st.cl.monthClosures = b.closures;
      renderClosures();
    } catch (err) { if (err.status !== 401) $('#clList').innerHTML = `<li class="empty"><strong>No se han podido cargar los cierres.</strong>${esc(err.message)}</li>`; }
  }
  $('#clPrev').addEventListener('click', () => { st.cl.month = shiftMonth(st.cl.month, -1); loadClosures(); });
  $('#clNext').addEventListener('click', () => { st.cl.month = shiftMonth(st.cl.month, 1); loadClosures(); });

  function renderClosures() {
    const c = st.cl, mc = c.monthClosures || [];
    renderCalendar($('#clCal'), c.month, {
      info: (d) => ({ count: c.bookings.filter((b) => b.date === d && b.status !== 'cancelada').length, closed: studioClosedOn(d, mc), part: mc.some((x) => x.date === d) && !studioClosedOn(d, mc) }),
      label: (i) => (i.closed ? 'cerrado' : i.part ? 'parcial' : i.count ? `${i.count} cita${i.count > 1 ? 's' : ''}` : ''),
      sel: (d) => d === c.from || d === c.to,
      range: (d) => c.from && c.to && d > c.from && d < c.to,
      minDate: st.now.date,
      pick: pickDay
    });
    $('#clMonth').textContent = `${MO[parseD(c.month).getUTCMonth()]} ${parseD(c.month).getUTCFullYear()}`;
    syncClosureForm();
    const groups = groupClosures(c.closures);
    $('#clList').innerHTML = groups.length ? groups.map((g, i) => `
      <li>
        <span class="when">${esc(closureWhen(g))}</span>
        <span class="what">${g.start ? `De ${esc(g.start)} a ${esc(g.end)}` : 'Todo el día'} · ${g.professional ? esc(pro(g.professional).name) : 'Toda la barbería'}</span>
        <span class="why">${esc(g.reason || 'Sin motivo')}</span>
        <span class="acts"><button type="button" class="btn btn-ghost" data-edit="${i}">Editar</button><button type="button" class="btn btn-ghost" data-del="${i}">Eliminar</button></span>
      </li>`).join('') : '<li class="empty"><strong>No hay cierres próximos.</strong>Marca vacaciones, festivos o una tarde libre desde el calendario.</li>';
    $$('#clList [data-edit]').forEach((b) => b.addEventListener('click', () => openClosureEdit(groups[+b.dataset.edit])));
    $$('#clList [data-del]').forEach((b) => b.addEventListener('click', () => askDeleteClosure(groups[+b.dataset.del])));
  }

  // Une días seguidos con el mismo alcance, franja y motivo: «del 3 al 9 de noviembre»
  function groupClosures(list) {
    const sorted = [...list].sort((a, b) => (a.professional || '').localeCompare(b.professional || '') || (a.start || '').localeCompare(b.start || '') || a.date.localeCompare(b.date));
    const out = [];
    sorted.forEach((c) => {
      const g = out[out.length - 1];
      if (g && g.professional === c.professional && g.start === c.start && g.end === c.end && g.reason === c.reason && addDays(g.to, 1) === c.date) { g.to = c.date; g.ids.push(c.id); }
      else out.push({ ...c, from: c.date, to: c.date, ids: [c.id] });
    });
    return out.sort((a, b) => a.from.localeCompare(b.from));
  }
  const closureWhen = (g) => (g.from === g.to ? cap(fmtDay(g.from)) : `Del ${fmtDay(g.from)} al ${fmtDay(g.to)}`);

  function pickDay(d) {
    const c = st.cl;
    if (!c.from || c.to || d < c.from) { c.from = d; c.to = null; }
    else if (d === c.from) { c.from = null; }
    else c.to = d;
    $('#clFrom').value = c.from || ''; $('#clTo').value = c.to || '';
    hideConflict('#clConflict');
    renderClosures();
  }
  function syncClosureForm() {
    const c = st.cl, n = c.from ? (c.to ? Math.round((parseD(c.to) - parseD(c.from)) / 864e5) + 1 : 1) : 0;
    $('#clSel').textContent = !c.from ? 'Elige uno o varios días en el calendario.' : n === 1 ? cap(fmtDay(c.from)) : `Del ${fmtDay(c.from)} al ${fmtDay(c.to)} (${n} días)`;
    $('#clFrom').min = st.now.date; $('#clTo').min = c.from || st.now.date;
  }
  $('#clFrom').addEventListener('change', (e) => { st.cl.from = e.target.value || null; if (st.cl.from) st.cl.month = monthStart(st.cl.from); loadClosures(); });
  $('#clTo').addEventListener('change', (e) => { st.cl.to = e.target.value || null; renderClosures(); });
  $$('input[name="clKind"]').forEach((r) => r.addEventListener('change', () => { $('#clSpan').hidden = $('input[name="clKind"]:checked').value !== 'span'; }));

  function hideConflict(sel) { $(sel).hidden = true; $(sel).innerHTML = ''; }
  // Lista de citas afectadas con «Volver» y «Guardar igualmente»; nunca se cancelan solas
  function showConflict(sel, title, list, note, onForce, forceLabel) {
    const box = $(sel);
    box.innerHTML = `<strong>${esc(title)}</strong>
      <ul>${list.slice(0, 12).map((b) => `<li>${esc(cap(fmtDay(b.date)))}, ${esc(b.time)} · ${esc(b.name)} · ${esc(b.phone)}${single() ? '' : ' · ' + esc(pro(b.professional).first)}</li>`).join('')}${list.length > 12 ? `<li>y ${list.length - 12} más</li>` : ''}</ul>
      <p>${esc(note)}</p>
      <div class="acts"><button type="button" class="btn btn-ghost" data-back>Volver</button><button type="button" class="btn btn-danger" data-force>${esc(forceLabel)}</button></div>`;
    box.hidden = false;
    $('[data-back]', box).addEventListener('click', () => hideConflict(sel));
    $('[data-force]', box).addEventListener('click', onForce);
    $('[data-force]', box).focus();
  }

  async function saveClosure(force) {
    const from = $('#clFrom').value, to = $('#clTo').value || from, span = $('input[name="clKind"]:checked').value === 'span';
    $('#clErr').textContent = '';
    if (!from) { $('#clErr').textContent = 'Elige al menos un día.'; return; }
    if (span && (!$('#clStart').value || !$('#clEnd').value || $('#clEnd').value <= $('#clStart').value)) { $('#clErr').textContent = 'La hora final de la franja debe ser posterior a la inicial.'; return; }
    const body = { from, to, professional: $('#clPro').value || null, reason: $('#clReason').value, start: span ? $('#clStart').value : null, end: span ? $('#clEnd').value : null, force };
    const btn = $('#clSubmit'); btn.disabled = true;
    try {
      const r = await api('/api/admin/closures', { method: 'POST', body: JSON.stringify(body) });
      hideConflict('#clConflict');
      toast(`Cierre guardado${r.created > 1 ? ` (${r.created} días)` : ''}. Ya no se puede reservar en ese periodo.${r.affected ? ` ${r.affected === 1 ? 'Queda 1 cita' : `Quedan ${r.affected} citas`} por revisar en la agenda.` : ''}`);
      Object.assign(st.cl, { from: null, to: null });
      $('#clFrom').value = ''; $('#clTo').value = ''; $('#clReason').value = '';
      loadClosures();
    } catch (err) {
      if (err.status === 409 && err.data && err.data.conflicts) {
        showConflict('#clConflict', `Hay ${err.data.conflicts.length} ${err.data.conflicts.length === 1 ? 'cita activa' : 'citas activas'} en ese periodo`, err.data.conflicts,
          'Si guardas el cierre, estas citas NO se cancelan: avisa a los clientes y cancélalas o reprográmalas desde la agenda.', () => saveClosure(true), 'Guardar igualmente');
      } else $('#clErr').textContent = err.message;
    } finally { btn.disabled = false; }
  }
  $('#clForm').addEventListener('submit', (e) => { e.preventDefault(); saveClosure(false); });

  let editing = null;
  function openClosureEdit(g) {
    editing = g;
    $('#dxText').textContent = `${closureWhen(g)} · ${g.professional ? pro(g.professional).name : 'Toda la barbería'}`;
    $$('input[name="cxKind"]').forEach((r) => { r.checked = r.value === (g.start ? 'span' : 'day'); });
    $('#cxSpan').hidden = !g.start;
    $('#cxStart').value = g.start || '10:00'; $('#cxEnd').value = g.end || '14:00';
    $('#cxReason').value = g.reason || '';
    $('#cxErr').textContent = ''; hideConflict('#cxConflict');
    $('#dlgClosure').showModal();
  }
  $$('input[name="cxKind"]').forEach((r) => r.addEventListener('change', () => { $('#cxSpan').hidden = $('input[name="cxKind"]:checked').value !== 'span'; }));
  async function saveClosureEdit(force) {
    const span = $('input[name="cxKind"]:checked').value === 'span';
    if (span && $('#cxEnd').value <= $('#cxStart').value) { $('#cxErr').textContent = 'La hora final debe ser posterior a la inicial.'; return; }
    const body = { reason: $('#cxReason').value, start: span ? $('#cxStart').value : null, end: span ? $('#cxEnd').value : null, force };
    $('#cxSave').disabled = true; $('#cxErr').textContent = '';
    try {
      for (const id of editing.ids) await api(`/api/admin/closures/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
      $('#dlgClosure').close(); toast('Cierre actualizado.'); loadClosures();
    } catch (err) {
      if (err.status === 409 && err.data && err.data.conflicts) {
        showConflict('#cxConflict', 'Hay citas activas en la nueva franja', err.data.conflicts, 'Estas citas no se cancelan solas: revísalas en la agenda.', () => saveClosureEdit(true), 'Guardar igualmente');
      } else $('#cxErr').textContent = err.message;
      loadClosures();
    } finally { $('#cxSave').disabled = false; }
  }
  $('#cxForm').addEventListener('submit', (e) => { e.preventDefault(); saveClosureEdit(false); });
  function askDeleteClosure(g) {
    ask({ title: 'Eliminar cierre', ok: 'Eliminar cierre', danger: true,
      text: `${closureWhen(g)} volverá a tener horas disponibles en la web según el horario normal.`,
      run: async () => {
        for (const id of g.ids) { try { await api(`/api/admin/closures/${id}`, { method: 'DELETE' }); } catch (err) { if (err.status !== 404) throw err; } }
        toast('Cierre eliminado. Esos días vuelven a estar disponibles.'); loadClosures();
      } });
  }

  /* ---------------- Horarios ---------------- */
  function weekHtml(week, key) {
    return ORDER.map((i) => {
      const d = week[i] || { open: false, ranges: [{ from: '10:00', to: '20:00' }] };
      return `<div class="wday" data-day="${i}" data-key="${key}">
        <label class="wday-name"><input type="checkbox" ${d.open ? 'checked' : ''} data-open> ${cap(WD[i])}</label>
        <div class="ranges">${d.open ? rangesHtml(d.ranges) : '<span class="closed-txt">Cerrado</span>'}</div>
      </div>`;
    }).join('');
  }
  function rangesHtml(ranges) {
    return ranges.map((r, j) => `${j ? `<span class="break">descanso ${esc(ranges[j - 1].to)}–${esc(r.from)}</span>` : ''}<span class="range">
      <input type="time" step="900" value="${esc(r.from)}" data-from aria-label="Abre a las"> <span aria-hidden="true">–</span> <input type="time" step="900" value="${esc(r.to)}" data-to aria-label="Cierra a las">
      ${ranges.length > 1 ? '<button type="button" class="x" data-rm aria-label="Quitar franja">×</button>' : ''}</span>`).join('') + '<button type="button" class="add-range" data-add>Añadir franja</button>';
  }
  function readDay(row) {
    const open = $('[data-open]', row).checked;
    const ranges = $$('.range', row).map((r) => ({ from: $('[data-from]', r).value, to: $('[data-to]', r).value }));
    return { open, ranges: ranges.length ? ranges : [{ from: '10:00', to: '20:00' }] };
  }
  function readWeek(container, key) {
    const w = [];
    $$(`.wday[data-key="${key}"]`, container).forEach((row) => { w[+row.dataset.day] = readDay(row); });
    return w;
  }
  // Editor de semana: abrir/cerrar días y añadir o quitar franjas (los huecos entre franjas son descansos)
  function wireWeek(container) {
    container.addEventListener('change', (e) => {
      if (e.target.matches('[data-open]')) {
        const row = e.target.closest('.wday');
        const day = readDay(row);
        $('.ranges', row).innerHTML = e.target.checked ? rangesHtml(day.ranges.length ? day.ranges : [{ from: '10:00', to: '20:00' }]) : '<span class="closed-txt">Cerrado</span>';
      }
      if (e.target.matches('[data-from], [data-to]')) {
        const row = e.target.closest('.wday');
        $('.ranges', row).innerHTML = rangesHtml(readDay(row).ranges);
      }
    });
    container.addEventListener('click', (e) => {
      const row = e.target.closest('.wday');
      if (!row) return;
      if (e.target.matches('[data-add]')) {
        const d = readDay(row), last = d.ranges[d.ranges.length - 1];
        const s = Math.min(toMin(last.to) + 60, 22 * 60), z = Math.min(s + 180, 23 * 60 + 45);
        // taste-skill-ignore: formato de hora HH:MM
        const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
        d.ranges.push({ from: hm(s), to: hm(z) });
        $('.ranges', row).innerHTML = rangesHtml(d.ranges);
        markDirty('horarios');
      }
      if (e.target.matches('[data-rm]')) {
        e.target.closest('.range').remove();
        $('.ranges', row).innerHTML = rangesHtml(readDay(row).ranges);
        markDirty('horarios');
      }
    });
  }
  function markDirty(v) { st.dirty[v] = true; $(v === 'horarios' ? '#hrDirty' : '#bzDirty').hidden = false; }
  function clearDirty(v) { st.dirty[v] = false; $(v === 'horarios' ? '#hrDirty' : '#bzDirty').hidden = true; }

  function renderHours() {
    if (st.dirty.horarios) return; // conserva lo que se estaba editando
    const s = st.set.schedule;
    $('#hrSlot').value = String(s.slotMinutes); $('#hrWin').value = s.windowDays;
    $('#hrWeek').innerHTML = weekHtml(s.week, 'base');
    $('#hrPros').innerHTML = pros().map((p) => `
      <div class="pro-sched" data-pro="${esc(p.id)}">
        <label><input type="checkbox" data-own ${p.schedule ? 'checked' : ''}> ${esc(p.name)}${p.active ? '' : ' <span class="opt">(inactivo)</span>'}</label>
        <div class="week" ${p.schedule ? '' : 'hidden'}>${weekHtml(p.schedule || s.week, 'pro-' + p.id)}</div>
      </div>`).join('');
    $('#hrErr').textContent = ''; hideConflict('#hrConflict');
  }
  wireWeek($('#hrWeek')); wireWeek($('#hrPros'));
  $('#hrPros').addEventListener('change', (e) => {
    if (!e.target.matches('[data-own]')) return;
    const box = e.target.closest('.pro-sched'), wk = $('.week', box);
    if (e.target.checked) wk.innerHTML = weekHtml(readWeek($('#hrWeek'), 'base'), 'pro-' + box.dataset.pro); // parte del horario general
    wk.hidden = !e.target.checked;
  });
  $('#hrForm').addEventListener('input', () => markDirty('horarios'));
  $('#hrForm').addEventListener('change', () => markDirty('horarios'));

  async function saveHours(force) {
    const schedule = { slotMinutes: +$('#hrSlot').value, windowDays: +$('#hrWin').value, week: readWeek($('#hrWeek'), 'base') };
    const professionals = pros().map((p) => {
      const box = $(`.pro-sched[data-pro="${CSS.escape(p.id)}"]`);
      const own = box && $('[data-own]', box).checked;
      return { ...p, schedule: own ? readWeek(box, 'pro-' + p.id) : null };
    });
    $('#hrErr').textContent = ''; $('#hrSave').disabled = true;
    try {
      const r = await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ schedule, professionals: single() ? undefined : professionals, force }) });
      st.set = { ...st.set, ...r }; clearDirty('horarios'); renderHours();
      toast(r.affected ? `Horario guardado. ${r.affected} citas quedan fuera del horario nuevo: revísalas en la agenda.` : 'Horario guardado. La web ya ofrece las horas nuevas.');
    } catch (err) {
      if (err.status === 409 && err.data && err.data.conflicts) {
        showConflict('#hrConflict', `${err.data.conflicts.length} ${err.data.conflicts.length === 1 ? 'cita queda' : 'citas quedan'} fuera del horario nuevo`, err.data.conflicts,
          'No se cancelan solas. Si guardas, revísalas en la agenda y avisa a los clientes.', () => saveHours(true), 'Guardar igualmente');
      } else $('#hrErr').textContent = err.message;
    } finally { $('#hrSave').disabled = false; }
  }
  $('#hrForm').addEventListener('submit', (e) => { e.preventDefault(); saveHours(false); });

  /* ---------------- Negocio ---------------- */
  let team = [];
  function renderBusiness() {
    if (st.dirty.negocio) return;
    const b = st.set.business, L = b.location || {};
    $('#bzAddress').value = L.address || ''; $('#bzCity').value = L.city || ''; $('#bzPhone').value = L.phone || '';
    $('#bzLat').value = L.lat ?? ''; $('#bzLng').value = L.lng ?? ''; $('#bzMaps').value = L.mapsUrl || ''; $('#bzNotes').value = L.notes || '';
    $('#bzTz').value = b.timezone || 'Europe/Madrid';
    team = pros().map((p) => ({ ...p, saved: true }));
    renderTeam();
    $('#bzErr').textContent = ''; hideConflict('#bzConflict');
  }
  function renderTeam() {
    $('#bzTeam').innerHTML = team.map((p, i) => {
      const wa = String(p.whatsapp || '').replace(/\D/g, '');
      return `<div class="member ${p.active ? '' : 'is-off'}" data-i="${i}">
        ${p.photo ? `<img src="../${esc(p.photo)}" alt="">` : '<span class="ph" aria-hidden="true"></span>'}
        <div class="fld"><label for="tm-n-${i}">Nombre</label><input id="tm-n-${i}" data-k="name" value="${esc(p.name)}" maxlength="60"></div>
        <div class="fld"><label for="tm-f-${i}">Nombre corto</label><input id="tm-f-${i}" data-k="first" value="${esc(p.first || '')}" maxlength="30"></div>
        <div class="fld"><label for="tm-r-${i}">Especialidad</label><input id="tm-r-${i}" data-k="role" value="${esc(p.role || '')}" maxlength="80"></div>
        <div class="fld"><label for="tm-w-${i}">WhatsApp</label><input id="tm-w-${i}" data-k="whatsapp" value="${esc(wa)}" inputmode="numeric" placeholder="34600123456" aria-describedby="tm-wh-${i}"></div>
        <div class="fld"><label for="tm-p-${i}">Foto</label><input id="tm-p-${i}" data-k="photo" value="${esc(p.photo || '')}" placeholder="assets/archivo.jpg"></div>
        <div class="member-foot">
          <label><input type="checkbox" data-k="active" ${p.active ? 'checked' : ''}> Activo en la web</label>
          <span id="tm-wh-${i}" class="${wa.length >= 8 ? 'wa-ok' : 'wa-no'}">${wa.length >= 8 ? 'Botón de WhatsApp activo' : 'Sin WhatsApp: no se mostrará el botón'}</span>
          <button type="button" class="rm" data-rm-pro="${i}">${p.saved ? 'Eliminar' : 'Quitar'}</button>
        </div>
      </div>`;
    }).join('');
  }
  $('#bzTeam').addEventListener('input', (e) => {
    const m = e.target.closest('.member'); if (!m) return;
    const p = team[+m.dataset.i], k = e.target.dataset.k;
    if (k === 'active') { p.active = e.target.checked; m.classList.toggle('is-off', !p.active); }
    else if (k) p[k] = e.target.value;
    if (k === 'whatsapp') {
      const ok = e.target.value.replace(/\D/g, '').length >= 8, h = $(`#tm-wh-${m.dataset.i}`);
      h.className = ok ? 'wa-ok' : 'wa-no'; h.textContent = ok ? 'Botón de WhatsApp activo' : 'Sin WhatsApp: no se mostrará el botón';
    }
    markDirty('negocio');
  });
  $('#bzTeam').addEventListener('click', (e) => {
    const b = e.target.closest('[data-rm-pro]'); if (!b) return;
    const i = +b.dataset.rmPro, p = team[i];
    const drop = () => { team.splice(i, 1); renderTeam(); markDirty('negocio'); };
    if (!p.saved) return drop();
    ask({ title: `Eliminar a ${p.name || 'este barbero'}`, ok: 'Quitar del equipo', danger: true,
      text: 'Se quitará al guardar. Si tiene reservas, el servidor no lo permitirá: en ese caso desmarca «Activo en la web».', run: async () => drop() });
  });
  $('#bzAdd').addEventListener('click', () => {
    team.push({ id: '', name: '', first: '', role: '', photo: '', whatsapp: '', active: true, schedule: null, saved: false });
    renderTeam(); markDirty('negocio');
    $(`#tm-n-${team.length - 1}`).focus();
  });
  $('#bzForm').addEventListener('input', (e) => { if (!e.target.closest('#bzTeam')) markDirty('negocio'); });

  async function saveBusiness(force) {
    const business = {
      studioName: st.set.business.studioName, timezone: $('#bzTz').value.trim(),
      location: { address: $('#bzAddress').value, city: $('#bzCity').value, phone: $('#bzPhone').value, lat: $('#bzLat').value.trim().replace(',', '.'),
        lng: $('#bzLng').value.trim().replace(',', '.'), mapsUrl: $('#bzMaps').value.trim(), notes: $('#bzNotes').value }
    };
    const professionals = team.map(({ saved, ...p }) => p);
    $('#bzErr').textContent = ''; $('#bzSave').disabled = true;
    try {
      const r = await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ business, professionals, force }) });
      st.set = { ...st.set, ...r }; clearDirty('negocio'); fillProSelects(); renderBusiness();
      toast('Datos guardados. La web ya los muestra.');
    } catch (err) {
      if (err.status === 409 && err.data && err.data.conflicts) {
        showConflict('#bzConflict', `${err.data.conflicts.length} ${err.data.conflicts.length === 1 ? 'cita es' : 'citas son'} de barberos que dejarían de estar activos`, err.data.conflicts,
          'No se cancelan solas. Si guardas, reprográmalas con otro barbero o cancélalas desde la agenda.', () => saveBusiness(true), 'Guardar igualmente');
      } else $('#bzErr').textContent = err.message;
    } finally { $('#bzSave').disabled = false; }
  }
  $('#bzForm').addEventListener('submit', (e) => { e.preventDefault(); saveBusiness(false); });

  /* ---------------- Arranque ---------------- */
  (async () => {
    try { await api('/api/admin/me'); await start(); }
    catch (e) { if (e.status !== 401) { showLogin(); $('#loginErr').textContent = e.message; } }
  })();
})();
