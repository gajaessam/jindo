'use strict';
// 진도 위젯 설정 창: 반 · 학년 / 수업 계획 / 보기 / 기타
(async function () {
  const $ = (id) => document.getElementById(id);
  const api = window.jindo;
  const init = await api.invoke('settings:init');
  if (!init) return;
  const S = init.draft;          // { classes:[{src,name,custom_image,plan_id}], plans, reassign, scale, float, labels }
  const colors = init.colors;
  const originalPlanIds = S.plans.map((p) => p.id);
  let tab = init.tab || 'classes';
  let planTab = 0;               // 수업 계획 탭에서 보는 학년
  let focusLesson = -1;          // 진도창에서 왔을 때 보여 줄 차시
  function applyFocus(f) {
    if (!f) return;
    const i = S.plans.findIndex((p) => p.id === f.planId);
    if (i >= 0) planTab = i;
    focusLesson = Number.isInteger(f.lesson) ? f.lesson : -1;
  }
  applyFocus(init.focus);
  let dirty = false;
  const thumbs = new Map();

  // ── 공통 ──
  const multi = () => S.plans.length > 1;
  const colorOf = (planId) => colors[Math.max(0, S.plans.findIndex((p) => p.id === planId)) % colors.length];
  const planName = (planId) => (S.plans.find((p) => p.id === planId) || { name: '' }).name;

  let syncTimer = 0;
  function changed(now) {
    dirty = true;
    clearTimeout(syncTimer);
    const send = () => api.invoke('settings:draft', S);
    if (now) send(); else syncTimer = setTimeout(send, 150);
  }

  function newPlanId() {
    const used = new Set([...S.plans.map((p) => p.id), ...originalPlanIds]);
    let n = 1;
    while (used.has(`p${n}`)) n++;
    return `p${n}`;
  }

  function nextClassName() {
    const used = S.classes.map((c) => (String(c.name).match(/\d/g) || []).join('')).filter(Boolean).map(Number);
    return `${(used.length ? Math.max(...used) : 0) + 1}반`;
  }

  function nextGradeName() {
    const used = S.plans.map((p) => (String(p.name).match(/^(\d+)학년/) || [])[1]).filter(Boolean).map(Number);
    return `${(used.length ? Math.max(...used) : S.plans.length) + 1}학년`;
  }

  async function thumb(file, box, size) {
    box.replaceChildren();
    if (!file) { box.textContent = '+'; return; }
    let url = thumbs.get(file);
    if (!url) {
      const res = await api.invoke('settings:image', file);
      if (!res) { box.textContent = '!'; return; }
      url = URL.createObjectURL(new Blob([res.bytes], { type: res.mime }));
      thumbs.set(file, url);
    }
    box.replaceChildren(el('img', { src: url, alt: '', style: `max-width:${size}px;max-height:${size}px` }));
  }

  const confirmBox = (title, message, yes = '확인', danger = false) => api.invoke('settings:confirm', { title, message, yes, danger });

  // 작은 창 (페이지 안)
  let modalClose = null;
  function openModal(title, body, buttons) {
    return new Promise((resolve) => {
      const back = el('div', { class: 'modal-back' });
      const box = el('div', { class: 'modal', role: 'dialog', 'aria-label': title }, el('h3', { text: title }), ...body);
      const row = el('div', { class: 'btns' });
      const done = (v) => { back.remove(); modalClose = null; resolve(v); };
      for (const b of buttons) row.append(el('button', { class: `btn ${b.kind || ''}`, text: b.label, onclick: () => done(b.value) }));
      box.append(row);
      back.append(box);
      back.addEventListener('mousedown', (e) => { if (e.target === back) done(null); });
      document.body.append(back);
      modalClose = () => done(null);
      const first = box.querySelector('input, select, button');
      if (first) first.focus();
    });
  }

  // ── 탭 ──
  function showTab(name) {
    tab = name;
    for (const b of document.querySelectorAll('.nav button')) b.setAttribute('aria-selected', String(b.dataset.tab === name));
    for (const s of document.querySelectorAll('.content > section')) s.hidden = s.id !== `sec-${name}`;
    api.send('settings:tab', name);
    render();
  }
  for (const b of document.querySelectorAll('.nav button')) b.addEventListener('click', () => showTab(b.dataset.tab));
  api.on('settings:goto', (name, f) => { applyFocus(f); showTab(name); });

  function render() {
    if (tab === 'classes') renderClasses();
    else if (tab === 'plan') renderPlan();
    else renderWidget();
    $('hint').textContent = tab === 'widget'
      ? '바탕 화면 모양은 "저장"을 눌러야 확정돼요. 자동 실행·업데이트·복원은 누르면 바로 적용돼요.'
      : '바꾸는 동안 바탕 화면에 미리 보여요. "저장"을 눌러야 확정돼요.';
  }

  // ═════════ 반 · 학년 ═════════
  let draggingIdx = -1;

  function chipFor(cls, idx) {
    const th = el('span', { class: 'th' });
    const chip = el('button', { class: 'chip', draggable: multi() ? 'true' : 'false', title: '눌러서 이름·그림 바꾸기' + (multi() ? ' · 끌어서 다른 학년으로' : '') }, th, document.createTextNode(cls.name || '이름 없음'));
    thumb(cls.custom_image, th, 26);
    chip.addEventListener('click', () => editClass(idx));
    chip.addEventListener('dragstart', (e) => { draggingIdx = idx; chip.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(idx)); });
    chip.addEventListener('dragend', () => { draggingIdx = -1; chip.classList.remove('dragging'); });
    return chip;
  }

  function addClassTo(planId) {
    if (S.classes.length >= init.maxClasses) {
      confirmBox('반 추가', `반은 ${init.maxClasses}개까지 만들 수 있어요.`);
      return;
    }
    S.classes.push({ src: null, name: nextClassName(), custom_image: null, plan_id: planId });
    changed(true);
    render();
  }

  function renderClasses() {
    const sec = $('sec-classes');
    sec.replaceChildren();
    sec.append(el('p', {
      class: 'lead',
      text: multi()
        ? '학년마다 반이 나뉘어 있어요. 반을 끌어서 다른 학년으로 옮길 수 있어요. 반을 누르면 이름과 캐릭터 그림을 바꿔요.'
        : '반을 누르면 이름과 캐릭터 그림을 바꿔요. 다른 학년도 가르치면 아래 "+ 학년 추가"를 눌러요.',
    }));
    S.plans.forEach((p, pi) => {
      const list = S.classes.map((c, i) => [c, i]).filter(([c]) => c.plan_id === p.id);
      const box = el('div', { class: 'grade' });
      if (multi()) {
        box.append(el('div', { class: 'grade-head' },
          el('span', { class: 'dot', style: `background:${colors[pi % colors.length]}` }),
          el('b', { text: p.name || '이름 없는 학년' }),
          el('span', { class: 'count', text: `반 ${list.length}개` }),
          el('button', { class: 'btn pill-btn', text: '이름 바꾸기', onclick: () => renameGrade(pi) }),
          el('button', { class: 'btn pill-btn', text: '학년 삭제', onclick: () => deleteGrade(pi) })));
        box.addEventListener('dragover', (e) => { if (draggingIdx >= 0) { e.preventDefault(); box.classList.add('drop'); } });
        box.addEventListener('dragleave', () => box.classList.remove('drop'));
        box.addEventListener('drop', (e) => {
          e.preventDefault();
          box.classList.remove('drop');
          const idx = draggingIdx;
          if (idx < 0 || S.classes[idx].plan_id === p.id) return;
          S.classes[idx].plan_id = p.id;
          changed(true);
          render();
        });
      } else {
        box.append(el('div', { class: 'grade-head' }, el('b', { text: '수업하는 반' }), el('span', { class: 'count', text: `${S.classes.length}개 (최대 ${init.maxClasses}개)` })));
      }
      const chips = el('div', { class: 'chips' });
      for (const [c, i] of list) chips.append(chipFor(c, i));
      chips.append(el('button', { class: 'chip add', text: '+ 반', title: multi() ? `${p.name}에 반 추가` : '반 추가', onclick: () => addClassTo(p.id) }));
      if (!list.length) chips.prepend(el('span', { class: 'lead', text: '아직 반이 없어요.' }));
      box.append(chips);
      sec.append(box);
    });
    if (S.plans.length < init.maxPlans) {
      sec.append(el('button', { class: 'add-grade', text: '+ 학년 추가 (다른 학년도 가르쳐요)', onclick: addGrade }));
    }
  }

  async function editClass(idx) {
    const cls = S.classes[idx];
    const name = el('input', { type: 'text', value: cls.name, maxlength: '40', id: 'mName' });
    const big = el('div', { class: 'big' });
    let image = cls.custom_image;
    thumb(image, big, 52);
    const pick = el('button', {
      class: 'btn pill-btn', text: '그림 고르기',
      onclick: async () => { const f = await api.invoke('settings:pick-image', name.value); if (f) { image = f; thumb(image, big, 52); } },
    });
    const clear = el('button', { class: 'btn pill-btn', text: '그림 지우기', onclick: () => { image = null; thumb(null, big, 52); } });
    const body = [
      el('label', { class: 'f', for: 'mName' }, '반 이름', name),
      el('div', { class: 'img-row' }, big, el('div', { class: 'btns' }, pick, clear)),
    ];
    let gradeSel = null;
    if (multi()) {
      gradeSel = el('select', { id: 'mGrade' });
      for (const p of S.plans) {
        const o = el('option', { value: p.id, text: p.name });
        if (p.id === cls.plan_id) o.selected = true;
        gradeSel.append(o);
      }
      body.push(el('label', { class: 'f', for: 'mGrade' }, '학년', gradeSel));
    }
    const res = await openModal(`${cls.name} 고치기`, body, [
      { label: '반 삭제', kind: 'danger-ghost', value: 'delete' },
      { label: '취소', kind: 'ghost', value: null },
      { label: '확인', kind: 'primary', value: 'ok' },
    ]);
    if (res === 'ok') {
      cls.name = name.value.trim() || cls.name;
      cls.custom_image = image;
      if (gradeSel) cls.plan_id = gradeSel.value;
      changed(true);
      render();
    } else if (res === 'delete') {
      if (S.classes.length <= 1) { confirmBox('반 삭제', '반은 하나 이상 있어야 해요.'); return; }
      const ok = await confirmBox('반 삭제', `${cls.name}을(를) 지울까요?\n저장하면 이 반의 진도와 메모가 지워져요.`, '삭제', true);
      if (!ok) return;
      S.classes.splice(idx, 1);
      changed(true);
      render();
    }
  }

  async function renameGrade(pi) {
    const p = S.plans[pi];
    const input = el('input', { type: 'text', value: p.name, maxlength: '40', id: 'mGradeName', placeholder: '예: 2학년, 2학년 가정' });
    const res = await openModal('학년 이름 바꾸기', [el('label', { class: 'f', for: 'mGradeName' }, '학년 이름', input)], [
      { label: '취소', kind: 'ghost', value: null }, { label: '확인', kind: 'primary', value: 'ok' },
    ]);
    if (res !== 'ok') return;
    p.name = input.value.trim() || p.name;
    changed(true);
    render();
  }

  async function deleteGrade(pi) {
    const p = S.plans[pi];
    const target = S.plans[pi === 0 ? 1 : 0];
    const who = S.classes.filter((c) => c.plan_id === p.id).map((c) => c.name);
    const move = who.length ? `\n\n${who.join(', ')}은(는) "${target.name}"으로 옮겨지고, 체크는 처음부터 시작돼요.` : '';
    const ok = await confirmBox('학년 삭제', `"${p.name}"을(를) 지울까요?\n저장하면 이 학년의 차시와 활동이 함께 지워져요.${move}`, '삭제', true);
    if (!ok) return;
    S.reassign[p.id] = target.id;
    for (const k of Object.keys(S.reassign)) if (S.reassign[k] === p.id) S.reassign[k] = target.id;
    for (const c of S.classes) if (c.plan_id === p.id) c.plan_id = target.id;
    S.plans.splice(pi, 1);
    planTab = Math.min(planTab, S.plans.length - 1);
    changed(true);
    render();
  }

  async function addGrade() {
    const name = el('input', { type: 'text', value: nextGradeName(), maxlength: '40', id: 'mNewGrade', placeholder: '예: 1학년, 1학년 가정' });
    const checks = el('div', { class: 'checks' });
    const boxes = S.classes.map((c, i) => {
      const cb = el('input', { type: 'checkbox', value: String(i) });
      const lab = el('label', null, cb);
      if (multi()) lab.append(el('i', { style: `background:${colorOf(c.plan_id)}` }));
      lab.append(document.createTextNode(c.name));
      checks.append(lab);
      return cb;
    });
    const src = el('select', { id: 'mCopy' });
    src.append(el('option', { value: '', text: '비워 두기 (1차시만)' }));
    for (const p of S.plans) src.append(el('option', { value: p.id, text: `"${p.name}"에서 복사` }));
    const res = await openModal('학년 추가', [
      el('label', { class: 'f', for: 'mNewGrade' }, '학년 이름', name),
      el('div', { class: 'f' }, el('span', { class: 'lead', text: '이 학년 반 (나중에 끌어서 바꿀 수 있어요)' }), checks),
      el('label', { class: 'f', for: 'mCopy' }, '차시·활동', src),
    ], [{ label: '취소', kind: 'ghost', value: null }, { label: '추가하기', kind: 'primary', value: 'ok' }]);
    if (res !== 'ok') return;
    const from = S.plans.find((p) => p.id === src.value);
    const id = newPlanId();
    S.plans.push({
      id,
      name: name.value.trim() || nextGradeName(),
      lessons: from
        ? from.lessons.map((l) => ({ name: l.name, items: l.items.map((it) => ({ text: it.text })) }))
        : [{ name: '1차시', items: [] }],
    });
    boxes.forEach((cb, i) => { if (cb.checked) S.classes[i].plan_id = id; });
    changed(true);
    render();
  }

  // ═════════ 수업 계획 (차시·활동) ═════════
  let drag = null;
  let focusAfter = null;
  const lessons = () => S.plans[planTab].lessons;

  function handle(label, onDown) {
    const h = el('span', { class: 'handle', text: '⠿', title: `끌어서 ${label} 옮기기`, 'aria-hidden': 'true' });
    h.addEventListener('pointerdown', onDown);
    return h;
  }

  function renderPlan() {
    const sec = $('sec-plan');
    planTab = Math.min(planTab, S.plans.length - 1);
    sec.replaceChildren();
    sec.append(el('p', { class: 'lead', text: multi()
      ? '학년마다 차시와 활동을 따로 써요. 같은 학년 반끼리 함께 쓰고, 체크와 메모는 반마다 따로예요.'
      : '차시와 활동은 모든 반이 함께 써요. 체크와 메모는 반마다 따로예요.' }));
    if (multi()) {
      const tabs = el('div', { class: 'tabs', role: 'tablist' });
      S.plans.forEach((p, i) => {
        const b = el('button', { class: 'tab', role: 'tab', 'aria-selected': String(i === planTab) },
          el('i', { style: `background:${colors[i % colors.length]}` }), el('span', { text: p.name }));
        b.addEventListener('click', () => { planTab = i; render(); });
        tabs.append(b);
      });
      sec.append(tabs);
    }
    const box = el('div', { class: 'lessons', id: 'lessons' });
    const ls = lessons();
    ls.forEach((lesson, li) => {
      const nameInput = el('input', { type: 'text', id: `lesson${li}`, value: lesson.name, maxlength: '60', 'aria-label': `${li + 1}번째 차시 이름` });
      nameInput.addEventListener('input', () => { lesson.name = nameInput.value; changed(); });
      const head = el('div', { class: 'lesson-head' },
        handle('차시', (e) => startDrag(e, { type: 'lesson', li })),
        el('span', { class: 'badge', text: `${li + 1}` }),
        nameInput,
        el('div', { class: 'tools' }, el('button', {
          class: 'icon-btn del', text: '✕', 'aria-label': '차시 삭제', disabled: ls.length <= 1,
          title: ls.length <= 1 ? '차시가 1개뿐이라 지울 수 없어요' : '차시 삭제',
          onclick: async () => {
            const ok = await confirmBox('차시 삭제', `"${lesson.name || `${li + 1}차시`}"을(를) 지울까요?\n저장하면 이 차시의 활동과 반들의 체크가 함께 지워져요.`, '삭제', true);
            if (!ok) return;
            ls.splice(li, 1);
            changed(true);
            render();
          },
        })));
      const items = el('div', { class: 'items' });
      if (!lesson.items.length) items.append(el('div', { class: 'none', text: '활동이 없어요' }));
      lesson.items.forEach((item, ii) => {
        const input = el('input', { type: 'text', id: `item${li}_${ii}`, value: item.text, maxlength: '120', 'aria-label': `${li + 1}차시 ${ii + 1}번째 활동` });
        input.addEventListener('input', () => { item.text = input.value; changed(); });
        items.append(el('div', { class: 'item', 'data-li': String(li), 'data-ii': String(ii) },
          handle('활동', (e) => startDrag(e, { type: 'item', li, ii })),
          input,
          el('div', { class: 'tools' }, el('button', {
            class: 'icon-btn del', text: '✕', title: '활동 삭제', 'aria-label': '활동 삭제',
            onclick: async () => {
              const ok = await confirmBox('활동 삭제', `"${item.text || '활동'}"을(를) 지울까요?\n저장하면 반들의 이 활동 체크도 함께 지워져요.`, '삭제', true);
              if (!ok) return;
              lesson.items.splice(ii, 1);
              changed(true);
              render();
            },
          }))));
      });
      const add = el('button', { class: 'btn pill-btn add-item', text: '+ 활동', onclick: () => { lesson.items.push({ text: '' }); focusAfter = `item${li}_${lesson.items.length - 1}`; changed(true); render(); } });
      box.append(el('div', { class: 'lesson', 'data-li': String(li) }, head, items, add));
    });
    box.append(el('div', { class: 'drop-line', id: 'dropLine', hidden: true }));
    sec.append(box);
    sec.append(el('button', { class: 'btn pill-btn add-lesson', text: '+ 차시 추가', onclick: () => { ls.push({ name: `${ls.length + 1}차시`, items: [] }); focusAfter = `lesson${ls.length - 1}`; changed(true); render(); } }));
    if (focusAfter) {
      const f = $(focusAfter);
      focusAfter = null;
      if (f) { f.focus(); f.scrollIntoView({ block: 'nearest' }); }
    }
    if (focusLesson >= 0) {
      // 진도창에서 보던 차시를 맨 위로 보여 줌
      const card = box.querySelector(`.lesson[data-li="${focusLesson}"]`);
      focusLesson = -1;
      if (card) requestAnimationFrame(() => card.scrollIntoView({ block: 'start' }));
    }
  }

  function startDrag(e, src) {
    if (e.button !== 0) return;
    e.preventDefault();
    const box = $('lessons');
    const node = src.type === 'lesson' ? box.querySelector(`.lesson[data-li="${src.li}"]`) : box.querySelector(`.item[data-li="${src.li}"][data-ii="${src.ii}"]`);
    node.classList.add('dragging');
    document.body.classList.add('is-dragging');
    drag = { src, node, target: null, pointerId: e.pointerId, lastY: e.clientY };
    const h = e.currentTarget;
    h.setPointerCapture(e.pointerId);
    const move = (ev) => { if (drag && ev.pointerId === drag.pointerId) { drag.lastY = ev.clientY; update(); autoScroll(); } };
    const up = (ev) => {
      h.removeEventListener('pointermove', move);
      h.removeEventListener('pointerup', up);
      h.removeEventListener('pointercancel', up);
      finish(ev.type === 'pointerup');
    };
    h.addEventListener('pointermove', move);
    h.addEventListener('pointerup', up);
    h.addEventListener('pointercancel', up);
    update();
  }

  function update() {
    const box = $('lessons');
    const line = $('dropLine');
    const cards = [...box.querySelectorAll('.lesson')];
    const y = drag.lastY;
    let t;
    if (drag.src.type === 'lesson') {
      let index = cards.length;
      for (let i = 0; i < cards.length; i++) { const r = cards[i].getBoundingClientRect(); if (y < r.top + r.height / 2) { index = i; break; } }
      const ref = cards[Math.min(index, cards.length - 1)].getBoundingClientRect();
      t = { index, line: [index < cards.length ? ref.top - 6 : ref.bottom + 6, ref.left, ref.width] };
    } else {
      let li = 0;
      let best = Infinity;
      cards.forEach((c, i) => { const r = c.getBoundingClientRect(); const d = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0; if (d < best) { best = d; li = i; } });
      const rows = [...cards[li].querySelectorAll('.item')];
      const ib = cards[li].querySelector('.items').getBoundingClientRect();
      if (!rows.length) t = { li, index: 0, line: [ib.top + ib.height / 2, ib.left, ib.width] };
      else {
        let index = rows.length;
        for (let i = 0; i < rows.length; i++) { const r = rows[i].getBoundingClientRect(); if (y < r.top + r.height / 2) { index = i; break; } }
        const ref = rows[Math.min(index, rows.length - 1)].getBoundingClientRect();
        t = { li, index, line: [index < rows.length ? ref.top - 3 : ref.bottom + 3, ref.left, ref.width] };
      }
    }
    drag.target = t;
    const base = box.getBoundingClientRect();
    line.hidden = false;
    line.style.top = `${Math.max(1, Math.min(t.line[0] - base.top - 2, base.height - 5))}px`;
    line.style.left = `${t.line[1] - base.left}px`;
    line.style.width = `${t.line[2]}px`;
  }

  function autoScroll() {
    const sc = $('content');
    const r = sc.getBoundingClientRect();
    if (drag.lastY < r.top + 40) sc.scrollTop -= 12;
    else if (drag.lastY > r.bottom - 40) sc.scrollTop += 12;
  }

  function finish(apply) {
    const d = drag;
    drag = null;
    document.body.classList.remove('is-dragging');
    if (!d) return;
    d.node.classList.remove('dragging');
    const line = $('dropLine');
    if (line) line.hidden = true;
    if (!apply || !d.target) return;
    const ls = lessons();
    const { src, target } = d;
    if (src.type === 'lesson') {
      let to = target.index;
      if (to > src.li) to -= 1;
      if (to === src.li) return;
      const [m] = ls.splice(src.li, 1);
      ls.splice(to, 0, m);
    } else {
      let to = target.index;
      if (target.li === src.li && to > src.ii) to -= 1;
      if (target.li === src.li && to === src.ii) return;
      const [m] = ls[src.li].items.splice(src.ii, 1);
      ls[target.li].items.splice(to, 0, m);
    }
    changed(true);
    render();
  }

  // ═════════ 위젯 ═════════
  // 위쪽 "바탕 화면 모양"은 저장해야 확정되고, 아래 자동 실행·업데이트·복원은 누르는 즉시 적용돼요.
  let autoOn = init.autostart.on;
  let backups = null;
  let picked = null;
  let displays = init.displays || [];
  api.on('settings:displays', (list) => { displays = list || []; if (tab === 'widget') render(); });

  // 지금 고른 모니터 (main의 pickDisplay와 같은 순서로 맞춰 봄: 번호+이름 → 이름 → 위치 → 주 모니터)
  function currentDisplay() {
    const primary = displays.find((d) => d.primary) || displays[0] || null;
    const m = S.monitor;
    if (!m) return primary;
    const named = m.label ? displays.filter((d) => d.key.label === m.label) : [];
    const at = (d) => d.key.x === m.x && d.key.y === m.y;
    return displays.find((d) => d.key.id === m.id && (!m.label || d.key.label === m.label))
      || (named.length === 1 ? named[0] : null)
      || named.find(at) || displays.find(at) || displays.find((d) => d.key.id === m.id) || primary;
  }

  async function renderWidget() {
    const sec = $('sec-widget');
    if (!backups) backups = await api.invoke('settings:backups');

    // 바탕 화면 모양
    const scale = el('input', { type: 'range', id: 'scale', min: '50', max: '150', step: '10', value: String(S.scale), 'aria-label': '캐릭터 크기' });
    const val = el('b', { text: `${S.scale}%` });
    scale.addEventListener('input', () => { S.scale = Number(scale.value); val.textContent = `${S.scale}%`; changed(); });
    const on = el('button', { 'aria-pressed': String(S.float), text: '살짝 둥둥', onclick: () => { S.float = true; changed(true); render(); } });
    const off = el('button', { 'aria-pressed': String(!S.float), text: '멈춤', onclick: () => { S.float = false; changed(true); render(); } });
    const labels = el('button', { class: 'switch', role: 'switch', 'aria-checked': String(S.labels), 'aria-label': '캐릭터 위 진도율 표시', onclick: () => { S.labels = !S.labels; changed(true); render(); } });

    // 표시할 모니터 (모니터가 2개 이상일 때만). 주 모니터를 고르면 "주 모니터 따라가기"(null)로 저장
    let monitorRow = null;
    if (displays.length > 1) {
      const cur = currentDisplay();
      const seg = el('div', { class: 'seg', role: 'group', 'aria-label': '표시할 모니터' },
        ...displays.map((d) => el('button', {
          'aria-pressed': String(d === cur), text: d.name, title: d.detail,
          onclick: () => { S.monitor = d.primary ? null : d.key; changed(true); render(); },
        })));
      monitorRow = el('div', { class: 'row-between' },
        el('span', null, el('span', { text: '표시할 모니터' }), el('div', { class: 'lead', text: cur ? cur.detail : '' })), seg);
    } else if (S.monitor) {
      monitorRow = el('div', { class: 'lead', text: '고른 모니터가 연결되어 있지 않아서 지금은 주 모니터에 보여요. 다시 연결하면 그 모니터로 옮겨 가요.' });
    }

    // 자동 실행
    const auto = el('button', {
      class: 'switch', role: 'switch', 'aria-checked': String(autoOn), 'aria-label': '자동 실행', disabled: !init.autostart.supported,
      onclick: async () => { autoOn = Boolean(await api.invoke('settings:autostart', !autoOn)); render(); },
    });

    // 백업 목록
    const list = el('div', { class: 'backup-list', role: 'radiogroup', 'aria-label': '백업 목록' });
    for (const e of backups) {
      const b = el('button', { class: 'entry', role: 'radio', 'aria-checked': String(picked === e.name) },
        el('span', { class: 'rd' }),
        el('span', null,
          el('span', { class: 'when', text: e.savedText }),
          e.beforeRestore ? el('span', { class: 'tagx', text: '복원 직전' }) : null,
          e.beforeUpgrade ? el('span', { class: 'tagx', text: '형식 변환 직전' }) : null,
          el('div', { class: 'info', text: `${e.classes}개 반 · ${e.plans > 1 ? `학년 ${e.plans}개 · ` : ''}활동 ${e.activities}개 · 체크 ${e.checks}개` })));
      b.addEventListener('click', () => { picked = e.name; render(); });
      list.append(b);
    }
    if (!backups.length) list.append(el('p', { class: 'lead', text: '아직 백업이 없어요. 하루에 한 번, 그날 처음 저장할 때 만들어져요.' }));
    const restore = el('button', {
      class: 'btn pill-btn', text: '이 백업으로 복원', disabled: !picked,
      onclick: async () => { if (picked) await api.invoke('settings:restore', picked); },
    });

    sec.replaceChildren(
      el('div', { class: 'sec-title', text: '바탕 화면 모양' }),
      el('div', { class: 'group' },
        el('div', { class: 'row-between' }, el('span', { text: '캐릭터 크기' }), el('span', { class: 'slider', style: 'display:flex;align-items:center;gap:10px' }, scale, val)),
        el('div', { class: 'row-between' }, el('span', { text: '움직임' }), el('div', { class: 'seg', role: 'group', 'aria-label': '움직임' }, on, off)),
        el('div', { class: 'row-between' }, el('span', { text: '캐릭터 위 진도율 표시' }), labels),
        monitorRow),
      el('div', { class: 'sec-title' }, '프로그램', el('span', { class: 'now', text: '누르면 바로 적용' })),
      el('div', { class: 'group' },
        el('div', { class: 'row-between' }, el('span', null, el('b', { text: '자동 실행' }), el('div', { class: 'lead', text: init.autostart.supported ? 'Windows에 로그인하면 진도 위젯이 저절로 켜져요.' : '설치한 진도 위젯에서만 켜고 끌 수 있어요.' })), auto)),
      el('div', { class: 'group' },
        el('div', { class: 'row-between' }, el('span', null, el('b', { text: '업데이트' }), el('div', { class: 'lead', text: `지금 버전 v${init.version}` })),
          el('button', { class: 'btn pill-btn', text: '업데이트 확인', onclick: () => api.send('settings:update-check') }))),
      el('div', { class: 'group' },
        el('b', { text: '백업에서 복원' }),
        el('div', { class: 'lead', text: '하루에 한 번 자동으로 남는 백업(최근 14개)으로 되돌려요. 복원하기 직전 상태도 함께 보관돼요.' }),
        list,
        el('div', { class: 'btns' }, restore)),
      el('div', { class: 'group about' },
        el('b', { text: '프로그램 정보' }),
        el('div', { text: `진도 위젯 v${init.version}` }),
        el('div', { text: 'ⓒ 가정재연쌤 | 무단 재배포 금지 | 개선 의견: @gajae_ssam' })),
    );
  }
  // ── 저장 · 닫기 ──
  $('save').addEventListener('click', async () => {
    clearTimeout(syncTimer);
    await api.invoke('settings:draft', S);
    $('save').disabled = true;
    const ok = await api.invoke('settings:save');
    if (!ok) $('save').disabled = false;
  });

  async function close() {
    if (modalClose) { modalClose(); return; }
    if (drag) { finish(false); return; }
    if (dirty) {
      const ok = await confirmBox('설정', '바꾼 내용을 저장하지 않고 닫을까요?', '저장하지 않고 닫기');
      if (!ok) return;
    }
    api.send('settings:close');
  }
  $('close').addEventListener('click', close);
  $('x').addEventListener('click', close);
  window.panelEscape = close;

  await document.fonts.ready;
  showTab(['classes', 'plan', 'widget'].includes(tab) ? tab : 'classes');
  // 창 높이는 고정 (탭을 바꿔도 창 크기가 출렁이지 않게). 내용이 길면 안에서 스크롤
  window.jindo.ready(720);
})();
