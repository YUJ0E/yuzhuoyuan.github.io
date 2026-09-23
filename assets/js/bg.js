/* Light-blue point-field background on a plain 2D canvas, no libraries.
   A slowly orbiting cloud of soft splats (floor plane + a few clusters + dust) with
   mouse parallax and scroll drift, with robot arms working on the floor, humanoids
   walking around it and a couple of drones flying through it.
   Honours prefers-reduced-motion (one static frame) and pauses when the tab is hidden. */
(function () {
  var canvas = document.getElementById('bgCanvas');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');
  var reduceMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
  var coarse = window.matchMedia('(pointer: coarse)').matches;
  var DPR = Math.min(window.devicePixelRatio || 1, 2);

  // light-blue palette: deep navy, cobalt, sky
  var PALETTE = ['34,56,88', '46,118,190', '110,175,225'];
  var BASE_ALPHA = 0.6;

  var FLOOR = -2.4;
  var W = 0, H = 0, N = 760, pts = [], drones = [], arms = [], walkers = [], sprites = [], droneSprite = null;
  var mouse = { x: 0, y: 0, tx: 0, ty: 0 };
  var scroll = window.scrollY || 0;
  var t = 0, last = 0, raf = 0, running = false;

  function rand(a, b) { return a + Math.random() * (b - a); }
  function gauss() {
    var u = 0, v = 0;
    while (!u) u = Math.random();
    while (!v) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  function kind() { var r = Math.random(); return r < 0.15 ? 2 : (r < 0.55 ? 1 : 0); }
  function splat(x, y, z, s, k, e) { return { x: x, y: y, z: z, s: s, k: k, a: rand(0, Math.PI), e: e }; }

  function build() {
    var i, c, C = [];
    pts = [];
    for (i = 0; i < N * 0.42; i++) pts.push(splat(rand(-10, 10), FLOOR + gauss() * 0.1, rand(-7, 7), rand(0.6, 1.3), kind(), rand(0.45, 1)));
    for (i = 0; i < 6; i++) C.push({ x: rand(-7, 7), y: rand(-1.4, 0.9), z: rand(-5, 5), r: rand(0.6, 1.4) });
    for (i = 0; i < N * 0.43; i++) {
      c = C[i % C.length];
      pts.push(splat(c.x + gauss() * c.r * 0.6, c.y + gauss() * c.r * 0.7, c.z + gauss() * c.r * 0.6, rand(0.7, 1.6), kind(), rand(0.35, 1)));
    }
    for (i = 0; i < N * 0.15; i++) pts.push(splat(rand(-11, 11), rand(-3, 4), rand(-8, 8), rand(0.4, 0.9), 0, rand(0.6, 1)));

    drones = [];
    for (i = 0; i < 2; i++) {
      drones.push({
        ax: rand(4.5, 7.5), ay: rand(0.4, 1.1), az: rand(3, 5.5), oy: rand(-0.6, 1.2),
        fx: rand(0.14, 0.3), fy: rand(0.25, 0.5), fz: rand(0.12, 0.26),
        px: rand(0, 6.28), py: rand(0, 6.28), pz: rand(0, 6.28), trail: []
      });
    }

    // robot arms sit on the floor, spread around the scene
    arms = [];
    for (i = 0; i < 4; i++) {
      var ang = i * Math.PI / 2 + rand(-0.4, 0.4), rad = rand(4.5, 7);
      arms.push({ x: Math.cos(ang) * rad, z: Math.sin(ang) * rad, ph: rand(0, 6.28), f: rand(0.35, 0.6), flip: Math.random() < 0.5 ? -1 : 1 });
    }
    // humanoids walk slow elliptical laps on the floor
    walkers = [];
    for (i = 0; i < 3; i++) {
      var wk = { rx: rand(3, 6.5), rz: rand(2.5, 5), w: rand(0.035, 0.05) * (Math.random() < 0.5 ? -1 : 1), ph: rand(0, 6.28) };
      wk.gait = Math.abs(wk.w) * (wk.rx + wk.rz) / 2 / 0.13;          // step rate matched to ground speed so feet don't skate
      walkers.push(wk);
    }
  }

  function makeSprite(rgb) {
    var S = 64, c = document.createElement('canvas'); c.width = c.height = S;
    var g = c.getContext('2d'), grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grd.addColorStop(0, 'rgba(' + rgb + ',1)');
    grd.addColorStop(0.35, 'rgba(' + rgb + ',0.55)');
    grd.addColorStop(0.7, 'rgba(' + rgb + ',0.12)');
    grd.addColorStop(1, 'rgba(' + rgb + ',0)');
    g.fillStyle = grd; g.fillRect(0, 0, S, S);
    return c;
  }
  // top-down quadrotor, nose pointing up
  function makeDroneSprite(rgb) {
    var S = 64, m = S / 2, c = document.createElement('canvas'); c.width = c.height = S;
    var g = c.getContext('2d'), grd = g.createRadialGradient(m, m, 0, m, m, m);
    grd.addColorStop(0, 'rgba(' + rgb + ',0.3)'); grd.addColorStop(1, 'rgba(' + rgb + ',0)');
    g.fillStyle = grd; g.fillRect(0, 0, S, S);
    g.strokeStyle = g.fillStyle = 'rgba(' + rgb + ',1)';
    g.lineCap = 'round'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(m - 13, m - 13); g.lineTo(m + 13, m + 13); g.moveTo(m + 13, m - 13); g.lineTo(m - 13, m + 13); g.stroke();
    g.lineWidth = 2.6;
    [[-16, -16], [16, -16], [-16, 16], [16, 16]].forEach(function (p) {
      g.beginPath(); g.arc(m + p[0], m + p[1], 7, 0, Math.PI * 2); g.stroke();
    });
    g.beginPath(); g.arc(m, m, 5, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(m, m - 9, 2.4, 0, Math.PI * 2); g.fill();
    return c;
  }

  function resize() {
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (reduceMQ.matches || !running) draw(0);
  }

  function project(x, y, z, cam) {
    var rx = x * cam.cy - z * cam.sy, rz = x * cam.sy + z * cam.cy;
    var yy = y + cam.lift;
    var ry = yy * cam.cp - rz * cam.sp; rz = yy * cam.sp + rz * cam.cp;
    var d = cam.dist - rz;
    if (d < 1) return null;
    var s = cam.focal / d;
    return { x: W / 2 + rx * s, y: H / 2 - ry * s, s: s, d: d };
  }
  function dronePos(dr, tt) {
    return [dr.ax * Math.sin(dr.fx * tt + dr.px), dr.oy + dr.ay * Math.sin(dr.fy * tt + dr.py), dr.az * Math.sin(dr.fz * tt + dr.pz)];
  }

  function depthAlpha(q) { return Math.min(1, (q.d - 1) / 3) * Math.max(0.2, 1 - (q.d - 7) / 14); }
  function line(x1, y1, x2, y2) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
  function dot(x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }

  // 3-link manipulator seen from the side; angles are measured from straight up
  function drawArm(a, cam) {
    var q = project(a.x, FLOOR, a.z, cam);
    if (!q) return;
    var u = Math.min(q.s, 70), ph = t * a.f + a.ph, k = a.flip;
    var th1 = k * (0.35 + 0.35 * Math.sin(ph));
    var th2 = th1 + k * (1.0 + 0.45 * Math.sin(ph * 1.3 + 1));
    var th3 = th2 + k * (0.6 + 0.4 * Math.sin(ph * 1.7 + 2));
    var L1 = 0.62 * u, L2 = 0.5 * u, L3 = 0.16 * u;
    var x0 = q.x, y0 = q.y - 0.12 * u;
    var x1 = x0 + Math.sin(th1) * L1, y1 = y0 - Math.cos(th1) * L1;
    var x2 = x1 + Math.sin(th2) * L2, y2 = y1 - Math.cos(th2) * L2;
    var x3 = x2 + Math.sin(th3) * L3, y3 = y2 - Math.cos(th3) * L3;
    var grip = 0.05 * u * (1.2 + Math.sin(ph * 2));
    var nx = Math.cos(th3), ny = Math.sin(th3);

    ctx.globalAlpha = Math.min(1, BASE_ALPHA + 0.2) * depthAlpha(q);
    ctx.strokeStyle = ctx.fillStyle = 'rgba(' + PALETTE[0] + ',1)';
    ctx.lineCap = 'round';
    ctx.fillRect(q.x - 0.16 * u, q.y - 0.12 * u, 0.32 * u, 0.12 * u);          // base
    ctx.lineWidth = Math.max(2, 0.08 * u); line(x0, y0, x1, y1);
    ctx.lineWidth = Math.max(1.6, 0.065 * u); line(x1, y1, x2, y2);
    ctx.lineWidth = Math.max(1.2, 0.045 * u); line(x2, y2, x3, y3);
    line(x3 - nx * grip, y3 - ny * grip, x3 + nx * grip, y3 + ny * grip);       // gripper palm
    var fx = Math.sin(th3) * 0.1 * u, fy = -Math.cos(th3) * 0.1 * u;
    line(x3 - nx * grip, y3 - ny * grip, x3 - nx * grip + fx, y3 - ny * grip + fy);
    line(x3 + nx * grip, y3 + ny * grip, x3 + nx * grip + fx, y3 + ny * grip + fy);
    ctx.fillStyle = 'rgba(' + PALETTE[1] + ',1)';
    dot(x0, y0, 0.055 * u); dot(x1, y1, 0.05 * u); dot(x2, y2, 0.042 * u);
  }

  function box(x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
    ctx.fill();
  }

  // walking humanoid robot seen from the side: boxy head and torso, jointed limbs
  function drawWalker(w, cam) {
    var ang = t * w.w + w.ph;
    var px = Math.cos(ang) * w.rx, pz = Math.sin(ang) * w.rz;
    var q = project(px, FLOOR, pz, cam);
    var q2 = project(Math.cos(ang + w.w * 0.5) * w.rx, FLOOR, Math.sin(ang + w.w * 0.5) * w.rz, cam);
    if (!q || !q2) return;
    var u = Math.min(q.s, 70) * 1.25, dir = q2.x >= q.x ? 1 : -1, g = t * w.gait + w.ph * 3;
    var STRIDE = 0.32, L1 = 0.25 * u, L2 = 0.25 * u, FOOT = 0.025 * u;

    // thigh swings sinusoidally; the knee only bends while the leg swings forward (cos > 0),
    // the stance leg stays nearly straight
    function legAngles(p) {
      var a1 = STRIDE * Math.sin(p), c = Math.max(0, Math.cos(p));
      return [a1, a1 - 0.05 - 0.7 * c * c];
    }
    var la = legAngles(g), lb = legAngles(g + Math.PI);
    function reach(a) { return L1 * Math.cos(a[0]) + L2 * Math.cos(a[1]); }
    // hip height follows whichever foot is lower, so that foot stays planted on the floor
    var hx = q.x, hipY = q.y - FOOT - Math.max(reach(la), reach(lb));
    var tW = 0.24 * u, tH = 0.32 * u, tTop = hipY - 0.04 * u - tH, shY = tTop + 0.06 * u;
    var dark = 'rgba(' + PALETTE[0] + ',1)', mid = 'rgba(' + PALETTE[1] + ',1)', light = 'rgba(' + PALETTE[2] + ',1)';
    var alpha = Math.min(1, BASE_ALPHA + 0.25) * depthAlpha(q);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    // two-segment limb; returns the end point. Angles are from straight down, positive = forward.
    function limb(x, y, a1, a2, l1, l2, width, col) {
      var kx = x + Math.sin(a1) * l1 * dir, ky = y + Math.cos(a1) * l1;
      var ex = kx + Math.sin(a2) * l2 * dir, ey = ky + Math.cos(a2) * l2;
      ctx.strokeStyle = col; ctx.lineWidth = width;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(kx, ky); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.fillStyle = mid; dot(x, y, width * 0.45); dot(kx, ky, width * 0.4);
      return [ex, ey];
    }
    function leg(a, col) {
      var e = limb(hx, hipY, a[0], a[1], L1, L2, Math.max(2, 0.085 * u), col);
      ctx.fillStyle = col; box(e[0] - (dir > 0 ? 0.04 : 0.1) * u, e[1] - 0.02 * u, 0.14 * u, 0.045 * u, 0.015 * u);  // foot
    }
    // arms swing opposite to the leg on the same side, elbows slightly bent forward
    function arm(p, col) {
      var a1 = -0.28 * Math.sin(p), e = limb(hx, shY, a1, a1 + 0.3 + 0.1 * Math.max(0, -Math.sin(p)), 0.19 * u, 0.17 * u, Math.max(1.8, 0.07 * u), col);
      ctx.fillStyle = mid; dot(e[0], e[1], 0.035 * u);                                             // hand
    }

    ctx.globalAlpha = alpha * 0.7;                                   // far-side limbs, a bit fainter
    leg(lb, dark); arm(g + Math.PI, dark);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = dark;
    box(hx - 0.1 * u, hipY - 0.06 * u, 0.2 * u, 0.09 * u, 0.02 * u);                                // pelvis
    box(hx - tW / 2, tTop, tW, tH, 0.05 * u);                                                        // torso
    ctx.fillStyle = light;
    box(hx - tW / 2 + (dir > 0 ? tW * 0.45 : tW * 0.12), tTop + 0.08 * u, tW * 0.43, 0.09 * u, 0.02 * u);  // chest panel
    ctx.fillStyle = dark;
    box(hx - 0.03 * u, tTop - 0.06 * u, 0.06 * u, 0.07 * u, 0.01 * u);                               // neck
    var hW = 0.2 * u, hH = 0.17 * u, hTop = tTop - 0.05 * u - hH;
    box(hx - hW / 2, hTop, hW, hH, 0.045 * u);                                                       // head
    ctx.fillStyle = light;
    box(hx + (dir > 0 ? 0 : -hW / 2), hTop + 0.05 * u, hW / 2 + 0.01 * u, 0.05 * u, 0.02 * u);      // visor
    ctx.strokeStyle = dark; ctx.lineWidth = Math.max(1, 0.02 * u);
    line(hx, hTop, hx - dir * 0.03 * u, hTop - 0.07 * u);                                            // antenna
    ctx.fillStyle = mid; dot(hx - dir * 0.03 * u, hTop - 0.07 * u, 0.025 * u);
    leg(la, dark); arm(g, dark);
  }

  function draw(dt) {
    t += dt;
    mouse.x += (mouse.tx - mouse.x) * 0.04;
    mouse.y += (mouse.ty - mouse.y) * 0.04;
    var yaw = t * 0.04 + mouse.x * 0.28 + scroll * 0.0003;
    var pitch = -0.14 + mouse.y * 0.14;
    var cam = { cy: Math.cos(yaw), sy: Math.sin(yaw), cp: Math.cos(pitch), sp: Math.sin(pitch),
                dist: 11, focal: Math.max(420, Math.max(W, H) * 0.55), lift: scroll * 0.0011 };

    ctx.clearRect(0, 0, W, H);
    var out = [], i, j, p, q;
    for (i = 0; i < pts.length; i++) {
      p = pts[i];
      q = project(p.x, p.y, p.z, cam);
      if (!q || q.x < -40 || q.x > W + 40 || q.y < -40 || q.y > H + 40) continue;
      q.p = p;
      q.r = p.s * q.s * 0.06;
      q.a = BASE_ALPHA * Math.min(1, (q.d - 1) / 3) * Math.max(0.12, 1 - (q.d - 7) / 14);
      out.push(q);
    }
    out.sort(function (a, b) { return b.d - a.d; });
    for (i = 0; i < out.length; i++) {
      q = out[i]; p = q.p;
      ctx.globalAlpha = q.a;
      ctx.save();
      ctx.translate(q.x, q.y);
      ctx.rotate(p.a);
      ctx.scale(1, p.e);
      ctx.drawImage(sprites[p.k], -q.r, -q.r, q.r * 2, q.r * 2);
      ctx.restore();
    }

    for (j = 0; j < arms.length; j++) drawArm(arms[j], cam);
    for (j = 0; j < walkers.length; j++) drawWalker(walkers[j], cam);

    for (j = 0; j < drones.length; j++) {
      var dr = drones[j], pos = dronePos(dr, t), ahead = dronePos(dr, t + 0.12);
      dr.trail.push(pos); if (dr.trail.length > 40) dr.trail.shift();
      for (i = 0; i < dr.trail.length; i++) {
        q = project(dr.trail[i][0], dr.trail[i][1], dr.trail[i][2], cam);
        if (!q) continue;
        var f = i / dr.trail.length, r = (0.4 + 1.2 * f) * q.s * 0.06;
        ctx.globalAlpha = BASE_ALPHA * f * 0.55;
        ctx.drawImage(sprites[2], q.x - r, q.y - r, r * 2, r * 2);
      }
      q = project(pos[0], pos[1], pos[2], cam);
      var q2 = project(ahead[0], ahead[1], ahead[2], cam);
      if (!q || !q2) continue;
      var half = Math.min(26, Math.max(8, 0.26 * q.s));
      ctx.globalAlpha = Math.min(1, BASE_ALPHA + 0.25) * Math.min(1, (q.d - 1) / 3);
      ctx.save();
      ctx.translate(q.x, q.y);
      ctx.rotate(Math.atan2(q2.y - q.y, q2.x - q.x) + Math.PI / 2);
      ctx.drawImage(droneSprite, -half, -half, half * 2, half * 2);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function frame(now) {
    var dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
    last = now;
    draw(dt);
    raf = requestAnimationFrame(frame);
  }
  function start() { if (running || reduceMQ.matches) return; running = true; last = 0; raf = requestAnimationFrame(frame); }
  function stop() { running = false; cancelAnimationFrame(raf); }

  window.addEventListener('resize', resize, { passive: true });
  window.addEventListener('scroll', function () { scroll = window.scrollY || 0; }, { passive: true });
  if (!coarse) {
    window.addEventListener('pointermove', function (e) {
      mouse.tx = e.clientX / W - 0.5; mouse.ty = e.clientY / H - 0.5;
    }, { passive: true });
  }
  document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); else start(); });
  reduceMQ.addEventListener('change', function () { if (reduceMQ.matches) { stop(); draw(0); } else start(); });

  build();
  sprites = PALETTE.map(makeSprite);
  droneSprite = makeDroneSprite(PALETTE[1]);
  resize();
  start();
})();
