'use strict';
// 진도창 화면: 체크, 차시 넘기기, 메모. 차시·활동 고치기는 설정 → 수업 계획에서.
const api = window.jindoProgress;
const $ = (id) => document.getElementById(id);
const list = $('list');
const memo = $('memo');

let v = null;

function setStatus(s) {
  const el = $('status');
  el.textContent = s;
  el.classList.toggle('saving', s === '저장 중…');
  el.classList.toggle('error', s === '저장 오류');
}

function render(next) {
  const classChanged = !v || v.classIdx !== next.classIdx;
  v = next;
  document.title = `${v.className} 진도`;
  $('title').textContent = `${v.className} 진도`;
  $('planChip').hidden = !v.planName;
  $('planName').textContent = v.planName || '';
  $('planDot').style.background = v.planColor || 'transparent';
  $('lessonName').textContent = v.lessonName;
  $('lessonName').title = v.lessonName;
  $('prev').disabled = v.lessonIdx <= 0;
  $('next').disabled = v.lessonIdx >= v.lessonCount - 1;
  $('barFill').style.width = `${v.percent}%`;
  $('bar').setAttribute('aria-valuenow', String(v.percent));
  $('progText').textContent = v.total
    ? `이번 차시 ${v.done}/${v.total} · ${v.percent}% 완료`
    : '이번 차시에는 활동이 없어요';
  $('progText').title = `전체 진도 ${v.overall}%`;

  list.replaceChildren();
  v.items.forEach((item, i) => {
    const li = document.createElement('li');
    li.className = `row${item.done ? ' done' : ''}`;
    const chk = document.createElement('button');
    chk.className = 'chk';
    chk.textContent = '✓';
    chk.setAttribute('role', 'checkbox');
    chk.setAttribute('aria-checked', String(item.done));
    chk.setAttribute('aria-label', item.text);
    chk.addEventListener('click', () => api.action('toggle', { item: i }));
    const txt = document.createElement('span');
    txt.className = 'txt';
    txt.textContent = item.text;
    txt.addEventListener('click', () => api.action('toggle', { item: i }));
    li.append(chk, txt);
    list.appendChild(li);
  });
  $('empty').hidden = v.items.length > 0;

  if (classChanged || document.activeElement !== memo) memo.value = v.memo;
  setStatus(v.status);

  document.body.style.maxHeight = `${v.maxHeight}px`;
  report();
}

function report() {
  requestAnimationFrame(() => api.ready(Math.ceil(document.body.getBoundingClientRect().height)));
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    api.action('close');
  }
});

$('close').addEventListener('click', () => api.action('close'));
$('prev').addEventListener('click', () => api.action('lesson', { delta: -1 }));
$('next').addEventListener('click', () => api.action('lesson', { delta: 1 }));
$('editPlan').addEventListener('click', () => api.action('editPlan'));

memo.addEventListener('input', () => api.memo(memo.value));
memo.addEventListener('blur', () => api.memoFlush());

api.onView(render);
api.onStatus(setStatus);
api.onTail((x) => {
  const t = $('tail');
  t.style.left = `${Math.max(40, Math.min(window.innerWidth - 40, x))}px`;
});

document.fonts.ready.then(() => api.get()).then((first) => { if (first) render(first); });
