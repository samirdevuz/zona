import { loadModel, bakeParts, partsBox } from '../lib.mjs';
import * as THREE from 'three';
const root = await loadModel('assets-src/t12/T-12 soviet tank.fbx');
const all = bakeParts(root, (n, o, h) => h);
const s = 0.01053;
const m = new THREE.Matrix4().makeRotationY(Math.PI).premultiply(new THREE.Matrix4().makeScale(s, s, s));
for (const p of all) p.geo.applyMatrix4(m);
const box = partsBox(all);
console.log('all', box.min.toArray().map(v=>v.toFixed(2)), box.max.toArray().map(v=>v.toFixed(2)));
const tower = all.filter(p => p.mesh === 'T-26_TOWER');
// thin-slice turret along z after the turn
const bins = new Map();
for (const p of tower) { const a = p.geo.attributes.position.array; for (let i=0;i<a.length;i+=9){ const cz=(a[i+2]+a[i+5]+a[i+8])/3, cx=(a[i]+a[i+3]+a[i+6])/3, cy=(a[i+1]+a[i+4]+a[i+7])/3; const k=Math.floor(cz/0.1); const b=bins.get(k)??{x0:9,x1:-9,y0:9,y1:-9,n:0}; b.x0=Math.min(b.x0,cx);b.x1=Math.max(b.x1,cx);b.y0=Math.min(b.y0,cy);b.y1=Math.max(b.y1,cy);b.n++;bins.set(k,b);} }
for (const k of [...bins.keys()].sort((a,b)=>a-b)) { const b=bins.get(k); console.log('z', (k*0.1).toFixed(1), 'cx', b.x0.toFixed(2), b.x1.toFixed(2), 'cy', b.y0.toFixed(2), b.y1.toFixed(2), b.n); }
