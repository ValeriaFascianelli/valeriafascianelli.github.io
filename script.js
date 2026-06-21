/* ════════════════════════════════════════════════
   Valeria Fascianelli — Website Script
   ════════════════════════════════════════════════ */

/* ── NEURAL CANVAS ── */
(function () {
  var canvas = document.getElementById('neuralCanvas');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');

  var W, H, neurons, pulses, connections, frame;
  var COUNT = 38;

  function rnd(a, b) { return a + Math.random() * (b - a); }

  /* 4-level dendrite tree with tapering width + dendritic spines */
  function addBranch(segs, x, y, angle, len, depth, maxDepth) {
    if (depth === 0 || len < 3.5) return;
    var a  = angle + rnd(-0.09, 0.09);          /* organic drift per segment */
    var ex = x + Math.cos(a) * len;
    var ey = y + Math.sin(a) * len;
    var w  = 0.12 + (depth / maxDepth) * 1.05;  /* thick near soma, thin at tips */
    segs.push({ x1: x, y1: y, x2: ex, y2: ey, w: w });

    /* dendritic spines on outer 2 levels */
    if (depth <= 2 && Math.random() > 0.48) {
      var spDir = a + (Math.random() > 0.5 ? 1 : -1) * rnd(1.1, 1.9);
      var sl    = rnd(3, 6);
      segs.push({
        x1: ex, y1: ey,
        x2: ex + Math.cos(spDir) * sl,
        y2: ey + Math.sin(spDir) * sl,
        w: 0.22, spine: true,
        hx: ex + Math.cos(spDir) * (sl + 1.2),
        hy: ey + Math.sin(spDir) * (sl + 1.2),
      });
    }

    var spread = rnd(0.30, 0.52);
    var decay  = rnd(0.60, 0.70);
    addBranch(segs, ex, ey, a - spread, len * decay, depth - 1, maxDepth);
    addBranch(segs, ex, ey, a + spread, len * decay, depth - 1, maxDepth);
    /* occasional trifurcation */
    if (Math.random() > 0.70 && depth >= 3) {
      addBranch(segs, ex, ey, a + rnd(-0.85, 0.85), len * decay * 0.65, depth - 2, maxDepth);
    }
  }

  /* Axon: long thin polyline + terminal arborisation */
  function makeAxon(axonAngle) {
    var pts = [{ x: 0, y: 0 }];
    var ax = 0, ay = 0, dir = axonAngle;
    var totalLen = rnd(110, 175);
    var steps = 9;
    for (var s = 0; s < steps; s++) {
      dir += rnd(-0.11, 0.11);
      ax  += Math.cos(dir) * (totalLen / steps);
      ay  += Math.sin(dir) * (totalLen / steps);
      pts.push({ x: ax, y: ay });
    }
    var last = pts[pts.length - 1];
    var termSegs = [], termPts = [];
    var nT = Math.floor(rnd(2, 4));
    for (var t = 0; t < nT; t++) {
      var ta = dir + (t - (nT - 1) / 2) * 0.48;
      var tl = rnd(10, 18);
      var tx = last.x + Math.cos(ta) * tl;
      var ty = last.y + Math.sin(ta) * tl;
      termSegs.push({ x1: last.x, y1: last.y, x2: tx, y2: ty, w: 0.3 });
      termPts.push({ x: tx, y: ty });
    }
    return { pts: pts, termSegs: termSegs, termPts: termPts };
  }

  function makeNeuron(x, y) {
    var axonAngle = rnd(0, Math.PI * 2);
    var DEPTH = 4;

    /* 4-6 primary dendrites, spread evenly, clear of axon cone */
    var dSegs = [];
    var nDend = Math.floor(rnd(4, 7));
    for (var i = 0; i < nDend; i++) {
      var a    = (i / nDend) * Math.PI * 2 + rnd(-0.28, 0.28);
      var diff = Math.abs(((a - axonAngle) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI);
      if (diff < 0.78) continue;
      addBranch(dSegs, 0, 0, a, rnd(34, 50), DEPTH, DEPTH);
    }

    return {
      x: x, y: y,
      vx: rnd(-0.18, 0.18), vy: rnd(-0.14, 0.14),
      r:  rnd(5, 7.5),
      dSegs: dSegs,
      axon: makeAxon(axonAngle),
      pot: rnd(0, 0.25),
      state: 'resting',
      refTimer: 0,
      glow: 0,
      dGlow: 0,
    };
  }

  /* Connect axon terminals to nearby somas */
  function buildConnections() {
    connections = [];
    for (var i = 0; i < neurons.length; i++) {
      var ni = neurons[i];
      ni.axon.termPts.forEach(function (tp) {
        var tx = ni.x + tp.x, ty = ni.y + tp.y;
        var bestJ = -1, bestD = 70;
        for (var j = 0; j < neurons.length; j++) {
          if (i === j) continue;
          var dx = tx - neurons[j].x, dy = ty - neurons[j].y;
          var d = Math.sqrt(dx * dx + dy * dy);
          if (d < bestD) { bestD = d; bestJ = j; }
        }
        if (bestJ >= 0) connections.push({ from: i, to: bestJ });
      });
    }
  }

  function fire(idx) {
    var n = neurons[idx];
    if (n.state !== 'resting') return;
    n.state = 'firing'; n.glow = 1.0; n.pot = 0; n.refTimer = 38;
    connections.forEach(function (c) {
      if (c.from === idx) pulses.push({ from: idx, to: c.to, t: 0 });
    });
  }

  /* Position along axon polyline at parameter t ∈ [0,1] */
  function axonPt(n, t) {
    var pts = n.axon.pts, total = pts.length - 1;
    var seg = t * total, i = Math.min(Math.floor(seg), total - 1), f = seg - i;
    return {
      x: n.x + pts[i].x + (pts[i + 1].x - pts[i].x) * f,
      y: n.y + pts[i].y + (pts[i + 1].y - pts[i].y) * f,
    };
  }

  /* ── Update ── */
  function update() {
    /* periodic burst — less frequent on mobile */
    var burstEvery = W < 600 ? 220 : 90;
    var burstSize  = W < 600 ? 2   : Math.floor(rnd(5, 9));
    if (frame % burstEvery === 0) {
      for (var s = 0; s < burstSize; s++) {
        var si = Math.floor(Math.random() * neurons.length);
        if (neurons[si].state === 'resting') neurons[si].pot = 0.75;
      }
    }

    neurons.forEach(function (n, idx) {
      n.x += n.vx; n.y += n.vy;
      if (n.x < -80)    n.x = W + 80;
      if (n.x > W + 80) n.x = -80;
      if (n.y < -80)    n.y = H + 80;
      if (n.y > H + 80) n.y = -80;

      n.glow  = Math.max(0, n.glow  - 0.013);
      n.dGlow = Math.max(0, n.dGlow - 0.018); /* dendritic flash */

      if (n.state === 'firing') {
        n.state = 'refractory';
      } else if (n.state === 'refractory') {
        if (--n.refTimer <= 0) { n.state = 'resting'; n.pot = 0; }
      } else {
        n.pot *= 0.993;
        var spontRate = W < 600 ? 0.0006 : 0.003;
        if (Math.random() < spontRate) n.pot = 0.65; /* spontaneous depolarisation */
        if (n.pot >= 0.65) fire(idx);
      }
    });

    for (var k = pulses.length - 1; k >= 0; k--) {
      pulses[k].t += W < 600 ? 0.010 : 0.018;
      if (pulses[k].t >= 1) {
        var tgt = neurons[pulses[k].to];
        if (tgt.state === 'resting') {
          tgt.pot   = Math.min(1, tgt.pot + 0.55);
          tgt.dGlow = 0.8; /* dendritic flash on signal receipt */
        }
        pulses.splice(k, 1);
      }
    }

    if (frame % 120 === 0) buildConnections();
    frame++;
  }

  /* ── Draw segments helper (handles spines with bulb heads) ── */
  function drawSegs(segs, nx, ny, alpha) {
    segs.forEach(function (s) {
      ctx.beginPath();
      ctx.moveTo(nx + s.x1, ny + s.y1);
      ctx.lineTo(nx + s.x2, ny + s.y2);
      ctx.strokeStyle = 'rgba(155, 145, 255, ' + alpha + ')';
      ctx.lineWidth = s.w;
      ctx.stroke();
      /* spine head bulb */
      if (s.spine && s.hx !== undefined) {
        ctx.beginPath();
        ctx.arc(nx + s.hx, ny + s.hy, 1.4, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(195, 185, 255, ' + (alpha * 0.85) + ')';
        ctx.fill();
      }
    });
  }

  /* ── Draw ── */
  function draw() {
    ctx.clearRect(0, 0, W, H);

    /* pre-compute which neurons are actively transmitting */
    var transmitting = {};
    pulses.forEach(function (p) { transmitting[p.from] = true; });

    neurons.forEach(function (n, idx) {
      var act    = n.glow + n.pot * 0.4;
      var axGlow = transmitting[idx] ? 0.75 : 0;
      var dAlpha = Math.min(0.38 + act * 0.22 + n.dGlow * 0.42, 0.85);
      var aAlpha = Math.min(0.38 + act * 0.22 + axGlow * 0.40, 0.88);

      /* dendrites — flash brighter on signal receipt */
      drawSegs(n.dSegs, n.x, n.y, dAlpha);

      /* axon trunk — glows when transmitting */
      var pts = n.axon.pts;
      ctx.beginPath();
      ctx.moveTo(n.x + pts[0].x, n.y + pts[0].y);
      for (var i = 1; i < pts.length; i++) ctx.lineTo(n.x + pts[i].x, n.y + pts[i].y);
      ctx.strokeStyle = 'rgba(175, 165, 255, ' + aAlpha + ')';
      ctx.lineWidth = 0.7 + axGlow * 0.6;
      ctx.stroke();

      /* axon terminal branches */
      drawSegs(n.axon.termSegs, n.x, n.y, aAlpha);

      /* terminal boutons */
      n.axon.termPts.forEach(function (tp) {
        ctx.beginPath();
        ctx.arc(n.x + tp.x, n.y + tp.y, 1.8 + axGlow, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(200, 190, 255, ' + (0.55 + act * 0.35 + axGlow * 0.3) + ')';
        ctx.fill();
      });

      /* soma halo on fire */
      if (n.glow > 0.1) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r * (1 + n.glow * 2.8), 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(200, 185, 255, ' + n.glow * 0.20 + ')';
        ctx.fill();
      }

      /* soma — colour encodes state */
      var r, g, b, a;
      if (n.glow > 0.65) {
        r = 242; g = 235; b = 255; a = 0.97;
      } else if (n.state === 'refractory') {
        r = 68; g = 58; b = 132; a = 0.46 + n.glow * 0.25;
      } else {
        var p = n.pot;
        r = Math.round(148 + p * 85); g = Math.round(138 + p * 75); b = 255;
        a = 0.60 + p * 0.35 + n.glow * 0.30;
      }
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r + n.glow * 4, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
      ctx.fill();
    });

    /* action potential pulses — comet with radial glow */
    pulses.forEach(function (p) {
      var pt  = axonPt(neurons[p.from], p.t);

      /* trail — #7c74f5 fading */
      for (var ti = 1; ti <= 5; ti++) {
        var tBack = Math.max(0, p.t - ti * 0.028);
        var tp    = axonPt(neurons[p.from], tBack);
        var ta    = (1 - ti / 6) * 0.35;
        var tr    = 2.6 - ti * 0.35;
        if (tr < 0.3) break;
        ctx.beginPath();
        ctx.arc(tp.x, tp.y, tr, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(124, 116, 245, ' + ta + ')';
        ctx.fill();
      }

      /* outer halo — gradient #7c74f5 → #a78bfa */
      var grad = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, 13);
      grad.addColorStop(0,   'rgba(167, 139, 250, 0.55)');
      grad.addColorStop(0.5, 'rgba(124, 116, 245, 0.20)');
      grad.addColorStop(1,   'rgba(100,  90, 230, 0)');
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 13, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();

      /* mid ring */
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(167, 139, 250, 0.75)';
      ctx.fill();

      /* core #a78bfa */
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 2.2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(167, 139, 250, 1)';
      ctx.fill();
    });
  }

  /* Grid-with-jitter placement: evenly tiled cells, neuron at random offset
     within each cell → no clumps, no empty patches, still organic */
  function placeNeurons() {
    var cols = Math.round(Math.sqrt(COUNT * W / H));
    var rows = Math.ceil(COUNT / cols);
    var cellW = W / cols;
    var cellH = H / rows;
    var pad  = 0.28; /* jitter = ±28% of cell size */

    /* build all cell indices, shuffle, pick COUNT */
    var cells = [];
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) cells.push({ r: r, c: c });
    }
    for (var i = cells.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = cells[i]; cells[i] = cells[j]; cells[j] = tmp;
    }
    cells = cells.slice(0, COUNT);

    return cells.map(function (cell) {
      var cx = (cell.c + 0.5) * cellW + rnd(-cellW * pad, cellW * pad);
      var cy = (cell.r + 0.5) * cellH + rnd(-cellH * pad, cellH * pad);
      cx = Math.max(60, Math.min(W - 60, cx));
      cy = Math.max(60, Math.min(H - 60, cy));
      return makeNeuron(cx, cy);
    });
  }

  function resize() {
    W = canvas.width = canvas.offsetWidth;
    H = canvas.height = canvas.offsetHeight;
    neurons = placeNeurons();
    buildConnections();
    pulses = [];
    frame = 0;
  }

  function loop() { update(); draw(); requestAnimationFrame(loop); }

  resize();
  loop();

  /* ── Mouse interaction ── */
  var lastStim = 0;
  document.addEventListener('mousemove', function (e) {
    var rect = canvas.getBoundingClientRect();
    var mx = e.clientX - rect.left;
    var my = e.clientY - rect.top;

    /* only active when cursor is inside the hero canvas */
    if (mx < 0 || mx > W || my < 0 || my > H) return;

    /* throttle: one stimulation every 70 ms */
    var now = Date.now();
    if (now - lastStim < 70) return;
    lastStim = now;

    /* fire the closest resting neuron + depolarise those within 110 px */
    var closestIdx = -1, closestD = Infinity;
    neurons.forEach(function (n, i) {
      var dx = n.x - mx, dy = n.y - my;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d < 110 && n.state === 'resting') n.pot = 0.75;
      if (d < closestD) { closestD = d; closestIdx = i; }
    });
    if (closestIdx >= 0 && closestD < 140 && neurons[closestIdx].state === 'resting') {
      fire(closestIdx);
    }
  });

  var _rt;
  window.addEventListener('resize', function () { clearTimeout(_rt); _rt = setTimeout(resize, 200); });
})();

/* ── SCROLL PROGRESS + NAVBAR ── */
(function () {
  const nav      = document.getElementById('nav');
  const progress = document.getElementById('scrollProgress');

  window.addEventListener('scroll', () => {
    const scrolled = window.scrollY;
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;

    if (nav)      nav.classList.toggle('scrolled', scrolled > 40);
    if (progress) progress.style.width = (scrolled / maxScroll * 100) + '%';
  }, { passive: true });
})();

/* ── MOBILE MENU ── */
(function () {
  const burger = document.getElementById('navBurger');
  const menu   = document.getElementById('navLinks');
  if (!burger || !menu) return;

  burger.addEventListener('click', () => {
    const open = menu.classList.toggle('open');
    const [s1, s2, s3] = burger.querySelectorAll('span');
    if (open) {
      s1.style.transform = 'translateY(6.5px) rotate(45deg)';
      s2.style.opacity   = '0';
      s3.style.transform = 'translateY(-6.5px) rotate(-45deg)';
    } else {
      [s1, s2, s3].forEach(s => { s.style.transform = ''; s.style.opacity = ''; });
    }
  });

  menu.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', () => {
      menu.classList.remove('open');
      burger.querySelectorAll('span').forEach(s => { s.style.transform = ''; s.style.opacity = ''; });
    });
  });
})();

/* ── SCROLL REVEAL ── */
(function () {
  const els = document.querySelectorAll('.reveal');
  if (!els.length) return;

  const io = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add('visible');
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -30px 0px' });

  els.forEach(el => io.observe(el));
})();

/* ── STAGGER LIST ITEMS ── */
(function () {
  const containers = document.querySelectorAll('.pub-list, .edu-list, .cv-entries');

  const io = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      const items = e.target.children;
      Array.from(items).forEach((item, i) => {
        item.style.opacity    = '0';
        item.style.transform  = 'translateY(14px)';
        item.style.transition = `opacity 0.45s ease ${i * 0.06}s, transform 0.45s ease ${i * 0.06}s`;
        requestAnimationFrame(() => {
          item.style.opacity   = '1';
          item.style.transform = 'translateY(0)';
        });
      });
      io.unobserve(e.target);
    });
  }, { threshold: 0.08 });

  containers.forEach(c => io.observe(c));
})();

/* ── PARALLAX BLOBS ── */
(function () {
  const about = document.querySelector('.about');
  if (!about) return;

  const b1 = about.querySelector('::before');

  window.addEventListener('scroll', () => {
    const rect   = about.getBoundingClientRect();
    const center = rect.top + rect.height / 2;
    const offset = (window.innerHeight / 2 - center) * 0.06;
    about.style.setProperty('--blob-offset', offset + 'px');
  }, { passive: true });
})();

/* ── STAGGER ABOUT PARAGRAPHS ── */
(function () {
  const paras = document.querySelectorAll('.about-copy p');
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      paras.forEach((p, i) => {
        p.style.opacity   = '0';
        p.style.transform = 'translateY(16px)';
        p.style.transition = `opacity 0.5s ease ${0.1 + i * 0.12}s, transform 0.5s ease ${0.1 + i * 0.12}s`;
        requestAnimationFrame(() => {
          p.style.opacity   = '1';
          p.style.transform = 'translateY(0)';
        });
      });
      io.unobserve(e.target);
    });
  }, { threshold: 0.15 });

  const copy = document.querySelector('.about-copy');
  if (copy) io.observe(copy);
})();

/* ── LIGHTBOX ── */
(function () {
  const lb      = document.getElementById('lightbox');
  const lbImg   = document.getElementById('lightboxImg');
  const lbCap   = document.getElementById('lightboxCaption');
  if (!lb) return;

  function openLB(src, alt, cap) {
    lbImg.src             = src;
    lbImg.alt             = alt;
    lbCap.textContent     = cap;
    lb.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeLB() {
    lb.classList.remove('open');
    document.body.style.overflow = '';
    setTimeout(() => { lbImg.src = ''; }, 300);
  }

  /* attach click to each figure */
  document.querySelectorAll('.hl-fig').forEach(function (fig) {
    var img = fig.querySelector('img');
    var cap = fig.querySelector('figcaption');
    if (!img) return;
    fig.style.cursor = 'zoom-in';
    fig.addEventListener('click', function () {
      openLB(img.src, img.alt, cap ? cap.textContent : '');
    });
  });

  document.getElementById('lightboxClose').addEventListener('click', closeLB);
  document.getElementById('lightboxBackdrop').addEventListener('click', closeLB);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeLB();
  });
})();

/* ── SMOOTH SCROLL ── */
(function () {
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', e => {
      const target = document.querySelector(a.getAttribute('href'));
      if (!target) return;
      e.preventDefault();
      const offset = parseInt(
        getComputedStyle(document.documentElement).getPropertyValue('--nav-h')
      ) || 64;
      window.scrollTo({ top: target.offsetTop - offset, behavior: 'smooth' });
    });
  });
})();
