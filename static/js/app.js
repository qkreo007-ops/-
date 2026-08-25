/**
 * TutorMark Main Application Controller (Multi-Photo & Supabase Enabled)
 */

// Application State
const state = {
  role: 'student', // 'student' or 'teacher'
  students: [],
  currentStudent: null,
  submissions: [],
  currentSubmission: null,
  statusFilter: 'all',
  studentFilter: 'all',
  selectedPhotoFiles: [], // Array of File objects accumulated by student
  canvasEditor: null,
  activeAnnotatingSubmission: null,
  activePageIndex: 0,
  pageAnnotations: {}, // Cache of annotations per page: { 0: [...objects], 1: [...objects] }
  pageComments: {},    // Cache of the 총평 comment per page
  savedSignatures: {}, // Snapshot of each page's annotations as last persisted
  previewObjectUrls: [], // Blob URLs for the upload preview strip (revoked on re-render)
  supabaseClient: null,
  systemStatus: null
};

// URL resolver for Supabase Storage (https://...) and Local (/uploads/...)
function resolveImageUrl(pathOrUrl) {
  if (!pathOrUrl) return '';
  if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://') || pathOrUrl.startsWith('/')) {
    return pathOrUrl;
  }
  return `/uploads/${pathOrUrl}`;
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
  initUI();
  showLoadingPlaceholders();
  await checkSystemStatus();
  await loadStudents();
  await loadSubmissions();
  await loadStats();

  if (window.lucide) {
    lucide.createIcons();
  }
});

/**
 * Decides how the page talks to its data, in priority order:
 *   1. An explicit key the user saved in this browser (localStorage) always wins.
 *   2. Whatever the backend reports. If a server is reachable and says it is in
 *      local SQLite mode, that is authoritative - we must NOT quietly connect to
 *      the project baked into config.js, which would show the wrong data.
 *   3. config.js defaults, used only for static hosting with no backend at all.
 */
async function checkSystemStatus() {
  let supabaseUrl = '';
  let supabaseKey = '';
  let supabaseBucket = 'tutormark-files';
  let supabaseEnabled = false;
  let serverAnswered = false;

  // 1. Manual override saved from the connection modal
  const saved = localStorage.getItem('TUTORMARK_SUPABASE_CONFIG');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (parsed.url && parsed.key) {
        supabaseUrl = parsed.url;
        supabaseKey = parsed.key;
        supabaseBucket = parsed.bucket || 'tutormark-files';
        supabaseEnabled = true;
      }
    } catch (e) {
      console.warn('Stored Supabase config is unreadable, ignoring it.');
    }
  }

  // 2. Server / Cloudflare Function
  if (!supabaseEnabled) {
    try {
      const res = await fetch('/api/system/status');
      if (res.ok) {
        const data = await res.json();
        serverAnswered = true;
        state.serverStatus = data;
        if (data.supabase_enabled && data.supabase_url && data.supabase_key) {
          supabaseUrl = data.supabase_url;
          supabaseKey = data.supabase_key;
          supabaseBucket = data.supabase_bucket || 'tutormark-files';
          supabaseEnabled = true;
        } else if (data.supabase_enabled && data.client_direct_access === false) {
          // Server has Supabase but withheld a non-anon key: go through its API instead
          console.info('Server keeps its Supabase key private; using the server API.');
        }
      }
    } catch (err) {
      console.log('Server status API not reachable, checking client config...');
    }
  }

  // 3. Static-hosting default, only when no backend answered
  if (!supabaseEnabled && !serverAnswered &&
      window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.url && window.SUPABASE_CONFIG.anonKey) {
    supabaseUrl = window.SUPABASE_CONFIG.url;
    supabaseKey = window.SUPABASE_CONFIG.anonKey;
    supabaseBucket = window.SUPABASE_CONFIG.bucket || 'tutormark-files';
    supabaseEnabled = true;
  }

  // 4. Initialize Supabase Client
  state.supabaseClient = null;
  state.systemStatus = null;

  if (supabaseEnabled && window.supabase && supabaseUrl && supabaseKey) {
    try {
      state.supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);
      state.systemStatus = {
        supabase_enabled: true,
        supabase_url: supabaseUrl,
        supabase_key: supabaseKey,
        supabase_bucket: supabaseBucket
      };
    } catch (e) {
      console.error('Failed to init Supabase client:', e);
    }
  }

  renderConnectionBadge();
}

function renderConnectionBadge() {
  const badge = document.getElementById('supabase-status-badge');
  if (!badge) return;

  if (state.systemStatus && state.systemStatus.supabase_enabled) {
    badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span> ⚡ Supabase DB & Storage 연동됨`;
    badge.className = 'px-2.5 py-0.5 text-xs font-semibold rounded-full bg-emerald-900/80 text-emerald-300 border border-emerald-700 flex items-center gap-1.5 cursor-pointer hover:bg-emerald-800 transition';
    badge.title = `Supabase URL: ${state.systemStatus.supabase_url}
Bucket: ${state.systemStatus.supabase_bucket}
클릭하여 설정을 변경할 수 있습니다.`;
  } else {
    badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-amber-400"></span> 💾 로컬 모드 (SQLite)`;
    badge.className = 'px-2.5 py-0.5 text-xs font-semibold rounded-full bg-amber-900/60 text-amber-300 border border-amber-700 flex items-center gap-1.5 cursor-pointer hover:bg-amber-800 transition';
    badge.title = '클릭하여 Supabase 연동 키를 입력하고 활성화하세요.';
  }
  badge.onclick = () => openSupabaseGuideModal();
}

/** A cold Supabase connection can take several seconds - don't leave the page blank. */
function showLoadingPlaceholders() {
  const chips = document.getElementById('student-chips-container');
  if (chips && !chips.innerHTML.trim()) {
    chips.innerHTML = `
      <span class="px-3.5 py-2 rounded-xl text-sm text-slate-400 bg-slate-100 border border-slate-200 animate-pulse">
        학생 목록 불러오는 중...
      </span>`;
  }

  ['student-submissions-list', 'teacher-submissions-list'].forEach(id => {
    const list = document.getElementById(id);
    if (list && !list.innerHTML.trim()) {
      list.innerHTML = `
        <div class="py-12 text-center text-slate-400 bg-white rounded-2xl border border-dashed border-slate-200">
          <div class="inline-block w-6 h-6 border-2 border-slate-300 border-t-blue-500 rounded-full animate-spin mb-2"></div>
          <p class="text-sm font-medium">과제 목록을 불러오는 중입니다...</p>
        </div>`;
    }
  });
}

function initUI() {
  // Initialize Canvas Editor
  state.canvasEditor = new TutorMarkCanvasEditor('canvas-container');
  state.canvasEditor.onZoomChange = (zoomPercent) => {
    const zoomText = document.getElementById('zoom-percentage-text');
    if (zoomText) zoomText.innerText = `${zoomPercent}%`;
  };

  // Setup Role Buttons
  document.getElementById('btn-mode-student').addEventListener('click', () => switchRole('student'));
  document.getElementById('btn-mode-teacher').addEventListener('click', () => promptTeacherPin());

  // Setup Multi-Photo Inputs
  const photoInput = document.getElementById('student-photo-input');
  photoInput.addEventListener('change', handlePhotoSelect);

  const photoInputExtra = document.getElementById('student-photo-input-extra');
  if (photoInputExtra) {
    photoInputExtra.addEventListener('change', handlePhotoSelect);
  }

  document.getElementById('submission-form').addEventListener('submit', handleSubmissionSubmit);

  // Setup Canvas Page Navigation
  document.getElementById('btn-canvas-prev-page').addEventListener('click', () => {
    if (state.activePageIndex > 0) {
      switchCanvasPage(state.activePageIndex - 1);
    }
  });

  document.getElementById('btn-canvas-next-page').addEventListener('click', () => {
    const images = getActiveSubmissionImages();
    if (state.activePageIndex < images.length - 1) {
      switchCanvasPage(state.activePageIndex + 1);
    }
  });

  // Setup Canvas Toolbar
  setupCanvasToolbar();

  // Initialize High-Z-Index Lightbox Viewer
  lightbox.init();

  // Any element carrying data-lightbox-src opens the viewer (replaces inline onclick strings,
  // which broke on titles containing quotes and allowed markup to leak into the handler)
  document.addEventListener('click', (e) => {
    const dl = e.target.closest('[data-download-src]');
    if (dl) {
      e.preventDefault();
      e.stopPropagation();
      downloadImage(dl.dataset.downloadSrc, dl.dataset.downloadName);
      return;
    }

    const trigger = e.target.closest('[data-lightbox-src]');
    if (!trigger) return;
    openLightbox(trigger.dataset.lightboxSrc, trigger.dataset.lightboxTitle || '이미지 확대보기');
  });

  // Escape closes the topmost open modal
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!document.getElementById('image-lightbox-modal').classList.contains('hidden')) return; // lightbox handles itself
    if (!document.getElementById('supabase-guide-modal').classList.contains('hidden')) {
      closeSupabaseGuideModal();
    } else if (!document.getElementById('canvas-editor-modal').classList.contains('hidden')) {
      closeCanvasEditor();
    } else if (!document.getElementById('submission-detail-modal').classList.contains('hidden')) {
      closeDetailModal();
    }
  });

  // Warn before a reload discards an unsaved annotation
  window.addEventListener('beforeunload', (e) => {
    if (hasUnsavedAnnotations()) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // Keep the canvas backing store in sync with the viewport
  window.addEventListener('resize', () => {
    if (!document.getElementById('canvas-editor-modal').classList.contains('hidden')) {
      state.canvasEditor.resizeCanvas();
    }
  });
}

function annotationSignature(objs) {
  return JSON.stringify(objs || []);
}

function markPageSaved(pageIndex, objs) {
  state.savedSignatures[pageIndex] = annotationSignature(objs);
}

/** A page counts as unsaved only when its strokes differ from what was last persisted. */
function hasUnsavedAnnotations() {
  if (!state.activeAnnotatingSubmission || !state.canvasEditor) return false;

  const savedFor = (i) => state.savedSignatures[i] !== undefined ? state.savedSignatures[i] : '[]';

  if (annotationSignature(state.canvasEditor.exportVectorData()) !== savedFor(state.activePageIndex)) {
    return true;
  }
  return Object.keys(state.pageAnnotations).some(key => {
    const i = Number(key);
    return i !== state.activePageIndex && annotationSignature(state.pageAnnotations[key]) !== savedFor(i);
  });
}

function getActiveSubmissionImages() {
  if (!state.activeAnnotatingSubmission) return [];
  const sub = state.activeAnnotatingSubmission;
  return sub.images && sub.images.length > 0 ? sub.images : [sub.image_url || sub.image_filename];
}

// --- Role Management ---
function switchRole(role) {
  state.role = role;
  const studentBtn = document.getElementById('btn-mode-student');
  const teacherBtn = document.getElementById('btn-mode-teacher');
  const studentView = document.getElementById('student-view');
  const teacherView = document.getElementById('teacher-view');
  const roleBadge = document.getElementById('current-role-badge');

  if (role === 'student') {
    studentBtn.classList.add('bg-blue-600', 'text-white', 'shadow-md');
    studentBtn.classList.remove('bg-gray-100', 'text-gray-700');
    teacherBtn.classList.add('bg-gray-100', 'text-gray-700');
    teacherBtn.classList.remove('bg-purple-600', 'text-white', 'shadow-md');

    studentView.classList.remove('hidden');
    teacherView.classList.add('hidden');
    roleBadge.innerText = '학생 모드';
    roleBadge.className = 'px-2.5 py-0.5 text-xs font-semibold rounded-full bg-blue-100 text-blue-800';

    loadSubmissions();
  } else {
    teacherBtn.classList.add('bg-purple-600', 'text-white', 'shadow-md');
    teacherBtn.classList.remove('bg-gray-100', 'text-gray-700');
    studentBtn.classList.add('bg-gray-100', 'text-gray-700');
    studentBtn.classList.remove('bg-blue-600', 'text-white', 'shadow-md');

    teacherView.classList.remove('hidden');
    studentView.classList.add('hidden');
    roleBadge.innerText = '교사/관리자 모드';
    roleBadge.className = 'px-2.5 py-0.5 text-xs font-semibold rounded-full bg-purple-100 text-purple-800';

    loadStats();
    loadSubmissions();
  }

  if (window.lucide) lucide.createIcons();
}

// Used only when the verify-pin endpoint is unreachable (e.g. static Cloudflare Pages hosting)
const LOCAL_TEACHER_PINS = ['1234', '0000', 'admin'];

function promptTeacherPin() {
  if (state.role === 'teacher') return;
  
  const pin = prompt('교사/관리자 모드 접속 PIN 번호를 입력하세요 (기본: 1234):', '1234');
  if (pin === null) return;

  fetch('/api/teacher/verify-pin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: pin.trim() })
  })
  .then(res => res.json())
  .then(data => {
    if (data.success) {
      switchRole('teacher');
      showToast('선생님 모드로 전환되었습니다.', 'success');
    } else {
      showToast(data.message || '비밀번호가 올바르지 않습니다.', 'error');
    }
  })
  .catch(() => {
    // No backend (static hosting): fall back to a local check instead of granting access outright
    if (LOCAL_TEACHER_PINS.includes(pin.trim())) {
      switchRole('teacher');
      showToast('선생님 모드로 전환되었습니다.', 'success');
    } else {
      showToast('비밀번호가 올바르지 않습니다. (기본: 1234)', 'error');
    }
  });
}

// --- Data Loading ---
async function loadStudents() {
  try {
    let students = [];
    let loadedFromSupabase = false;

    if (state.supabaseClient) {
      const { data, error } = await state.supabaseClient.from('students').select('*').order('id', { ascending: true });
      if (error) {
        console.warn('Supabase students query failed, falling back to the local API:', error.message);
      } else {
        students = data || [];
        loadedFromSupabase = true;
      }
    }

    // Only reach for the local API when Supabase is absent or actually errored.
    // An empty Supabase table is a real answer and must not be overwritten by local data.
    if (!loadedFromSupabase) {
      const res = await fetch('/api/students');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) students = data;
      }
    }

    state.students = Array.isArray(students) ? students : [];

    // Re-bind the selection to the refreshed row (or the first student) so stale objects are not kept
    if (state.currentStudent) {
      const stillThere = state.students.find(s => s.id === state.currentStudent.id);
      state.currentStudent = stillThere || null;
    }
    if (!state.currentStudent && state.students.length > 0) {
      state.currentStudent = state.students[0];
    }

    renderStudentSelectUI();
    renderStudentFilterUI();
  } catch (err) {
    console.error('Failed to load students:', err);
  }
}

function renderStudentSelectUI() {
  const container = document.getElementById('student-chips-container');
  if (!container) return;

  if (state.students.length === 0) {
    container.innerHTML = `
      <span class="px-3.5 py-2 rounded-xl text-sm text-slate-400 bg-slate-50 border border-dashed border-slate-200">
        등록된 학생이 없습니다. [학생 추가]를 눌러주세요.
      </span>`;
    return;
  }

  container.innerHTML = state.students.map(s => `
    <button type="button" 
      onclick="selectStudent(${s.id})"
      class="student-chip px-3.5 py-2 rounded-xl text-sm font-medium transition-all flex items-center gap-2 border ${
        state.currentStudent && state.currentStudent.id === s.id
          ? 'bg-blue-50 border-blue-500 text-blue-700 shadow-sm ring-2 ring-blue-400/20'
          : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
      }">
      <span class="w-2.5 h-2.5 rounded-full" style="background-color: ${s.avatar_color}"></span>
      <span>${escapeHtml(s.name)}</span>
      <span class="text-xs text-gray-400 font-normal">(${escapeHtml(s.grade || '')})</span>
    </button>
  `).join('');
}

function renderStudentFilterUI() {
  const container = document.getElementById('teacher-student-filter');
  if (!container) return;

  let html = `
    <button onclick="setTeacherStudentFilter('all')" 
      class="px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
        state.studentFilter === 'all' ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
      }">전체 학생</button>
  `;

  state.students.forEach(s => {
    html += `
      <button onclick="setTeacherStudentFilter(${s.id})" 
        class="px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
          state.studentFilter === s.id ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
        }">${escapeHtml(s.name)}</button>
    `;
  });

  container.innerHTML = html;
}

function selectStudent(studentId) {
  const found = state.students.find(s => s.id === studentId);
  if (found) {
    state.currentStudent = found;
    renderStudentSelectUI();
    loadSubmissions();
  }
}

function setTeacherStudentFilter(filterVal) {
  state.studentFilter = filterVal;
  renderStudentFilterUI();
  loadSubmissions();
}

function setStatusFilter(status) {
  state.statusFilter = status;
  
  document.querySelectorAll('.status-filter-btn').forEach(btn => {
    if (btn.dataset.status === status) {
      btn.classList.add('bg-blue-600', 'text-white');
      btn.classList.remove('bg-gray-100', 'text-gray-600');
    } else {
      btn.classList.remove('bg-blue-600', 'text-white');
      btn.classList.add('bg-gray-100', 'text-gray-600');
    }
  });

  loadSubmissions();
}

async function loadStats() {
  try {
    let stats = null;
    if (state.supabaseClient) {
      const [stRes, subRes, pendRes, revRes] = await Promise.all([
        state.supabaseClient.from('students').select('id', { count: 'exact', head: true }),
        state.supabaseClient.from('submissions').select('id', { count: 'exact', head: true }),
        state.supabaseClient.from('submissions').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        state.supabaseClient.from('submissions').select('id', { count: 'exact', head: true }).eq('status', 'reviewed')
      ]);
      stats = {
        student_count: stRes.count || 0,
        total_submissions: subRes.count || 0,
        pending_count: pendRes.count || 0,
        reviewed_count: revRes.count || 0
      };
    } else {
      const res = await fetch('/api/stats');
      if (res.ok) stats = await res.json();
    }

    if (stats) {
      document.getElementById('stat-total-submissions').innerText = stats.total_submissions;
      document.getElementById('stat-pending-submissions').innerText = stats.pending_count;
      document.getElementById('stat-reviewed-submissions').innerText = stats.reviewed_count;
      document.getElementById('stat-student-count').innerText = stats.student_count;
    }
  } catch (err) {
    console.error('Failed to load stats:', err);
  }
}

async function loadSubmissions() {
  try {
    let submissions = [];
    let loadedFromSupabase = false;

    if (state.supabaseClient) {
      let query = state.supabaseClient.from('submissions').select('*, feedbacks(id)').order('id', { ascending: false });
      if (state.role === 'student' && state.currentStudent) {
        query = query.eq('student_id', state.currentStudent.id);
      } else if (state.role === 'teacher' && state.studentFilter !== 'all') {
        query = query.eq('student_id', state.studentFilter);
      }
      if (state.statusFilter !== 'all') {
        query = query.eq('status', state.statusFilter);
      }

      const { data, error } = await query;
      if (error) {
        console.warn('Supabase submissions query failed, falling back to the local API:', error.message);
      } else {
        loadedFromSupabase = true;
        submissions = (data || []).map(sub => {
          let images = [];
          if (sub.image_urls) {
            images = typeof sub.image_urls === 'string' ? JSON.parse(sub.image_urls) : sub.image_urls;
          } else if (sub.image_url) {
            images = [sub.image_url];
          }
          return {
            ...sub,
            images,
            feedback_count: Array.isArray(sub.feedbacks) ? sub.feedbacks.length : 0
          };
        });
      }
    }

    if (!loadedFromSupabase) {
      const params = new URLSearchParams();
      if (state.role === 'student' && state.currentStudent) {
        params.set('student_id', state.currentStudent.id);
      } else if (state.role === 'teacher' && state.studentFilter !== 'all') {
        params.set('student_id', state.studentFilter);
      }
      if (state.statusFilter !== 'all') {
        params.set('status', state.statusFilter);
      }
      const res = await fetch(`/api/submissions?${params.toString()}`);
      if (res.ok) submissions = await res.json();
    }

    state.submissions = Array.isArray(submissions) ? submissions : [];

    if (state.role === 'student') {
      renderStudentSubmissions();
    } else {
      renderTeacherSubmissions();
    }
  } catch (err) {
    console.error('Failed to load submissions:', err);
  }
}

// --- Render Submissions ---
function renderStudentSubmissions() {
  const container = document.getElementById('student-submissions-list');
  if (!container) return;

  if (state.submissions.length === 0) {
    container.innerHTML = `
      <div class="py-12 text-center text-gray-400 bg-white rounded-2xl border border-dashed border-gray-200">
        <i data-lucide="image-off" class="w-12 h-12 mx-auto mb-3 text-gray-300"></i>
        <p class="font-medium text-gray-500">제출된 사진 과제가 없습니다.</p>
        <p class="text-xs text-gray-400 mt-1">위의 사진 찍어 올리기에서 공부한 시험지나 책을 찍어 올려보세요!</p>
      </div>
    `;
    if (window.lucide) lucide.createIcons();
    return;
  }

  container.innerHTML = state.submissions.map(sub => {
    const images = sub.images && sub.images.length > 0 ? sub.images : [sub.image_url || sub.image_filename];
    const firstImgSrc = resolveImageUrl(images[0]);
    const count = images.length;

    return `
    <div class="bg-white rounded-2xl border border-gray-200/80 shadow-sm overflow-hidden hover:shadow-md transition">
      <div class="p-5 flex flex-col md:flex-row gap-5 items-start">
        <div class="w-full md:w-44 h-44 bg-slate-900 rounded-xl overflow-hidden relative cursor-pointer group flex-shrink-0"
             onclick="openDetailModal(${sub.id})">
          <img src="${escapeHtml(firstImgSrc)}" class="w-full h-full object-cover group-hover:scale-105 transition duration-300" alt="과제 사진">
          ${count > 1 ? `
            <div class="absolute top-2 right-2 px-2 py-0.5 rounded-lg bg-black/75 text-white font-bold text-xs flex items-center gap-1 backdrop-blur-xs">
              <i data-lucide="images" class="w-3 h-3"></i> ${count}장
            </div>
          ` : ''}
          <div class="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-white font-medium text-xs gap-1">
            <i data-lucide="zoom-in" class="w-4 h-4"></i> 상세보기 (${count}장)
          </div>
        </div>
        
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 mb-2">
            <span class="px-2.5 py-0.5 text-xs font-semibold rounded-md bg-blue-100 text-blue-700">${escapeHtml(sub.subject)}</span>
            ${count > 1 ? `<span class="px-2 py-0.5 text-xs font-semibold rounded-md bg-slate-100 text-slate-700">${count}장 첨부</span>` : ''}
            ${sub.status === 'reviewed' 
              ? `<span class="px-2.5 py-0.5 text-xs font-semibold rounded-md bg-emerald-100 text-emerald-700 flex items-center gap-1"><i data-lucide="check-circle" class="w-3 h-3"></i> 선생님 첨삭 완료 (${sub.feedback_count || 1}건)</span>`
              : `<span class="px-2.5 py-0.5 text-xs font-semibold rounded-md bg-amber-100 text-amber-700 flex items-center gap-1"><i data-lucide="clock" class="w-3 h-3"></i> 선생님 확인 대기중</span>`
            }
            <span class="text-xs text-gray-400 ml-auto">${sub.created_at?.slice(0, 16).replace('T', ' ')}</span>
          </div>

          <h3 class="font-bold text-gray-800 text-lg mb-1 truncate">${escapeHtml(sub.title)}</h3>
          
          ${sub.memo ? `<p class="text-sm text-gray-600 bg-gray-50 p-3 rounded-lg border border-gray-100 mb-3"><span class="font-semibold text-gray-700">학생 메모:</span> ${escapeHtml(sub.memo)}</p>` : ''}
          
          <div class="flex items-center gap-3 pt-2">
            <button onclick="openDetailModal(${sub.id})" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl flex items-center gap-1.5 transition">
              <i data-lucide="message-square" class="w-3.5 h-3.5"></i> 
              ${sub.status === 'reviewed' ? '선생님 첨삭 및 코멘트 보기' : '과제 상세보기'}
            </button>
            <button onclick="confirmDeleteSubmission(${sub.id})" class="px-3 py-2 text-gray-400 hover:text-red-500 text-xs font-medium rounded-lg hover:bg-red-50 transition">
              삭제
            </button>
          </div>
        </div>
      </div>
    </div>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons();
}

function renderTeacherSubmissions() {
  const container = document.getElementById('teacher-submissions-list');
  if (!container) return;

  if (state.submissions.length === 0) {
    container.innerHTML = `
      <div class="py-16 text-center text-gray-400 bg-white rounded-2xl border border-dashed border-gray-200">
        <i data-lucide="inbox" class="w-12 h-12 mx-auto mb-3 text-gray-300"></i>
        <p class="font-medium text-gray-500">해당 조건의 학생 과제가 없습니다.</p>
      </div>
    `;
    if (window.lucide) lucide.createIcons();
    return;
  }

  container.innerHTML = state.submissions.map(sub => {
    const images = sub.images && sub.images.length > 0 ? sub.images : [sub.image_url || sub.image_filename];
    const firstImgSrc = resolveImageUrl(images[0]);
    const count = images.length;

    return `
    <div class="bg-white rounded-2xl border border-gray-200/80 shadow-sm hover:shadow-md transition overflow-hidden">
      <div class="p-5 flex flex-col md:flex-row gap-5 items-start">
        <div class="w-full md:w-48 h-48 bg-slate-900 rounded-xl overflow-hidden relative group cursor-pointer flex-shrink-0"
             onclick="openCanvasEditor(${sub.id}, 0)">
          <img src="${escapeHtml(firstImgSrc)}" class="w-full h-full object-cover group-hover:scale-105 transition duration-300" alt="과제 사진">
          ${count > 1 ? `
            <div class="absolute top-2 right-2 px-2.5 py-0.5 rounded-lg bg-black/80 text-white font-bold text-xs flex items-center gap-1 backdrop-blur-xs">
              <i data-lucide="images" class="w-3 h-3 text-purple-300"></i> 총 ${count}장
            </div>
          ` : ''}
          <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex flex-col items-center justify-center text-white font-semibold text-xs gap-1.5">
            <i data-lucide="edit-3" class="w-6 h-6 text-purple-300"></i>
            <span>클릭하여 캔버스 첨삭하기</span>
          </div>
        </div>

        <div class="flex-1 min-w-0">
          <div class="flex flex-wrap items-center gap-2 mb-2">
            <span class="px-2.5 py-0.5 text-xs font-bold rounded-md bg-purple-100 text-purple-700">${escapeHtml(sub.student_name)}</span>
            <span class="px-2.5 py-0.5 text-xs font-semibold rounded-md bg-gray-100 text-gray-700">${escapeHtml(sub.subject)}</span>
            ${count > 1 ? `<span class="px-2 py-0.5 text-xs font-bold rounded-md bg-purple-50 text-purple-700 border border-purple-200">${count}장의 사진</span>` : ''}
            
            ${sub.status === 'reviewed' 
              ? `<span class="px-2.5 py-0.5 text-xs font-bold rounded-md bg-emerald-100 text-emerald-800 flex items-center gap-1"><i data-lucide="check" class="w-3.5 h-3.5"></i> 첨삭 완료 (${sub.feedback_count || 1}건)</span>`
              : `<span class="px-2.5 py-0.5 text-xs font-bold rounded-md bg-rose-100 text-rose-700 flex items-center gap-1 animate-pulse"><i data-lucide="alert-circle" class="w-3.5 h-3.5"></i> 미첨삭 (첨삭 필요)</span>`
            }
            <span class="text-xs text-gray-400 ml-auto">${sub.created_at?.slice(0, 16).replace('T', ' ')}</span>
          </div>

          <h3 class="font-bold text-gray-800 text-xl mb-1 truncate">${escapeHtml(sub.title)}</h3>
          
          ${sub.memo ? `
            <div class="bg-amber-50/70 border border-amber-200/60 p-3 rounded-xl mb-3 text-sm text-gray-700">
              <span class="font-bold text-amber-900">학생 질문/메모:</span> ${escapeHtml(sub.memo)}
            </div>
          ` : ''}

          <div class="flex flex-wrap items-center gap-2.5 pt-2">
            <button onclick="openCanvasEditor(${sub.id}, 0)" class="px-4 py-2.5 bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold rounded-xl flex items-center gap-2 shadow-sm transition">
              <i data-lucide="edit-3" class="w-4 h-4"></i> 사진 확대 및 마우스/글자 첨삭하기
            </button>
            <button onclick="openDetailModal(${sub.id})" class="px-3.5 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold rounded-xl flex items-center gap-1.5 transition">
              <i data-lucide="message-circle" class="w-3.5 h-3.5"></i> 과제 & 첨삭 피드백 (${sub.feedback_count || 0})
            </button>
            <button onclick="confirmDeleteSubmission(${sub.id})" class="px-3 py-2.5 text-gray-400 hover:text-red-600 text-xs font-medium rounded-lg hover:bg-red-50 transition ml-auto">
              <i data-lucide="trash-2" class="w-3.5 h-3.5"></i> 삭제
            </button>
          </div>
        </div>
      </div>
    </div>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons();
}

// --- Student Multi-Photo Upload Handlers ---
function handlePhotoSelect(e) {
  const newFiles = Array.from(e.target.files);
  if (!newFiles || newFiles.length === 0) return;

  // Append new files to state list
  state.selectedPhotoFiles.push(...newFiles);
  renderPhotoThumbnails();

  // Clear input value so same file can be chosen again if needed
  e.target.value = '';
}

function releasePreviewObjectUrls() {
  state.previewObjectUrls.forEach(url => URL.revokeObjectURL(url));
  state.previewObjectUrls = [];
}

function renderPhotoThumbnails() {
  const container = document.getElementById('photo-preview-container');
  const grid = document.getElementById('photo-thumbnails-grid');
  const badge = document.getElementById('student-photo-count-badge');

  // Every render mints fresh blob URLs, so free the previous batch or they leak for the session
  releasePreviewObjectUrls();

  if (state.selectedPhotoFiles.length === 0) {
    container.classList.add('hidden');
    badge.classList.add('hidden');
    grid.innerHTML = '';
    return;
  }

  container.classList.remove('hidden');
  badge.classList.remove('hidden');
  badge.innerText = `총 ${state.selectedPhotoFiles.length}장의 사진 선택됨 (클릭시 크게보기)`;

  grid.innerHTML = state.selectedPhotoFiles.map((file, idx) => {
    const objectUrl = URL.createObjectURL(file);
    state.previewObjectUrls.push(objectUrl);
    return `
      <div class="relative group aspect-square rounded-xl overflow-hidden bg-slate-800 border-2 border-slate-700 shadow-sm cursor-pointer"
           data-lightbox-src="${escapeHtml(objectUrl)}" data-lightbox-title="선택한 사진 미리보기 (${idx + 1}페이지)">
        <img src="${escapeHtml(objectUrl)}" class="w-full h-full object-cover group-hover:scale-105 transition duration-200" alt="사진 ${idx + 1}">
        <span class="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/80 text-white font-bold text-[10px] backdrop-blur-xs">
          ${idx + 1}페이지
        </span>
        <div class="absolute inset-0 bg-black/35 opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-white text-[11px] font-semibold gap-1 pointer-events-none">
          <i data-lucide="zoom-in" class="w-3.5 h-3.5"></i> 크게보기
        </div>
        <button type="button" onclick="event.stopPropagation(); removeSelectedPhoto(${idx})"
                class="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-rose-600 hover:bg-rose-700 text-white flex items-center justify-center shadow transition z-10" title="이 사진 삭제">
          &times;
        </button>
      </div>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons();
}

function removeSelectedPhoto(index) {
  state.selectedPhotoFiles.splice(index, 1);
  renderPhotoThumbnails();
}

function base64ToBlob(dataUrl) {
  const arr = dataUrl.split(',');
  const mime = arr[0].match(/:(.*?);/)[1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
}

// Universal Submission Detail Fetcher (Supabase Direct & Local API)
async function fetchSubmissionDetail(submissionId) {
  if (state.supabaseClient) {
    const { data: subData, error: subErr } = await state.supabaseClient
      .from('submissions')
      .select('*')
      .eq('id', submissionId)
      .single();

    if (subErr) throw new Error(subErr.message || '과제 정보를 불러오지 못했습니다.');

    const { data: fbData } = await state.supabaseClient
      .from('feedbacks')
      .select('*')
      .eq('submission_id', submissionId)
      .order('id', { ascending: true });

    let images = [];
    if (subData.image_urls) {
      images = typeof subData.image_urls === 'string' ? JSON.parse(subData.image_urls) : subData.image_urls;
    } else if (subData.image_url) {
      images = [subData.image_url];
    }

    return {
      ...subData,
      images,
      feedbacks: fbData || []
    };
  }

  // Fallback to local server API
  const res = await fetch(`/api/submissions/${submissionId}`);
  if (!res.ok) throw new Error('과제 정보를 불러오지 못했습니다.');
  return await res.json();
}

async function handleSubmissionSubmit(e) {
  e.preventDefault();

  if (!state.currentStudent) {
    showToast('학생을 먼저 선택해주세요.', 'error');
    return;
  }

  if (state.selectedPhotoFiles.length === 0) {
    showToast('촬영하거나 선택한 사진 파일이 없습니다.', 'error');
    return;
  }

  const subject = document.getElementById('submission-subject').value;
  const title = document.getElementById('submission-title').value.trim();
  const memo = document.getElementById('submission-memo').value.trim();

  if (!title) {
    showToast('과제 제목(예: 수학 익힘책 42p)을 입력해주세요.', 'error');
    return;
  }

  const submitBtn = document.getElementById('btn-submit-work');
  submitBtn.disabled = true;
  submitBtn.innerHTML = `<span class="inline-block animate-spin mr-2">⏳</span> 사진 ${state.selectedPhotoFiles.length}장 업로드 중...`;

  try {
    // 1. If Supabase Client is active, upload directly to Supabase Storage & DB
    if (state.supabaseClient) {
      const bucket = state.systemStatus?.supabase_bucket || window.SUPABASE_CONFIG?.bucket || 'tutormark-files';
      const uploadedUrls = [];

      for (let i = 0; i < state.selectedPhotoFiles.length; i++) {
        const file = state.selectedPhotoFiles[i];
        const ext = file.name.split('.').pop() || 'jpg';
        const filename = `sub_${Date.now()}_${Math.random().toString(36).substring(2, 7)}_p${i + 1}.${ext}`;

        const { data: uploadData, error: uploadErr } = await state.supabaseClient.storage
          .from(bucket)
          .upload(filename, file, { contentType: file.type || 'image/jpeg', upsert: true });

        if (uploadErr) throw new Error('사진 저장 실패: ' + uploadErr.message);

        const { data: { publicUrl } } = state.supabaseClient.storage
          .from(bucket)
          .getPublicUrl(filename);

        uploadedUrls.push(publicUrl);
      }

      const { data: newSub, error: insertErr } = await state.supabaseClient
        .from('submissions')
        .insert([{
          student_id: state.currentStudent.id,
          student_name: state.currentStudent.name,
          subject: subject,
          title: title,
          memo: memo,
          image_url: uploadedUrls[0] || '',
          image_urls: uploadedUrls,
          status: 'pending',
          created_at: new Date().toISOString()
        }])
        .select();

      if (insertErr) throw new Error('과제 저장 실패: ' + insertErr.message);

      showToast(`사진 ${state.selectedPhotoFiles.length}장이 성공적으로 제출되었습니다!`, 'success');
      document.getElementById('submission-title').value = '';
      document.getElementById('submission-memo').value = '';
      state.selectedPhotoFiles = [];
      renderPhotoThumbnails();

      await loadSubmissions();
      await loadStats();
      return;
    }

    // 2. Otherwise fallback to local API
    const formData = new FormData();
    formData.append('student_id', state.currentStudent.id);
    formData.append('student_name', state.currentStudent.name);
    formData.append('subject', subject);
    formData.append('title', title);
    formData.append('memo', memo);

    state.selectedPhotoFiles.forEach(file => {
      formData.append('files', file);
    });

    const res = await fetch('/api/submissions', {
      method: 'POST',
      body: formData
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || '업로드 실패');
    }

    showToast(`사진 ${state.selectedPhotoFiles.length}장이 성공적으로 제출되었습니다!`, 'success');
    document.getElementById('submission-title').value = '';
    document.getElementById('submission-memo').value = '';
    state.selectedPhotoFiles = [];
    renderPhotoThumbnails();

    await loadSubmissions();
    await loadStats();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = `<i data-lucide="upload" class="w-4 h-4"></i> 선생님께 사진 과제 제출하기`;
    if (window.lucide) lucide.createIcons();
  }
}

// --- Detail Modal & Multi-Photo Gallery ---
async function openDetailModal(submissionId) {
  try {
    const sub = await fetchSubmissionDetail(submissionId);
    state.currentSubmission = sub;

    const modal = document.getElementById('submission-detail-modal');
    document.getElementById('modal-sub-title').innerText = sub.title;
    document.getElementById('modal-sub-student').innerText = sub.student_name;
    document.getElementById('modal-sub-subject').innerText = sub.subject;
    document.getElementById('modal-sub-date').innerText = sub.created_at?.slice(0, 16).replace('T', ' ');
    
    const memoContainer = document.getElementById('modal-sub-memo-container');
    if (sub.memo) {
      memoContainer.classList.remove('hidden');
      document.getElementById('modal-sub-memo').innerText = sub.memo;
    } else {
      memoContainer.classList.add('hidden');
    }

    // Render Multi-Photo Gallery
    const images = sub.images && sub.images.length > 0 ? sub.images : [sub.image_url || sub.image_filename];
    document.getElementById('modal-photos-count').innerText = `${images.length}`;
    
    const gallery = document.getElementById('modal-photos-gallery');
    gallery.innerHTML = images.map((imgUrl, idx) => {
      const fullUrl = resolveImageUrl(imgUrl);
      return `
        <div class="relative group rounded-2xl overflow-hidden bg-slate-950 border border-slate-200 cursor-pointer aspect-[3/4] shadow-xs"
             data-lightbox-src="${escapeHtml(fullUrl)}" data-lightbox-title="${escapeHtml(sub.title)} - ${idx + 1}페이지">
          <img src="${escapeHtml(fullUrl)}" class="w-full h-full object-cover group-hover:scale-105 transition duration-300" alt="과제 ${idx + 1}페이지">
          <span class="absolute top-2 left-2 px-2 py-0.5 rounded-lg bg-black/80 text-white font-bold text-xs backdrop-blur-xs">
            ${idx + 1}페이지
          </span>
          <div class="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-white text-xs font-semibold gap-1">
            <i data-lucide="zoom-in" class="w-4 h-4"></i> 크게보기
          </div>
        </div>
      `;
    }).join('');

    // Render Feedbacks
    renderFeedbacksList(sub.feedbacks || []);

    // Teacher quick annotate button
    const teacherAnnotateBtn = document.getElementById('modal-btn-annotate');
    if (state.role === 'teacher') {
      teacherAnnotateBtn.classList.remove('hidden');
      teacherAnnotateBtn.onclick = () => {
        closeDetailModal();
        openCanvasEditor(sub.id, 0);
      };
    } else {
      teacherAnnotateBtn.classList.add('hidden');
    }

    modal.classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function renderFeedbacksList(feedbacks) {
  const container = document.getElementById('modal-feedbacks-container');
  const countBadge = document.getElementById('modal-feedback-count');
  countBadge.innerText = `${feedbacks.length}건`;

  if (feedbacks.length === 0) {
    container.innerHTML = `
      <div class="p-6 text-center text-gray-400 bg-gray-50 rounded-xl border border-dashed border-gray-200">
        <i data-lucide="clock" class="w-8 h-8 mx-auto mb-2 text-gray-300"></i>
        <p class="text-sm font-medium text-gray-500">아직 선생님 첨삭 피드백이 등록되지 않았습니다.</p>
        <p class="text-xs text-gray-400 mt-0.5">선생님이 첨삭을 완료하면 이곳에 첨삭본과 코멘트가 댓글 형태로 표시됩니다.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = feedbacks.map((fb, idx) => {
    const fbImgUrl = resolveImageUrl(fb.annotated_image_url || fb.annotated_image_filename);
    const pageNum = (fb.page_index !== undefined && fb.page_index !== null) ? fb.page_index + 1 : 1;

    return `
    <div class="bg-purple-50/50 border border-purple-100 rounded-2xl p-4 shadow-sm">
      <div class="flex items-center justify-between mb-2.5">
        <div class="flex items-center gap-2">
          <span class="w-6 h-6 rounded-full bg-purple-600 text-white flex items-center justify-center text-xs font-bold">
            ${idx + 1}
          </span>
          <span class="font-bold text-gray-800 text-sm">${escapeHtml(fb.teacher_name || '선생님')} 첨삭 피드백</span>
          <span class="px-2 py-0.5 rounded-md bg-purple-200/80 text-purple-900 font-bold text-xs">[${pageNum}페이지 첨삭]</span>
        </div>
        <span class="text-xs text-gray-400">${fb.created_at?.slice(0, 16).replace('T', ' ')}</span>
      </div>

      ${fb.comment ? `
        <div class="bg-white p-3.5 rounded-xl border border-purple-100 text-sm text-gray-700 mb-3 shadow-xs">
          <p class="font-semibold text-purple-900 text-xs mb-1">📝 선생님 총평 및 코멘트:</p>
          <p class="whitespace-pre-line">${escapeHtml(fb.comment)}</p>
        </div>
      ` : ''}

      <div class="relative group rounded-xl overflow-hidden bg-slate-950 border border-purple-200 max-h-96 cursor-pointer"
           data-lightbox-src="${escapeHtml(fbImgUrl)}" data-lightbox-title="선생님 첨삭본 (${pageNum}페이지, ${idx + 1}차)">
        <img src="${escapeHtml(fbImgUrl)}" class="w-full h-auto object-contain mx-auto max-h-96" alt="첨삭 이미지">
        <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-white text-xs font-semibold gap-1.5">
          <i data-lucide="zoom-in" class="w-4 h-4"></i> 클릭하여 첨삭본 크게 확대보기
        </div>
      </div>

      <div class="flex items-center justify-end gap-2 mt-2.5">
        <a href="${escapeHtml(fbImgUrl)}" target="_blank" rel="noopener"
           data-download-src="${escapeHtml(fbImgUrl)}" data-download-name="첨삭피드백_${pageNum}페이지_${idx + 1}.jpg" 
           class="text-xs text-purple-600 hover:text-purple-800 font-medium flex items-center gap-1 px-2.5 py-1 rounded hover:bg-purple-100/50 transition">
          <i data-lucide="download" class="w-3.5 h-3.5"></i> 첨삭본 다운로드
        </a>
        ${state.role === 'teacher' ? `
          <button onclick="deleteFeedback(${fb.id})" class="text-xs text-red-500 hover:text-red-700 font-medium px-2 py-1 rounded hover:bg-red-50 transition">
            피드백 삭제
          </button>
        ` : ''}
      </div>
    </div>
    `;
  }).join('');
}

function closeDetailModal() {
  document.getElementById('submission-detail-modal').classList.add('hidden');
}

// --- Canvas Annotation Studio Modal (Multi-Page Supported) ---
async function openCanvasEditor(submissionId, pageIndex = 0) {
  try {
    const sub = await fetchSubmissionDetail(submissionId);
    state.activeAnnotatingSubmission = sub;
    state.activePageIndex = pageIndex;
    state.pageComments = {};

    // Reopening a reviewed submission restores the strokes from the most recent
    // feedback of each page, so the teacher can amend rather than redraw.
    state.pageAnnotations = collectSavedAnnotations(sub);

    document.getElementById('canvas-student-info').innerText = `${sub.student_name} (${sub.subject})`;
    document.getElementById('canvas-submission-title').innerText = sub.title;
    document.getElementById('canvas-feedback-comment').value = '';

    const modal = document.getElementById('canvas-editor-modal');
    modal.classList.remove('hidden');

    updateCanvasPageUI();

    state.canvasEditor.resizeCanvas();
    const images = getActiveSubmissionImages();
    if (images.length === 0) {
      throw new Error('이 과제에는 첨삭할 사진이 없습니다.');
    }

    const targetImageUrl = resolveImageUrl(images[state.activePageIndex] || images[0]);
    // Pass the saved strokes into loadImage so they survive its internal reset
    await state.canvasEditor.loadImage(targetImageUrl, state.pageAnnotations[state.activePageIndex] || null);

    if (window.lucide) lucide.createIcons();

    Object.keys(state.pageAnnotations).forEach(i => markPageSaved(i, state.pageAnnotations[i]));
    markPageSaved(state.activePageIndex, state.canvasEditor.exportVectorData());

    const restored = (state.pageAnnotations[state.activePageIndex] || []).length;
    showToast(
      restored > 0
        ? `첨삭 에디터가 준비되었습니다. (${state.activePageIndex + 1}페이지 · 기존 첨삭 ${restored}개 불러옴)`
        : `첨삭 에디터가 준비되었습니다. (현재 ${state.activePageIndex + 1}페이지)`,
      'info'
    );
  } catch (err) {
    document.getElementById('canvas-editor-modal').classList.add('hidden');
    state.activeAnnotatingSubmission = null;
    showToast('캔버스 열기 실패: ' + err.message, 'error');
  }
}

/** Latest feedback per page wins, so amending twice keeps building on the newest version. */
function collectSavedAnnotations(sub) {
  const byPage = {};
  (sub.feedbacks || []).forEach(fb => {
    const page = Number(fb.page_index) || 0;
    const objs = state.canvasEditor.parseVectorData(fb.annotation_data);
    if (objs.length > 0) byPage[page] = objs;
  });
  return byPage;
}

function switchCanvasPage(newPageIndex) {
  if (!state.activeAnnotatingSubmission) return;
  const images = getActiveSubmissionImages();
  if (newPageIndex < 0 || newPageIndex >= images.length) return;

  const commentInput = document.getElementById('canvas-feedback-comment');

  // Stash this page's work before swapping the background image out from under it
  state.pageAnnotations[state.activePageIndex] = state.canvasEditor.exportVectorData();
  state.pageComments[state.activePageIndex] = commentInput.value;

  state.activePageIndex = newPageIndex;
  updateCanvasPageUI();
  commentInput.value = state.pageComments[newPageIndex] || '';

  const targetImageUrl = resolveImageUrl(images[newPageIndex]);
  state.canvasEditor
    .loadImage(targetImageUrl, state.pageAnnotations[newPageIndex] || null)
    .catch(err => showToast(`${newPageIndex + 1}페이지 이미지를 불러오지 못했습니다: ${err.message}`, 'error'));
}

function updateCanvasPageUI() {
  const images = getActiveSubmissionImages();
  const total = images.length;
  const current = state.activePageIndex + 1;

  document.getElementById('canvas-page-indicator').innerText = `${current} / ${total} 페이지`;
  document.getElementById('canvas-active-page-label').innerText = `[${current}페이지]`;

  const prevBtn = document.getElementById('btn-canvas-prev-page');
  const nextBtn = document.getElementById('btn-canvas-next-page');

  if (state.activePageIndex <= 0) {
    prevBtn.disabled = true;
    prevBtn.classList.add('opacity-40', 'cursor-not-allowed');
  } else {
    prevBtn.disabled = false;
    prevBtn.classList.remove('opacity-40', 'cursor-not-allowed');
  }

  if (state.activePageIndex >= total - 1) {
    nextBtn.disabled = true;
    nextBtn.classList.add('opacity-40', 'cursor-not-allowed');
  } else {
    nextBtn.disabled = false;
    nextBtn.classList.remove('opacity-40', 'cursor-not-allowed');
  }
}

function closeCanvasEditor(force = false) {
  if (force !== true && hasUnsavedAnnotations()) {
    if (!confirm('저장하지 않은 첨삭 내용이 있습니다. 정말 닫으시겠습니까?')) return;
  }

  document.getElementById('canvas-editor-modal').classList.add('hidden');
  state.activeAnnotatingSubmission = null;
  state.pageAnnotations = {};
  state.pageComments = {};
  state.savedSignatures = {};
  state.activePageIndex = 0;
}

// Setup Canvas Toolbar
function setupCanvasToolbar() {
  const editor = state.canvasEditor;

  const toolButtons = document.querySelectorAll('.canvas-tool-btn');
  toolButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const tool = btn.dataset.tool;
      toolButtons.forEach(b => b.classList.remove('active', 'bg-blue-600', 'text-white'));
      btn.classList.add('active', 'bg-blue-600', 'text-white');
      editor.setTool(tool);
    });
  });

  const colorSwatches = document.querySelectorAll('.canvas-color-swatch');
  colorSwatches.forEach(swatch => {
    swatch.addEventListener('click', () => {
      const color = swatch.dataset.color;
      colorSwatches.forEach(s => s.classList.remove('active'));
      swatch.classList.add('active');
      editor.setColor(color);
    });
  });

  const customColorInput = document.getElementById('canvas-custom-color');
  if (customColorInput) {
    customColorInput.addEventListener('input', (e) => {
      colorSwatches.forEach(sw => sw.classList.remove('active'));
      editor.setColor(e.target.value);
    });
  }

  const strokeSlider = document.getElementById('stroke-width-slider');
  if (strokeSlider) {
    strokeSlider.addEventListener('input', (e) => {
      editor.setLineWidth(parseInt(e.target.value, 10));
      document.getElementById('stroke-width-val').innerText = `${e.target.value}px`;
    });
  }

  const fontSlider = document.getElementById('font-size-slider');
  if (fontSlider) {
    fontSlider.addEventListener('input', (e) => {
      editor.setFontSize(parseInt(e.target.value, 10));
      document.getElementById('font-size-val').innerText = `${e.target.value}px`;
    });
  }

  document.getElementById('btn-zoom-in').addEventListener('click', () => editor.zoomIn());
  document.getElementById('btn-zoom-out').addEventListener('click', () => editor.zoomOut());
  document.getElementById('btn-zoom-fit').addEventListener('click', () => editor.fitToScreen());
  document.getElementById('btn-zoom-100').addEventListener('click', () => editor.resetZoom());

  document.getElementById('btn-canvas-undo').addEventListener('click', () => editor.undo());
  document.getElementById('btn-canvas-redo').addEventListener('click', () => editor.redo());
  document.getElementById('btn-canvas-clear').addEventListener('click', () => {
    if (confirm('현재 페이지 캔버스에 작성한 모든 첨삭을 초기화하시겠습니까?')) {
      editor.clearAll();
    }
  });

  document.getElementById('btn-save-feedback').addEventListener('click', handleSaveFeedback);
}

async function handleSaveFeedback() {
  if (!state.activeAnnotatingSubmission) return;

  const saveBtn = document.getElementById('btn-save-feedback');
  saveBtn.disabled = true;
  saveBtn.innerHTML = `<span class="inline-block animate-spin mr-2">⏳</span> ${state.activePageIndex + 1}페이지 첨삭본 저장 중...`;

  try {
    const exported = state.canvasEditor.exportAnnotatedImage();
    if (!exported) {
      throw new Error('이미지를 내보내지 못했습니다.');
    }

    const comment = document.getElementById('canvas-feedback-comment').value.trim();

    // 1. Direct Supabase Storage & DB upload
    if (state.supabaseClient) {
      const bucket = state.systemStatus?.supabase_bucket || window.SUPABASE_CONFIG?.bucket || 'tutormark-files';
      const blob = base64ToBlob(exported.dataUrl);
      const filename = `fb_${state.activeAnnotatingSubmission.id}_p${state.activePageIndex + 1}_${Date.now()}.jpg`;

      const { data: uploadData, error: uploadErr } = await state.supabaseClient.storage
        .from(bucket)
        .upload(filename, blob, { contentType: 'image/jpeg', upsert: true });

      if (uploadErr) throw new Error('첨삭본 이미지 저장 실패: ' + uploadErr.message);

      const { data: { publicUrl } } = state.supabaseClient.storage
        .from(bucket)
        .getPublicUrl(filename);

      const { data: newFb, error: fbErr } = await state.supabaseClient
        .from('feedbacks')
        .insert([{
          submission_id: state.activeAnnotatingSubmission.id,
          page_index: state.activePageIndex,
          teacher_name: '선생님',
          comment: comment,
          annotated_image_url: publicUrl,
          annotation_data: exported.vectorData, // already a JSON string
          created_at: new Date().toISOString()
        }])
        .select();

      if (fbErr) throw new Error('첨삭 피드백 저장 실패: ' + fbErr.message);

      await state.supabaseClient
        .from('submissions')
        .update({ status: 'reviewed' })
        .eq('id', state.activeAnnotatingSubmission.id);

      await finishFeedbackSave(exported);
      return;
    }

    // 2. Fallback to API
    const res = await fetch('/api/feedbacks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        submission_id: state.activeAnnotatingSubmission.id,
        page_index: state.activePageIndex,
        teacher_name: '선생님',
        comment: comment,
        annotated_image_base64: exported.dataUrl,
        annotation_data: exported.vectorData
      })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || '피드백 저장 실패');
    }

    await finishFeedbackSave(exported);
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.innerHTML = `<i data-lucide="check" class="w-4 h-4"></i> 현재 페이지 첨삭 완료 및 저장`;
    if (window.lucide) lucide.createIcons();
  }
}

/**
 * Runs after a page's feedback is persisted: records the new baseline and, on a
 * multi-page submission, advances to the next page instead of closing the studio.
 */
async function finishFeedbackSave(exported) {
  const pageIndex = state.activePageIndex;
  markPageSaved(pageIndex, exported.objects);
  state.pageAnnotations[pageIndex] = exported.objects;

  const images = getActiveSubmissionImages();
  const isLastPage = pageIndex >= images.length - 1;

  await loadSubmissions();
  await loadStats();

  if (isLastPage) {
    showToast(`${pageIndex + 1}페이지 첨삭 피드백이 성공적으로 댓글로 등록되었습니다!`, 'success');
    closeCanvasEditor(true);
    return;
  }

  document.getElementById('canvas-feedback-comment').value = '';
  showToast(`${pageIndex + 1}페이지 첨삭 저장 완료! ${pageIndex + 2}페이지로 이동합니다.`, 'success');
  switchCanvasPage(pageIndex + 1);
}

/** Converts a Supabase public URL back into the object path inside the bucket. */
function storagePathFromUrl(url) {
  if (!url) return '';
  const bucket = state.systemStatus?.supabase_bucket || 'tutormark-files';
  const marker = `/public/${bucket}/`;
  if (url.includes(marker)) {
    return url.split(marker)[1].split('?')[0];
  }
  return '';
}

/** Best-effort removal of stored images; a storage failure must not block the DB delete. */
async function removeStoredImages(urls) {
  if (!state.supabaseClient) return;
  const bucket = state.systemStatus?.supabase_bucket || 'tutormark-files';
  const paths = urls.map(storagePathFromUrl).filter(Boolean);
  if (paths.length === 0) return;
  try {
    await state.supabaseClient.storage.from(bucket).remove(paths);
  } catch (err) {
    console.warn('Storage cleanup failed:', err);
  }
}

async function deleteFeedback(feedbackId) {
  if (!confirm('이 첨삭 피드백 댓글을 삭제하시겠습니까?')) return;

  try {
    if (state.supabaseClient) {
      // Read the image URL before the row disappears, or the file is orphaned in storage
      const { data: fbRow } = await state.supabaseClient
        .from('feedbacks').select('annotated_image_url').eq('id', feedbackId).single();

      const { error } = await state.supabaseClient.from('feedbacks').delete().eq('id', feedbackId);
      if (error) throw new Error(error.message);

      await removeStoredImages([fbRow?.annotated_image_url].filter(Boolean));

      // The submission goes back to pending once its last feedback is gone
      if (state.currentSubmission) {
        const { data: rest } = await state.supabaseClient
          .from('feedbacks').select('id').eq('submission_id', state.currentSubmission.id);
        if (!rest || rest.length === 0) {
          await state.supabaseClient.from('submissions')
            .update({ status: 'pending' }).eq('id', state.currentSubmission.id);
        }
      }

      showToast('첨삭 피드백이 삭제되었습니다.', 'info');
      if (state.currentSubmission) {
        await openDetailModal(state.currentSubmission.id);
      }
      await loadSubmissions();
      await loadStats();
      return;
    }

    const res = await fetch(`/api/feedbacks/${feedbackId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('삭제 실패');
    
    showToast('첨삭 피드백이 삭제되었습니다.', 'info');
    if (state.currentSubmission) {
      await openDetailModal(state.currentSubmission.id);
    }
    await loadSubmissions();
    await loadStats();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function confirmDeleteSubmission(submissionId) {
  if (!confirm('정말 이 과제와 관련된 모든 첨삭 기록을 삭제하시겠습니까?')) return;

  try {
    if (state.supabaseClient) {
      // Collect every image path first; the cascade delete takes the rows with it
      const detail = await fetchSubmissionDetail(submissionId).catch(() => null);
      const urls = detail
        ? [...(detail.images || []), ...(detail.feedbacks || []).map(f => f.annotated_image_url)]
        : [];

      const { error } = await state.supabaseClient.from('submissions').delete().eq('id', submissionId);
      if (error) throw new Error(error.message);

      await removeStoredImages(urls.filter(Boolean));

      showToast('과제가 삭제되었습니다.', 'info');
      closeDetailModal();
      await loadSubmissions();
      await loadStats();
      return;
    }

    const res = await fetch(`/api/submissions/${submissionId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('삭제 실패');

    showToast('과제가 삭제되었습니다.', 'info');
    closeDetailModal();
    await loadSubmissions();
    await loadStats();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// --- High-Z-Index Interactive Lightbox Viewer ---
const lightbox = {
  modal: null,
  img: null,
  titleElem: null,
  downloadLink: null,
  zoomValElem: null,
  viewport: null,
  scale: 1.0,
  panX: 0,
  panY: 0,
  isPanning: false,
  didPan: false,
  startPanX: 0,
  startPanY: 0,

  init() {
    this.modal = document.getElementById('image-lightbox-modal');
    this.img = document.getElementById('lightbox-img');
    this.titleElem = document.getElementById('lightbox-title');
    this.downloadLink = document.getElementById('lightbox-download-link');
    this.zoomValElem = document.getElementById('lightbox-zoom-val');
    this.viewport = document.getElementById('lightbox-viewport');

    if (!this.modal) return;

    // Zoom Buttons
    document.getElementById('btn-lightbox-zoom-in')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.setZoom(this.scale * 1.25);
    });
    document.getElementById('btn-lightbox-zoom-out')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.setZoom(this.scale / 1.25);
    });
    document.getElementById('btn-lightbox-zoom-reset')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.resetZoom();
    });

    // Close button & Click outside to close
    document.getElementById('btn-close-lightbox')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.close();
    });
    this.modal.addEventListener('click', (e) => {
      // A drag that ends on the backdrop still fires a click; don't close on it
      if (this.didPan) {
        this.didPan = false;
        return;
      }
      if (e.target.id === 'image-lightbox-modal' || e.target.id === 'lightbox-viewport') {
        this.close();
      }
    });

    // Mouse Wheel Zoom
    this.viewport?.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
      this.setZoom(this.scale * zoomFactor);
    }, { passive: false });

    // Drag to Pan
    this.viewport?.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.isPanning = true;
      this.didPan = false;
      this.startPanX = e.clientX - this.panX;
      this.startPanY = e.clientY - this.panY;
      try { this.viewport.setPointerCapture(e.pointerId); } catch (err) { /* unsupported */ }
    });
    this.viewport?.addEventListener('pointermove', (e) => {
      if (!this.isPanning) return;
      const nextX = e.clientX - this.startPanX;
      const nextY = e.clientY - this.startPanY;
      if (Math.abs(nextX - this.panX) > 2 || Math.abs(nextY - this.panY) > 2) this.didPan = true;
      this.panX = nextX;
      this.panY = nextY;
      this.updateTransform();
    });
    this.viewport?.addEventListener('pointerup', () => {
      this.isPanning = false;
    });
    this.viewport?.addEventListener('pointercancel', () => {
      this.isPanning = false;
    });

    // Keyboard ESC to Close
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.modal && !this.modal.classList.contains('hidden')) {
        this.close();
      }
    });
  },

  open(imageUrl, title = '이미지 확대보기') {
    if (!this.modal) this.init();

    this.img.src = imageUrl;
    this.titleElem.innerText = title;
    if (this.downloadLink) {
      this.downloadLink.href = imageUrl;
      this.downloadLink.dataset.downloadSrc = imageUrl;
      this.downloadLink.dataset.downloadName = `${(title || 'tutormark').replace(/[\/:*?"<>|]/g, '_')}.jpg`;
    }
    this.resetZoom();

    // Ensure it is on the top-most z-index
    this.modal.style.zIndex = '99999';
    this.modal.classList.remove('hidden');

    if (window.lucide) lucide.createIcons();
  },

  close() {
    if (this.modal) {
      this.modal.classList.add('hidden');
    }
  },

  resetZoom() {
    this.scale = 1.0;
    this.panX = 0;
    this.panY = 0;
    this.updateTransform();
  },

  setZoom(newScale) {
    this.scale = Math.max(0.4, Math.min(6.0, newScale));
    this.updateTransform();
  },

  updateTransform() {
    if (!this.img) return;
    this.img.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.scale})`;
    if (this.zoomValElem) {
      this.zoomValElem.innerText = `${Math.round(this.scale * 100)}%`;
    }
  }
};

/**
 * Cross-origin images ignore the anchor `download` attribute and just navigate away,
 * so pull the bytes down and hand the browser a same-origin blob instead.
 */
async function downloadImage(url, filename) {
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error(res.statusText);
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename || 'tutormark.jpg';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
  } catch (err) {
    // CORS blocked or offline: let the browser open it so the user can save manually
    window.open(url, '_blank', 'noopener');
  }
}

function openLightbox(imageUrl, title) {
  lightbox.open(imageUrl, title);
}

function closeLightbox() {
  lightbox.close();
}

// --- Quick Add Student Modal ---
async function promptAddStudent() {
  const name = prompt('추가할 학생의 이름을 입력하세요 (예: 박지훈):');
  if (!name || !name.trim()) return;

  const grade = prompt('학생의 학년 또는 과목을 입력하세요 (예: 중2 수학):', '중등부') || '';
  const newStudent = {
    name: name.trim(),
    grade: grade.trim(),
    pin: '0000',
    avatar_color: ['#EC4899', '#8B5CF6', '#F59E0B', '#10B981', '#3B82F6'][Math.floor(Math.random() * 5)]
  };

  try {
    // 1. If Supabase Client is initialized on frontend, insert directly
    if (state.supabaseClient) {
      const { data, error } = await state.supabaseClient.from('students').insert([newStudent]).select();
      if (error) throw new Error(error.message);
      showToast(`'${name}' 학생이 등록되었습니다.`, 'success');
      await loadStudents();
      await loadStats();
      if (data && data[0]) {
        state.currentStudent = data[0];
        renderStudentSelectUI();
        loadSubmissions();
      }
      return;
    }

    // 2. Otherwise fallback to API endpoint
    const res = await fetch('/api/students', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newStudent)
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || errData.error || '학생 추가 실패');
    }

    const created = await res.json();
    showToast(`'${name}' 학생이 등록되었습니다.`, 'success');
    await loadStudents();
    await loadStats();
    if (created && created.id) {
      const found = state.students.find(s => s.id === created.id);
      if (found) {
        state.currentStudent = found;
        renderStudentSelectUI();
        loadSubmissions();
      }
    }
  } catch (err) {
    console.error('Failed to add student:', err);
    showToast('학생 추가 실패: ' + err.message, 'error');
  }
}

// --- Supabase Connection Manager Modal ---
function openSupabaseGuideModal() {
  const modal = document.getElementById('supabase-guide-modal');
  if (!modal) return;

  const urlInput = document.getElementById('input-supabase-url');
  const keyInput = document.getElementById('input-supabase-key');
  const bucketInput = document.getElementById('input-supabase-bucket');

  if (urlInput && keyInput && bucketInput) {
    const currentUrl = state.systemStatus?.supabase_url || window.SUPABASE_CONFIG?.url || '';
    const currentKey = state.systemStatus?.supabase_key || window.SUPABASE_CONFIG?.anonKey || '';
    const currentBucket = state.systemStatus?.supabase_bucket || window.SUPABASE_CONFIG?.bucket || 'tutormark-files';

    urlInput.value = currentUrl;
    keyInput.value = currentKey;
    bucketInput.value = currentBucket;
  }

  modal.classList.remove('hidden');
  if (window.lucide) lucide.createIcons();
}

function closeSupabaseGuideModal() {
  const modal = document.getElementById('supabase-guide-modal');
  if (modal) modal.classList.add('hidden');
}

/** Removes the browser-saved key so the page falls back to the server / local mode. */
async function clearManualSupabaseConfig() {
  if (!confirm('저장된 Supabase 연동 키를 삭제하고 서버 기본 설정(로컬 모드)으로 돌아갈까요?')) return;

  localStorage.removeItem('TUTORMARK_SUPABASE_CONFIG');
  state.supabaseClient = null;
  state.systemStatus = null;

  closeSupabaseGuideModal();
  await checkSystemStatus();
  await loadStudents();
  await loadSubmissions();
  await loadStats();
  showToast('연동 키를 삭제했습니다. 서버 기본 설정으로 전환되었습니다.', 'info');
}

async function saveManualSupabaseConfig() {
  const url = document.getElementById('input-supabase-url')?.value.trim();
  const key = document.getElementById('input-supabase-key')?.value.trim();
  const bucket = document.getElementById('input-supabase-bucket')?.value.trim() || 'tutormark-files';

  if (!url || !key) {
    showToast('Supabase URL과 Anon Key를 모두 입력해주세요.', 'error');
    return;
  }

  try {
    if (window.supabase) {
      const testClient = window.supabase.createClient(url, key);
      const { data, error } = await testClient.from('students').select('id').limit(1);
      if (error && error.code !== 'PGRST116') {
        throw new Error(error.message);
      }
      state.supabaseClient = testClient;
    }

    localStorage.setItem('TUTORMARK_SUPABASE_CONFIG', JSON.stringify({ url, key, bucket }));
    state.systemStatus = {
      supabase_enabled: true,
      supabase_url: url,
      supabase_key: key,
      supabase_bucket: bucket
    };

    closeSupabaseGuideModal();
    showToast('⚡ Supabase 클라우드 연동이 활성화되었습니다!', 'success');
    await checkSystemStatus();
    await loadStudents();
    await loadSubmissions();
    await loadStats();
  } catch (err) {
    showToast('연동 실패: ' + err.message, 'error');
  }
}

// --- Helper Utilities ---
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
}

let toastTimer = null;

function showToast(message, type = 'info') {
  const toast = document.getElementById('global-toast');
  const text = document.getElementById('toast-text');
  const icon = document.getElementById('toast-icon');

  text.innerText = message;

  if (type === 'success') {
    toast.className = 'fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-2xl bg-emerald-600 text-white font-medium text-sm transition-all duration-300 transform translate-y-0 opacity-100';
    icon.innerHTML = `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>`;
  } else if (type === 'error') {
    toast.className = 'fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-2xl bg-rose-600 text-white font-medium text-sm transition-all duration-300 transform translate-y-0 opacity-100';
    icon.innerHTML = `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>`;
  } else {
    toast.className = 'fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-2xl bg-slate-900 text-white font-medium text-sm transition-all duration-300 transform translate-y-0 opacity-100';
    icon.innerHTML = `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>`;
  }

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.className = 'hidden';
    toastTimer = null;
  }, 3500);
}
