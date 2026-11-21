import { state } from '../state.js';
import { RAW_CSV_DATA, GLITCH_COURSES } from '../data/courses.js';
import { escapeAttr } from '../utils/dom.js';
import { RANK_IMG_BASE, RANK_EXT, FLAG_BASE_URL } from '../config.js';
import { countryMatchesFilter } from './filter.js';
import { getVideoIcon, isModalVideoIcon } from '../ui/videoModal.js';
import { getRankImageSrc } from '../utils/dom.js';

export function switchCategory(cat) {
  let key = (cat === '200cc' || cat === 'Shroomless') ? 'Default' : cat;
  if (state.allCategoryData[key]) {
    state.globalRankingData = state.allCategoryData[key];
    if (state.currentSelectedCourse) renderRankingList();
  } else {
    console.warn("Data not ready for " + key);
  }
}

export function showRankingScreen(c) {
  state.currentSelectedCourse = c;
  state.currentTire = 'without';
  state.isGlitch = false;
  state.isReadMoreExpanded = false;
  updateToggleUI();

  document.body.classList.remove('mode-expanded');
  document.getElementById('cup-select-screen').classList.add('hidden');
  document.getElementById('ranking-screen').classList.remove('hidden');
  document.getElementById('ranking-course-title').innerText = c.name;

  const glitchBtn = document.getElementById('glitch-btn');
  glitchBtn.classList.toggle('hidden', !GLITCH_COURSES.includes(c.name));

  renderRankingList();
  window.scrollTo(0, 0);
}

export function goBackToCups() {
  document.getElementById('ranking-screen').classList.add('hidden');
  document.getElementById('cup-select-screen').classList.remove('hidden');
  state.currentSelectedCourse = null;
  if (state.activeCard) document.body.classList.add('mode-expanded');
}

export function toggleMode() {
  state.currentTire = (state.currentTire === 'without') ? 'dekatire' : 'without';
  updateToggleUI();
  renderRankingList();
}

export function toggleGlitchMode() {
  state.isGlitch = !state.isGlitch;
  updateToggleUI();
  renderRankingList();
}

export function toggleReadMore() {
  state.isReadMoreExpanded = true;
  renderRankingList();
}

function updateToggleUI() {
  const optWithout = document.getElementById('opt-without');
  const optDekatire = document.getElementById('opt-dekatire');
  const btnGlitch = document.getElementById('glitch-btn');

  optWithout.classList.remove('selected');
  optDekatire.classList.remove('selected');
  btnGlitch.classList.remove('active');

  if (state.currentTire === 'without') optWithout.classList.add('selected');
  else optDekatire.classList.add('selected');

  if (state.isGlitch) btnGlitch.classList.add('active');
}

export function renderRankingList() {
  const listEl = document.getElementById('rankingList');
  listEl.innerHTML = '';

  let key = state.currentSelectedCourse.file.substring(4);
  if (state.isGlitch) key += "_G";

  let data = state.globalRankingData[key] ? (state.globalRankingData[key][state.currentTire] || []) : [];
  data = data.filter(d => countryMatchesFilter(d.country));

  const displayCount = state.isReadMoreExpanded ? data.length : 8;

  for (let i = 0; i < displayCount; i++) {
    const d = data[i] || (i < 8 ? { rank: i+1, name: "---", time: "--:--", video: "-", country: "-" } : null);
    if (!d) continue;

    const row = document.createElement('div');
    row.className = `rank-row ${d.rank === 1 ? 'rank-1st' : ''} animate-slide-in`;
    row.style.animationDelay = `${(i+1)*0.04}s`;

    const iconSrc = getVideoIcon(d.video);
    const hasVid = (d.video !== '-' && d.video !== '' && iconSrc !== 'Novideo.webp');

    let flagHtml = '';
    if (d.country && d.country !== '-') {
      const countryCode = d.country.toLowerCase();
      flagHtml = `<img src="${countryCode === 'scotland' ? 'img/flag/scotland.webp' : `${FLAG_BASE_URL}${countryCode}.svg`}" onerror="this.style.visibility='hidden'">`;
    }
    const nameHtml = d.name !== '---' ? `<a href="/player/${encodeURIComponent(d.name)}" class="name-link" data-player="${escapeAttr(d.name)}">${d.name}</a>` : d.name;
    const timeHtml = hasVid ? `<a href="${escapeAttr(d.video)}" target="_blank" class="time-link">${d.time}</a>` : d.time;
    let rankContent;
    if (d.rank <= 8) {
      rankContent = `<img src="${getRankImageSrc(d.rank)}" onerror="this.style.display='none';this.parentElement.innerText='${d.rank}'">`;
    } else {
      rankContent = `<span style="font-size:1.5rem;font-weight:bold;">${d.rank}</span>`;
    }
    const isModalTarget = isModalVideoIcon(iconSrc);

  const isModalTarget = isModalVideoIcon(iconSrc);

    const iconHtml = hasVid
      ? (isModalTarget
        ? `<div class="video-icon" data-video-url="${escapeAttr(d.video)}" style="cursor:pointer"><img src="${iconSrc}"></div>`
        : `<a href="${escapeAttr(d.video)}" target="_blank"><img src="${iconSrc}"></a>`)
      : `<div class="no-link"><img src="Novideo.webp"></div>`;
    row.innerHTML = `<div class="section col-rank">${rankContent}</div><div class="section col-name">${nameHtml}</div><div class="section col-time">${timeHtml}</div><div class="section col-icon">${iconHtml}</div><div class="section col-flag">${flagHtml}</div>`;
    listEl.appendChild(row);
  }

  if (!state.isReadMoreExpanded && data.length > 8) {
    const btn = document.createElement('div');
    btn.className = 'read-more-btn animate-slide-in';
    btn.innerText = '▼ Load more ▼';
    btn.onclick = toggleReadMore;
    listEl.appendChild(btn);
  }
}

export function initRankingEvents() {
  document.querySelector('#ranking-screen .back-btn').addEventListener('click', goBackToCups);
  document.querySelector('#ranking-screen .mode-toggle').addEventListener('click', toggleMode);
  document.getElementById('glitch-btn').addEventListener('click', toggleGlitchMode);
  document.querySelector('#ranking-screen .earth-btn').addEventListener('click', () => window.dispatchEvent(new CustomEvent('open-country-filter')));
  document.querySelector('#ranking-screen .mobile-category-btn').addEventListener('click', () => document.getElementById('mobile-category-overlay').classList.add('visible'));

  document.querySelector('.capsule').addEventListener('click', (e) => {
    const item = e.target.closest('.capsule-item[data-cat]');
    if (item) switchCategory(item.dataset.cat);
  });

  const mobileCatOverlay = document.getElementById('mobile-category-overlay');
  mobileCatOverlay.addEventListener('click', () => mobileCatOverlay.classList.remove('visible'));
  mobileCatOverlay.querySelector('.mobile-category-list').addEventListener('click', (e) => e.stopPropagation());
  mobileCatOverlay.querySelectorAll('.mobile-category-item[data-cat]').forEach(item => {
    item.addEventListener('click', () => { switchCategory(item.dataset.cat); mobileCatOverlay.classList.remove('visible'); });
  });
}
