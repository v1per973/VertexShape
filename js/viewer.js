(function(){
  const container  = document.getElementById('viewer');
  const labelLayer = document.getElementById('labelLayer');
  const fileInput  = document.getElementById('file');
  const btnChoose  = document.getElementById('btnChoose');
  const fileLabel  = document.getElementById('fileLabel');
  const edgeCount  = document.getElementById('edgeCount');
  const bbSizeEl   = document.getElementById('bbSize');
  const toolbar    = document.getElementById('toolbar');

  if (toolbar) {
    toolbar.style.background = 'transparent';
    toolbar.style.border = 'none';
    toolbar.style.boxShadow = 'none';
    toolbar.style.backdropFilter = 'none';
  }

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0f14);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.01, 1e9);
  camera.position.set(3,2,4);

  const renderer = new THREE.WebGLRenderer({antialias:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.065;

  const hemi=new THREE.HemisphereLight(0xffffff,0x223355,.7);
  const dl = new THREE.DirectionalLight(0xffffff,1.1);
  dl.position.set(3,5,2);
  scene.add(hemi, dl);

  const grid = new THREE.GridHelper(100, 100, 0x2a3a5a, 0x122038);
  grid.material.opacity = 0.25; grid.material.transparent = true;
  grid.visible = false;
  scene.add(grid);

  const edgesGroup=new THREE.Group();
  scene.add(edgesGroup);

  const bootCube = new THREE.Mesh(
    new THREE.BoxGeometry(1,1,1),
    new THREE.MeshStandardMaterial({color:0x2dd4bf, metalness:.1, roughness:.6})
  );
  scene.add(bootCube);

  const UNITS_TO_CM = 1;
  function fmtLenCm(cm){
    const v = cm;
    const dp = v>=100 ? 0 : v>=10 ? 1 : 2;
    return v.toFixed(dp)+' cm';
  }
  function pixelsToWorld(px, atWorldPos){
    const dist=camera.position.distanceTo(atWorldPos);
    const h=2*dist*Math.tan(THREE.MathUtils.degToRad(camera.fov)/2);
    return px*(h/container.clientHeight);
  }

  let modelRoot=null;
  let edgesVisible=true;

  let rawSegments=[];
  let mergedSegments=[];
  let labelItems=[];
  let diagLen=1;
  let selectedIndex=-1;

  function setModelLoaded(loaded){
    grid.visible = !!loaded;
  }
  setModelLoaded(false);

  async function loadFromFile(file){
    try{
      const url = URL.createObjectURL(file);
      const loader = new THREE.OBJLoader();
      loader.load(url, (obj)=>{
        if(modelRoot) modelRoot.removeFromParent();
        obj.traverse(o=>{
          if(o.isMesh){
            if(!o.material || Array.isArray(o.material)){
              o.material = new THREE.MeshStandardMaterial({ color:0x9bb8ff, metalness:.1, roughness:.55 });
            }
            if(!o.geometry.isBufferGeometry){
              const g = new THREE.BufferGeometry().setFromObject(o);
              o.geometry.dispose?.();
              o.geometry = g;
            }
            o.castShadow = o.receiveShadow = true;
          }
        });

        modelRoot = obj;
        scene.add(obj);
        setModelLoaded(true);
        if (fileLabel) fileLabel.textContent = file.name;

        let meshes=0;
        obj.traverse(o=>{ if(o.isMesh) meshes++; });

        const box=new THREE.Box3().setFromObject(obj);
        const sizeWorld=box.getSize(new THREE.Vector3());
        const sizeCM=sizeWorld.clone().multiplyScalar(UNITS_TO_CM);
        if (bbSizeEl) bbSizeEl.textContent=`${sizeCM.x.toFixed(2)}×${sizeCM.y.toFixed(2)}×${sizeCM.z.toFixed(2)} cm`;
        diagLen = sizeWorld.length() || 1;

        fitCameraToObject(obj,1.25);
        buildRawSegments();
        mergeCollinearSegments();
        rebuildLabels();
        bootCube.removeFromParent();
      }, undefined, ()=>{
        setModelLoaded(false);
      });
    }catch{
      setModelLoaded(false);
    }
  }

  const EDGE_ANGLE_DEG = 1.0;
  function getMinEdgeUnits(){ return 0; }

  function buildRawSegments(){
    clearGroup(edgesGroup);
    rawSegments.length=0;

    if(!modelRoot){ if(edgeCount) edgeCount.textContent='0'; return; }

    const lineMat=new THREE.LineBasicMaterial({color:0x93c5fd,transparent:true,opacity:.5});

    modelRoot.updateWorldMatrix(true,true);
    modelRoot.traverse(o=>{
      if(!o.isMesh) return;
      if(!o.geometry || !o.geometry.attributes?.position) return;
      const egeom=new THREE.EdgesGeometry(o.geometry, EDGE_ANGLE_DEG);
      const lines=new THREE.LineSegments(egeom,lineMat);
      lines.applyMatrix4(o.matrixWorld);
      if(edgesVisible) edgesGroup.add(lines);

      const pos=egeom.attributes.position;
      for(let i=0;i<pos.count;i+=2){
        const a=new THREE.Vector3(pos.getX(i),pos.getY(i),pos.getZ(i)).applyMatrix4(o.matrixWorld);
        const b=new THREE.Vector3(pos.getX(i+1),pos.getY(i+1),pos.getZ(i+1)).applyMatrix4(o.matrixWorld);
        if(a.distanceToSquared(b) < 1e-18) continue;
        rawSegments.push({a,b});
      }
    });
  }

  function canonicalDir(v){
    const d=v.clone().normalize();
    const ax=Math.abs(d.x), ay=Math.abs(d.y), az=Math.abs(d.z);
    if(ax>=ay && ax>=az){ if(d.x<0) d.multiplyScalar(-1); }
    else if(ay>=ax && ay>=az){ if(d.y<0) d.multiplyScalar(-1); }
    else { if(d.z<0) d.multiplyScalar(-1); }
    return d;
  }
  function lineAnchor(p, dir){
    const t = p.dot(dir);
    return p.clone().sub(dir.clone().multiplyScalar(t));
  }
  function qKeyVec(v, step){
    return `${Math.round(v.x/step)},${Math.round(v.y/step)},${Math.round(v.z/step)}`;
  }

  function mergeCollinearSegments(){
    const EPS_ANCHOR = Math.max(1e-9, diagLen*1e-6);
    const EPS_DIR    = 1e-6;
    const GAP_TOL    = Math.max(1e-9, diagLen*1e-6);

    const groups=new Map();
    for(const seg of rawSegments){
      const dir = canonicalDir(seg.b.clone().sub(seg.a));
      const anchor = lineAnchor(seg.a, dir);
      const dkey = qKeyVec(dir, EPS_DIR);
      const akey = qKeyVec(anchor, EPS_ANCHOR);
      const key = akey + '|' + dkey;

      let g = groups.get(key);
      if(!g){ g = { anchor, dir, intervals:[] }; groups.set(key,g); }
      const s0 = seg.a.dot(g.dir);
      const s1 = seg.b.dot(g.dir);
      const a1 = Math.min(s0,s1), b1 = Math.max(s0,s1);
      g.intervals.push([a1,b1]);
    }

    mergedSegments.length=0;
    const minUnits = getMinEdgeUnits();
    groups.forEach(g=>{
      g.intervals.sort((i1,i2)=>i1[0]-i2[0]);
      const merged=[];
      let cur=null;
      for(const iv of g.intervals){
        if(!cur){ cur=[iv[0],iv[1]]; continue; }
        if(iv[0] <= cur[1] + GAP_TOL){ cur[1] = Math.max(cur[1], iv[1]); }
        else{ merged.push(cur); cur=[iv[0],iv[1]]; }
      }
      if(cur) merged.push(cur);

      for(const iv of merged){
        const lenUnits = Math.max(0, iv[1]-iv[0]);
        if(lenUnits < Math.max(minUnits, GAP_TOL)) continue;
        const A = g.dir.clone().multiplyScalar(iv[0]).add(g.anchor);
        const B = g.dir.clone().multiplyScalar(iv[1]).add(g.anchor);
        const mid = A.clone().add(B).multiplyScalar(0.5);
        mergedSegments.push({a:A,b:B,mid,lenCm: lenUnits*UNITS_TO_CM});
      }
    });

    if (edgeCount) edgeCount.textContent=String(mergedSegments.length);
    selectedIndex = -1;
  }

  function rebuildLabels(){
    for(const it of labelItems){
      if(it.el && it.el.parentNode) it.el.parentNode.removeChild(it.el);
    }
    labelItems.length=0;
    for(const e of mergedSegments){
      const el=document.createElement('div');
      el.className='label';
      el.textContent=fmtLenCm(e.lenCm);
      el.style.position='absolute';
      el.style.left='0px'; el.style.top='0px';
      el.style.transformOrigin='50% 50%';
      el.style.pointerEvents='none';
      el.style.display='none';
      labelLayer.appendChild(el);
      labelItems.push({a:e.a.clone(), b:e.b.clone(), mid:e.mid.clone(), el});
    }
  }

  function updateLabels(){
    if(selectedIndex<0) return;
    const it = labelItems[selectedIndex];
    const w=container.clientWidth, h=container.clientHeight;
    const toScreen = (v)=>{
      const p=v.clone().project(camera);
      return {x:(p.x+1)*0.5*w, y:(1-p.y)*0.5*h, z:p.z};
    };
    const pxOffset = 10;

    const sA=toScreen(it.a);
    const sB=toScreen(it.b);
    const sM=toScreen(it.mid);

    if(!(sM.z>=-1 && sM.z<=1)){ it.el.style.display='none'; return; }
    it.el.style.display='block';

    const dx=sB.x-sA.x, dy=sB.y-sA.y;
    const len=Math.hypot(dx,dy);
    const angle = (len>1e-4) ? Math.atan2(dy,dx)*180/Math.PI : 0;

    let offX=0, offY=0;
    if(len>1e-4){
      offX = (-dy/len)*pxOffset;
      offY = ( dx/len)*pxOffset;
    }

    it.el.style.left = `${sM.x + offX}px`;
    it.el.style.top  = `${sM.y + offY}px`;
    it.el.style.transform = `translate(-50%,-50%) rotate(${angle}deg)`;
  }

  function hideAllLabels(){
    for(const it of labelItems) it.el.style.display='none';
  }

  const raycaster = new THREE.Raycaster();
  const _tmpRayPt = new THREE.Vector3();
  const _tmpSegPt = new THREE.Vector3();

  function pickEdge(clientX, clientY){
    if(labelItems.length===0) return -1;
    const rect = renderer.domElement.getBoundingClientRect();
    const mouse = {
      x: ((clientX - rect.left) / rect.width) * 2 - 1,
      y: -((clientY - rect.top)  / rect.height) * 2 + 1
    };
    raycaster.setFromCamera(mouse, camera);
    let best=-1, bestD=Infinity;
    for(let i=0;i<labelItems.length;i++){
      const it = labelItems[i];
      const d2 = raycaster.ray.distanceSqToSegment(it.a, it.b, _tmpRayPt, _tmpSegPt);
      const th = pixelsToWorld(8, it.mid);
      if(d2 <= th*th){
        if(d2 < bestD){ bestD = d2; best = i; }
      }
    }
    return best;
  }

  function fitCameraToObject(obj,pad=1.2){
    const box=new THREE.Box3().setFromObject(obj);
    const size=box.getSize(new THREE.Vector3());
    const center=box.getCenter(new THREE.Vector3());
    const maxSize=Math.max(size.x,size.y,size.z);
    const fitH=maxSize/(2*Math.tan(THREE.MathUtils.degToRad(camera.fov)/2));
    const fitW=fitH/camera.aspect;
    const dist=pad*Math.max(fitH,fitW);
    camera.position.copy(center.clone().add(new THREE.Vector3(1,1,1).normalize().multiplyScalar(dist)));
    controls.target.copy(center);
    camera.near=dist/100; camera.far=dist*1000;
    camera.updateProjectionMatrix();
    controls.update();
  }

  btnChoose.addEventListener('click', ()=> fileInput.click());
  fileInput.addEventListener('change', e=>{
    const f=e.target.files?.[0];
    if(f && /\.obj$/i.test(f.name)){ loadFromFile(f); }
    else { e.target.value=''; }
  });

  renderer.domElement.addEventListener('pointerdown', (e)=>{
    const idx = pickEdge(e.clientX, e.clientY);
    if(idx === -1){ hideAllLabels(); selectedIndex=-1; }
    else{
      hideAllLabels();
      selectedIndex = idx;
      labelItems[selectedIndex].el.style.display='block';
      updateLabels();
    }
  });

  function onResize(){
    const w=container.clientWidth,h=container.clientHeight;
    camera.aspect=w/h; camera.updateProjectionMatrix();
    renderer.setSize(w,h,false);
  }
  new ResizeObserver(onResize).observe(container);

  let last=performance.now();
  function animate(){
    requestAnimationFrame(animate);
    const now=performance.now(); const dt=Math.min(.05,(now-last)/1000); last=now;
    if (bootCube.parent) { bootCube.rotation.y += dt*0.6; bootCube.rotation.x += dt*0.15; }
    controls.update();
    updateLabels();
    renderer.render(scene,camera);
  }
  animate();

  function clearGroup(g){
    for(let i=g.children.length-1;i>=0;i--){
      const o=g.children[i];
      if(o.geometry) o.geometry.dispose?.();
      g.remove(o);
    }
  }
})();
