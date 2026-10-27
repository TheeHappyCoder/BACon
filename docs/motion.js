// Scroll motion for both pages (GSAP + ScrollTrigger), loaded after each page's own script so the rows it builds
// exist. <body data-motion="bacon"> reads like a device answering: text decodes, a broadcast ripples, headings are
// wiped in by a lime scan, the console is scanned. <body data-motion="rasher"> sizzles: sparks rise, words drop into
// the pan, and the "breaks" half glitches now and then. Reduced motion, or no GSAP, keeps the plain reveal.
;(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduce || !window.gsap || !window.ScrollTrigger) return
  gsap.registerPlugin(ScrollTrigger)
  if (window.lenis) window.lenis.on('scroll', ScrollTrigger.update)
  const flavour = document.body.dataset.motion || 'bacon'
  const $ = (s, root = document) => [...root.querySelectorAll(s)]
  // elements GSAP animates leave the CSS reveal, so the two never fight over opacity and transform
  const take = (els) => { for (const el of els) { el.classList.remove('reveal'); el.style.transitionDelay = '' } return els }
  const on = (trigger, start = 'top 80%') => ({ trigger, start })

  // split text into spans, keeping the italic part italic; `unit` is 'w' (words) or 'c' (characters)
  function split(el, unit) {
    const walk = (node) => {
      for (const n of [...node.childNodes]) {
        if (n.nodeType === 1) { walk(n); continue }
        if (n.nodeType !== 3) continue
        const frag = document.createDocumentFragment()
        for (const word of n.textContent.split(/(\s+)/)) {
          if (!word) continue
          if (/^\s+$/.test(word)) { frag.append(word); continue }
          const w = document.createElement('span')
          w.className = 'm-w'
          w.innerHTML = unit === 'c' ? [...word].map((c) => `<span class="m-c">${c}</span>`).join('') : `<span class="m-in">${word}</span>`
          frag.append(w)
        }
        n.replaceWith(frag)
      }
    }
    walk(el)
    return $(unit === 'c' ? '.m-c' : '.m-in', el)
  }

  // a heading decoded like a value coming off the wire: each character cycles through glyphs, then settles
  function decode(el, { delay = 0, step = 0.028, spin = 0.45 } = {}) {
    const chars = split(el, 'c')
    const finals = chars.map((c) => c.textContent)
    const GLYPHS = '01#%&*+=<>/ABCDEF'
    chars.forEach((c) => { c.style.opacity = '0' })
    const t0 = performance.now() + delay * 1000
    const tick = (now) => {
      const t = (now - t0) / 1000
      let done = true
      chars.forEach((c, i) => {
        const s = i * step
        if (t < s) { done = false; return }
        c.style.opacity = '1'
        if (t < s + spin) { done = false; c.textContent = GLYPHS[(Math.random() * GLYPHS.length) | 0]; c.classList.add('m-hot') }
        else if (c.classList.contains('m-hot')) { c.textContent = finals[i]; c.classList.remove('m-hot') }
      })
      if (!done) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }

  // ---- the hero: shared bones, different personalities ----
  const hero = document.querySelector('.hero')
  const rim = hero?.querySelector('.hero-shot .rim')
  if (hero) {
    const h1 = hero.querySelector('h1')
    h1.style.animation = 'none'
    if (flavour === 'bacon') {
      decode(h1, { delay: 0.15 })
      // the app is revealed from the bottom up as a clip, then tips flat as you scroll
      gsap.fromTo(rim, { clipPath: 'inset(100% 0% 0% 0% round 22px 22px 0 0)' }, { clipPath: 'inset(0% 0% 0% 0% round 22px 22px 0 0)', duration: 1.2, ease: 'expo.out', delay: 0.2 })
      gsap.fromTo(rim, { scale: 0.92, y: 40 }, { scale: 1, y: 0, ease: 'none', scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: 0.5 } })
    } else {
      // words drop into the pan and bounce
      gsap.from(split(h1, 'w'), { y: -140, rotate: () => gsap.utils.random(-14, 14), opacity: 0, duration: 1.2, ease: 'bounce.out', stagger: 0.09, delay: 0.1 })
      // sparks rise off the app's top edge, like fat spitting in the pan
      const sparks = document.createElement('div')
      sparks.className = 'm-sparks'
      for (let i = 0; i < 28; i++) sparks.append(document.createElement('i'))
      hero.insertBefore(sparks, hero.firstChild)
      for (const s of sparks.children) {
        const go = () => {
          const d = gsap.utils.random(1.6, 3)
          gsap.timeline({ delay: gsap.utils.random(0, 2.5), onComplete: go })
            .fromTo(s, { x: gsap.utils.random(-480, 480), y: 0, scale: gsap.utils.random(0.4, 1.2), opacity: 0 }, { x: `+=${gsap.utils.random(-60, 60)}`, y: gsap.utils.random(-260, -420), duration: d, ease: 'power1.out' })
            .to(s, { opacity: 1, duration: d * 0.2 }, 0)
            .to(s, { opacity: 0, duration: d * 0.4 }, d * 0.6)
        }
        go()
      }
      // the app lands with a wobble, then leans back as you scroll past
      gsap.from(rim, { y: 120, rotate: -2, duration: 1.4, ease: 'elastic.out(1, 0.6)', delay: 0.3 })
      // the perspective is set before anything moves, so the tilt starts from nothing instead of snapping in
      gsap.set(rim, { transformPerspective: 1600, transformOrigin: '50% 0%' })
      gsap.fromTo(rim, { rotateX: 0 }, { rotateX: 9, ease: 'power1.in', scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: 1.2 } })
    }
    gsap.to(hero, { backgroundPositionY: '35%', ease: 'none', scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: true } })
    gsap.to(hero.querySelector('.hero-copy'), { y: -100, opacity: 0, ease: 'none', scrollTrigger: { trigger: hero, start: 'top top', end: '60% top', scrub: true } })
  }

  // ---- section heads ----
  for (const head of take($('.head'))) {
    const h2 = head.querySelector('h2'), p = head.querySelector('p'), badge = head.querySelector('.badge')
    const tl = gsap.timeline({ scrollTrigger: on(head, 'top 85%') })
    if (flavour === 'bacon') {
      // a lime bar sweeps across and leaves the line behind it
      const wrap = document.createElement('span')
      wrap.className = 'm-wipe'
      wrap.innerHTML = h2.innerHTML
      h2.innerHTML = ''
      h2.append(wrap)
      const bar = document.createElement('span')
      bar.className = 'm-bar'
      h2.classList.add('m-wiped')
      h2.append(bar)
      tl.from(badge, { opacity: 0, y: 8, duration: 0.4 })
        .fromTo(bar, { scaleX: 0, transformOrigin: '0% 50%' }, { scaleX: 1, duration: 0.5, ease: 'power3.in' })
        .set(wrap, { '--shown': 1 })
        .to(bar, { scaleX: 0, transformOrigin: '100% 50%', duration: 0.55, ease: 'power3.out' })
      if (p) tl.from(p, { opacity: 0, y: 12, duration: 0.6, ease: 'power2.out' }, '-=0.3')
    } else {
      tl.from(badge, { scale: 0, rotate: -20, duration: 0.6, ease: 'back.out(3)' })
        .from(split(h2, 'w'), { y: -60, opacity: 0, rotate: () => gsap.utils.random(-8, 8), duration: 0.9, ease: 'bounce.out', stagger: 0.06 }, '-=0.2')
      if (p) tl.from(p, { opacity: 0, y: 12, duration: 0.6 }, '-=0.5')
    }
  }

  // ---- every sky drifts behind what sits on it ----
  for (const el of $('.sky-panel, .tile.sky, .device .shot')) {
    gsap.fromTo(el, { backgroundPositionY: '15%' }, { backgroundPositionY: '85%', ease: 'none', scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom top', scrub: true } })
  }

  // ---- the showcase: the app opens like a lens from the tabs' side, the tabs tick in ----
  for (const sc of take($('.showcase'))) {
    const tl = gsap.timeline({ scrollTrigger: on(sc) })
    tl.fromTo(sc, { clipPath: 'inset(10% 10% 10% 10% round 60px)', opacity: 0 }, { clipPath: 'inset(0% 0% 0% 0% round 28px)', opacity: 1, duration: 1.1, ease: 'expo.out', clearProps: 'clipPath' })
      .from($('.tab', sc), { x: -24, opacity: 0, duration: 0.5, stagger: 0.06, ease: 'power3.out' }, '-=0.7')
      .fromTo(sc.querySelector('.stage'), { clipPath: 'circle(0% at 0% 50%)' }, { clipPath: 'circle(150% at 0% 50%)', duration: 1.2, ease: 'expo.inOut', clearProps: 'clipPath' }, '<')
  }

  // ---- BACon: bento flips down, the console is scanned, the writes are ticked off ----
  if (flavour === 'bacon') {
    const bento = document.querySelector('.bento')
    if (bento) {
      const tiles = take($(':scope > .tile', bento))
      gsap.from(tiles, { rotateX: -70, transformPerspective: 1200, transformOrigin: '50% 0%', opacity: 0, duration: 1.1, ease: 'expo.out', stagger: 0.12, scrollTrigger: on(bento) })
      gsap.from($('.fact', bento), { x: 40, opacity: 0, duration: 0.7, ease: 'power3.out', stagger: 0.1, delay: 0.4, scrollTrigger: on(bento) })
    }
    for (const c of take($('.console'))) {
      const scan = document.createElement('span')
      scan.className = 'm-scan'
      c.append(scan)
      const rows = $('.qrow', c)
      const tl = gsap.timeline({ scrollTrigger: on(c) })
      tl.from(c, { y: 50, opacity: 0, duration: 0.8, ease: 'expo.out' })
        .set(rows, { opacity: 0.18 })
        .fromTo(scan, { top: 0, opacity: 1 }, { top: '100%', duration: 1.6, ease: 'power1.inOut' })
        .to(rows, { opacity: 1, duration: 0.25, stagger: 1.6 / Math.max(rows.length, 1) }, '<0.15')
        .to(scan, { opacity: 0, duration: 0.3 })
      // a row lights its dot as the pointer passes, like a point answering
      for (const r of rows) r.addEventListener('pointerenter', () => gsap.fromTo(r.querySelector('.what i'), { scale: 2.6 }, { scale: 1, duration: 0.6, ease: 'elastic.out(1, 0.4)' }))
    }
    for (const s of take($('.split'))) {
      const ticks = $('.op .ic path', s)
      gsap.set(ticks, { strokeDasharray: 24 })
      const tl = gsap.timeline({ scrollTrigger: on(s) })
      tl.from(s, { y: 50, opacity: 0, duration: 0.8, ease: 'expo.out' })
        .from($('.op', s), { opacity: 0, x: -16, duration: 0.45, stagger: 0.08, ease: 'power2.out' }, '-=0.4')
        .from($('.op .ic', s), { scale: 0, duration: 0.5, stagger: 0.08, ease: 'back.out(3)' }, '<')
        // each tick is drawn, like a write read back
        .from(ticks, { strokeDashoffset: 24, duration: 0.5, stagger: 0.08, ease: 'power2.out' }, '<0.15')
    }
    // the Rasher faces are dealt out from one pile; their CSS fan and hover take over once they land
    for (const faces of $('.faces')) {
      const cards = $('.rim', faces)
      cards.forEach((c) => { c.style.transition = 'none' })
      gsap.from(cards, { x: (i) => (1 - i) * 120, y: 80, rotate: (i) => (i - 1) * -18, opacity: 0, duration: 1.1, ease: 'expo.out', stagger: 0.1, clearProps: 'transform', scrollTrigger: on(faces),
        onComplete: () => cards.forEach((c) => { c.style.transition = '' }) })
    }
  }

  // ---- Rasher: devices are served, the coverage pops from the centre, and the breaks half glitches ----
  if (flavour === 'rasher') {
    for (const group of $('.devices')) {
      const cards = take($('.device', group))
      gsap.from(cards, { y: 120, rotate: (i) => (i - 1) * 6, opacity: 0, duration: 1.1, ease: 'back.out(1.3)', stagger: 0.12, scrollTrigger: on(group) })
      for (const card of cards) {
        gsap.to(card.querySelector('.shot img'), { y: -6, duration: 2.4, ease: 'sine.inOut', yoyo: true, repeat: -1, delay: Math.random() })
        const ry = gsap.quickTo(card, 'rotationY', { duration: 0.6, ease: 'power3.out' }), rx = gsap.quickTo(card, 'rotationX', { duration: 0.6, ease: 'power3.out' })
        gsap.set(card, { transformPerspective: 1000 })
        card.addEventListener('pointermove', (e) => { const r = card.getBoundingClientRect(); ry(((e.clientX - r.left) / r.width - 0.5) * 10); rx(-((e.clientY - r.top) / r.height - 0.5) * 8) })
        card.addEventListener('pointerleave', () => { rx(0); ry(0) })
      }
    }
    for (const grid of $('.coverage')) {
      gsap.from(take($('.tile', grid)), { scale: 0.6, opacity: 0, duration: 0.8, ease: 'back.out(1.8)', stagger: { each: 0.08, from: 'center', grid: 'auto' }, scrollTrigger: on(grid) })
    }
    for (const s of take($('.split'))) {
      const calm = s.querySelector('.half.yes'), broke = s.querySelector('.half.no')
      const tl = gsap.timeline({ scrollTrigger: on(s) })
      tl.from(s, { y: 50, opacity: 0, duration: 0.8, ease: 'expo.out' })
        .from($('.op', calm), { opacity: 0, y: 12, duration: 0.5, stagger: 0.08 }, '-=0.3')
        // then the other half misbehaves on its way in
        .add(glitch(broke, 0.5))
        .from($('.op', broke), { opacity: 0, x: () => gsap.utils.random(-30, 30), duration: 0.35, stagger: 0.07, ease: 'steps(4)' }, '-=0.2')
        .from($('.op .ic', broke), { rotate: 90, scale: 0, duration: 0.5, stagger: 0.07, ease: 'back.out(3)' }, '<')
      // and every few seconds one of its rows has a moment
      const rows = $('.op', broke)
      const again = () => gsap.delayedCall(gsap.utils.random(3, 6), () => { glitch(gsap.utils.random(rows), 0.35); again() })
      ScrollTrigger.create({ trigger: s, start: 'top bottom', once: true, onEnter: again })
    }
  }

  // a quick glitch: the element jitters, splits into red and cyan, then settles
  function glitch(el, secs) {
    const tl = gsap.timeline()
    const n = Math.round(secs / 0.05)
    tl.call(() => el.classList.add('m-glitch'))
    for (let i = 0; i < n; i++) tl.to(el, { x: gsap.utils.random(-7, 7), skewX: gsap.utils.random(-6, 6), duration: 0.05, ease: 'none' })
    tl.to(el, { x: 0, skewX: 0, duration: 0.08 }).call(() => el.classList.remove('m-glitch'))
    return tl
  }

  // ---- FAQ: questions slide in from alternating sides ----
  for (const f of take($('.faq'))) {
    gsap.from(f, { y: 40, opacity: 0, duration: 0.8, ease: 'expo.out', scrollTrigger: on(f, 'top 85%') })
    gsap.from($('details', f), { x: (i) => (i % 2 ? 40 : -40), opacity: 0, duration: 0.7, ease: 'power3.out', stagger: 0.07, scrollTrigger: on(f, 'top 80%') })
  }

  // ---- the duo panel on the BACon page ----
  for (const d of take($('.duo'))) {
    gsap.from(d, { y: 70, opacity: 0, duration: 1, ease: 'expo.out', scrollTrigger: on(d) })
    gsap.from($('.duo-copy > *', d), { y: 24, opacity: 0, duration: 0.7, ease: 'power3.out', stagger: 0.08, scrollTrigger: on(d, 'top 70%') })
  }

  // ---- the closing sky ----
  for (const c of take($('.closing .sky-panel'))) {
    if (flavour === 'bacon') {
      // opens out from a slit, like a window blind going up
      gsap.fromTo(c, { clipPath: 'inset(18% 22% 18% 22% round 28px)' }, { clipPath: 'inset(0% 0% 0% 0% round 28px)', ease: 'none', scrollTrigger: { trigger: c, start: 'top bottom', end: 'top 30%', scrub: 0.6 } })
      const h2 = c.querySelector('h2')
      ScrollTrigger.create({ trigger: c, start: 'top 60%', once: true, onEnter: () => decode(h2, { step: 0.022, spin: 0.35 }) })
    } else {
      gsap.fromTo(c, { rotateX: 24, transformPerspective: 1400, transformOrigin: '50% 100%', y: 60 }, { rotateX: 0, y: 0, ease: 'none', scrollTrigger: { trigger: c, start: 'top bottom', end: 'top 35%', scrub: 0.6 } })
      ScrollTrigger.create({ trigger: c, start: 'top 55%', once: true, onEnter: () => glitch(c.querySelector('h2'), 0.6) })
    }
    gsap.from($('.badge, p, .ctas', c), { y: 20, opacity: 0, duration: 0.7, ease: 'power3.out', stagger: 0.08, scrollTrigger: on(c, 'top 65%') })
  }
})()
