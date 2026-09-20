/* ============================================================
   KRAIL Blog · shared behaviour
   Scroll reveal, smart-sticky nav, category filter,
   reading progress, share links.
   ============================================================ */
(function () {
  'use strict';

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Scroll reveal ---------- */
  /* Squiggles reveal on their own, so a heading does not need .anim to draw one. */
  var revealables = document.querySelectorAll('.anim, .accent-word');
  if ('IntersectionObserver' in window && !reduce) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });
    revealables.forEach(function (el) { io.observe(el); });
  } else {
    revealables.forEach(function (el) { el.classList.add('in'); });
  }

  /* ---------- Smart sticky nav ---------- */
  var nav = document.querySelector('nav.top');
  if (nav) {
    var lastY = window.scrollY;
    window.addEventListener('scroll', function () {
      var y = window.scrollY;
      nav.classList.toggle('scrolled', y > 8);
      if (y > 200 && y > lastY) nav.classList.add('nav-hidden');
      else nav.classList.remove('nav-hidden');
      lastY = y;
    }, { passive: true });
  }

  /* ---------- Category filter ---------- */
  var chips = document.querySelectorAll('.chip[data-filter]');
  var grid = document.getElementById('cardGrid');
  var countEl = document.getElementById('postCount');
  if (chips.length && grid) {
    var cards = grid.querySelectorAll('.card');
    chips.forEach(function (chip) {
      chip.addEventListener('click', function () {
        var want = chip.getAttribute('data-filter');
        chips.forEach(function (c) { c.setAttribute('aria-pressed', String(c === chip)); });
        var shown = 0;
        cards.forEach(function (card) {
          var match = want === 'all' || card.getAttribute('data-cat') === want;
          card.classList.toggle('hidden', !match);
          if (match) shown++;
        });
        if (countEl) countEl.textContent = shown + (shown === 1 ? ' story' : ' stories');
      });
    });
  }

  /* ---------- Reading progress ---------- */
  var bar = document.querySelector('.progress');
  var article = document.querySelector('.prose-body');
  if (bar && article) {
    var tick = function () {
      var top = article.offsetTop;
      var height = article.offsetHeight - window.innerHeight;
      var pct = height > 0 ? (window.scrollY - top) / height : 0;
      bar.style.width = Math.max(0, Math.min(1, pct)) * 100 + '%';
    };
    window.addEventListener('scroll', tick, { passive: true });
    window.addEventListener('resize', tick);
    tick();
  }

  /* ---------- Share ---------- */
  document.querySelectorAll('[data-share]').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      var url = encodeURIComponent(location.href);
      var title = encodeURIComponent(document.title);
      var kind = btn.getAttribute('data-share');
      var map = {
        x: 'https://twitter.com/intent/tweet?url=' + url + '&text=' + title,
        linkedin: 'https://www.linkedin.com/sharing/share-offsite/?url=' + url,
        facebook: 'https://www.facebook.com/sharer/sharer.php?u=' + url,
        reddit: 'https://www.reddit.com/submit?url=' + url + '&title=' + title
      };
      if (kind === 'copy') {
        navigator.clipboard && navigator.clipboard.writeText(location.href);
        btn.setAttribute('aria-label', 'Link copied');
        return;
      }
      if (map[kind]) window.open(map[kind], '_blank', 'noopener');
    });
  });

  /* ---------- Demo theme lab (removed before ship) ---------- */
  var lab = document.getElementById('lab');
  if (lab) {
    var applyTheme = function (mode) {
      if (mode === 'auto') {
        var dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
      } else {
        document.documentElement.setAttribute('data-theme', mode);
      }
      try { localStorage.setItem('krail-blog-theme', mode); } catch (err) {}
    };
    lab.querySelectorAll('[data-theme-set]').forEach(function (b) {
      b.addEventListener('click', function () {
        lab.querySelectorAll('[data-theme-set]').forEach(function (x) {
          x.setAttribute('aria-pressed', String(x === b));
        });
        applyTheme(b.getAttribute('data-theme-set'));
      });
    });
    var vivid = lab.querySelector('[data-vivid-toggle]');
    if (vivid) {
      vivid.addEventListener('click', function () {
        var on = document.documentElement.getAttribute('data-vivid') === '1';
        document.documentElement.setAttribute('data-vivid', on ? '0' : '1');
        vivid.setAttribute('aria-pressed', String(!on));
        vivid.textContent = on ? 'Accessible' : 'Vivid (fails WCAG)';
      });
    }
    lab.querySelectorAll('[data-accent]').forEach(function (sw) {
      sw.addEventListener('click', function () {
        var target = document.querySelector('.masthead') || document.querySelector('.post-wrap');
        if (target) target.style.setProperty('--accent', sw.getAttribute('data-accent'));
      });
    });
    var saved = null;
    try { saved = localStorage.getItem('krail-blog-theme'); } catch (err) {}
    if (saved) {
      applyTheme(saved);
      lab.querySelectorAll('[data-theme-set]').forEach(function (x) {
        x.setAttribute('aria-pressed', String(x.getAttribute('data-theme-set') === saved));
      });
    }
  }

  /* ---------- Hold the last frame, then replay ----------
     A plain `loop` restarts the instant the last frame lands, so a flow
     clip snaps back with no pause at all and reads as a twitch rather than
     a demonstration. These run once, rest on the final frame, and start
     over.

     The default rest is a beat, not a stare, because a clip that ends on a
     rest state (a card closed again) has already given the reader its time
     in the middle. A clip that ends ON its payoff wants longer, and asks
     for it with `data-replay="4000"`.

     Rewinding to 0 and playing is what replays it. Setting `currentTime`
     first means the poster never flashes back in between. */
  var REPLAY_HOLD_MS = 1200;

  function holdThenReplay(clip) {
    var timer = null;
    var hold = parseInt(clip.dataset.replay, 10);
    if (!(hold >= 0)) hold = REPLAY_HOLD_MS;

    clip.addEventListener('ended', function () {
      if (timer) return;
      timer = window.setTimeout(function () {
        timer = null;
        if (clip.dataset.calm === 'on') return;
        try { clip.currentTime = 0; } catch (err) {}
        var playing = clip.play();
        if (playing && playing.catch) playing.catch(function () {});
      }, hold);
    });

    /* A clip that is paused for reduced motion must not be restarted by a
       timer that was already in flight when the setting changed. */
    clip.addEventListener('pause', function () {
      if (clip.dataset.calm === 'on' && timer) {
        window.clearTimeout(timer);
        timer = null;
      }
    });
  }

  var replayClips = document.querySelectorAll('video[data-replay]');
  for (var r = 0; r < replayClips.length; r++) holdThenReplay(replayClips[r]);

  /* ---------- Reduced motion, for the device recordings ----------
     The flow clips in a phone frame autoplay and loop. CSS can turn off an
     animation but it cannot stop a video, so the reduced-motion half of
     that promise has to be script. Pausing on the first frame still leaves
     the poster visible, so the screen reads as a screenshot rather than
     going blank. Kept live rather than read once, because the setting can
     change while the page is open. */
  var calmQuery = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;

  function applyCalm() {
    if (!calmQuery) return;
    var clips = document.querySelectorAll('.phone video');
    for (var i = 0; i < clips.length; i++) {
      var clip = clips[i];
      if (calmQuery.matches) {
        clip.dataset.calm = 'on';
        clip.removeAttribute('autoplay');
        clip.loop = false;
        clip.pause();
        try { clip.currentTime = 0; } catch (err) {}
        continue;
      }
      clip.dataset.calm = '';
      if (clip.paused) {
        var playing = clip.play();
        /* Safari rejects this if it decides the gesture rules were not met.
           A still frame is an acceptable outcome, an unhandled rejection
           in the console is not. */
        if (playing && playing.catch) playing.catch(function () {});
      }
    }
  }

  if (calmQuery) {
    applyCalm();
    if (calmQuery.addEventListener) calmQuery.addEventListener('change', applyCalm);
    else if (calmQuery.addListener) calmQuery.addListener(applyCalm);
  }
})();
