import { loadModel } from '../lib.mjs';
import * as THREE from 'three';
const root = await loadModel(process.argv[2]);
const pr = (o, d = 0) => {
  if (d > 4 && o.isBone) return;
  console.log(' '.repeat(d * 2) + `${o.type} ${o.name} pos=${o.position.toArray().map((v) => v.toFixed(2))} rot=${o.rotation.toArray().slice(0, 3).map((v) => v.toFixed(2))} scale=${o.scale.toArray().map((v) => v.toFixed(3))}`);
  for (const c of o.children) pr(c, d + 1);
};
pr(root);
root.updateMatrixWorld(true);
const box = new THREE.Box3().setFromObject(root, true);
console.log('box', box.min.toArray().map((v) => v.toFixed(2)), box.max.toArray().map((v) => v.toFixed(2)));
root.traverse((o) => { if (o.isBone && /Head$|Hips|RightHand$|LeftFoot$/.test(o.name)) console.log(o.name, new THREE.Vector3().setFromMatrixPosition(o.matrixWorld).toArray().map((v) => v.toFixed(2))); });
