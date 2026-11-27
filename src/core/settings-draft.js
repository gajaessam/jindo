'use strict';
// "설정" 창 하나의 초안(draft): 반·학년·수업 계획·보기 설정을 한꺼번에 고치고 "저장"으로 적용합니다.
// 미리 보기와 저장 모두 applySettingsDraft를 써서, 창을 연 동안 진도창에서 한 체크도 지켜집니다.
//
// draft = {
//   classes: [{ src: 원래 반 번호 | null(새 반), name, custom_image, plan_id }],  // 화면에 보이는 순서
//   plans:   [{ id, name, lessons }],          // 학년(계획)과 차시·활동
//   reassign:{ 지운학년id: 옮겨갈학년id },
//   scale, float, labels,
//   monitor: null | { id, label, x, y }       // 위젯을 띄울 모니터
// }

const { cloneData, planById, emptyMarks, MIN_CLASSES, MAX_CLASSES } = require('./data');
const { applyEditedPlans, cleanPlans } = require('./plan-merge');
const { normalizeMonitor } = require('./display-pick');

function draftFromData(data) {
  return {
    classes: data.classes.map((c, i) => ({ src: i, name: c.name, custom_image: c.custom_image || null, plan_id: c.plan_id })),
    plans: cloneData(data.plans),
    reassign: {},
    scale: data.character_scale,
    float: data.float_motion,
    labels: data.show_progress_labels,
    monitor: data.monitor || null,
  };
}

function clampScale(v) {
  const n = Math.round(Number(v) / 10) * 10;
  return Number.isFinite(n) ? Math.max(50, Math.min(150, n)) : 100;
}

// 새 반 이름: 지금 반 번호 중 가장 큰 수 + 1
function nextClassName(classes) {
  const used = classes.map((c) => (String(c.name).match(/\d/g) || []).join('')).filter(Boolean).map(Number);
  return `${(used.length ? Math.max(...used) : 0) + 1}반`;
}

function hasChecks(cls) {
  return cls.progress.some((marks) => marks.some(Boolean));
}

// data는 바꾸지 않고 새 data를 돌려줍니다.
function applySettingsDraft(data, draft) {
  const count = draft.classes.length;
  if (count < MIN_CLASSES) throw new Error('반은 하나 이상 있어야 해요.');
  if (count > MAX_CLASSES) throw new Error(`반은 ${MAX_CLASSES}개까지 만들 수 있어요.`);

  // 1) 학년·차시·활동 적용 (지운 학년의 반은 옮겨 가고, 체크는 활동을 따라감)
  const base = applyEditedPlans(data, cleanPlans(draft.plans), draft.reassign || {});
  const valid = (id) => base.plans.some((p) => p.id === id);

  // 2) 반 목록 다시 만들기 (순서, 이름, 그림, 학년, 새 반, 지운 반)
  const lesson = {};
  const classes = draft.classes.map((d, k) => {
    const name = String(d.name ?? '').trim();
    const old = d.src !== null && d.src !== undefined ? base.classes[d.src] : null;
    if (old) {
      const cls = cloneData(old);
      cls.name = name || cls.name;
      cls.custom_image = d.custom_image || null;
      if (valid(d.plan_id) && d.plan_id !== cls.plan_id) {
        cls.plan_id = d.plan_id;
        cls.progress = emptyMarks(planById(base, d.plan_id));
      } else if (String(d.src) in base.lesson) {
        lesson[String(k)] = base.lesson[String(d.src)];
      }
      return cls;
    }
    const planId = valid(d.plan_id) ? d.plan_id : base.plans[0].id;
    return {
      name: name || `${k + 1}반`,
      image: 0,
      custom_image: d.custom_image || null,
      progress: emptyMarks(planById(base, planId)),
      memo: '',
      plan_id: planId,
    };
  });

  const out = cloneData(base);
  out.classes = classes;
  out.lesson = lesson;
  out.character_scale = clampScale(draft.scale);
  out.float_motion = Boolean(draft.float);
  out.show_progress_labels = Boolean(draft.labels);
  if ('monitor' in draft) out.monitor = normalizeMonitor(draft.monitor);
  return out;
}

// 저장 전에 확인받을 것: 지워지는 반, 학년이 바뀌어 체크가 지워지는 반
function settingsWarnings(data, draft) {
  const kept = new Set(draft.classes.map((d) => d.src).filter((s) => s !== null && s !== undefined));
  const removed = data.classes.filter((_, i) => !kept.has(i)).map((c) => c.name);
  const losing = [];
  for (const d of draft.classes) {
    if (d.src === null || d.src === undefined) continue;
    const old = data.classes[d.src];
    if (!old) continue;
    let target = d.plan_id;
    while (draft.reassign && draft.reassign[target]) target = draft.reassign[target];
    if (target && target !== old.plan_id && hasChecks(old)) losing.push(old.name);
  }
  return { removed, losing };
}

module.exports = { draftFromData, applySettingsDraft, settingsWarnings, nextClassName, clampScale };
