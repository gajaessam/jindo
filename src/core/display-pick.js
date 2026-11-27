'use strict';
// 듀얼 모니터: 위젯을 어느 모니터에 띄울지 (화면과 무관한 순수 함수)
//
// 저장 값 monitor: null(주 모니터, 기본) 또는 { id, label, x, y }
//  - Windows가 모니터 번호(id)를 다시 매길 수 있어서, 이름(label)과 위치(x, y)도 같이 저장해 두고 차례로 맞춰 봅니다.
//  - 고른 모니터를 못 찾으면(모니터를 뺐을 때 등) 주 모니터에 띄웁니다. 저장 값은 그대로 두어 다시 꽂으면 돌아갑니다.

function normalizeMonitor(v) {
  if (!v || typeof v !== 'object') return null;
  const id = Number(v.id);
  const x = Number(v.x);
  const y = Number(v.y);
  if (!Number.isFinite(id) || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { id, label: String(v.label || '').slice(0, 80), x: Math.round(x), y: Math.round(y) };
}

// displays: Electron screen.getAllDisplays() 모양 [{ id, label, bounds:{x,y,width,height}, workArea }]
function pickDisplay(displays, primaryId, pref) {
  const list = Array.isArray(displays) ? displays : [];
  const primary = list.find((d) => d.id === primaryId) || list[0] || null;
  const want = normalizeMonitor(pref);
  if (!want || list.length < 2) return primary;
  const at = (d) => d.bounds && d.bounds.x === want.x && d.bounds.y === want.y;
  const named = want.label ? list.filter((d) => d.label === want.label) : [];
  return list.find((d) => d.id === want.id && (!want.label || d.label === want.label))
    || (named.length === 1 ? named[0] : null)
    || named.find(at)
    || list.find(at)
    || list.find((d) => d.id === want.id)
    || primary;
}

// 설정 창에 보여 줄 모니터 목록: 왼쪽부터 순서대로
function describeDisplays(displays, primaryId) {
  const list = (Array.isArray(displays) ? displays : []).slice().sort((a, b) => (a.bounds.x - b.bounds.x) || (a.bounds.y - b.bounds.y));
  const sideBySide = list.length === 2 && list[0].bounds.x !== list[1].bounds.x;
  return list.map((d, i) => {
    let name = `모니터 ${i + 1}`;
    if (sideBySide) name = i === 0 ? '왼쪽 모니터' : '오른쪽 모니터';
    const size = `${d.bounds.width}×${d.bounds.height}`;
    return {
      key: { id: d.id, label: String(d.label || ''), x: d.bounds.x, y: d.bounds.y },
      name,
      detail: [d.label, size, d.id === primaryId ? '주 모니터' : ''].filter(Boolean).join(' · '),
      primary: d.id === primaryId,
    };
  });
}

function sameMonitor(a, b) {
  const x = normalizeMonitor(a);
  const y = normalizeMonitor(b);
  if (!x || !y) return !x && !y;
  return x.id === y.id && x.label === y.label && x.x === y.x && x.y === y.y;
}

module.exports = { normalizeMonitor, pickDisplay, describeDisplays, sameMonitor };
