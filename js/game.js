(() => {
  'use strict';

  const app = document.getElementById('app');
  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.imageSmoothingEnabled = false;

  const loading = document.getElementById('loading');
  const loadingText = document.getElementById('loadingText');
  const toast = document.getElementById('toast');
  const nearbyBadge = document.getElementById('nearbyBadge');
  const npcCount = document.getElementById('npcCount');
  const talkBtn = document.getElementById('talkBtn');
  const talkTarget = document.getElementById('talkTarget');
  const characterBtn = document.getElementById('characterBtn');
  const zoomInBtn = document.getElementById('zoomInBtn');
  const zoomOutBtn = document.getElementById('zoomOutBtn');

  const dialoguePanel = document.getElementById('dialoguePanel');
  const dialoguePortrait = document.getElementById('dialoguePortrait');
  const dialogueName = document.getElementById('dialogueName');
  const dialogueText = document.getElementById('dialogueText');
  const dialogueNextBtn = document.getElementById('dialogueNextBtn');
  const dialogueCloseBtn = document.getElementById('dialogueCloseBtn');

  const characterOverlay = document.getElementById('characterOverlay');
  const characterCloseBtn = document.getElementById('characterCloseBtn');
  const characterSearch = document.getElementById('characterSearch');
  const characterList = document.getElementById('characterList');
  const randomSummonBtn = document.getElementById('randomSummonBtn');
  const removeAllBtn = document.getElementById('removeAllBtn');

  const helpOverlay = document.getElementById('helpOverlay');
  const helpBtn = document.getElementById('helpBtn');
  const helpCloseBtn = document.getElementById('helpCloseBtn');
  const helpOkBtn = document.getElementById('helpOkBtn');

  const MAP_W = window.IFUN_COLLISION.mapWidth;
  const MAP_H = window.IFUN_COLLISION.mapHeight;
  const COLL_CELL = window.IFUN_COLLISION.cellSize;
  const GRID_W = window.IFUN_COLLISION.gridWidth;
  const GRID_H = window.IFUN_COLLISION.gridHeight;
  const TALK_RANGE = 105;
  const PLAYER_RADIUS = 13;
  const NPC_RADIUS = 15;
  const SPRITE_H = 132;
  const SPRITE_W = SPRITE_H * 290 / 354;

  const FRAME_FILES = {
    down:  ['r1c1_front_neutral.png','r1c2_front_step1.png','r1c3_front_step2.png'],
    right: ['r2c1_right_neutral.png','r2c2_right_step1.png','r2c3_right_step2.png'],
    left:  ['r3c1_left_neutral.png','r3c2_left_step1.png','r3c3_left_step2.png'],
    up:    ['r4c1_back_neutral.png','r4c2_back_step1.png','r4c3_back_step2.png']
  };
  const DIR_INDEX = ['up','right','down','left'];
  const WALK_CYCLE = [1,0,2,0];

  const dialogueArray = Array.isArray(window.IFUN_DIALOGUES) ? window.IFUN_DIALOGUES : [];
  const dialogueMap = new Map(dialogueArray.map(entry => [entry.name, entry.lines]));
  const characterNames = dialogueArray.map(entry => entry.name);

  const collisionBytes = Uint8Array.from(atob(window.IFUN_COLLISION.bitsetBase64), c => c.charCodeAt(0));
  function gridWalkable(gx, gy) {
    if (gx < 0 || gy < 0 || gx >= GRID_W || gy >= GRID_H) return false;
    const idx = gy * GRID_W + gx;
    return ((collisionBytes[idx >> 3] >> (idx & 7)) & 1) === 1;
  }
  function pointWalkable(x, y) {
    if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return false;
    return gridWalkable(Math.floor(x / COLL_CELL), Math.floor(y / COLL_CELL));
  }
  function circleWalkable(x, y, r) {
    const samples = [
      [0,0],[r,0],[-r,0],[0,r],[0,-r],
      [r*.72,r*.72],[-r*.72,r*.72],[r*.72,-r*.72],[-r*.72,-r*.72]
    ];
    return samples.every(([dx,dy]) => pointWalkable(x+dx, y+dy));
  }

  const images = new Map();
  function loadImage(src) {
    if (images.has(src)) return Promise.resolve(images.get(src));
    return new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => { images.set(src, im); resolve(im); };
      im.onerror = () => reject(new Error(`画像を読み込めません: ${src}`));
      im.src = encodeURI(src);
    });
  }
  function charPath(name, file) { return `assets/characters/${name}/${file}`; }

  const mapImage = new Image();
  const playerFrames = { down:[], right:[], left:[], up:[] };
  const npcFrames = new Map();
  async function loadCharacterNeutral(name) {
    if (npcFrames.has(name)) return npcFrames.get(name);
    const frames = {};
    for (const dir of DIR_INDEX) {
      const src = charPath(name, FRAME_FILES[dir][0]);
      frames[dir] = await loadImage(src);
    }
    npcFrames.set(name, frames);
    return frames;
  }
  async function loadPlayerFrames() {
    for (const dir of DIR_INDEX) {
      playerFrames[dir] = await Promise.all(FRAME_FILES[dir].map(file => loadImage(charPath('プレイヤー', file))));
    }
  }

  const player = {
    x: 836, y: 790,
    facing: 'up',
    speed: 176,
    walkClock: 0,
    moving: false
  };
  const npcs = new Map();
  const dialogueCursor = new Map();
  let activeDialogueName = null;
  let activeNearest = null;
  let lastTime = performance.now();
  let cameraX = player.x;
  let cameraY = player.y;
  let zoomBias = 1;
  let cameraScale = .65;
  let toastTimer = 0;
  let ready = false;
  let characterModalOpen = false;
  let helpModalOpen = false;
  let dialogueOpen = false;
  let dpr = 1;

  const keyDirs = new Set();
  const touchDirs = new Set();
  const pointerDirMap = new Map();

  function showToast(message, ms=1100) {
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), ms);
  }

  function setModalState() {
    app.classList.toggle('modal-mode', characterModalOpen || helpModalOpen);
    app.classList.toggle('dialogue-mode', dialogueOpen);
  }

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h;
      ctx.imageSmoothingEnabled = false;
    }
  }

  function currentBaseFit() {
    const cssW = canvas.clientWidth || window.innerWidth;
    const cssH = canvas.clientHeight || window.innerHeight;
    const fit = Math.min(cssW / MAP_W, cssH / MAP_H);
    const mobileFloor = cssW < 700 ? 0.60 : 0.68;
    return Math.max(fit, mobileFloor);
  }
  function updateCameraScale() {
    cameraScale = Math.max(0.46, Math.min(1.15, currentBaseFit() * zoomBias));
  }
  function changeZoom(mult) {
    zoomBias = Math.max(.72, Math.min(1.65, zoomBias * mult));
    updateCameraScale();
    showToast(`表示倍率 ${Math.round(zoomBias*100)}%`, 700);
  }

  function dirVector(dir) {
    if (dir==='up') return [0,-1];
    if (dir==='down') return [0,1];
    if (dir==='left') return [-1,0];
    return [1,0];
  }
  function faceToward(entity, tx, ty) {
    const dx = tx - entity.x, dy = ty - entity.y;
    if (Math.abs(dx) > Math.abs(dy)) entity.facing = dx >= 0 ? 'right' : 'left';
    else entity.facing = dy >= 0 ? 'down' : 'up';
  }

  function entityCollisionAt(x,y,ignoreName=null) {
    for (const [name,npc] of npcs) {
      if (name === ignoreName) continue;
      if (Math.hypot(npc.x-x, npc.y-y) < PLAYER_RADIUS + NPC_RADIUS + 4) return true;
    }
    return false;
  }
  function canPlayerStand(x,y) {
    return circleWalkable(x,y,PLAYER_RADIUS) && !entityCollisionAt(x,y);
  }
  function canNpcStand(x,y,ignoreName=null) {
    if (!circleWalkable(x,y,NPC_RADIUS)) return false;
    if (Math.hypot(player.x-x, player.y-y) < PLAYER_RADIUS + NPC_RADIUS + 22) return false;
    for (const [name,npc] of npcs) {
      if (name === ignoreName) continue;
      if (Math.hypot(npc.x-x,npc.y-y) < NPC_RADIUS*2 + 16) return false;
    }
    return true;
  }

  function findSpawnNearPlayer() {
    const startAngle = Math.random()*Math.PI*2;
    for (let radius=82; radius<=300; radius+=26) {
      for (let i=0;i<20;i++) {
        const a = startAngle + (Math.PI*2*i/20);
        const x = player.x + Math.cos(a)*radius;
        const y = player.y + Math.sin(a)*radius;
        if (canNpcStand(x,y)) return {x,y};
      }
    }
    for (let i=0;i<1800;i++) {
      const x = 80 + Math.random()*(MAP_W-160);
      const y = 120 + Math.random()*(MAP_H-190);
      if (canNpcStand(x,y)) return {x,y};
    }
    return null;
  }

  async function summonCharacter(name, fixedPosition=null) {
    if (!dialogueMap.has(name)) return false;
    if (npcs.has(name)) {
      showToast(`${name} はすでに店内にいます`);
      return false;
    }
    let pos = fixedPosition;
    if (!pos || !canNpcStand(pos.x,pos.y)) pos = findSpawnNearPlayer();
    if (!pos) {
      showToast('召喚できる空き場所がありません');
      return false;
    }
    try {
      await loadCharacterNeutral(name);
    } catch (err) {
      console.error(err);
      showToast(`${name} の画像を読み込めません`);
      return false;
    }
    const npc = { name, x:pos.x, y:pos.y, facing:'down', idleClock:Math.random()*10 };
    faceToward(npc, player.x, player.y);
    npcs.set(name, npc);
    updateCharacterUI();
    showToast(`${name} を召喚しました`);
    return true;
  }

  function removeCharacter(name, silent=false) {
    if (!npcs.has(name)) return;
    if (activeDialogueName === name) closeDialogue();
    npcs.delete(name);
    updateCharacterUI();
    if (!silent) showToast(`${name} を削除しました`);
  }
  function removeAllCharacters() {
    closeDialogue();
    npcs.clear();
    updateCharacterUI();
    showToast('キャラクターを全削除しました');
  }

  function updateCharacterUI() {
    npcCount.textContent = `${npcs.size} / ${characterNames.length}`;
    renderCharacterList(characterSearch.value);
  }

  function renderCharacterList(filter='') {
    const q = filter.trim().toLowerCase();
    const frag = document.createDocumentFragment();
    for (const name of characterNames) {
      if (q && !name.toLowerCase().includes(q)) continue;
      const on = npcs.has(name);
      const row = document.createElement('div');
      row.className = 'character-row';
      const info = document.createElement('div');
      info.className = 'character-info';
      const dot = document.createElement('span');
      dot.className = 'status-dot' + (on ? ' on' : '');
      const text = document.createElement('div');
      const nm = document.createElement('div');
      nm.className = 'character-name'; nm.textContent = name;
      const st = document.createElement('div');
      st.className = 'character-state'; st.textContent = on ? '店内にいます' : '未召喚';
      text.append(nm,st); info.append(dot,text);
      const btn = document.createElement('button');
      btn.type='button'; btn.className='row-action' + (on ? ' remove' : '');
      btn.textContent = on ? '削除' : '召喚';
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        if (npcs.has(name)) removeCharacter(name);
        else await summonCharacter(name);
        btn.disabled = false;
        renderCharacterList(characterSearch.value);
      });
      row.append(info,btn); frag.append(row);
    }
    characterList.replaceChildren(frag);
  }

  function openCharacterPanel() {
    if (dialogueOpen) closeDialogue();
    characterModalOpen = true;
    characterOverlay.classList.add('open');
    characterOverlay.setAttribute('aria-hidden','false');
    renderCharacterList(characterSearch.value);
    setModalState();
    setTimeout(() => characterSearch.focus(), 50);
  }
  function closeCharacterPanel() {
    characterModalOpen = false;
    characterOverlay.classList.remove('open');
    characterOverlay.setAttribute('aria-hidden','true');
    characterSearch.blur();
    setModalState();
  }
  function openHelp() {
    helpModalOpen = true;
    helpOverlay.classList.add('open');
    helpOverlay.setAttribute('aria-hidden','false');
    setModalState();
  }
  function closeHelp() {
    helpModalOpen = false;
    helpOverlay.classList.remove('open');
    helpOverlay.setAttribute('aria-hidden','true');
    setModalState();
  }

  function nextDialogueLine(name) {
    const lines = dialogueMap.get(name) || [];
    if (!lines.length) return '……。';
    let idx = dialogueCursor.get(name);
    if (idx == null) idx = Math.floor(Math.random()*lines.length);
    else idx = (idx + 1) % lines.length;
    dialogueCursor.set(name, idx);
    return lines[idx];
  }
  function showDialogueLine(name) {
    dialogueName.textContent = name;
    dialogueText.textContent = nextDialogueLine(name);
    dialoguePortrait.src = encodeURI(charPath(name, FRAME_FILES.down[0]));
    dialoguePortrait.alt = `${name}のドット絵`;
  }
  function openDialogue(name) {
    const npc = npcs.get(name);
    if (!npc) return;
    activeDialogueName = name;
    dialogueOpen = true;
    faceToward(player, npc.x, npc.y);
    faceToward(npc, player.x, player.y);
    showDialogueLine(name);
    dialoguePanel.classList.add('open');
    dialoguePanel.setAttribute('aria-hidden','false');
    keyDirs.clear(); touchDirs.clear(); pointerDirMap.clear();
    document.querySelectorAll('.dpad-button.pressed').forEach(b=>b.classList.remove('pressed'));
    setModalState();
  }
  function closeDialogue() {
    dialogueOpen = false;
    activeDialogueName = null;
    dialoguePanel.classList.remove('open');
    dialoguePanel.setAttribute('aria-hidden','true');
    setModalState();
  }
  function tryTalk() {
    if (characterModalOpen || helpModalOpen) return;
    if (dialogueOpen) {
      showDialogueLine(activeDialogueName);
      return;
    }
    if (!activeNearest) {
      showToast('近くに話せる相手がいません');
      return;
    }
    openDialogue(activeNearest.name);
  }

  function getMoveVector() {
    let x=0,y=0;
    const dirs = new Set([...keyDirs,...touchDirs]);
    if (dirs.has('left')) x -= 1;
    if (dirs.has('right')) x += 1;
    if (dirs.has('up')) y -= 1;
    if (dirs.has('down')) y += 1;
    if (x && y) { const n=Math.SQRT1_2; x*=n; y*=n; }
    return {x,y};
  }

  function updatePlayer(dt) {
    if (dialogueOpen || characterModalOpen || helpModalOpen) { player.moving=false; return; }
    const v = getMoveVector();
    player.moving = !!(v.x || v.y);
    if (!player.moving) return;
    if (Math.abs(v.x) > Math.abs(v.y)) player.facing = v.x>0 ? 'right' : 'left';
    else if (Math.abs(v.y) > 0) player.facing = v.y>0 ? 'down' : 'up';
    const step = player.speed * dt;
    const nx = player.x + v.x*step;
    const ny = player.y + v.y*step;
    if (canPlayerStand(nx, player.y)) player.x = nx;
    if (canPlayerStand(player.x, ny)) player.y = ny;
    player.walkClock += dt;
  }

  function updateNearest() {
    let best = null, bestD = TALK_RANGE + 1;
    for (const npc of npcs.values()) {
      const d = Math.hypot(npc.x-player.x, npc.y-player.y);
      if (d < bestD) { best = npc; bestD = d; }
    }
    activeNearest = bestD <= TALK_RANGE ? best : null;
    talkBtn.disabled = !activeNearest && !dialogueOpen;
    if (dialogueOpen && activeDialogueName) {
      talkTarget.textContent = '次の話題';
      nearbyBadge.classList.remove('show');
    } else if (activeNearest) {
      talkTarget.textContent = activeNearest.name;
      nearbyBadge.textContent = `${activeNearest.name} と話せます`;
      nearbyBadge.classList.add('show');
    } else {
      talkTarget.textContent = '近くに誰もいません';
      nearbyBadge.classList.remove('show');
    }
  }

  function updateNpcs(dt) {
    for (const npc of npcs.values()) {
      npc.idleClock += dt;
      // Very subtle static-idle turning so summoned characters feel alive without roaming.
      if (!dialogueOpen && npc.idleClock > 5 + (npc.name.length % 4)) {
        npc.idleClock = 0;
        const dx = player.x-npc.x, dy=player.y-npc.y;
        if (Math.hypot(dx,dy) < 210) faceToward(npc,player.x,player.y);
      }
    }
  }

  function drawSprite(image, x, y, alpha=1) {
    const sx = (x - cameraX) * cameraScale + canvas.width/(2*dpr);
    const sy = (y - cameraY) * cameraScale + canvas.height/(2*dpr);
    const dw = SPRITE_W * cameraScale;
    const dh = SPRITE_H * cameraScale;
    ctx.globalAlpha = alpha;
    ctx.drawImage(image, (sx - dw/2)*dpr, (sy - dh)*dpr, dw*dpr, dh*dpr);
    ctx.globalAlpha = 1;
  }

  function currentPlayerFrame() {
    const arr = playerFrames[player.facing];
    if (!arr || !arr.length) return null;
    if (!player.moving) return arr[0];
    const idx = WALK_CYCLE[Math.floor(player.walkClock / .12) % WALK_CYCLE.length];
    return arr[idx];
  }

  function drawWorld() {
    const cssW = canvas.width/dpr, cssH = canvas.height/dpr;
    const viewW = cssW / cameraScale;
    const viewH = cssH / cameraScale;
    cameraX += (player.x-cameraX) * .14;
    cameraY += (player.y-cameraY) * .14;
    const halfW=viewW/2, halfH=viewH/2;
    if (viewW < MAP_W) cameraX = Math.max(halfW, Math.min(MAP_W-halfW, cameraX)); else cameraX=MAP_W/2;
    if (viewH < MAP_H) cameraY = Math.max(halfH, Math.min(MAP_H-halfH, cameraY)); else cameraY=MAP_H/2;

    const sx = cameraX - viewW/2, sy = cameraY - viewH/2;
    ctx.fillStyle = '#0b0908';
    ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(mapImage, sx,sy,viewW,viewH, 0,0,canvas.width,canvas.height);

    const entities = [];
    for (const npc of npcs.values()) entities.push({type:'npc', y:npc.y, ref:npc});
    entities.push({type:'player', y:player.y, ref:player});
    entities.sort((a,b)=>a.y-b.y);

    for (const e of entities) {
      if (e.type==='player') {
        const im = currentPlayerFrame();
        if (im) drawSprite(im, player.x, player.y);
      } else {
        const npc=e.ref;
        const frames=npcFrames.get(npc.name);
        if (frames && frames[npc.facing]) drawSprite(frames[npc.facing], npc.x, npc.y);
      }
    }

    // interaction marker around the nearest NPC's feet
    if (activeNearest && !dialogueOpen) {
      const sx2=(activeNearest.x-cameraX)*cameraScale+cssW/2;
      const sy2=(activeNearest.y-cameraY)*cameraScale+cssH/2;
      ctx.save();
      ctx.strokeStyle='rgba(255,218,133,.9)';
      ctx.lineWidth=2*dpr;
      ctx.setLineDash([5*dpr,4*dpr]);
      ctx.beginPath();
      ctx.ellipse(sx2*dpr, sy2*dpr, 26*cameraScale*dpr, 10*cameraScale*dpr, 0,0,Math.PI*2);
      ctx.stroke();
      ctx.restore();
    }
  }

  function frame(now) {
    resizeCanvas();
    updateCameraScale();
    const dt = Math.min(.04, Math.max(0, (now-lastTime)/1000));
    lastTime = now;
    if (ready) {
      updatePlayer(dt);
      updateNpcs(dt);
      updateNearest();
      drawWorld();
    }
    requestAnimationFrame(frame);
  }

  function mapKeyToDir(code) {
    if (code==='ArrowUp'||code==='KeyW') return 'up';
    if (code==='ArrowDown'||code==='KeyS') return 'down';
    if (code==='ArrowLeft'||code==='KeyA') return 'left';
    if (code==='ArrowRight'||code==='KeyD') return 'right';
    return null;
  }
  window.addEventListener('keydown', e => {
    const target=e.target;
    const typing = target && (target.tagName==='INPUT'||target.tagName==='TEXTAREA'||target.isContentEditable);
    if (typing) {
      if (e.code==='Escape') { target.blur(); closeCharacterPanel(); closeHelp(); }
      return;
    }
    const dir=mapKeyToDir(e.code);
    if (dir) { e.preventDefault(); keyDirs.add(dir); return; }
    if ((e.code==='KeyE'||e.code==='Enter'||e.code==='Space') && !e.repeat) { e.preventDefault(); tryTalk(); }
    else if ((e.code==='KeyM'||e.code==='KeyC') && !e.repeat) { e.preventDefault(); characterModalOpen ? closeCharacterPanel() : openCharacterPanel(); }
    else if (e.code==='Escape' && !e.repeat) {
      if (dialogueOpen) closeDialogue(); else if (characterModalOpen) closeCharacterPanel(); else if (helpModalOpen) closeHelp();
    }
  }, {passive:false});
  window.addEventListener('keyup', e => {
    const dir=mapKeyToDir(e.code); if (dir) keyDirs.delete(dir);
  });
  window.addEventListener('blur', () => { keyDirs.clear(); touchDirs.clear(); pointerDirMap.clear(); });

  document.querySelectorAll('.dpad-button[data-dir]').forEach(btn => {
    const dir=btn.dataset.dir;
    btn.addEventListener('pointerdown', e => {
      e.preventDefault();
      btn.setPointerCapture?.(e.pointerId);
      pointerDirMap.set(e.pointerId, dir);
      touchDirs.add(dir);
      btn.classList.add('pressed');
    });
    const release = e => {
      const d=pointerDirMap.get(e.pointerId);
      pointerDirMap.delete(e.pointerId);
      if (d) {
        const still=[...pointerDirMap.values()].includes(d);
        if (!still) touchDirs.delete(d);
      }
      btn.classList.remove('pressed');
    };
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
    btn.addEventListener('lostpointercapture', release);
  });

  talkBtn.addEventListener('click', tryTalk);
  characterBtn.addEventListener('click', openCharacterPanel);
  characterCloseBtn.addEventListener('click', closeCharacterPanel);
  characterOverlay.addEventListener('pointerdown', e => { if (e.target===characterOverlay) closeCharacterPanel(); });
  characterSearch.addEventListener('input', () => renderCharacterList(characterSearch.value));
  randomSummonBtn.addEventListener('click', async () => {
    const candidates = characterNames.filter(n => !npcs.has(n));
    if (!candidates.length) { showToast('全キャラクターが召喚済みです'); return; }
    const name=candidates[Math.floor(Math.random()*candidates.length)];
    randomSummonBtn.disabled=true;
    await summonCharacter(name);
    randomSummonBtn.disabled=false;
  });
  removeAllBtn.addEventListener('click', () => {
    if (!npcs.size) { showToast('削除するキャラクターがいません'); return; }
    removeAllCharacters();
  });

  dialogueNextBtn.addEventListener('click', () => { if (activeDialogueName) showDialogueLine(activeDialogueName); });
  dialogueCloseBtn.addEventListener('click', closeDialogue);
  dialoguePanel.addEventListener('pointerdown', e => e.stopPropagation());

  helpBtn.addEventListener('click', openHelp);
  helpCloseBtn.addEventListener('click', closeHelp);
  helpOkBtn.addEventListener('click', closeHelp);
  helpOverlay.addEventListener('pointerdown', e => { if (e.target===helpOverlay) closeHelp(); });
  zoomInBtn.addEventListener('click', () => changeZoom(1.12));
  zoomOutBtn.addEventListener('click', () => changeZoom(1/1.12));

  document.addEventListener('contextmenu', e => { if (app.contains(e.target)) e.preventDefault(); });

  async function boot() {
    try {
      loadingText.textContent='マップを読み込み中…';
      await new Promise((resolve,reject)=>{ mapImage.onload=resolve; mapImage.onerror=reject; mapImage.src='assets/map/ifun_hanten.png'; });
      loadingText.textContent='プレイヤーを読み込み中…';
      await loadPlayerFrames();
      loadingText.textContent='店員を呼んでいます…';
      await loadCharacterNeutral('モン');
      ready=true;
      updateCameraScale();
      // The restaurant staff is present by default. User can delete him like anyone else.
      await summonCharacter('モン', {x:800,y:480});
      loading.classList.add('hidden');
      setTimeout(()=>loading.remove(),260);
      showToast('十字キーで移動 → 近づいて「話す」', 2600);
    } catch (err) {
      console.error(err);
      loadingText.textContent='読み込みに失敗しました。ZIPを展開したまま index.html を開いてください。';
    }
  }

  renderCharacterList();
  requestAnimationFrame(frame);
  boot();
})();
