const CONFIG = {
  supabaseUrl: 'https://qdzklcmoqqksfnxjidby.supabase.co',
  supabaseKey: 'sb_publishable_VrsCSCN3W3upQQgWWu6TBA_8A2cLr6g',
  adminEmail: 'minkijon65@gmail.com',
  center: { lat: 37.4567, lng: 126.6504 },
  maxImages: 3,
}

const CATEGORIES = [
  { name: '보행', color: '#2878d0', chip: '#e1efff' },
  { name: '주차', color: '#e67e22', chip: '#fff0dd' },
  { name: '안전', color: '#d73a3a', chip: '#ffe3e3' },
  { name: '환경', color: '#2f8b57', chip: '#dff4e7' },
  { name: '편의시설', color: '#7a52b3', chip: '#eee4fa' },
  { name: '빈집·유휴공간', color: '#9a6a37', chip: '#f2e8dc' },
  { name: '기타', color: '#63726a', chip: '#e9eeeb' },
]

const db = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey)
const $ = (selector) => document.querySelector(selector)
const state = { session: null, profile: null, records: [], filter: '전체', map: null, markers: [], recordOverlays: [], currentLocationOverlay: null, pickMode: false, picked: null, newFiles: [] }

function toast(message) {
  const el = $('#toast'); el.textContent = message; el.classList.add('show')
  clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 2800)
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]))
}

function categoryOf(name) { return CATEGORIES.find((item) => item.name === name) || CATEGORIES.at(-1) }
function dateLabel(date) { return new Intl.DateTimeFormat('ko-KR', { year:'numeric', month:'short', day:'numeric' }).format(new Date(`${date}T00:00:00`)) }
function isAdmin() { return state.profile?.role === 'admin' || state.session?.user?.email?.toLowerCase() === CONFIG.adminEmail }

let authMode = 'login'
$('#auth-toggle').addEventListener('click', () => {
  authMode = authMode === 'login' ? 'signup' : 'login'
  $('#auth-title').textContent = authMode === 'login' ? '로그인' : '계정 만들기'
  $('#auth-submit').textContent = authMode === 'login' ? '로그인' : '가입하기'
  $('#auth-toggle').textContent = authMode === 'login' ? '처음이신가요? 계정 만들기' : '이미 계정이 있나요? 로그인'
  $('#auth-description').textContent = authMode === 'login' ? '등록된 팀원 이메일로 접속하세요.' : '관리자에게 전달한 이메일과 동일하게 가입하세요.'
})

$('#auth-form').addEventListener('submit', async (event) => {
  event.preventDefault()
  const email = $('#auth-email').value.trim().toLowerCase()
  const password = $('#auth-password').value
  $('#auth-submit').disabled = true
  const result = authMode === 'login'
    ? await db.auth.signInWithPassword({ email, password })
    : await db.auth.signUp({ email, password })
  $('#auth-submit').disabled = false
  if (result.error) return toast(result.error.message)
  if (authMode === 'signup' && !result.data.session) toast('확인 이메일을 보냈습니다. 이메일 인증 후 로그인하세요.')
})

$('#logout-button').addEventListener('click', () => db.auth.signOut())

async function bootstrap(session) {
  state.session = session
  if (!session) {
    $('#auth-view').classList.remove('hidden'); $('#app-view').classList.add('hidden'); return
  }
  const { data: member } = await db.from('team_members').select('*').eq('email', session.user.email.toLowerCase()).maybeSingle()
  state.profile = member
  if (!member) {
    await db.auth.signOut()
    toast('아직 승인되지 않은 이메일입니다. 관리자에게 승인을 요청하세요.')
    return
  }
  $('#auth-view').classList.add('hidden'); $('#app-view').classList.remove('hidden')
  $('#user-email').textContent = session.user.email
  $('#team-button').classList.toggle('hidden', !isAdmin())
  if (!state.map) initMap()
  await loadRecords()
}

db.auth.onAuthStateChange((_event, session) => setTimeout(() => bootstrap(session), 0))
db.auth.getSession().then(({ data }) => bootstrap(data.session))

function initMap() {
  if (!window.kakao?.maps) return toast('카카오 지도를 불러오지 못했습니다. 도메인 등록을 확인하세요.')
  kakao.maps.load(() => {
    state.map = new kakao.maps.Map($('#map'), { center: new kakao.maps.LatLng(CONFIG.center.lat, CONFIG.center.lng), level: 4 })
    kakao.maps.event.addListener(state.map, 'click', (event) => {
      if (!state.pickMode) return
      state.picked = { lat: event.latLng.getLat(), lng: event.latLng.getLng() }
      state.pickMode = false; $('#map-instruction').classList.add('hidden'); openRecordForm()
    })
    renderMarkers()
  })
}

function markerImage(category) {
  const { color } = categoryOf(category)
  // 보이는 마커 크기는 유지하고 투명 여백을 더해 모바일 터치 영역만 넓힌다.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="68" height="68" viewBox="0 0 68 68"><g transform="translate(15 22)"><path fill="${color}" stroke="white" stroke-width="3" d="M19 1.5C9.3 1.5 1.5 9.3 1.5 19c0 13 17.5 25 17.5 25s17.5-12 17.5-25C36.5 9.3 28.7 1.5 19 1.5Z"/><circle cx="19" cy="18" r="6" fill="white"/></g></svg>`
  return new kakao.maps.MarkerImage(`data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`, new kakao.maps.Size(68,68), { offset:new kakao.maps.Point(34,68) })
}

function renderMarkers() {
  if (!state.map) return
  state.markers.forEach((marker) => marker.setMap(null)); state.markers = []
  state.recordOverlays.forEach((item) => item.overlay.setMap(null)); state.recordOverlays = []
  filteredRecords().forEach((record) => {
    const position = new kakao.maps.LatLng(record.latitude, record.longitude)
    const marker = new kakao.maps.Marker({ map:state.map, position, image:markerImage(record.category) })
    kakao.maps.event.addListener(marker, 'click', () => activateRecordPreview(record.id)); state.markers.push(marker)

    const preview = document.createElement('button')
    preview.type = 'button'
    preview.className = `map-record-preview ${record.image_paths?.length ? '' : 'no-photo'}`
    preview.dataset.mapRecord = record.id
    preview.setAttribute('aria-label', `${record.category} 기록 상세보기`)
    const memo = document.createElement('span')
    memo.textContent = record.memo || '메모 없음'
    if (record.image_paths?.length) {
      const image = new Image()
      image.alt = '첨부 사진 미리보기'
      image.loading = 'lazy'
      preview.appendChild(image)
      db.storage.from('survey-photos').createSignedUrl(record.image_paths[0], 3600).then(({ data }) => {
        if (data?.signedUrl) image.src = data.signedUrl
      })
    }
    preview.appendChild(memo)
    const overlay = new kakao.maps.CustomOverlay({ position, content:preview, xAnchor:0, yAnchor:.5, clickable:true })
    overlay.setMap(state.map)
    overlay.setZIndex(4)
    state.recordOverlays.push({ id:record.id, overlay, element:preview })
  })
}

function activateRecordPreview(recordId) {
  state.recordOverlays.forEach((item) => {
    const selected = item.id === recordId
    item.overlay.setZIndex(selected ? 30 : 4)
    item.element.classList.toggle('selected', selected)
  })
}

function showCurrentLocation(position) {
  if (!state.currentLocationOverlay) {
    const icon = document.createElement('div')
    icon.className = 'current-location-marker'
    icon.setAttribute('aria-label', '내 현재 위치')
    state.currentLocationOverlay = new kakao.maps.CustomOverlay({ map:state.map, position, content:icon, xAnchor:.5, yAnchor:.5, zIndex:6 })
  } else {
    state.currentLocationOverlay.setPosition(position)
    state.currentLocationOverlay.setMap(state.map)
  }
}

async function loadRecords() {
  const { data, error } = await db.from('survey_records').select('*').order('surveyed_at', { ascending:false }).order('created_at', { ascending:false })
  if (error) return toast(`기록을 불러오지 못했습니다: ${error.message}`)
  state.records = data || []; renderAll()
}

function filteredRecords() { return state.filter === '전체' ? state.records : state.records.filter((r) => r.category === state.filter) }
function renderAll() { renderFilters(); renderList(); renderMarkers(); $('#record-count').textContent = `기록 ${state.records.length}개` }

function renderFilters() {
  $('#category-filters').innerHTML = ['전체', ...CATEGORIES.map((c) => c.name)].map((name) => `<button class="filter-chip ${state.filter===name?'active':''}" data-filter="${escapeHtml(name)}">${escapeHtml(name)}</button>`).join('')
  document.querySelectorAll('[data-filter]').forEach((button) => button.addEventListener('click', () => { state.filter = button.dataset.filter; renderAll() }))
}

function renderList() {
  const records = filteredRecords()
  $('#record-list').innerHTML = records.length ? records.map((record) => {
    const category = categoryOf(record.category)
    return `<button class="record-card" data-record="${record.id}"><div class="record-card-head"><span class="badge" style="--chip:${category.chip}"><i style="width:7px;height:7px;border-radius:50%;background:${category.color}"></i>${escapeHtml(record.category)}</span><span class="meta">${dateLabel(record.surveyed_at)}</span></div><p>${escapeHtml(record.memo)}</p><span class="meta">${record.image_paths?.length || 0}장 · ${escapeHtml(record.author_email || '')}</span></button>`
  }).join('') : '<div class="empty">아직 등록된 현장 기록이 없습니다.<br>첫 기록을 남겨보세요.</div>'
  document.querySelectorAll('[data-record]').forEach((button) => button.addEventListener('click', () => showDetail(button.dataset.record)))
}

$('#add-button').addEventListener('click', () => { state.pickMode = true; state.picked = null; $('#map-instruction').classList.remove('hidden'); toast('지도에서 기록할 위치를 눌러주세요.') })
$('#cancel-pick').addEventListener('click', () => { state.pickMode = false; $('#map-instruction').classList.add('hidden') })
function useCurrentLocation(openForm = false) {
  const targetButton = openForm ? $('#current-record-button') : $('#locate-button')
  const originalText = targetButton.textContent
  targetButton.disabled = true
  targetButton.textContent = '위치 확인 중…'

  navigator.geolocation.getCurrentPosition(({ coords }) => {
    const position = new kakao.maps.LatLng(coords.latitude, coords.longitude)
    state.map.panTo(position)
    showCurrentLocation(position)
    if (openForm) {
      state.picked = { lat:coords.latitude, lng:coords.longitude }
      state.pickMode = false
      $('#map-instruction').classList.add('hidden')
      openRecordForm()
    } else {
      toast('현재 위치로 이동했습니다.')
    }
    targetButton.disabled = false
    targetButton.textContent = originalText
  }, (error) => {
    targetButton.disabled = false
    targetButton.textContent = originalText
    toast(error.code === 1 ? '위치 권한을 허용해주세요.' : '현재 위치를 확인할 수 없습니다.')
  }, { enableHighAccuracy:true, timeout:12000, maximumAge:10000 })
}

$('#locate-button').addEventListener('click', () => useCurrentLocation(false))
$('#current-record-button').addEventListener('click', () => useCurrentLocation(true))

function openRecordForm(record = null) {
  $('#record-dialog-title').textContent = record ? '기록 수정' : '새 기록'
  $('#record-id').value = record?.id || ''
  state.picked = record ? { lat:record.latitude, lng:record.longitude } : state.picked
  $('#coordinate-text').textContent = `${state.picked.lat.toFixed(6)}, ${state.picked.lng.toFixed(6)}`
  $('#record-category').innerHTML = CATEGORIES.map((item) => `<option ${record?.category===item.name?'selected':''}>${item.name}</option>`).join('')
  $('#record-memo').value = record?.memo || ''
  $('#surveyed-at').value = record?.surveyed_at || new Date().toISOString().slice(0,10)
  $('#record-images').value = ''; state.newFiles = []; renderImagePreview([])
  $('#record-dialog').showModal()
}

function closeRecordForm() {
  state.newFiles = []
  state.picked = null
  $('#record-images').value = ''
  $('#image-preview').innerHTML = ''
  $('#record-dialog').close()
}

$('#record-close').addEventListener('click', closeRecordForm)
$('#record-cancel').addEventListener('click', closeRecordForm)

$('#record-images').addEventListener('change', () => {
  const files = [...$('#record-images').files]
  if (files.length > CONFIG.maxImages) { $('#record-images').value=''; return toast(`사진은 최대 ${CONFIG.maxImages}장까지 등록할 수 있습니다.`) }
  state.newFiles = files; renderImagePreview(files)
})

function renderImagePreview(files) {
  $('#image-preview').innerHTML = ''
  files.forEach((file) => { const img = new Image(); img.src=URL.createObjectURL(file); img.onload=()=>URL.revokeObjectURL(img.src); $('#image-preview').appendChild(img) })
}

async function compressImage(file) {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas'); canvas.width=Math.round(bitmap.width*scale); canvas.height=Math.round(bitmap.height*scale)
  canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height); bitmap.close()
  let quality=.8, blob
  do { blob = await new Promise((resolve) => canvas.toBlob(resolve,'image/jpeg',quality)); quality -= .1 } while (blob.size > 500*1024 && quality >= .4)
  return blob
}

$('#record-form').addEventListener('submit', async (event) => {
  event.preventDefault()
  if (!state.picked) return toast('지도에서 위치를 선택해주세요.')
  const button=$('#save-record'); button.disabled=true; button.textContent='저장 중…'
  const existingId=$('#record-id').value; const id=existingId || crypto.randomUUID(); let paths=[]
  const existing=state.records.find((r)=>r.id===id); if (existingId) paths=existing?.image_paths || []
  try {
    for (const file of state.newFiles) {
      const compressed=await compressImage(file); const path=`${state.session.user.id}/${id}/${crypto.randomUUID()}.jpg`
      const { error }=await db.storage.from('survey-photos').upload(path,compressed,{contentType:'image/jpeg'}); if(error) throw error; paths.push(path)
    }
    const payload={ id,user_id:existing?.user_id || state.session.user.id,author_email:existing?.author_email || state.session.user.email.toLowerCase(),latitude:state.picked.lat,longitude:state.picked.lng,category:$('#record-category').value,memo:$('#record-memo').value.trim(),surveyed_at:$('#surveyed-at').value,image_paths:paths,updated_at:new Date().toISOString() }
    const { error }=await db.from('survey_records').upsert(payload); if(error) throw error
    $('#record-dialog').close(); await loadRecords(); toast(existingId?'기록을 수정했습니다.':'현장 기록을 저장했습니다.')
  } catch(error) { toast(`저장하지 못했습니다: ${error.message}`) }
  finally { button.disabled=false; button.textContent='저장' }
})

async function signedImageUrls(paths=[]) {
  const urls = await Promise.all(paths.map(async (path) => { const { data }=await db.storage.from('survey-photos').createSignedUrl(path,3600); return data?.signedUrl }))
  return urls.filter(Boolean)
}

async function showDetail(id) {
  const record=state.records.find((r)=>r.id===id); if(!record) return
  state.map?.panTo(new kakao.maps.LatLng(record.latitude,record.longitude))
  const urls=await signedImageUrls(record.image_paths); const editable=record.user_id===state.session.user.id || isAdmin(); const category=categoryOf(record.category)
  $('#detail-content').innerHTML=`<div class="detail-title"><div><span class="badge" style="--chip:${category.chip}">${escapeHtml(record.category)}</span><h2>${dateLabel(record.surveyed_at)} 기록</h2></div><button class="close-button" data-detail-close>×</button></div>${urls.length?`<div class="detail-gallery">${urls.map((url)=>`<img src="${url}" alt="현장 사진" loading="lazy">`).join('')}</div>`:''}<p class="detail-body">${escapeHtml(record.memo)}</p><p class="meta">작성자 ${escapeHtml(record.author_email||'')} · ${record.latitude.toFixed(6)}, ${record.longitude.toFixed(6)}</p><div class="detail-actions">${editable?`<button class="ghost" data-edit-record="${record.id}">수정</button><button class="danger" data-delete-record="${record.id}">삭제</button>`:''}</div>`
  $('#detail-dialog').showModal()
  $('[data-detail-close]').onclick=()=>$('#detail-dialog').close()
  const edit=$('[data-edit-record]'); if(edit) edit.onclick=()=>{ $('#detail-dialog').close(); openRecordForm(record) }
  const del=$('[data-delete-record]'); if(del) del.onclick=()=>deleteRecord(record)
}

document.addEventListener('click', (event) => {
  const preview = event.target.closest('[data-map-record]')
  if (preview) showDetail(preview.dataset.mapRecord)
})

async function deleteRecord(record) {
  if (!confirm('이 기록과 첨부 사진을 삭제할까요?')) return
  if(record.image_paths?.length) await db.storage.from('survey-photos').remove(record.image_paths)
  const { error }=await db.from('survey_records').delete().eq('id',record.id)
  if(error) return toast(error.message); $('#detail-dialog').close(); await loadRecords(); toast('기록을 삭제했습니다.')
}

$('#team-button').addEventListener('click', async()=>{ $('#team-dialog').showModal(); await loadMembers() })
$('[data-close="team"]').addEventListener('click',()=>$('#team-dialog').close())
$('#team-form').addEventListener('submit',async(event)=>{ event.preventDefault(); const email=$('#member-email').value.trim().toLowerCase(); const {error}=await db.from('team_members').insert({email,role:'member',added_by:state.session.user.id}); if(error)return toast(error.message); $('#member-email').value=''; await loadMembers(); toast('팀원 이메일을 추가했습니다.') })
async function loadMembers(){ const {data,error}=await db.from('team_members').select('*').order('added_at'); if(error)return toast(error.message); $('#member-list').innerHTML=(data||[]).map((member)=>`<div class="member-item"><span>${escapeHtml(member.email)} <strong>${member.role==='admin'?'관리자':''}</strong></span>${member.role!=='admin'?`<button class="text-button" data-remove-member="${escapeHtml(member.email)}">삭제</button>`:''}</div>`).join(''); document.querySelectorAll('[data-remove-member]').forEach((button)=>button.onclick=()=>removeMember(button.dataset.removeMember)) }
async function removeMember(email){ if(!confirm(`${email} 팀원을 삭제할까요?`))return; const {error}=await db.from('team_members').delete().eq('email',email); if(error)return toast(error.message); await loadMembers() }

document.querySelectorAll('dialog').forEach((dialog)=>dialog.addEventListener('click',(event)=>{ if(event.target===dialog)dialog.close() }))

// 모바일: 화면 상단에서 아래로 당기면 새로고침한다.
function setupPullToRefresh() {
  if (!window.matchMedia('(pointer: coarse)').matches) return
  const indicator = $('#pull-refresh')
  let startY = 0
  let distance = 0
  let tracking = false

  document.addEventListener('touchstart', (event) => {
    if (event.touches.length !== 1 || event.touches[0].clientY > 90 || event.target.closest('dialog')) return
    startY = event.touches[0].clientY
    distance = 0
    tracking = true
  }, { passive:true })

  document.addEventListener('touchmove', (event) => {
    if (!tracking) return
    distance = Math.max(0, event.touches[0].clientY - startY)
    if (!distance) return
    if (distance > 12) event.preventDefault()
    const progress = Math.min(distance, 110)
    indicator.style.transform = `translate(-50%, ${progress - 52}px)`
    indicator.classList.add('visible')
    indicator.textContent = distance >= 90 ? '놓으면 새로고침' : '아래로 당겨 새로고침'
  }, { passive:false })

  document.addEventListener('touchend', () => {
    if (!tracking) return
    tracking = false
    if (distance >= 90) {
      indicator.textContent = '새로고침 중…'
      indicator.classList.add('refreshing')
      window.location.reload()
      return
    }
    indicator.classList.remove('visible')
    indicator.style.transform = ''
  }, { passive:true })

  document.addEventListener('touchcancel', () => {
    tracking = false
    indicator.classList.remove('visible')
    indicator.style.transform = ''
  }, { passive:true })
}

setupPullToRefresh()
