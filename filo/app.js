/* FILO — interacción y movimiento. Sin dependencias. */
(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const smooth = (t) => t * t * (3 - 2 * t);
  const html = document.documentElement;
  const mqReduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const mqFine = window.matchMedia('(hover: hover) and (pointer: fine)');
  let reduce = mqReduce.matches;

  // Tokens de movimiento compartidos con styles.css
  const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';
  const EASE_IN_OUT = 'cubic-bezier(0.77, 0, 0.175, 1)';
  const EASE_FALL = 'cubic-bezier(0.55, 0.055, 0.675, 0.19)'; // gravedad: caída del pelo cortado

  /* ------------------------------------------------------------------
     Contenido de la web (los datos del negocio y del equipo llegan del servidor)
  ------------------------------------------------------------------ */
  const SERVICES = [
    { name: 'Corte a tijera', img: 0, tech: 'Tijera sobre peine',
      desc: 'Corte completo a tijera, en húmedo y repasado en seco. Para pelo medio, tupés y peinados que necesitan forma.' },
    { name: 'Degradado', img: 1, tech: 'Graduación de 0 a 3',
      desc: 'Máquina y tijera para degradados sin saltos: a piel, bajo, medio o alto, con la nuca y las patillas definidas.' },
    { name: 'Diseño y perfilado', img: 2, tech: 'Contorno a navaja',
      desc: 'Raya marcada, líneas y contornos limpios con máquina de perfilar y navaja.' },
    { name: 'Arreglo de barba', img: 3, tech: 'Línea de mejilla y cuello',
      desc: 'Forma, volumen y líneas de mejilla y cuello pensadas para tu cara. Con toalla caliente y aceite.' },
    { name: 'Afeitado a navaja', img: 4, tech: 'Dos pasadas',
      desc: 'Afeitado clásico: toalla caliente, espuma y navaja en dos pasadas, a favor y a contrapelo.' },
    { name: 'Canas y matiz', img: 5, tech: 'Camuflaje parcial',
      desc: 'Reducción discreta de canas en pelo y barba, para que el cambio no se note de una semana a otra.' }
  ];

  // Texto de cada ficha del equipo por identificador (nombre, rol, foto y WhatsApp vienen de la configuración)
  const TEAM_COPY = {
    leo: { desc: 'Trabaja a tijera de principio a fin. Cortes clásicos, tupés y nucas limpias que crecen sin perder la forma.', tags: ['Tijera', 'Clásico', 'Tupé'] },
    ivan: { desc: 'Degradados sin saltos y diseños a navaja. Metódico con las líneas y con los tiempos.', tags: ['Degradado', 'Diseño', 'Perfilado'] },
    bruno: { desc: 'Barbas con forma y afeitado tradicional a navaja, con toalla caliente.', tags: ['Barba', 'Navaja', 'Toalla caliente'] },
    nico: { desc: 'Corta el pelo rizado y con textura en seco, mechón a mechón, para que funcione sin producto.', tags: ['Rizo', 'Textura', 'Corte en seco'] }
  };

  /* ------------------------------------------------------------------
     Elementos
  ------------------------------------------------------------------ */
  const header = $('#header');
  const brand = $('#brand');
  const headerCta = $('#headerCta');
  const hero = $('.hero');
  const heroMedia = $('#heroMedia');

  /* ------------------------------------------------------------------
     INTRO — línea de corte, tijeras y logotipo (≈2,5 s, una vez por sesión)
  ------------------------------------------------------------------ */
  const NS = 'http://www.w3.org/2000/svg';
  const mk = (tag, attrs, parent) => {
    const el = document.createElementNS(NS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(el);
    return el;
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const anim = (el, kf, o) => el.animate(kf, Object.assign({ fill: 'both' }, o));

  // Escena en unidades propias: la línea de corte está en y = 520; el pivote de las tijeras en x = 1040
  function fitScene(svg, cutY) {
    const W = innerWidth, H = innerHeight;
    const s = W < H ? W / 760 : Math.min(W / 1100, H / 820);
    const vw = W / s, vh = H / s;
    svg.setAttribute('viewBox', `${920 - vw / 2} ${520 - cutY / s} ${vw} ${vh}`);
  }

  function buildClippings() {
    // Recortes de pelo: trazos cortos que caen desde la línea, junto a las hojas
    const g = $('#frags');
    let seed = 11;
    const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    const colors = ['#C8CAC5', '#B8B8B2', '#C9BBA7', '#8F918C'];
    const out = [];
    for (let i = 0; i < 34; i++) {
      const x = 640 + rnd() * 300, y = 516 + rnd() * 8, l = 4 + rnd() * 9, a = (rnd() - 0.5) * 2.6;
      const p = mk('path', {
        d: `M ${x} ${y} l ${(Math.cos(a) * l).toFixed(2)} ${(Math.sin(a) * l).toFixed(2)}`,
        stroke: colors[i % colors.length], 'stroke-width': 1 + rnd() * 1.4, 'stroke-linecap': 'round',
        fill: 'none', class: 'falling', opacity: 0
      }, g);
      out.push({ p, f: rnd() });
    }
    return out;
  }

  async function runIntro() {
    const intro = $('#intro');
    if (!html.classList.contains('intro-on')) return heroIn();
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    scrollTo(0, 0);
    frame(); // la cabecera calcula su tema antes de medir el color del logotipo

    const svg = $('#introScene'), bg = $('#introBg'), line = $('#introLine'), logo = $('#introLogo'), word = $('span', logo);
    const cutY = innerHeight * 0.56;
    fitScene(svg, cutY);
    const clips = buildClippings();
    const move = $('#shearsMove'), blA = $('.blade-a'), blB = $('.blade-b');

    // La intro no espera a la red más de lo imprescindible: tipografía e imagen con límite
    const fontsReady = document.fonts ? document.fonts.load('900 100px "Sofia Sans Extra Condensed"') : Promise.resolve();
    const heroImg = $('img', heroMedia);
    const imgReady = heroImg.decode ? heroImg.decode().catch(() => {}) : Promise.resolve();
    await Promise.race([fontsReady, wait(400)]);

    const running = [];
    const A = (el, kf, o) => { const a = anim(el, kf, o); running.push(a); return a; };
    let skipped = false;
    const skip = () => { if (skipped) return; skipped = true; running.forEach((a) => a.finish()); };
    addEventListener('pointerdown', skip, { once: true });
    addEventListener('keydown', skip, { once: true });

    // 1 · La línea de corte recorre la pantalla
    A(line, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: 620, easing: EASE_IN_OUT });
    // 2 · Las tijeras entran abriéndose y cortan sobre la línea (cierran en T)
    const T = 1060;
    // Una sola animación para entrar, sostener el corte y salir (T + 120 → T + 500)
    A(move, [
      { transform: 'translateX(640px)', opacity: 0, easing: EASE_OUT },
      { transform: 'translateX(0px)', opacity: 1, offset: 640 / (T + 380) },
      { transform: 'translateX(0px)', opacity: 1, offset: T / (T + 380), easing: EASE_OUT },
      { transform: 'translateX(260px)', opacity: 0 }
    ], { duration: T + 380, delay: 120 });
    A(blA, [{ transform: 'rotate(0deg)' }, { transform: 'rotate(-17deg)', offset: 0.72 }, { transform: 'rotate(0deg)' }], { duration: 760, delay: T - 760, easing: EASE_IN_OUT });
    A(blB, [{ transform: 'rotate(0deg)' }, { transform: 'rotate(17deg)', offset: 0.72 }, { transform: 'rotate(0deg)' }], { duration: 760, delay: T - 760, easing: EASE_IN_OUT });
    // 3 · El pelo cortado cae; las tijeras salen
    clips.forEach(({ p, f }) => {
      A(p, [
        { opacity: 0, transform: 'translate(0, 0) rotate(0deg)' },
        { opacity: 1, transform: 'translate(0, 2px) rotate(0deg)', offset: 0.06 },
        { opacity: 0, transform: `translate(${(f - 0.5) * 50}px, ${150 + f * 220}px) rotate(${(f - 0.5) * 160}deg)` }
      ], { duration: 640 + f * 300, delay: T + f * 90, easing: EASE_FALL });
    });
    // 4 · El nombre emerge de la línea
    A(word, [{ clipPath: 'inset(100% 0 0 0)', transform: 'translateY(38%)' }, { clipPath: 'inset(0% 0 0 0)', transform: 'translateY(0)' }], { duration: 620, delay: T + 80, easing: EASE_OUT });

    // 5 · El logotipo viaja hasta la cabecera y la escena se cierra sobre la línea
    const F = T + 900, DF = 580;
    const L = logo.getBoundingClientRect(), S = word.getBoundingClientRect(), B = brand.getBoundingClientRect();
    const k = parseFloat(getComputedStyle(brand).fontSize) / parseFloat(getComputedStyle(logo).fontSize);
    const cx = L.left + L.width / 2, cy = L.top + L.height / 2;
    const sx = S.left + S.width / 2, sy = S.top + S.height / 2;
    const dx = B.left + B.width / 2 - cx - k * (sx - cx), dy = B.top + B.height / 2 - cy - k * (sy - cy);
    const endColor = getComputedStyle(brand).color;
    A(logo, [
      { transform: 'translate(-50%, -100%)', color: '#F2F0E9' },
      { transform: `translate(calc(-50% + ${dx}px), calc(-100% + ${dy}px)) scale(${k})`, color: endColor }
    ], { duration: DF, delay: F, easing: EASE_IN_OUT });
    A(bg, [{ clipPath: 'inset(0 0 0 0)' }, { clipPath: 'inset(56% 0 44% 0)' }], { duration: DF, delay: F, easing: EASE_IN_OUT });
    A(line, [{ opacity: 1 }, { opacity: 0 }], { duration: DF, delay: F + DF * 0.4, easing: 'ease' });
    A(svg, [{ opacity: 1 }, { opacity: 0 }], { duration: 200, delay: F - 100, easing: 'ease' });
    const headerIn = A(header, [{ opacity: 0 }, { opacity: 1 }], { duration: DF, delay: F + DF * 0.3, easing: 'ease' });

    if (skipped) running.forEach((a) => a.finish()); // se pulsó antes de que arrancara la secuencia

    // ?intro=scrub congela la secuencia para revisarla fotograma a fotograma
    if (/[?&]intro=scrub/.test(location.search)) {
      running.forEach((a) => a.pause());
      window.filoScrub = (ms) => running.forEach((a) => { a.currentTime = ms; });
      await new Promise((r) => { window.filoContinue = r; });
      running.forEach((a) => a.finish());
    }

    // Revelado de la portada: no espera a la imagen más de lo que dura la intro
    const revealAt = skipped ? 0 : F;
    setTimeout(() => hero.classList.add('in'), revealAt);
    await Promise.race([imgReady, wait(skipped ? 0 : F)]);
    await Promise.all(running.map((a) => a.finished.catch(() => {})));

    // Traspaso: el logotipo de la intro queda exactamente sobre el de la cabecera
    header.style.transition = 'none'; brand.style.transition = 'none';
    html.classList.remove('intro-on');
    void header.offsetWidth;
    headerIn.cancel();
    header.style.transition = ''; brand.style.transition = '';
    hero.classList.add('in');
    intro.remove();
    removeEventListener('pointerdown', skip); removeEventListener('keydown', skip);
    try { sessionStorage.setItem('filo-intro', '1'); } catch (e) { /* almacenamiento bloqueado: la intro puede repetirse */ }
    measureCta();
    onScroll();
  }

  function heroIn() {
    const go = () => hero.classList.add('in');
    requestAnimationFrame(go);
    setTimeout(go, 80); // rAF se pausa en pestañas en segundo plano
  }

  /* ------------------------------------------------------------------
     Servicios: lista activa + foto fija + ficha técnica dibujada
  ------------------------------------------------------------------ */
  const srvList = $('#srvList');
  const srvImgs = $$('[data-srv-img]');
  const srvDiagram = $('#srvDiagram');
  const srvTech = $('#srvTech');
  let srvActive = -1;

  const HEAD = '<ellipse class="head" cx="60" cy="52" rx="24" ry="29"/><path class="head" d="M 49 80 L 47 98 M 71 80 L 73 98"/>';
  const DIAGRAMS = [
    // Tijera: largo uniforme sobre el peine
    '<path class="draw" pathLength="1" d="M 40 24 L 40 36 M 50 20 L 50 34 M 60 18 L 60 33 M 70 20 L 70 34 M 80 24 L 80 36"/><path class="cut draw" pathLength="1" d="M 24 36 C 44 30 76 30 96 36"/>',
    // Degradado: el largo crece de la nuca hacia arriba
    '<path class="draw" pathLength="1" d="M 84 74 L 88 74 M 85 64 L 92 64 M 86 54 L 96 54 M 86 44 L 99 44 M 84 34 L 100 34"/><path class="cut draw" pathLength="1" d="M 88 80 C 96 62 100 46 98 28"/>',
    // Diseño: línea lateral y contorno
    '<path class="draw" pathLength="1" d="M 36 40 C 44 28 76 28 84 40"/><path class="cut draw" pathLength="1" d="M 42 38 L 58 30 M 38 58 L 38 46"/>',
    // Barba: línea de mejilla y de cuello
    '<path class="draw" pathLength="1" d="M 38 58 C 40 84 54 92 60 92 C 66 92 80 84 82 58"/><path class="cut draw" pathLength="1" d="M 36 60 C 44 66 50 70 52 76 M 84 60 C 76 66 70 70 68 76 M 44 98 C 54 102 66 102 76 98"/>',
    // Navaja: pasada en diagonal por la mejilla
    '<path class="draw" pathLength="1" d="M 40 62 C 44 80 54 88 60 88"/><path class="cut draw" pathLength="1" d="M 30 48 L 56 74"/><path class="draw" pathLength="1" d="M 24 42 L 34 52 L 38 48 L 28 38 Z"/>',
    // Canas: mechones alternos, parcial
    '<path class="draw" pathLength="1" d="M 40 30 L 44 22 M 52 26 L 55 18 M 64 26 L 66 18 M 76 30 L 79 22"/><path class="cut draw" pathLength="1" d="M 46 28 L 49 20 M 70 28 L 72 20"/>'
  ];

  function renderServices() {
    srvList.innerHTML = SERVICES.map((s, i) => `
      <li class="srv-item" data-i="${i}">
        <button type="button" class="srv-row" aria-expanded="false" aria-controls="srv-d-${i}">
          <span class="srv-name">${s.name}</span>
        </button>
        <div class="srv-desc" id="srv-d-${i}" role="region" aria-label="${s.name}">
          <div><p>${s.desc}</p></div>
        </div>
      </li>`).join('');
    $$('.srv-item', srvList).forEach((li) => {
      const i = +li.dataset.i;
      $('.srv-row', li).addEventListener('click', () => setService(i));
      li.addEventListener('mouseenter', () => { if (mqFine.matches) setService(i); });
    });
    setService(0);
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((es) => {
        es.forEach((e) => { if (e.isIntersecting) setService(+e.target.dataset.i); });
      }, { rootMargin: '-46% 0px -46% 0px' });
      $$('.srv-item', srvList).forEach((li) => io.observe(li));
    }
  }

  function setService(i) {
    if (i === srvActive) return;
    srvActive = i;
    $$('.srv-item', srvList).forEach((li, j) => {
      li.classList.toggle('is-on', j === i);
      $('.srv-row', li).setAttribute('aria-expanded', j === i ? 'true' : 'false');
    });
    srvImgs.forEach((im) => im.classList.toggle('is-on', +im.dataset.srvImg === SERVICES[i].img));
    srvDiagram.innerHTML = HEAD + DIAGRAMS[i];
    srvTech.textContent = SERVICES[i].tech;
  }

  /* ------------------------------------------------------------------
     Equipo (desde la configuración del negocio)
  ------------------------------------------------------------------ */
  function renderTeam(pros) {
    const list = $('#teamList');
    if (!pros) { list.innerHTML = '<p class="team-lead">No se ha podido cargar el equipo. Recarga la página en unos segundos.</p>'; return; }
    list.innerHTML = pros.map((p, i) => {
      const c = TEAM_COPY[p.id] || { desc: '', tags: [] };
      return `
      <article class="member" data-id="${esc(p.id)}" data-i="${i}">
        <div class="member-photo" data-reveal="mask">
          <img src="${esc(p.photo)}" alt="Retrato de ${esc(p.name)} (fotografía de muestra)" width="1200" height="1500" loading="lazy">
        </div>
        <div class="member-info" data-reveal>
          <h3 class="member-name">${esc(p.name)}</h3>
          <p class="member-role">${esc(p.role)}</p>
          ${c.desc ? `<p class="member-quote">${esc(c.desc)}</p>` : ''}
          ${c.tags.length ? `<div class="member-more" id="more-${esc(p.id)}"><div>
            <ul class="member-tags" aria-label="Especialidades de ${esc(p.first)}">${c.tags.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
          </div></div>` : ''}
          <div class="member-actions">
            ${c.tags.length ? `<button type="button" class="member-toggle" aria-expanded="false" aria-controls="more-${esc(p.id)}">Ver especialidades</button>` : ''}
            <a class="member-book" href="#reserva" data-book data-pro="${esc(p.id)}">Reservar con ${esc(p.first)}</a>
          </div>
        </div>
      </article>`;
    }).join('');
    $$('.member', list).forEach((m) => {
      const t = $('.member-toggle', m);
      if (!t) return;
      const toggle = () => {
        const open = !m.classList.contains('is-open');
        m.classList.toggle('is-open', open);
        t.setAttribute('aria-expanded', String(open));
        t.textContent = open ? 'Ocultar especialidades' : 'Ver especialidades';
      };
      t.addEventListener('click', toggle);
      $('.member-photo', m).addEventListener('click', toggle); // respuesta táctil equivalente al hover
    });
    observeReveals($$('[data-reveal]', list));
  }

  /* ------------------------------------------------------------------
     Revelados al entrar en viewport (una vez)
  ------------------------------------------------------------------ */
  let revealIO = null;
  function observeReveals(els) {
    if (reduce || !('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('in')); return; }
    if (!revealIO) {
      revealIO = new IntersectionObserver((es) => {
        es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); revealIO.unobserve(e.target); } });
      }, { threshold: 0.05, rootMargin: '0px 0px 8% 0px' });
    }
    els.forEach((e) => revealIO.observe(e));
  }

  /* ------------------------------------------------------------------
     Menú móvil
  ------------------------------------------------------------------ */
  const menu = $('#menu'), menuBtn = $('#menuBtn');
  const menuOpen = () => menuBtn.getAttribute('aria-expanded') === 'true';
  function setMenu(open) {
    menuBtn.setAttribute('aria-expanded', String(open));
    menuBtn.textContent = open ? 'Cerrar' : 'Menú';
    if (open) {
      menu.hidden = false;
      requestAnimationFrame(() => requestAnimationFrame(() => menu.classList.add('is-open')));
      document.body.style.overflow = 'hidden';
      setTimeout(() => $('a', menu).focus({ preventScroll: true }), 60);
    } else {
      menu.classList.remove('is-open');
      document.body.style.overflow = '';
      setTimeout(() => { if (!menu.classList.contains('is-open')) menu.hidden = true; }, reduce ? 0 : 420);
    }
    onScroll();
  }
  menuBtn.addEventListener('click', () => setMenu(!menuOpen()));
  menu.addEventListener('click', (e) => { if (e.target.closest('a')) setMenu(false); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menuOpen()) { setMenu(false); menuBtn.focus(); }
  });

  /* ------------------------------------------------------------------
     Motor de scroll: cabecera, parallax, secciones fijadas, expansión de reserva
  ------------------------------------------------------------------ */
  const man = $('#manifesto'), manWords = $$('.man-title .w', man), manPhotos = $$('.man-photo', man);
  const themed = $$('[data-theme]');
  const booking = $('#reserva'), bkStage = $('#bkStage'), bkSurface = $('#bkSurface'), bkCta = $('#bkCta'), bkLabel = $('#bkLabel');
  const bkUi = $('#bkUi'), bkHeadline = $('#bkHeadline'), bkRail = $('#bkRail');
  const uiKids = [...bkUi.children];
  let ticking = false, bkFull = false, bkLive = false, bkE = 0, ctaRect = null;

  function onScroll() { if (!ticking) { ticking = true; requestAnimationFrame(frame); } }
  // El botón de la cabecera es el origen de la expansión: se mide en reposo
  function measureCta() { ctaRect = headerCta.getBoundingClientRect(); }

  function frame() {
    ticking = false;
    const y = scrollY, H = innerHeight, W = innerWidth;

    if (!reduce) {
      // Portada: la fotografía se desplaza más despacio que el texto
      const heroH = hero.offsetHeight;
      if (y < heroH) heroMedia.style.transform = `translate3d(0, ${y * 0.14}px, 0)`;
      // Manifiesto fijado
      const mr = man.getBoundingClientRect();
      if (mr.bottom > 0 && mr.top < H) {
        const p = clamp(-mr.top / (man.offsetHeight - H));
        manWords.forEach((w, i) => w.classList.toggle('on', p > 0.06 + i * 0.1));
        const travel = W <= 760 ? 0.12 : W <= 1080 ? 0.3 : 1; // en pantallas estrechas el recorrido es corto: nunca alcanza el texto
        manPhotos.forEach((ph) => {
          const sp = +ph.dataset.speed * travel;
          ph.style.transform = `translate3d(0, ${(0.35 - p) * H * sp}px, 0)`;
        });
      }
    }
    bookingFrame(W);
    headerFrame(y);
  }

  // Cabecera siempre visible: toma el tema de la sección que tiene debajo
  function headerFrame(y) {
    const probe = header.offsetHeight / 2;
    let theme = 'light';
    for (const s of themed) {
      const r = s.getBoundingClientRect();
      if (r.top <= probe && r.bottom > probe) { theme = s.dataset.theme; break; }
    }
    const overStage = bkLive && !bkFull;
    if (overStage && ctaRect && ctaRect.left * (1 - bkE) <= brand.getBoundingClientRect().left) theme = 'light'; // la superficie clara ya cubre el logotipo
    if (bkFull) theme = 'light';
    if (menuOpen()) theme = 'dark';
    header.classList.toggle('on-dark', theme === 'dark');
    header.classList.toggle('on-light', theme === 'light');
    header.classList.toggle('is-scrolled', y > 8 || menuOpen());
    header.classList.toggle('is-clear', overStage && !menuOpen());
  }

  function bookingGeom() {
    const total = booking.offsetHeight - bkStage.offsetHeight;
    return { top: booking.offsetTop, total, fullAt: booking.offsetTop + total * 0.78 };
  }

  function bookingFrame(W) {
    if (reduce) { bkUi.inert = false; bkFull = false; bkLive = false; headerCta.classList.remove('is-handed'); return; }
    const Hs = bkStage.offsetHeight;
    const r = booking.getBoundingClientRect();
    const total = booking.offsetHeight - Hs;
    const raw = clamp(-r.top / total);
    const p = clamp(raw / 0.72);
    const e = smooth(p);
    bkE = e;
    // La escena está fijada (o ya expandida y saliendo): la superficie toma el relevo del botón de la cabecera
    const live = r.top <= 0 && r.bottom > header.offsetHeight;
    if (live !== bkLive) {
      bkLive = live;
      bkSurface.classList.toggle('is-live', live);
      headerCta.classList.toggle('is-handed', live);
      headerCta.tabIndex = live ? -1 : 0;
    }
    if (!ctaRect) measureCta();
    const c = ctaRect, k = 1 - e;
    bkSurface.style.clipPath = `inset(${c.top * k}px ${(W - c.right) * k}px ${(Hs - c.bottom) * k}px ${c.left * k}px)`;
    // La etiqueta parte del centro del botón compacto y crece hacia el centro mientras se desvanece
    const lx = c.left + c.width / 2 - W / 2, ly = c.top + c.height / 2 - Hs / 2;
    bkLabel.style.transform = `translate3d(${lx * k}px, ${ly * k}px, 0) scale(${1 + e * 1.6})`;
    bkLabel.style.opacity = 1 - clamp((p - 0.3) / 0.25);
    // El formulario se abre desde la línea de corte, dentro de la superficie clara
    const open = 1 - smooth(clamp((p - 0.6) / 0.28));
    bkUi.style.clipPath = `inset(${open * 50}% 0 ${open * 50}% 0)`;
    const ui = clamp((p - 0.8) / 0.18);
    uiKids.forEach((el, i) => {
      const u = clamp(ui * 1.25 - i * 0.12);
      el.style.opacity = u;
      el.style.transform = `translate3d(0, ${(1 - u) * 20}px, 0)`;
    });
    bkHeadline.style.transform = `translate3d(0, ${-e * 16}vh, 0)`;
    bkHeadline.style.opacity = 1 - clamp(p / 0.4);
    const railIn = clamp((innerHeight - r.top) / (innerHeight * 0.7));
    bkRail.style.transform = `scaleX(${smooth(railIn)})`;
    bkRail.style.opacity = 1 - clamp((p - 0.2) / 0.3);
    const full = p >= 0.97;
    if (full !== bkFull) {
      bkFull = full;
      booking.classList.toggle('is-full', full);
      bkUi.inert = !full;
      bkCta.tabIndex = full ? -1 : 0;
      if (full) refreshAvailability(); // al entrar en la reserva, horas al día
    }
  }

  /* ------------------------------------------------------------------
     Enlaces de reserva: llevan a la reserva expandida, con preselección
  ------------------------------------------------------------------ */
  function goBooking(prefill) {
    if (prefill) applyPrefill(prefill);
    const g = bookingGeom();
    const target = reduce ? g.top : g.fullAt;
    const far = Math.abs(scrollY - target) > innerHeight * 6;
    scrollTo({ top: target, behavior: reduce || far ? 'auto' : 'smooth' });
    const focusFirst = () => {
      const el = !result.hidden ? result : $(bk.single ? '#optDates input:checked, #optDates input:not(:disabled)' : '#optPros input:checked', bkUi);
      if (el) el.focus({ preventScroll: true });
    };
    let done = false;
    const finish = () => { if (done) return; done = true; frame(); setTimeout(focusFirst, 30); };
    if ('onscrollend' in window && !(reduce || far)) addEventListener('scrollend', finish, { once: true });
    setTimeout(finish, reduce || far ? 50 : 1400);
  }
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-book]');
    if (!a) return;
    e.preventDefault();
    if (menuOpen()) setMenu(false);
    goBooking({ pro: a.dataset.pro });
  });
  bkCta.addEventListener('click', () => goBooking());
  $('#bkBack').addEventListener('click', () => {
    scrollTo({ top: $('#ubicacion').offsetTop, behavior: reduce ? 'auto' : 'smooth' });
    $('#placeTitle').setAttribute('tabindex', '-1');
    $('#placeTitle').focus({ preventScroll: true });
  });
  // Teclado: si el foco entra en la reserva sin estar expandida, se expande
  bkUi.addEventListener('focusin', () => { if (!bkFull && !reduce) scrollTo({ top: bookingGeom().fullAt, behavior: 'auto' }); });

  /* ------------------------------------------------------------------
     Reserva: barbero → día → hora → datos → confirmar.
     Disponibilidad y registro reales contra el servidor (server/server.mjs);
     nada se da por reservado sin su respuesta.
  ------------------------------------------------------------------ */
  const form = $('#bkForm');
  const submitBtn = $('#bkSubmit');
  const result = $('#bkResult');
  const statusEl = $('#bkStatus');
  const optDates = $('#optDates'), optTimes = $('#optTimes'), optPros = $('#optPros');
  const hintTime = $('#hintTime'), hintPro = $('#hintPro');
  const bk = { cfg: null, now: null, days: {}, date: null, time: null, pro: null, sending: false, loaded: false, prefill: null, at: 0, single: false };
  const WD = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const WD_S = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  const MO = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const MO_S = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const parseD = (s) => new Date(s + 'T12:00:00Z');
  const addDays = (s, n) => { const d = parseD(s); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const fmtLong = (s) => { const d = parseD(s); return `${WD[d.getUTCDay()]} ${d.getUTCDate()} de ${MO[d.getUTCMonth()]}`; };
  const proById = (id) => bk.cfg.professionals.find((p) => p.id === id);
  const day = (d) => bk.days[d] || { closed: false, off: bk.cfg.professionals.map((p) => p.id), pros: {} };
  // Horas libres de un día: las del barbero elegido o la unión de todos («Sin preferencia»)
  function freeTimes(d, pro = bk.pro) {
    const st = day(d);
    if (st.closed) return [];
    if (pro) return st.pros[pro] || [];
    return [...new Set(Object.values(st.pros).flat())].sort();
  }
  const studioShut = (d) => { const st = day(d); return st.closed || bk.cfg.professionals.every((p) => st.off.includes(p.id)); };
  const proOff = (d, pro) => day(d).off.includes(pro);

  async function request(path, opts = {}) {
    const r = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
    let data = {};
    try { data = await r.json(); } catch (e) { /* respuesta sin cuerpo */ }
    if (!r.ok) { const e = new Error(data.error || 'El servidor no ha respondido correctamente.'); e.status = r.status; throw e; }
    return data;
  }

  function setStatus(msg, isError, retry) {
    statusEl.className = 'bk-status' + (isError ? ' is-error' : '');
    statusEl.textContent = msg;
    if (retry) {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = 'Reintentar';
      b.addEventListener('click', retry);
      statusEl.appendChild(b);
    }
  }

  async function loadAvailability() {
    const today = bk.now.date;
    const a = await request(`/api/availability?from=${today}&to=${addDays(today, bk.cfg.schedule.windowDays)}`);
    bk.now = a.now; bk.days = a.days; bk.at = Date.now();
  }

  async function refreshAvailability() {
    if (!bk.loaded || bk.sending || Date.now() - bk.at < 30000) return;
    try { await loadAvailability(); } catch (e) { return; }
    if (bk.time && !freeTimes(bk.date).includes(bk.time)) bk.time = null;
    if (bk.date && !freeTimes(bk.date, null).length) { bk.date = null; bk.time = null; }
    renderAll(); renderFacts(); renderPlace();
  }

  async function initBooking() {
    setStatus('Cargando disponibilidad…');
    submitBtn.disabled = true;
    try {
      if (!bk.cfg) {
        bk.cfg = await request('/api/public-config');
        bk.now = bk.cfg.now;
        bk.single = bk.cfg.professionals.length === 1;
        if (bk.single) bk.pro = bk.cfg.professionals[0].id;
        renderTeam(bk.cfg.professionals);
      }
      await loadAvailability();
      bk.loaded = true;
      setStatus('');
      submitBtn.disabled = false;
      $('#blkPro').hidden = bk.single;
      if (bk.single) $('#bkIntro').textContent = `Elige día y hora con ${bk.cfg.professionals[0].first}. Solo te pedimos tu nombre y tu teléfono.`;
      if (bk.prefill) { const pf = bk.prefill; bk.prefill = null; applyPrefill(pf); }
      renderAll(); renderFacts(); renderPlace();
    } catch (e) {
      if (!bk.cfg) renderTeam(null);
      setStatus('No se ha podido cargar la disponibilidad de la barbería. No es posible reservar ahora mismo.', true, initBooking);
      $('#factToday').textContent = 'Consulta la disponibilidad en la reserva';
    }
  }

  function renderPros() {
    if (bk.single) { optPros.innerHTML = ''; return; }
    // «Sin preferencia» primero: elegir barbero es opcional
    const any = `<label class="pro pro-any"><input type="radio" name="pro" value="any" ${bk.pro ? '' : 'checked'}>
        <span class="pro-body"><span class="pro-mark" aria-hidden="true"></span><span class="pro-name">Sin preferencia</span><span class="pro-sub">Te atiende quien esté libre a esa hora</span></span></label>`;
    optPros.innerHTML = any + bk.cfg.professionals.map((p) => {
      const off = !!(bk.date && proOff(bk.date, p.id));
      const busy = !off && !!(bk.date && bk.time && !freeTimes(bk.date, p.id).includes(bk.time));
      const why = off ? 'No trabaja ese día' : busy ? 'Ocupado a esa hora' : '';
      return `<label class="pro"><input type="radio" name="pro" value="${esc(p.id)}" ${why ? 'disabled' : ''} ${bk.pro === p.id ? 'checked' : ''} aria-label="${esc(p.name)}${why ? ', ' + why.toLowerCase() : ''}">
        <span class="pro-body"><img src="${esc(p.photo)}" alt="" width="52" height="52" loading="lazy"><span class="pro-name">${esc(p.name)}</span><span class="pro-sub">${why || esc(p.role)}</span></span></label>`;
    }).join('');
    hintPro.textContent = 'Elige con quién o deja «Sin preferencia».';
  }

  function renderDates() {
    const days = [];
    for (let i = 0; i <= bk.cfg.schedule.windowDays; i++) days.push(addDays(bk.now.date, i));
    const who = bk.pro && proById(bk.pro);
    optDates.innerHTML = days.map((d) => {
      const dt = parseD(d), shut = studioShut(d), off = !shut && who && proOff(d, bk.pro);
      const full = !shut && !off && !freeTimes(d).length;
      const disabled = shut || off || full;
      const note = shut ? 'cerrado' : off ? 'no está' : full ? 'completo' : d === bk.now.date ? 'hoy' : MO_S[dt.getUTCMonth()];
      const extra = shut ? ', cerrado' : off ? `, ${who.first} no trabaja` : full ? ', sin horas libres' : '';
      return `<label class="chip"><input type="radio" name="date" value="${d}" ${disabled ? 'disabled' : ''} ${bk.date === d ? 'checked' : ''} aria-label="${fmtLong(d)}${extra}"><span>${WD_S[dt.getUTCDay()]}<b>${dt.getUTCDate()}</b>${note}</span></label>`;
    }).join('');
  }

  function renderTimes() {
    if (!bk.date) { optTimes.innerHTML = ''; hintTime.textContent = 'Elige un día para ver las horas libres.'; return; }
    const times = freeTimes(bk.date);
    const who = bk.pro && !bk.single ? proById(bk.pro).first : null;
    if (!times.length) {
      optTimes.innerHTML = '';
      hintTime.textContent = who ? `${who} no tiene horas libres ese día. Prueba otro día o elige «Sin preferencia».` : 'No quedan horas libres ese día.';
      return;
    }
    hintTime.textContent = `${times.length === 1 ? 'Queda 1 hora libre' : `Quedan ${times.length} horas libres`}${who ? ` con ${who}` : ''}. Cada cita dura ${bk.cfg.schedule.slotMinutes} minutos.`;
    optTimes.innerHTML = times.map((t, i) =>
      `<label class="chip" style="--i:${i}"><input type="radio" name="time" value="${t}" ${bk.time === t ? 'checked' : ''} aria-label="${t}"><span>${t}</span></label>`).join('');
  }

  function renderSummary() {
    const set = (k, h, empty) => { const dd = $(`[data-sum="${k}"]`); dd.innerHTML = h; dd.classList.toggle('is-empty', empty); };
    set('date', bk.date ? esc(cap(fmtLong(bk.date))) : 'Sin elegir', !bk.date);
    set('time', bk.time || 'Sin elegir', !bk.time);
    const p = bk.pro && proById(bk.pro);
    set('pro', p ? `<img src="${esc(p.photo)}" alt="">${esc(p.name)}` : 'Sin preferencia', false);
  }

  function renderAll() { renderPros(); renderDates(); renderTimes(); renderSummary(); }

  form.addEventListener('change', (e) => {
    const t = e.target;
    if (!bk.loaded || !t.name) return;
    $('#errForm').textContent = '';
    if (t.name === 'pro') {
      bk.pro = t.value === 'any' ? null : t.value;
      if (bk.date && (proOff(bk.date, bk.pro) || !freeTimes(bk.date).length)) { bk.date = null; bk.time = null; }
      if (bk.time && !freeTimes(bk.date).includes(bk.time)) bk.time = null;
      renderDates(); renderTimes();
    } else if (t.name === 'date') {
      bk.date = t.value;
      if (bk.time && !freeTimes(bk.date).includes(bk.time)) bk.time = null;
      renderTimes(); renderPros();
    } else if (t.name === 'time') {
      bk.time = t.value;
      renderPros();
    }
    renderSummary();
  });

  function validateBooking() {
    const errForm = $('#errForm');
    const missing = !bk.date ? 'el día' : !bk.time ? 'la hora' : null;
    const name = $('#fName'), phone = $('#fPhone');
    const okName = name.value.trim().length >= 2;
    const digits = phone.value.replace(/\D/g, '');
    const okPhone = digits.length >= 9 && digits.length <= 15 && /^\+?[\d\s().-]+$/.test(phone.value.trim());
    name.setAttribute('aria-invalid', String(!okName));
    phone.setAttribute('aria-invalid', String(!okPhone));
    $('#errName').textContent = okName ? '' : 'Escribe tu nombre.';
    $('#errPhone').textContent = okPhone ? '' : 'Escribe un teléfono válido, de 9 a 15 cifras.';
    errForm.textContent = missing ? `Falta elegir ${missing}.` : '';
    if (missing) { const g = !bk.date ? optDates : optTimes; const i = $('input:not(:disabled)', g); if (i) i.focus(); return false; }
    if (!okName) { name.focus(); return false; }
    if (!okPhone) { phone.focus(); return false; }
    return true;
  }

  function setSending(on) {
    bk.sending = on;
    submitBtn.classList.toggle('is-loading', on);
    submitBtn.disabled = on;
    $('.btn-label', submitBtn).textContent = on ? 'Registrando la reserva…' : 'Confirmar reserva';
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (bk.sending || !bk.loaded) return; // evita envíos duplicados
    if (!validateBooking()) return;
    setSending(true);
    const sent = { pro: bk.pro, date: bk.date };
    try {
      const { booking: b } = await request('/api/bookings', {
        method: 'POST',
        body: JSON.stringify({ date: bk.date, time: bk.time, professional: bk.pro || 'any', name: $('#fName').value, phone: $('#fPhone').value })
      });
      showSuccess(b);
      bk.at = 0; // la próxima entrada a la reserva vuelve a pedir la disponibilidad
      try { await loadAvailability(); renderFacts(); } catch (e2) { /* se actualiza al volver */ }
    } catch (err) {
      const errForm = $('#errForm');
      if (err.status === 409) {
        // Otro cliente ha reservado ese hueco: se recarga la disponibilidad real y se conservan nombre, teléfono, barbero y día
        try { await loadAvailability(); } catch (e2) { /* se mantiene la anterior */ }
        bk.pro = sent.pro; bk.date = freeTimes(sent.date).length ? sent.date : null; bk.time = null;
        renderAll();
        errForm.textContent = err.message + ' Elige otra hora; tus datos siguen aquí.';
        const first = $('input:not(:disabled)', bk.date ? optTimes : optDates); if (first) first.focus();
      } else if (err.status) {
        errForm.textContent = err.message;
      } else {
        errForm.textContent = 'No se ha podido conectar con el sistema de reservas. Tu cita no se ha registrado: inténtalo de nuevo.';
      }
    } finally {
      setSending(false);
    }
  });

  // Mensaje acordado: sin servicios ni precios. Sin número configurado no hay enlace.
  function waLink(b) {
    const p = proById(b.professional);
    if (!p || !/^\d{8,15}$/.test(p.whatsapp || '')) return null;
    const msg = `Hola, soy ${b.name}. Acabo de registrar una reserva para el ${fmtLong(b.date)} a las ${b.time} con ${p.name}. Mi código de reserva es ${b.code}.`;
    return `https://wa.me/${p.whatsapp}?text=${encodeURIComponent(msg)}`;
  }

  function showSuccess(b) {
    const p = proById(b.professional) || { name: b.professional, first: b.professional };
    const wa = waLink(b);
    form.hidden = true;
    $('#bkIntro').hidden = true;
    result.innerHTML = `
      <h3>Reserva registrada</h3>
      <dl>
        <div><dt>Día</dt><dd>${esc(cap(fmtLong(b.date)))}</dd></div>
        <div><dt>Hora</dt><dd>${esc(b.time)}${b.end ? `–${esc(b.end)}` : ''}</dd></div>
        <div><dt>Barbero</dt><dd>${esc(p.name)}${b.autoAssigned ? ' <span class="bk-auto">(asignado)</span>' : ''}</dd></div>
        <div><dt>Cliente</dt><dd>${esc(b.name)}</dd></div>
        <div><dt>Código</dt><dd class="bk-code">${esc(b.code)}</dd></div>
      </dl>
      ${b.autoAssigned ? `<p>Como no elegiste barbero, te atenderá <strong>${esc(p.name)}</strong>, que está libre a esa hora.</p>` : ''}
      <p>Tu cita ya está guardada en el sistema de la barbería, pendiente de confirmación. Guarda el código por si necesitas cambiarla.</p>
      <div class="bk-actions">
        ${wa ? `<a class="btn btn-primary" id="bkWa" href="${esc(wa)}" target="_blank" rel="noopener">Enviar reserva por WhatsApp</a>`
             : `<p class="bk-note">El WhatsApp de ${esc(p.first)} todavía no está configurado. La barbería verá tu reserva igualmente.</p>`}
        <button type="button" class="link-line" id="bkAgain">Hacer otra reserva</button>
      </div>
      ${wa ? `<p class="bk-note">Se abrirá WhatsApp con el mensaje ya escrito para ${esc(p.first)}; el envío lo haces tú. Aunque no lo envíes, la reserva sigue registrada.</p>` : ''}`;
    result.hidden = false;
    result.focus();
    $('#bkAgain').addEventListener('click', resetBooking);
  }

  async function resetBooking() {
    form.reset();
    Object.assign(bk, { date: null, time: null, pro: bk.single ? bk.pro : null });
    $$('[aria-invalid]', form).forEach((el) => el.removeAttribute('aria-invalid'));
    ['errForm', 'errName', 'errPhone'].forEach((id) => { $('#' + id).textContent = ''; });
    result.hidden = true; form.hidden = false; $('#bkIntro').hidden = false;
    try { await loadAvailability(); } catch (e) { /* se reintenta al reservar */ }
    renderAll();
    const first = $('input:not(:disabled)', bk.single ? optDates : optPros); if (first) first.focus();
  }

  function applyPrefill(pf) {
    if (!pf || (!pf.pro && !pf.date)) return;
    if (!bk.loaded) { bk.prefill = pf; return; }
    if (!result.hidden) return;
    if (pf.pro !== undefined && !bk.single) bk.pro = pf.pro && proById(pf.pro) ? pf.pro : null;
    if (pf.date) bk.date = freeTimes(pf.date).length ? pf.date : null;
    if (pf.time) bk.time = bk.date && freeTimes(bk.date).includes(pf.time) ? pf.time : null;
    if (bk.date && (proOff(bk.date, bk.pro) || !freeTimes(bk.date).length)) { bk.date = null; bk.time = null; }
    if (bk.time && !freeTimes(bk.date).includes(bk.time)) bk.time = null;
    renderAll();
  }

  /* ------------------------------------------------------------------
     Portada: hoy y próxima hora libre, desde la disponibilidad real
  ------------------------------------------------------------------ */
  const rangesTxt = (ranges) => ranges.map((r) => `${r.from}–${r.to}`).join(' y ');
  function renderFacts() {
    if (!bk.loaded) return;
    const today = bk.now.date, wk = bk.cfg.schedule.week[parseD(today).getUTCDay()];
    const left = freeTimes(today, null).length;
    let txt;
    if (studioShut(today)) txt = 'Cerrado';
    else if (left) txt = `Abierto, ${rangesTxt(wk.ranges)}`;
    else txt = 'Sin horas libres hoy';
    $('#factToday').textContent = txt;
    let next = null;
    for (let i = 0; i <= bk.cfg.schedule.windowDays && !next; i++) {
      const d = addDays(today, i), t = freeTimes(d, null)[0];
      if (t) next = { d, t };
    }
    const wrap = $('#factNextWrap'), btn = $('#factNext');
    wrap.hidden = !next;
    if (next) {
      const label = next.d === today ? `Hoy, ${next.t}` : next.d === addDays(today, 1) ? `Mañana, ${next.t}` : `${cap(fmtLong(next.d))}, ${next.t}`;
      btn.textContent = label;
      btn.setAttribute('aria-label', `Reservar la próxima hora libre: ${label}`);
      btn.onclick = () => goBooking({ pro: null, date: next.d, time: next.t });
    }
  }

  /* ------------------------------------------------------------------
     Ubicación: dirección, mapa y horario desde la configuración real.
     El mapa solo se carga al acercarse y nunca se pide la ubicación del visitante.
  ------------------------------------------------------------------ */
  function hoursRows(week) {
    // Agrupa días seguidos (empezando en lunes) con el mismo horario
    const order = [1, 2, 3, 4, 5, 6, 0];
    const key = (d) => (week[d] && week[d].open ? rangesTxt(week[d].ranges) : 'Cerrado');
    const runs = [];
    order.forEach((d) => {
      const last = runs[runs.length - 1];
      if (last && last.key === key(d)) last.days.push(d); else runs.push({ key: key(d), days: [d] });
    });
    const label = (ds) => cap(ds.length > 2 ? `${WD[ds[0]]} a ${WD[ds[ds.length - 1]]}` : ds.map((d) => WD[d]).join(' y '));
    return runs.map((r) => ({ days: label(r.days), hours: r.key }));
  }

  let mapIO = null;
  function renderPlace() {
    if (!bk.cfg) return;
    const L = bk.cfg.location || {};
    const addr = $('#placeAddress');
    const full = [L.address, L.city].filter(Boolean).join(', ');
    if (full) { addr.textContent = full; addr.classList.remove('is-pending'); } else addr.classList.add('is-pending');
    const notes = $('#placeNotes'); notes.hidden = !L.notes; notes.textContent = L.notes || '';
    const hasGeo = typeof L.lat === 'number' && typeof L.lng === 'number';
    const query = hasGeo ? `${L.lat},${L.lng}` : full;
    const open = L.mapsUrl || (query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : '');
    const dir = query ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(query)}` : '';
    const dl = $('#placeDirections'); dl.hidden = !dir; if (dir) dl.href = dir;
    const ol = $('#placeOpen'); ol.hidden = !open; if (open) ol.href = open;
    const ph = $('#placePhone'); ph.hidden = !L.phone;
    if (L.phone) { ph.textContent = 'Llamar al ' + L.phone; ph.href = 'tel:' + L.phone.replace(/[^\d+]/g, ''); }
    const map = $('#placeMap');
    map.hidden = !query;
    if (query && !map.firstChild && !mapIO) {
      const load = () => {
        map.innerHTML = `<iframe title="Mapa con la ubicación de la barbería" loading="lazy" referrerpolicy="no-referrer-when-downgrade"
          src="https://maps.google.com/maps?q=${encodeURIComponent(query)}&amp;z=17&amp;output=embed"></iframe>`;
      };
      if ('IntersectionObserver' in window) {
        mapIO = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) { mapIO.disconnect(); load(); } }, { rootMargin: '600px 0px' });
        mapIO.observe(map);
      } else load();
    }
    $('#placeHours').innerHTML = hoursRows(bk.cfg.schedule.week).map((r) => `<div><dt>${esc(r.days)}</dt><dd>${esc(r.hours)}</dd></div>`).join('');
    // Días sin servicio marcados en el panel (toda la barbería) que caen en días de apertura, los 3 próximos
    const closed = Object.keys(bk.days).filter((d) => bk.days[d].closed && (bk.cfg.schedule.week[parseD(d).getUTCDay()] || {}).open).sort().slice(0, 3);
    $('#placeClosed').hidden = !closed.length;
    $('#placeClosedList').innerHTML = closed.map((d) => `<li>${esc(cap(fmtLong(d)))}</li>`).join('');
    if (full) $('#footPlace').textContent = full + (L.phone ? ' · ' + L.phone : '');
  }

  /* ------------------------------------------------------------------
     Arranque
  ------------------------------------------------------------------ */
  renderServices();
  observeReveals($$('[data-reveal]'));
  initBooking();

  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', () => { measureCta(); onScroll(); });
  mqReduce.addEventListener('change', (e) => { reduce = e.matches; location.reload(); });
  if (document.fonts) document.fonts.ready.then(() => { measureCta(); onScroll(); });

  runIntro();
  onScroll();
})();
